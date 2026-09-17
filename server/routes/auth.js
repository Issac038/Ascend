const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require("../models/User");
const Settings = require("../models/Settings");
const Area = require("../models/Area");
const auth = require("../middleware/auth");
const { todayKey, todayKeyFor, isValidDateKey } = require("../utils/date");
const { sendResetCode } = require("../utils/mailer");

const router = express.Router();

// (timezone cache lives in routes/data.js; profile updates there re-read the user)

const DEFAULT_AREAS = [
    { key: "body", name: "Body" },
    { key: "mind", name: "Mind" },
    { key: "discipline", name: "Discipline" },
    { key: "learning", name: "Learning" },
    { key: "productivity", name: "Productivity" },
    { key: "relationships", name: "Relationships" },
    { key: "finances", name: "Finances" },
    { key: "skills", name: "Skills" },
    { key: "personal", name: "Personal" }
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(userId) {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function setAuthCookie(res, token) {
    res.cookie("token", token, {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000
    });
}

function clampTzOffset(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(-840, Math.min(840, n));
}

async function createDefaultAreas(userId) {
    await Area.insertMany(
        DEFAULT_AREAS.map((a, i) => ({
            userId,
            key: a.key,
            name: a.name,
            order: i
        }))
    );
}

async function ensureSettings(userId) {
    let settings = await Settings.findOne({ userId });
    if (!settings) {
        settings = await Settings.create({ userId });
    }
    return settings;
}

// ------------------------------------------------------------
// REGISTER
// ------------------------------------------------------------
router.post("/register", async (req, res) => {
    try {
        const name = String(req.body.name || "").trim().slice(0, 60);
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return res.status(400).json({ success: false, message: "Please enter a valid email" });
        }
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({ success: false, message: "Password must be 8-128 characters" });
        }

        const existing = await User.findOne({ email }).lean();
        if (existing) {
            return res.status(409).json({ success: false, message: "An account with this email already exists" });
        }

        // Optional invite code: if INVITE_CODE is configured, registration is
        // invite-only (constant-time compare). Unset = open registration.
        if (process.env.INVITE_CODE) {
            const a = Buffer.from(String(req.body.inviteCode || ""));
            const b = Buffer.from(String(process.env.INVITE_CODE));
            if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
                return res.status(403).json({
                    success: false,
                    message: "Registration requires an invite code.",
                    codeRequired: true
                });
            }
        }

        const hashed = await bcrypt.hash(password, 12);
        const user = await User.create({ name, email, password: hashed });

        await createDefaultAreas(user._id);
        await ensureSettings(user._id);

        setAuthCookie(res, signToken(user._id));

        res.status(201).json({
            success: true,
            message: "Welcome to ASCEND",
            user: { id: user._id, name: user.name, email: user.email, onboarded: false }
        });
    } catch (error) {
        console.error("register error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ------------------------------------------------------------
// LOGIN
// ------------------------------------------------------------
router.post("/login", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!email || !password || email.length > 254 || password.length > 128) {
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        setAuthCookie(res, signToken(user._id));

        res.json({
            success: true,
            message: "Welcome back",
            user: { id: user._id, name: user.name, email: user.email, onboarded: user.onboarded }
        });
    } catch (error) {
        console.error("login error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ------------------------------------------------------------
// ME (session check)
// ------------------------------------------------------------
router.get("/me", auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("-password -__v");
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }
        await ensureSettings(req.userId);

        res.json({ success: true, user });
    } catch (error) {
        console.error("me error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ------------------------------------------------------------
// UPDATE PROFILE
// ------------------------------------------------------------
router.patch("/profile", auth, async (req, res) => {
    try {
        const allowed = ["name", "avatarInitials", "motto", "futureVision", "bio"];
        const limits = { name: 60, avatarInitials: 2, motto: 140, futureVision: 500, bio: 300 };
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                updates[key] = String(req.body[key]).slice(0, limits[key] || 500);
            }
        }
        if (updates.name !== undefined && !updates.name.trim()) {
            return res.status(400).json({ success: false, message: "Name cannot be empty" });
        }
        if (req.body.timezoneOffset !== undefined) {
            updates.timezoneOffset = clampTzOffset(req.body.timezoneOffset);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields to update" });
        }

        const user = await User.findByIdAndUpdate(
            req.userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select("-password -__v");

        res.json({ success: true, user });
    } catch (error) {
        console.error("profile error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ------------------------------------------------------------
// COMPLETE ONBOARDING
// ------------------------------------------------------------
router.post("/onboarding", auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(401).json({ success: false, message: "Not authenticated" });

        const {
            focusAreas = [],
            focusAreaNames = [],
            futureVision = "",
            motto = "",
            struggles = "",
            dailyAvailability = "45",
            priorities = [],
            currentHabits = [],
            desiredHabits = [],
            goals = [],
            timezoneOffset = 0
        } = req.body;

        const tz = clampTzOffset(timezoneOffset);
        if (tz) {
            user.timezoneOffset = tz;
        }

        // mark selected areas as focus
        if (Array.isArray(focusAreas) && focusAreas.length > 0) {
            await Area.updateMany(
                { userId: user._id, key: { $in: focusAreas.map(String).slice(0, 20) } },
                { $set: { focus: true } }
            );
        }

        // custom areas created during onboarding
        if (Array.isArray(focusAreaNames) && focusAreaNames.length > 0) {
            let order = await Area.countDocuments({ userId: user._id });
            for (const name of focusAreaNames.slice(0, 10)) {
                const trimmed = String(name).trim().slice(0, 40);
                if (!trimmed) continue;
                const key = `custom_${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${Date.now() % 10000}`;
                await Area.create({ userId: user._id, key, name: trimmed, focus: true, order });
                order += 1;
            }
        }

        if (motto) user.motto = String(motto).slice(0, 140);
        if (futureVision) user.futureVision = String(futureVision).slice(0, 500);
        user.onboarded = true;
        await user.save();

        // ---- Seed initial setup from onboarding answers ----
        const Habit = require("../models/Habit");
        const Task = require("../models/Task");
        const Goal = require("../models/Goal");

        const AVAILABILITY_MINUTES = Math.max(15, Math.min(600, Number(dailyAvailability) || 45));
        const maxHabits = Math.max(2, Math.min(6, Math.round(AVAILABILITY_MINUTES / 15)));

        const desired = [...desiredHabits, ...currentHabits]
            .filter(Boolean)
            .slice(0, maxHabits);

        const today = todayKeyFor(tz);
        for (const spec of desired) {
            await Habit.create({
                userId: user._id,
                name: String(spec.name || spec).slice(0, 80),
                area: String(spec.area || "personal").slice(0, 30),
                type: "boolean",
                frequency: "daily",
                difficulty: "medium",
                startDate: today
            });
        }

        const starterTasks = [
            { title: "Set up your daily plan", timeBlock: "morning" },
            { title: "Complete your first habits", timeBlock: "afternoon" },
            { title: "Write your first reflection", timeBlock: "evening" }
        ];
        for (const t of starterTasks) {
            await Task.create({ userId: user._id, title: t.title, date: today, timeBlock: t.timeBlock });
        }

        // Goals collected during onboarding
        for (const g of (Array.isArray(goals) ? goals : []).slice(0, 5)) {
            if (!g || !g.title) continue;
            await Goal.create({
                userId: user._id,
                title: String(g.title).slice(0, 120),
                area: String(g.area || "personal").slice(0, 30),
                horizon: ["short", "medium", "long"].includes(g.horizon) ? g.horizon : "medium",
                deadline: typeof g.deadline === "string" && isValidDateKey(g.deadline) ? g.deadline : null
            });
        }

        // priorities + struggles go into the profile for later AI use
        if (Array.isArray(priorities) || struggles) {
            user.bio = [
                Array.isArray(priorities) && priorities.length ? `Priorities: ${priorities.slice(0, 5).join(", ")}` : "",
                struggles ? `Working on: ${String(struggles).slice(0, 200)}` : ""
            ].filter(Boolean).join(" - ").slice(0, 300);
            await user.save();
        }

        res.json({
            success: true,
            message: "Your ASCEND setup is ready",
            user: await User.findById(req.userId).select("-password -__v")
        });
    } catch (error) {
        console.error("onboarding error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ------------------------------------------------------------
// PASSWORD RESET — production-safe flow
//
// - 6-digit code generated with crypto (CSPRNG), never Math.random()
// - stored HASHED in the database, single-use, 15-minute expiry
// - delivered by email via the mailer abstraction (utils/mailer.js)
// - if SMTP is not configured the API still behaves safely: the code is
//   logged server-side only and NEVER returned to the client.
//   => password reset requires SMTP config to be usable (see .env.example)
// ------------------------------------------------------------
const PasswordResetToken = require("../models/PasswordResetToken");

router.post("/forgot-password", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        // Always the same response — no account enumeration.
        const generic = { success: true, message: "If that email exists, a reset code has been sent." };

        if (!EMAIL_RE.test(email)) return res.json(generic);

        const user = await User.findOne({ email }).lean();
        if (!user) return res.json(generic);

        // invalidate previous unused codes for this email
        await PasswordResetToken.deleteMany({ email });

        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        const codeHash = crypto.createHash("sha256").update(code).digest("hex");

        await PasswordResetToken.create({
            email,
            codeHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        });

        await sendResetCode(email, code);
        return res.json(generic);
    } catch (error) {
        console.error("forgot-password error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/reset-password", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const code = String(req.body.code || "").trim();
        const password = String(req.body.password || "");

        if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
        }
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({ success: false, message: "Password must be 8-128 characters" });
        }

        const record = await PasswordResetToken.findOne({ email });
        const codeHash = crypto.createHash("sha256").update(code).digest("hex");

        if (!record || record.expiresAt < new Date() || record.codeHash !== codeHash) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
        }

        // single-use: burn the token before updating the password
        await PasswordResetToken.deleteOne({ _id: record._id });

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
        }

        user.password = await bcrypt.hash(password, 12);
        await user.save();

        res.json({ success: true, message: "Password updated. You can log in now." });
    } catch (error) {
        console.error("reset-password error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ------------------------------------------------------------
// LOGOUT
// ------------------------------------------------------------
router.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ success: true, message: "Logged out" });
});

// todayKey is used by other modules via utils/date; keep isValidDateKey export surface stable
module.exports = router;
