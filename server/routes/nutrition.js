const express = require("express");

const auth = require("../middleware/auth");
const { isValidDateKey, todayKeyFor } = require("../utils/date");
const nutrition = require("../services/nutritionService");
const imageRecognition = require("../services/imageRecognitionService");
const Meal = require("../models/Meal");
const User = require("../models/User");

const router = express.Router();

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const SOURCES = ["search", "photo", "barcode", "manual"];

function validIdOr400(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id || ""));
}

async function userTz(userId) {
    const u = await User.findById(userId).select("timezoneOffset").lean();
    return (u && u.timezoneOffset) || 0;
}

// ------------------------------------------------------------
// FOOD NORMALIZATION + AUTHORITATIVE NUTRITION RESOLUTION
//
// SECURITY: the client NEVER gets to dictate nutrition values for a
// provider (FatSecret) food. Provider foods are re-resolved server-side
// from FatSecret (cached ≤6h) using providerFoodId + servingId (+ grams);
// client-sent calories/macros for those foods are ignored entirely.
// Only `manual` foods (user-typed label values) accept client numbers,
// clamped to sane ranges, and are stored with provider:"manual".
// ------------------------------------------------------------
function clampManualFood(raw) {
    const out = {
        provider: "manual",
        providerFoodId: null,
        name: String(raw.name || "").trim().slice(0, 200),
        brand: String(raw.brand || "").slice(0, 120),
        servingDescription: String(raw.servingDescription || "").slice(0, 200),
        servingId: null,
        quantity: Math.min(Math.max(Number(raw.quantity) || 1, 0.01), 50),
        grams: raw.grams != null && Number.isFinite(Number(raw.grams))
            ? Math.min(Math.max(Number(raw.grams), 0), 5000)
            : null,
        estimated: !!raw.estimated
    };
    if (!out.name) return null;

    for (const [key, max] of [["calories", 5000], ["protein", 500], ["carbs", 500], ["fat", 500]]) {
        const n = Number(raw[key]);
        out[key] = Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
    }
    // per-serving macros must be plausible relative to calories (fat 9/g,
    // carbs & protein 4/g) — rejects obviously fabricated values
    const macroKcal = out.protein * 4 + out.carbs * 4 + out.fat * 9;
    if (out.calories > 0 && macroKcal > out.calories * 1.6 + 60) {
        out.protein = 0;
        out.carbs = 0;
        out.fat = 0;
    }
    return out;
}

// Resolve every food in a payload. Throws Error with .status/.code on
// failure — the meal is REJECTED, never stored with unverifiable values.
async function resolveFoods(rawFoods) {
    const foods = [];
    for (const raw of rawFoods) {
        const claimedProvider = raw.provider === "fatsecret" || (raw.provider !== "manual" && raw.providerFoodId);
        if (claimedProvider) {
            const name = String(raw.name || "this food").trim().slice(0, 60);
            if (!raw.providerFoodId) {
                const err = new Error(`"${name}" is missing a verified food reference — add it via Search, or enter it manually.`);
                err.status = 400;
                throw err;
            }
            let r;
            try {
                r = await nutrition.resolveFoodNutrition({
                    providerFoodId: raw.providerFoodId,
                    servingId: raw.servingId,
                    grams: raw.grams,
                    quantity: raw.quantity
                });
            } catch (e) {
                if (e.code === "BAD_INPUT" || e.code === "NOT_FOUND") {
                    const err = new Error(`We couldn't verify "${name}" against the nutrition provider. Try searching for it again, or enter it manually.`);
                    err.status = 400;
                    throw err;
                }
                if (e.code === "PROVIDER_IP") {
                    const err = new Error("The nutrition provider rejected this server's IP address — add the server's outbound IPs to the FatSecret IP allowlist.");
                    err.status = 403;
                    err.code = "PROVIDER_IP";
                    throw err;
                }
                const err = new Error("Could not verify nutrition with the provider right now. Please try again shortly.");
                err.status = 502;
                throw err;
            }
            const g = Number(raw.grams);
            foods.push({
                provider: "fatsecret",
                providerFoodId: String(raw.providerFoodId).slice(0, 40),
                name: r.name,
                brand: r.brand,
                servingDescription: r.servingDescription,
                servingId: r.servingId,
                quantity: r.quantity,
                grams: Number.isFinite(g) && g > 0 ? Math.min(g, 5000) : null,
                calories: r.calories,
                protein: r.protein,
                carbs: r.carbs,
                fat: r.fat,
                estimated: false
            });
        } else {
            const manual = clampManualFood(raw);
            if (manual) foods.push(manual);
        }
    }
    return foods;
}

function mealTotals(foods) {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    for (const f of foods) {
        const q = Number(f.quantity) || 1;
        calories += (Number(f.calories) || 0) * q;
        protein += (Number(f.protein) || 0) * q;
        carbs += (Number(f.carbs) || 0) * q;
        fat += (Number(f.fat) || 0) * q;
    }
    return {
        totalCalories: Math.round(calories),
        totalProtein: Math.round(protein * 10) / 10,
        totalCarbs: Math.round(carbs * 10) / 10,
        totalFat: Math.round(fat * 10) / 10
    };
}

function withTotals(meal) {
    const obj = meal.toObject();
    return { ...obj, ...mealTotals(obj.foods) };
}

// ============================================================
// CAPABILITIES — what the current provider credentials actually enable.
// Distinguishes: credentials missing vs provider auth failure vs network
// vs rate limit. The UI uses this (and providerError) to show honest
// states instead of guessing "keys not configured".
// ============================================================
router.get("/capabilities", auth, async (req, res) => {
    try {
        const caps = await nutrition.capabilities();
        res.json({ success: true, capabilities: caps });
    } catch (e) {
        console.error("capabilities error:", e.message);
        res.status(500).json({ success: false, message: "Could not check nutrition availability", code: "CAPS_ERROR" });
    }
});

// One place that maps service error codes to honest HTTP responses.
// Never leaks upstream bodies, credentials, or tokens.
function mapProviderError(e, res, unavailableMsg) {
    if (e.status === 400 || e.code === "BAD_INPUT") {
        return res.status(400).json({ success: false, message: e.message || "Invalid request", code: e.code || "BAD_INPUT" });
    }
    if (e.code === "NOT_CONFIGURED") {
        return res.status(503).json({ success: false, message: "Nutrition provider is not configured on the server.", code: "NOT_CONFIGURED" });
    }
    if (e.code === "PROVIDER_AUTH") {
        return res.status(503).json({ success: false, message: "Nutrition provider authentication failed — check the server's FatSecret configuration.", code: "PROVIDER_AUTH" });
    }
    if (e.code === "PROVIDER_DOWN" || e.code === "PROVIDER_DOWN_COOLDOWN") {
        return res.status(503).json({ success: false, message: "Nutrition service is temporarily unreachable. Try again shortly.", code: "PROVIDER_DOWN" });
    }
    if (e.code === "RATE_LIMITED") {
        return res.status(429).json({ success: false, message: "Nutrition search is rate limited right now. Try again in a moment.", code: "RATE_LIMITED" });
    }
    if (e.code === "PROVIDER_SCOPE") {
        return res.status(501).json({ success: false, message: "This nutrition capability isn't available with the server's current FatSecret plan.", code: "PROVIDER_SCOPE" });
    }
    if (e.code === "PROVIDER_IP") {
        // Log the rejected IP server-side only (it is this server's own
        // outbound address, never a credential); the client gets a safe,
        // actionable message without it.
        if (e.detail) console.error("fatsecret IP restriction: rejected server outbound IP", e.detail);
        return res.status(403).json({ success: false, message: "The nutrition provider rejected this server's IP address — add the server's outbound IPs to the FatSecret IP allowlist.", code: "PROVIDER_IP" });
    }
    console.error("nutrition provider error:", e.message);
    return res.status(502).json({ success: false, message: unavailableMsg || "Nutrition search is temporarily unavailable.", code: e.code || "PROVIDER_ERROR" });
}

// ============================================================
// PROVIDER PROXY — food search + details (secrets stay server-side)
// ============================================================
router.get("/search", auth, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        if (!q) return res.status(400).json({ success: false, message: "Search query is required" });
        if (q.length > 120) return res.status(400).json({ success: false, message: "Search query is too long" });

        const page = Math.max(Number(req.query.page) || 0, 0);
        const result = await nutrition.searchFoods(q, { maxResults: 12, pageNumber: page });
        res.json({ success: true, ...result });
    } catch (e) {
        mapProviderError(e, res);
    }
});

router.get("/food/:id", auth, async (req, res) => {
    try {
        const food = await nutrition.getFood(req.params.id);
        res.json({ success: true, food });
    } catch (e) {
        if (e.code === "BAD_INPUT" || e.code === "NOT_FOUND") {
            return res.status(400).json({ success: false, message: "Food not found" });
        }
        mapProviderError(e, res, "Food details are temporarily unavailable.");
    }
});

// ============================================================
// PHOTO — provider abstraction. Honest unavailable state until a
// Premier/vision provider is configured (never fabricates results).
// ============================================================
router.post("/analyze-photo", auth, async (req, res) => {
    try {
        if (!req.headers["content-type"] || !req.headers["content-type"].includes("multipart/form-data")) {
            return res.status(400).json({ success: false, message: "Image upload expected", code: "BAD_INPUT" });
        }
        if (!imageRecognition.photoEnabled()) {
            return res.status(501).json({
                success: false,
                message: "Photo analysis isn't available with the current nutrition provider configuration.",
                code: "PHOTO_UNAVAILABLE"
            });
        }
        return res.status(501).json({
            success: false,
            message: "Photo analysis isn't available with the current nutrition provider configuration.",
            code: "PHOTO_UNAVAILABLE"
        });
    } catch (e) {
        console.error("analyze-photo error:", e.message);
        res.status(502).json({ success: false, message: "Photo analysis failed.", code: "PROVIDER_ERROR" });
    }
});

// ============================================================
// BARCODE — Premier-only upstream. Manual entry is the fallback that
// keeps the tab functional: barcode digits are searched by name/brand.
// ============================================================
router.get("/barcode/:code", auth, async (req, res) => {
    try {
        const code = String(req.params.code || "").replace(/\D/g, "");
        if (code.length < 6 || code.length > 14) {
            return res.status(400).json({ success: false, message: "Invalid barcode" });
        }
        const food = await nutrition.lookupBarcode(code);
        res.json({ success: true, food });
    } catch (e) {
        if (e.code === "PREMIER_REQUIRED") {
            return res.status(501).json({
                success: false,
                message: "Barcode lookup requires a FatSecret Premier plan. Use Search, or enter the product name manually.",
                code: "PREMIER_REQUIRED"
            });
        }
        console.error("barcode error:", e.message);
        res.status(502).json({ success: false, message: "Barcode lookup failed.", code: "PROVIDER_ERROR" });
    }
});

// ============================================================
// MEAL CRUD
// ============================================================
router.get("/meals", auth, async (req, res) => {
    try {
        const tz = await userTz(req.userId);
        const today = todayKeyFor(tz);
        const date = isValidDateKey(req.query.date) ? req.query.date : today;
        const meals = await Meal.find({ userId: req.userId, date }).sort({ createdAt: 1 });

        const totals = mealTotals(meals.flatMap((m) => m.foods));
        res.json({
            success: true,
            date,
            today,
            meals: meals.map(withTotals),
            totals
        });
    } catch (e) {
        console.error("meals load error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load meals" });
    }
});

router.post("/meals", auth, async (req, res) => {
    try {
        const tz = await userTz(req.userId);
        const date = isValidDateKey(req.body.date) ? req.body.date : todayKeyFor(tz);
        if (!isValidDateKey(date)) return res.status(400).json({ success: false, message: "Invalid date" });

        const mealType = MEAL_TYPES.includes(req.body.mealType) ? req.body.mealType : "snack";
        const source = SOURCES.includes(req.body.source) ? req.body.source : "manual";

        if (!Array.isArray(req.body.foods) || req.body.foods.length === 0) {
            return res.status(400).json({ success: false, message: "Add at least one food" });
        }
        if (req.body.foods.length > 30) {
            return res.status(400).json({ success: false, message: "Too many foods in one meal (max 30)" });
        }
        const foods = await resolveFoods(req.body.foods);
        if (foods.length === 0) {
            return res.status(400).json({ success: false, message: "Food entries are missing names" });
        }

        const meal = await Meal.create({ userId: req.userId, date, mealType, source, notes: String(req.body.notes || "").slice(0, 500), foods });
        res.status(201).json({ success: true, meal: withTotals(meal) });
    } catch (e) {
        if (e.status === 400) return res.status(400).json({ success: false, message: e.message, code: e.code || "BAD_INPUT" });
        if (e.status === 403) return res.status(403).json({ success: false, message: e.message, code: e.code || "PROVIDER_IP" });
        if (e.status === 502) return res.status(502).json({ success: false, message: e.message, code: "PROVIDER_DOWN" });
        console.error("meal create error:", e.message);
        res.status(500).json({ success: false, message: "Failed to save meal" });
    }
});

router.put("/meals/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });

        if (req.body.date !== undefined) {
            if (!isValidDateKey(req.body.date)) return res.status(400).json({ success: false, message: "Invalid date" });
            meal.date = req.body.date;
        }
        if (req.body.mealType !== undefined) {
            if (!MEAL_TYPES.includes(req.body.mealType)) return res.status(400).json({ success: false, message: "Invalid meal type" });
            meal.mealType = req.body.mealType;
        }
        if (req.body.notes !== undefined) meal.notes = String(req.body.notes || "").slice(0, 500);

        if (Array.isArray(req.body.foods)) {
            if (req.body.foods.length === 0) return res.status(400).json({ success: false, message: "A meal needs at least one food" });
            if (req.body.foods.length > 30) return res.status(400).json({ success: false, message: "Too many foods in one meal (max 30)" });
            const foods = await resolveFoods(req.body.foods);
            if (foods.length === 0) return res.status(400).json({ success: false, message: "Food entries are missing names" });
            meal.foods = foods;
        }

        await meal.save();
        res.json({ success: true, meal: withTotals(meal) });
    } catch (e) {
        if (e.status === 400) return res.status(400).json({ success: false, message: e.message, code: e.code || "BAD_INPUT" });
        if (e.status === 403) return res.status(403).json({ success: false, message: e.message, code: e.code || "PROVIDER_IP" });
        if (e.status === 502) return res.status(502).json({ success: false, message: e.message, code: "PROVIDER_DOWN" });
        console.error("meal update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update meal" });
    }
});

router.delete("/meals/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });
        await meal.deleteOne();
        res.json({ success: true });
    } catch (e) {
        console.error("meal delete error:", e.message);
        res.status(500).json({ success: false, message: "Failed to delete meal" });
    }
});

// Daily totals across a date range (recent history view)
router.get("/summary", auth, async (req, res) => {
    try {
        const tz = await userTz(req.userId);
        const today = todayKeyFor(tz);
        const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
        const from = req.query.from && isValidDateKey(req.query.from) ? req.query.from : null;
        const to = from
            ? (req.query.to && isValidDateKey(req.query.to) ? req.query.to : today)
            : today;

        // compute the window without importing client date helpers:
        const start = from || new Date(new Date(to + "T12:00:00Z").getTime() - (days - 1) * 86400000)
            .toISOString().slice(0, 10);

        const meals = await Meal.find({ userId: req.userId, date: { $gte: start, $lte: to } })
            .sort({ date: 1 })
            .limit(400); // bounded: ≤30 days × ≤~13 meals/day

        const byDate = {};
        for (const m of meals) {
            if (!byDate[m.date]) byDate[m.date] = [];
            byDate[m.date].push(m);
        }

        const out = [];
        let cursor = start;
        const guard = 40;
        let i = 0;
        while (cursor <= to && i < guard) {
            const dayMeals = byDate[cursor] || [];
            out.push({ date: cursor, ...mealTotals(dayMeals.flatMap((m) => m.foods)), mealCount: dayMeals.length });
            cursor = new Date(new Date(cursor + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
            i += 1;
        }

        res.json({ success: true, today, days: out });
    } catch (e) {
        console.error("nutrition summary error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load nutrition summary" });
    }
});

module.exports = router;
