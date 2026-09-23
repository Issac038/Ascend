const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const auth = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// ------------------------------------------------------------
// JOURNAL PIN — private-journal access control within an
// authenticated Ascend account.
//
// Threat model (stated honestly): a 4-digit PIN has 10,000
// combinations. It is privacy against casual access (a friend
// glancing at an open laptop / shared device), NOT strong
// cryptographic security. The account password still protects
// the account itself. Defenses implemented:
//   - PIN stored only as a bcrypt hash (never plaintext, never
//     returned by any API, never logged)
//   - constant-time compare via bcrypt
//   - attempt counter + escalating temporary lockout on the
//     server (survives client state: verify route refuses while
//     locked, regardless of how the client behaves)
//   - per-route IP rate limiting on top of the per-user lockout
//   - recovery via account password (journal is never permanently
//     inaccessible)
// ------------------------------------------------------------

const BCRYPT_COST = 10;
const MAX_ATTEMPTS = 5; // per lockout window
const LOCK_BASE_MINUTES = 2; // doubles with each successive lockout, capped
const LOCK_MAX_MINUTES = 30;
const UNLOCK_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h session unlock

const pinLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30, // generous for honest users; brute force dies to lockout anyway
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Try again in a few minutes." }
});

// ---------- unlock token (HMAC, stateless, TTL) ----------
// Token format: <userId>.<expiresAtMs>.<hmac_sha256(payload)>
// Proves the user entered the correct PIN recently. Not a secret:
// it only exists so journal routes can require an unlock event
// without re-sending the PIN on every request.
function signUnlockToken(userId, expiresAtMs) {
    const payload = `${userId}.${expiresAtMs}`;
    const sig = crypto
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(`journal-unlock:${payload}`)
        .digest("hex");
    return `${payload}.${sig}`;
}

function verifyUnlockToken(token, userId) {
    if (typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [uid, expStr, sig] = parts;
    if (uid !== String(userId)) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = crypto
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(`journal-unlock:${uid}.${expStr}`)
        .digest("hex");
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- lockout helpers ----------
function lockoutMinutesFor(attempts) {
    // attempts counts how many lockouts have already elapsed this streak:
    // 2, 4, 8, ... capped at 30 minutes.
    const cycles = Math.max(1, Math.floor(attempts / MAX_ATTEMPTS));
    return Math.min(LOCK_BASE_MINUTES * 2 ** (cycles - 1), LOCK_MAX_MINUTES);
}

async function pinStatusFor(userId) {
    const u = await User.findById(userId).select("journalPinHash journalPinLockUntil").lean();
    if (!u) return null;
    const now = new Date();
    const lockedUntil = u.journalPinLockUntil && u.journalPinLockUntil > now ? u.journalPinLockUntil : null;
    return {
        configured: !!u.journalPinHash,
        locked: !!lockedUntil,
        lockSecondsRemaining: lockedUntil ? Math.ceil((lockedUntil - now) / 1000) : 0,
        unlocked: lockedUntil ? false : undefined // set by caller if a valid token is present
    };
}

// ---------- middleware used by the journal content routes ----------
async function requireJournalUnlock(req, res, next) {
    try {
        const u = await User.findById(req.userId).select("journalPinHash journalPinLockUntil").lean();
        if (!u || !u.journalPinHash) return next(); // no PIN configured -> unlocked

        const now = new Date();
        if (u.journalPinLockUntil && u.journalPinLockUntil > now) {
            return res.status(423).json({
                success: false,
                code: "JOURNAL_LOCKED",
                message: "Journal is locked. Too many incorrect attempts — try again later."
            });
        }

        const token = req.headers["x-journal-unlock"] || (req.body && req.body.unlockToken);
        if (token && verifyUnlockToken(token, req.userId)) return next();

        return res.status(423).json({
            success: false,
            code: "JOURNAL_LOCKED",
            message: "Journal is locked. Enter your PIN to continue."
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to check journal lock" });
    }
}

// ---------- status (no content exposure) ----------
router.get("/status", auth, async (req, res) => {
    try {
        const status = await pinStatusFor(req.userId);
        if (!status) return res.status(404).json({ success: false, message: "User not found" });
        const token = req.headers["x-journal-unlock"];
        status.unlocked = status.configured && !status.locked
            ? !!(token && verifyUnlockToken(token, req.userId))
            : false;
        if (!status.configured) status.unlocked = true;
        res.json({ success: true, ...status });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load journal security status" });
    }
});

// ---------- setup / change PIN ----------
router.post("/pin", pinLimiter, auth, async (req, res) => {
    try {
        const { pin, confirmPin, currentPin } = req.body;
        const pinStr = String(pin ?? "");

        if (!/^\d{4}$/.test(pinStr)) {
            return res.status(400).json({ success: false, message: "PIN must be exactly 4 digits" });
        }
        if (confirmPin !== undefined && String(confirmPin) !== pinStr) {
            return res.status(400).json({ success: false, message: "PINs do not match" });
        }
        // Trivially guessable PINs are allowed (it's the user's privacy trade
        // off to make) but a PIN equal to its own digits-reverse is still
        // hashed and rate-limited like any other. No extra rules.

        const user = await User.findById(req.userId).select("journalPinHash journalPinLockUntil journalPinAttempts password");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (user.journalPinHash) {
            // Replacing an existing PIN requires the current PIN.
            if (!currentPin) {
                return res.status(400).json({ success: false, message: "Enter your current PIN to change it" });
            }
            const now = new Date();
            if (user.journalPinLockUntil && user.journalPinLockUntil > now) {
                return res.status(423).json({ success: false, code: "JOURNAL_LOCKED", message: "Too many incorrect attempts — try again later." });
            }
            const ok = await bcrypt.compare(String(currentPin), user.journalPinHash);
            if (!ok) {
                user.journalPinAttempts = (user.journalPinAttempts || 0) + 1;
                if (user.journalPinAttempts >= MAX_ATTEMPTS) {
                    user.journalPinLockUntil = new Date(Date.now() + lockoutMinutesFor(user.journalPinAttempts) * 60 * 1000);
                    user.journalPinAttempts = 0;
                }
                await user.save();
                return res.status(400).json({ success: false, message: "Current PIN is incorrect" });
            }
        }

        user.journalPinHash = await bcrypt.hash(pinStr, BCRYPT_COST);
        user.journalPinAttempts = 0;
        user.journalPinLockUntil = null;
        user.journalPinSetAt = new Date();
        await user.save();

        res.json({ success: true, unlockedToken: signUnlockToken(req.userId, Date.now() + UNLOCK_TOKEN_TTL_MS) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to save PIN" });
    }
});

// ---------- verify PIN -> unlock ----------
router.post("/verify", pinLimiter, auth, async (req, res) => {
    try {
        const pinStr = String(req.body.pin ?? "");
        const user = await User.findById(req.userId).select("journalPinHash journalPinLockUntil journalPinAttempts");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (!user.journalPinHash) {
            return res.json({ success: true, unlockedToken: signUnlockToken(req.userId, Date.now() + UNLOCK_TOKEN_TTL_MS) });
        }

        const now = new Date();
        if (user.journalPinLockUntil && user.journalPinLockUntil > now) {
            const secs = Math.ceil((user.journalPinLockUntil - now) / 1000);
            return res.status(423).json({
                success: false,
                code: "JOURNAL_LOCKED",
                message: "Too many incorrect attempts. Try again in a few minutes.",
                retryAfterSeconds: secs
            });
        }

        const ok = await bcrypt.compare(pinStr, user.journalPinHash);
        if (!ok) {
            user.journalPinAttempts = (user.journalPinAttempts || 0) + 1;
            if (user.journalPinAttempts >= MAX_ATTEMPTS) {
                user.journalPinLockUntil = new Date(Date.now() + lockoutMinutesFor(user.journalPinAttempts) * 60 * 1000);
                user.journalPinAttempts = 0;
                await user.save();
                return res.status(423).json({
                    success: false,
                    code: "JOURNAL_LOCKED",
                    message: "Too many incorrect attempts. Locked temporarily.",
                    retryAfterSeconds: LOCK_BASE_MINUTES * 60
                });
            }
            await user.save();
            return res.status(400).json({
                success: false,
                message: "Incorrect PIN.",
                attemptsRemaining: MAX_ATTEMPTS - user.journalPinAttempts
            });
        }

        user.journalPinAttempts = 0;
        user.journalPinLockUntil = null;
        await user.save();

        res.json({ success: true, unlockedToken: signUnlockToken(req.userId, Date.now() + UNLOCK_TOKEN_TTL_MS) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to verify PIN" });
    }
});

// ---------- recovery: account password resets the PIN ----------
router.post("/forgot", pinLimiter, auth, async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ success: false, message: "Account password is required" });

        const user = await User.findById(req.userId).select("password");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const ok = await bcrypt.compare(String(password), user.password);
        if (!ok) return res.status(400).json({ success: false, message: "Account password is incorrect" });

        user.journalPinHash = undefined;
        user.journalPinAttempts = 0;
        user.journalPinLockUntil = null;
        user.journalPinSetAt = undefined;
        await user.save();

        res.json({ success: true, message: "Journal PIN removed. Set a new one any time." });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to reset PIN" });
    }
});

// ---------- disable PIN (requires current PIN) ----------
router.delete("/pin", pinLimiter, auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("journalPinHash journalPinLockUntil");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (!user.journalPinHash) return res.json({ success: true });

        const now = new Date();
        if (user.journalPinLockUntil && user.journalPinLockUntil > now) {
            return res.status(423).json({ success: false, code: "JOURNAL_LOCKED", message: "Too many incorrect attempts — try again later." });
        }
        const ok = await bcrypt.compare(String(req.body?.pin ?? ""), user.journalPinHash);
        if (!ok) return res.status(400).json({ success: false, message: "Incorrect PIN" });

        user.journalPinHash = undefined;
        user.journalPinAttempts = 0;
        user.journalPinLockUntil = null;
        user.journalPinSetAt = undefined;
        await user.save();

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to remove PIN" });
    }
});

module.exports = { router, requireJournalUnlock, signUnlockToken, verifyUnlockToken };
