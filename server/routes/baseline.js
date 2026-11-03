const express = require("express");
const rateLimit = require("express-rate-limit");

const auth = require("../middleware/auth");
const Baseline = require("../models/Baseline");
const {
    CATEGORY_KEYS,
    RUBRIC_VERSION,
    validateBaselineAnswers
} = require("../services/baselineValidation");
const { scoreSliderAnswers, averageSliderRating } = require("../services/baselineScores");

const router = express.Router();

const assessLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many assessment requests. Try again in a few minutes." }
});

// ------------------------------------------------------------
// RESPONSE SHAPING — explicit, so a Map never leaks raw internals.
// ------------------------------------------------------------
// One slider value: the canonical 1–10 integer, or a legacy single string
// that restores as an integer ("7", "10"). Empty, missing, or otherwise
// invalid is always null, which the UI treats as "not answered".
function serializeSliderAnswer(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10) return value;
    if (typeof value === "string" && /^(?:[1-9]|10)$/.test(value)) return Number(value);
    return null;
}

function serialize(doc) {
    if (!doc) return null;
    const assessments = {};
    for (const key of CATEGORY_KEYS) {
        const a = doc.assessments instanceof Map ? doc.assessments.get(key) : (doc.assessments || {})[key];
        assessments[key] = a
            ? {
                score: typeof a.score === "number" ? a.score : null,
                explanation: a.explanation || "",
                confidence: a.confidence || null,
                followUpQuestion: a.followUpQuestion || null,
                insufficient: !!a.insufficient || a.score === null
            }
            : { score: null, explanation: "Not enough information yet.", confidence: null, followUpQuestion: null, insufficient: true };
    }
    return {
        answers: {
            body: serializeSliderAnswer(doc.answers?.body),
            discipline: serializeSliderAnswer(doc.answers?.discipline),
            learning: serializeSliderAnswer(doc.answers?.learning),
            productivity: serializeSliderAnswer(doc.answers?.productivity),
            goalDrive: doc.answers?.goalDrive ?? ""
        },
        assessments,
        status: doc.status,
        assessedAt: doc.assessedAt,
        confirmedAt: doc.confirmedAt,
        rubricVersion: doc.rubricVersion || "",
        model: doc.model || "",
        assessmentMethod: doc.assessmentMethod || ""
    };
}

// ------------------------------------------------------------
// GET /api/baseline — the caller's own baseline (ownership via token).
// ------------------------------------------------------------
router.get("/", auth, async (req, res) => {
    try {
        const doc = await Baseline.findOne({ userId: req.userId });
        res.json({ baseline: serialize(doc) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load baseline" });
    }
});

// ------------------------------------------------------------
// POST /api/baseline/assess — save locally scored self-reported ratings.
//
// - All four ratings are validated and scored locally.
// - Goal Drive is retained as plain-text motivation and is not scored.
// - Client scores are never accepted.
// - A CONFIRMED baseline is never overwritten (409) — the initial baseline
//   is preserved when onboarding is revisited.
// - Idempotent under double-clicks: one doc per user (unique userId).
// ------------------------------------------------------------
async function saveAssessment(req, res) {
    try {
        const rawAnswers = req.body?.answers;
        const { clean: answers, errors } = validateBaselineAnswers(rawAnswers);
        if (!answers) {
            return res.status(400).json({ success: false, message: errors.join("; ") });
        }

        const existing = await Baseline.findOne({ userId: req.userId });
        if (existing && existing.status === "confirmed") {
            return res.status(409).json({
                success: false,
                code: "BASELINE_CONFIRMED",
                message: "Your starting baseline is already confirmed and preserved.",
                baseline: serialize(existing)
            });
        }

        const now = new Date();
        const assessments = scoreSliderAnswers(answers);
        const update = {
            $set: {
                answers,
                assessments,
                status: "draft",
                assessedAt: now,
                rubricVersion: RUBRIC_VERSION,
                model: "",
                assessmentMethod: "self-reported"
            },
            // `userId` is already matched in the query filter above; it is not
            // re-supplied here so Mongoose does not try to cast the string to
            // ObjectId on upsert. `confirmedAt` is the only default to set on
            // first insert.
            $setOnInsert: { confirmedAt: null }
        };

        let doc;
        try {
            doc = await Baseline.findOneAndUpdate(
                { userId: req.userId },
                update,
                { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
            );
        } catch (e) {
            // Two concurrent first-assess calls can race the unique index.
            if (e && e.code === 11000) {
                doc = await Baseline.findOneAndUpdate({ userId: req.userId }, update, { new: true });
            } else {
                throw e;
            }
        }

        res.json({
            success: true,
            baseline: serialize(doc),
            overallRating: averageSliderRating(assessments)
        });
    } catch (e) {
        console.error("baseline assess error:", e?.message || e || "INTERNAL_ERROR");
        if (process.env.NODE_ENV !== "production" && e) console.error(e.stack || e);
        res.status(500).json({ success: false, message: "Could not save your baseline. Try again." });
    }
}

router.post("/assess", auth, assessLimiter, async (req, res) => {
    await saveAssessment(req, res);
});

// ------------------------------------------------------------
// POST /api/baseline/confirm — lock in the reviewed draft.
// Idempotent: confirming twice returns the same preserved baseline.
// ------------------------------------------------------------
router.post("/confirm", auth, async (req, res) => {
    try {
        const doc = await Baseline.findOne({ userId: req.userId });
        if (!doc) {
            return res.status(404).json({
                success: false,
                code: "NO_BASELINE",
                message: "No baseline to confirm. Generate one first."
            });
        }
        if (doc.status !== "confirmed") {
            doc.status = "confirmed";
            doc.confirmedAt = new Date();
            await doc.save();
        }
        res.json({ success: true, baseline: serialize(doc) });
    } catch (e) {
        console.error("baseline confirm error:", e.message);
        res.status(500).json({ success: false, message: "Could not confirm baseline. Try again." });
    }
});

module.exports = router;
