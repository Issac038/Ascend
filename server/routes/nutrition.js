const express = require("express");

const auth = require("../middleware/auth");
const { isValidDateKey, todayKeyFor } = require("../utils/date");
const User = require("../models/User");
const { Meal, MealPrior, MealAnswerMemory } = require("../models/Meal");
const engine = require("../nutrition/index");
const { validateVisionPayload, validateLabelPayload, ValidationError } = require("../nutrition/schema");
const { clamp, totals, confidence, repair, resolver } = require("../nutrition/index");
const { canonicalConceptKey, updatePrior, isTrusted } = require("../nutrition/gramEngine");
const { GRAMS_MIN, GRAMS_MAX } = require("../models/NutritionLibrary");

const router = express.Router();

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_SOURCES = ["photo", "manual", "db_search", "label"];

function validIdOr400(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id || ""));
}

let mongoose_corpus_collection = null;
function getColl() {
    if (!mongoose_corpus_collection) {
        mongoose_corpus_collection = require("mongoose").connection.collection("nutrition_foods");
    }
    return mongoose_corpus_collection;
}

async function userTz(userId) {
    const u = await User.findById(userId).select("timezoneOffset").lean();
    return (u && u.timezoneOffset) || 0;
}

async function priorsFor(userId) {
    const docs = await MealPrior.find({ userId }).lean();
    const map = new Map();
    for (const d of docs) {
        map.set(d.foodConceptKey, {
            foodConceptKey: d.foodConceptKey,
            ewmaRatio: d.ewmaRatio,
            ratioVariance: d.ratioVariance,
            sampleCount: d.sampleCount,
            medianGrams: d.medianGrams,
            lastCorrectedAt: d.lastCorrectedAt ? d.lastCorrectedAt.getTime() : Date.now(),
        });
    }
    return map;
}

async function rememberedAnswersFor(userId, conceptKey) {
    const docs = await MealAnswerMemory.find({ userId, foodConceptKey: conceptKey }).lean();
    const map = new Map();
    for (const d of docs) {
        if (repair.shouldApplySilently(d)) map.set(d.attribute, d.value);
    }
    return map;
}

// ------------------------------------------------------------
// Totals for a stored meal — the engine's arithmetic, full precision
// internally, display-rounded for the client (§6.3 regime B).
// ------------------------------------------------------------
function mealView(meal) {
    const obj = meal.toObject ? meal.toObject() : meal;
    const raw = totals.recomputeTotals(obj);
    const display = totals.toDisplayTotals(raw);

    // Meal band from per-row bands (quadrature, kcal-weighted, floored).
    const banded = (obj.ingredients || []).map((row) => ({
        kcal: totals.itemCalories(row),
        band: {
            halfPct: row.bandHalfPct,
            reasons: row.isEstimate ? ["No database match for this item — it is an AI estimate."] : [],
        },
        rowId: row.id,
    }));
    const band = confidence.mealBand(banded);

    return {
        ...obj,
        totals: display,
        rawTotals: {
            kcal: Math.round(raw.kcal * 10) / 10,
            protein_g: Math.round(raw.protein_g * 10) / 10,
            fat_g: Math.round(raw.fat_g * 10) / 10,
            carbs_g: Math.round(raw.carbs_g * 10) / 10,
        },
        band,
    };
}

function dayTotals(meals) {
    const raw = meals.reduce((acc, m) => {
        const t = totals.recomputeTotals(m);
        acc.kcal += t.kcal;
        acc.protein_g += t.protein_g;
        acc.fat_g += t.fat_g;
        acc.carbs_g += t.carbs_g;
        acc.fiber_g += t.fiber_g;
        acc.sugar_g += t.sugar_g;
        acc.sodium_mg += t.sodium_mg;
        return acc;
    }, totals.zeroTotals());
    return { totals: totals.toDisplayTotals(raw), raw: { kcal: raw.kcal, protein_g: raw.protein_g, fat_g: raw.fat_g, carbs_g: raw.carbs_g } };
}

// ============================================================
// CAPABILITIES — truthful, derived from actual local state.
// The engine is fully local (USDA corpus in MongoDB): search/details work
// when the corpus is loaded; photo needs a vision provider (none configured
// in Ascend yet — honest 501); barcode lookup is corpus-gated.
// ============================================================
router.get("/capabilities", auth, async (req, res) => {
    try {
        let corpusCount = 0;
        let corpusReady = false;
        try {
            corpusCount = await getColl().countDocuments();
            corpusReady = corpusCount > 0;
        } catch {
            corpusReady = false;
        }
        res.json({
            success: true,
            capabilities: {
                configured: corpusReady,
                provider: "usda-fdc-local",
                corpusFoods: corpusCount,
                search: corpusReady,
                foodDetails: corpusReady,
                // Vision provider not integrated yet — honest, capability-gated.
                photo: false,
                photoReason: "vision_provider_not_configured",
                // Barcode: camera scanning is a mobile-native capability; the
                // web corpus lookup endpoint works, in-app camera scanning is
                // not implemented.
                barcode: corpusReady,
                barcodeReason: "manual_entry_only",
                labelScan: false,
                labelReason: "vision_provider_not_configured",
            },
        });
    } catch (e) {
        console.error("capabilities error:", e.message);
        res.status(500).json({ success: false, message: "Could not check nutrition availability", code: "CAPS_ERROR" });
    }
});

// ============================================================
// CORPUS SEARCH — free text over the local corpus (USDA + Ascend seed rows),
// extended with alias + spelling-tolerant matching and matchType labels.
// The legacy resolver shape (outcome/ladderStep) is preserved for
// compatibility; `matchType` is additive.
// ============================================================
const searchService = require("../nutrition/searchService");

router.get("/search", auth, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        if (!q) return res.status(400).json({ success: false, message: "Search query is required" });
        if (q.length > 120) return res.status(400).json({ success: false, message: "Search query is too long" });

        const coll = getColl();
        const { rows, matchType } = await searchService.searchFoods(coll, q, { limit: 12 });

        res.json({
            success: true,
            query: q,
            outcome: rows.length === 0 ? "miss" : matchType === "exact" ? "auto_accepted" : "needs_disambiguation",
            matchType,
            results: rows.map((r) => ({
                foodId: r.foodId,
                name: r.name,
                brand: r.brand,
                category: r.category,
                cuisine: r.cuisine,
                source: r.source,
                servingSizeG: r.servingSizeG,
                portionPerUnitG: r.portionPerUnitG,
                energyKcal: r.energyKcal,
                matchType: r.matchType,
                matchScore: Math.round((r.matchScore || 0) * 100) / 100,
            })),
        });
    } catch (e) {
        console.error("nutrition search error:", e.message);
        res.status(500).json({ success: false, message: "Food search failed. Please try again.", code: "SEARCH_ERROR" });
    }
});

// ============================================================
// FOOD DETAIL — per-100g snapshot + portion anchors for the editor.
// ============================================================
router.get("/food/:id", auth, async (req, res) => {
    try {
        const food = await resolver.loadFood(getColl(), String(req.params.id || ""));
        if (!food) return res.status(404).json({ success: false, message: "Food not found in the nutrition corpus" });
        res.json({ success: true, food });
    } catch (e) {
        console.error("food detail error:", e.message);
        res.status(500).json({ success: false, message: "Food details are temporarily unavailable." });
    }
});

// ============================================================
// PHOTO ANALYSIS — the deterministic pipeline over a vision payload.
// The CLIENT sends only the image; a vision-provider call would produce the
// payload server-side. No vision provider is configured yet, so this route
// honestly reports unavailable and NEVER fabricates a payload.
// ============================================================
router.post("/analyze-photo", auth, async (req, res) => {
    return res.status(501).json({
        success: false,
        message: "Photo analysis isn't available yet — no vision provider is configured on the server.",
        code: "PHOTO_UNAVAILABLE",
    });
});

// ============================================================
// DETERMINISTIC PREVIEW — validate + analyze a payload WITHOUT logging.
// Used by tests and by a future vision provider integration. Accepts a
// full VisionPayload (the only thing an inference model may return).
// ============================================================
router.post("/analyze", auth, async (req, res) => {
    try {
        const payload = validateVisionPayload(req.body);
        if (!payload.is_food) {
            return res.status(400).json({ success: false, message: payload.refusal_reason || "Not a food photo", code: "NOT_FOOD" });
        }
        const priors = await priorsFor(req.userId);
        const result = await engine.analyzePayload(getColl(), payload, { priors });
        res.json({
            success: true,
            items: result.items.map((o) => ({ row: o.row, gramResult: { grams: o.gramResult.grams, pathway: o.gramResult.pathway, halfPct: o.gramResult.halfPct, rivalGrams: o.gramResult.rivalGrams || null } })),
            totals: result.displayTotals,
            rawTotals: result.totals,
            band: result.band,
            clampFlags: result.clampFlags,
            questions: result.questions,
        });
    } catch (e) {
        if (e instanceof ValidationError) {
            return res.status(400).json({ success: false, message: e.message, code: "BAD_INPUT" });
        }
        console.error("analyze error:", e.message);
        res.status(500).json({ success: false, message: "Analysis failed. Please try again." });
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

        const day = dayTotals(meals.map((m) => m.toObject()));
        res.json({
            success: true,
            date,
            today,
            meals: meals.map(mealView),
            totals: day.totals,
            rawTotals: day.raw,
        });
    } catch (e) {
        console.error("meals load error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load meals" });
    }
});

// Build a single stored ingredient row from a client request. Nutrition
// numbers ALWAYS come from the corpus snapshot — the client supplies
// foodId + grams only. Manual rows accept client numbers with explicit
// clamping and the manual_custom origin (never silently merged).
async function buildIngredientRow(raw) {
    if (raw == null || typeof raw !== "object") return null;
    const origin = String(raw.origin || "db_search");

    // A row referencing one of the user's own custom foods. Nutrition values
    // ALWAYS come from the stored CustomFood (server-owned) — a client-supplied
    // snapshot is ignored, same tamper-resistance contract as corpus rows.
    if (origin === "custom_food") {
        const { NutritionCustomFood } = require("../models/NutritionLibrary");
        const cf = await NutritionCustomFood.findOne({ _id: String(raw.sourceFoodId || ""), userId: req.userId });
        if (!cf) return null;
        const grams = Math.min(Math.max(Number(raw.grams) || (cf.servingSizeG || 100), GRAMS_MIN), GRAMS_MAX);
        return {
            id: `cf-${cf._id}-${Math.random().toString(36).slice(2, 8)}`,
            displayName: cf.brand ? `${cf.brand} ${cf.name}`.slice(0, 160) : cf.name,
            sourceFoodId: null,
            grams,
            nutrientSnapshot: {
                kcal: cf.kcal,
                protein_g: cf.protein_g,
                fat_g: cf.fat_g,
                carbs_g: cf.carbs_g,
                fiber_g: cf.fiber_g,
                sugar_g: cf.sugar_g,
                sodium_mg: cf.sodium_mg,
            },
            origin: "custom_food",
            sourceUrl: null,
            gramPathway: "user_edited",
            bandHalfPct: 0,
            isEstimate: false,
            assumptions: [],
            macrosUserEdited: false,
            corrections: [],
        };
    }

    if (origin === "manual_custom") {
        const name = String(raw.displayName || "").trim().slice(0, 160);
        if (!name) return null;
        const snap = raw.nutrientSnapshot || {};
        const kcal = Math.min(Math.max(Number(snap.kcal) || 0, 0), 920);
        // Atwater plausibility on manual rows: reject obviously fabricated macros.
        let p = Math.min(Math.max(Number(snap.protein_g) || 0, 0), 100);
        let c = Math.min(Math.max(Number(snap.carbs_g) || 0, 0), 100);
        let f = Math.min(Math.max(Number(snap.fat_g) || 0, 0), 100);
        const macroKcal = totals.reconcileFromMacros(p, c, f);
        if (kcal > 0 && macroKcal > kcal * 1.6 + 60) {
            p = 0; c = 0; f = 0;
        }
        return {
            id: `man-${Math.random().toString(36).slice(2, 10)}`,
            displayName: name,
            sourceFoodId: null,
            grams: Math.min(Math.max(Number(raw.grams) || 100, 1), 5000),
            nutrientSnapshot: {
                kcal,
                protein_g: p,
                fat_g: f,
                carbs_g: c,
                fiber_g: Number.isFinite(Number(snap.fiber_g)) ? Math.min(Math.max(Number(snap.fiber_g), 0), 100) : null,
                sugar_g: Number.isFinite(Number(snap.sugar_g)) ? Math.min(Math.max(Number(snap.sugar_g), 0), 100) : null,
                sodium_mg: Number.isFinite(Number(snap.sodium_mg)) ? Math.min(Math.max(Number(snap.sodium_mg), 0), 5000) : null,
            },
            origin: "manual_custom",
            sourceUrl: null,
            gramPathway: "user_edited",
            bandHalfPct: 0,
            isEstimate: false,
            assumptions: [],
            macrosUserEdited: false,
            corrections: [],
        };
    }

    // db_search / vision_model / barcode / label_ocr: resolve from the corpus.
    const foodId = String(raw.sourceFoodId || "").slice(0, 40);
    if (!foodId) return null;
    const food = await resolver.loadFood(getColl(), foodId);
    if (!food || food.per100g.kcal == null) return null;
    const grams = Math.min(Math.max(Number(raw.grams) || (food.servingSizeG || 100), 1), 5000);
    const p = food.per100g;
    return {
        id: `fdc-${food.foodId}-${Math.random().toString(36).slice(2, 8)}`,
        displayName: food.brand ? `${food.brand} ${food.name}`.slice(0, 160) : food.name,
        sourceFoodId: food.foodId,
        grams,
        nutrientSnapshot: {
            kcal: p.kcal,
            protein_g: p.protein_g,
            fat_g: p.fat_g,
            carbs_g: p.carbs_g,
            fiber_g: p.fiber_g,
            sugar_g: p.sugar_g,
            sodium_mg: p.sodium_mg,
        },
        origin: origin === "vision_model" ? "vision_model" : "db_search",
        sourceUrl: null,
        gramPathway: raw.gramPathway === "discrete_count" ? "discrete_count" : "user_edited",
        bandHalfPct: Number.isFinite(Number(raw.bandHalfPct)) ? Math.min(Math.max(Number(raw.bandHalfPct), 0), 0.8) : 0,
        isEstimate: false,
        assumptions: [],
        macrosUserEdited: false,
        corrections: [],
    };
}

router.post("/meals", auth, async (req, res) => {
    try {
        const tz = await userTz(req.userId);
        const date = isValidDateKey(req.body.date) ? req.body.date : todayKeyFor(tz);
        if (!isValidDateKey(date)) return res.status(400).json({ success: false, message: "Invalid date" });

        const mealType = MEAL_TYPES.includes(req.body.mealType) ? req.body.mealType : "snack";
        const source = MEAL_SOURCES.includes(req.body.source) ? req.body.source : "db_search";

        if (!Array.isArray(req.body.ingredients) || req.body.ingredients.length === 0) {
            return res.status(400).json({ success: false, message: "Add at least one food" });
        }
        if (req.body.ingredients.length > 30) {
            return res.status(400).json({ success: false, message: "Too many foods in one meal (max 30)" });
        }

        const rows = [];
        for (const raw of req.body.ingredients) {
            const row = await buildIngredientRow(raw);
            if (!row) {
                return res.status(400).json({ success: false, message: `Could not resolve "${String((raw && raw.displayName) || "a food").slice(0, 60)}" against the nutrition corpus — search for it again or enter it manually.`, code: "UNRESOLVED_FOOD" });
            }
            rows.push(row);
        }

        const portion = Number(req.body.portionEatenFraction);
        const meal = await Meal.create({
            userId: req.userId,
            date,
            mealType,
            source,
            notes: String(req.body.notes || "").slice(0, 500),
            portionEatenFraction: Number.isFinite(portion) ? Math.min(Math.max(portion, 0.05), 1) : 1,
            ingredients: rows,
        });
        res.status(201).json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("meal create error:", e.message);
        res.status(500).json({ success: false, message: "Failed to save meal" });
    }
});

// CORRECTIONS — deterministic edits only. Each endpoint changes exactly one
// assumption and recomputes arithmetic; no model call anywhere.

// Change grams on one row (the ONE quantity the user edits directly).
router.patch("/meals/:id/rows/:rowId/grams", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });
        const row = meal.ingredients.find((r) => r.id === req.params.rowId);
        if (!row) return res.status(404).json({ success: false, message: "Ingredient not found" });

        const grams = Number(req.body && req.body.grams);
        if (!Number.isFinite(grams) || grams < 1 || grams > 5000) {
            return res.status(400).json({ success: false, message: "grams must be 1–5000" });
        }

        // Feed the personal prior: ratio = final/model estimate.
        const conceptKey = row.sourceFoodId ? `fdc:${row.sourceFoodId}` : canonicalConceptKey(row.displayName, null);
        const est = row.grams;
        if (row.gramPathway !== "user_edited" && est > 0 && grams !== est) {
            const prior = await MealPrior.findOne({ userId: req.userId, foodConceptKey: conceptKey });
            const updated = updatePrior(
                prior
                    ? {
                        foodConceptKey: conceptKey,
                        ewmaRatio: prior.ewmaRatio,
                        ratioVariance: prior.ratioVariance,
                        sampleCount: prior.sampleCount,
                        medianGrams: prior.medianGrams,
                        lastCorrectedAt: prior.lastCorrectedAt ? prior.lastCorrectedAt.getTime() : Date.now(),
                    }
                    : null,
                conceptKey,
                est,
                grams,
                Date.now(),
            );
            await MealPrior.updateOne(
                { userId: req.userId, foodConceptKey: conceptKey },
                {
                    $set: {
                        ewmaRatio: updated.ewmaRatio,
                        ratioVariance: updated.ratioVariance,
                        sampleCount: updated.sampleCount,
                        medianGrams: updated.medianGrams,
                        lastCorrectedAt: new Date(updated.lastCorrectedAt),
                    },
                },
                { upsert: true },
            );
        }

        row.corrections.push({ at: new Date(), field: "grams", from: row.grams, to: grams });
        row.grams = grams;
        // gramPathway becomes user_edited: ground truth for this meal.
        row.gramPathway = "user_edited";
        row.bandHalfPct = 0;
        await meal.save();
        res.json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("row grams update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update portion" });
    }
});

// Set the whole-meal portionEatenFraction ("did you eat all of it?").
router.patch("/meals/:id/portion", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });
        const p = Number(req.body && req.body.portionEatenFraction);
        if (!Number.isFinite(p) || p < 0.05 || p > 1) {
            return res.status(400).json({ success: false, message: "portionEatenFraction must be 0.05–1" });
        }
        meal.portionEatenFraction = p;
        await meal.save();
        res.json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("portion update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update portion eaten" });
    }
});

// Apply a question-bank answer (cooking oil etc.) — pushes a synthetic
// ingredient row (origin assumption_filler) and recomputes. The per-100g
// values for the filler rows come from the corpus (butter/oil rows), never
// from the client.
const OIL_ANSWER_MAP = {
    none: null, // remove filler if present
    little: { search: "vegetable oil", grams: 14 }, // ~1 tbsp
    lots: { search: "vegetable oil", grams: 28 }, // ~2 tbsp
};

router.patch("/meals/:id/rows/:rowId/assumption", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });
        const row = meal.ingredients.find((r) => r.id === req.params.rowId);
        if (!row) return res.status(404).json({ success: false, message: "Ingredient not found" });

        const attribute = String((req.body && req.body.attribute) || "").slice(0, 60);
        const value = String((req.body && req.body.value) || "").slice(0, 60);
        if (!attribute || !value) return res.status(400).json({ success: false, message: "attribute and value required" });

        if (attribute === "cooking_oil") {
            // Remove any existing oil filler row for this row.
            meal.ingredients = meal.ingredients.filter((r) => !(r.origin === "assumption_filler" && r.assumptions.some((a) => a.type === `oil_for:${row.id}`)));
            const spec = OIL_ANSWER_MAP[value];
            if (spec) {
                const hit = await resolver.resolveByText(getColl(), { canonicalFoodKey: spec.search, observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: spec.grams });
                const cand = hit.outcome.kind === "auto_accepted" ? hit.outcome.candidate : (hit.outcome.candidates || [])[0];
                const food = cand ? await resolver.loadFood(getColl(), cand.foodId) : null;
                if (food && food.per100g.kcal != null) {
                    meal.ingredients.push({
                        id: `oil-${Math.random().toString(36).slice(2, 10)}`,
                        displayName: "Cooking oil (assumed)",
                        sourceFoodId: food.foodId,
                        grams: spec.grams,
                        nutrientSnapshot: {
                            kcal: food.per100g.kcal,
                            protein_g: food.per100g.protein_g,
                            fat_g: food.per100g.fat_g,
                            carbs_g: food.per100g.carbs_g,
                            fiber_g: food.per100g.fiber_g,
                            sugar_g: food.per100g.sugar_g,
                            sodium_mg: food.per100g.sodium_mg,
                        },
                        origin: "assumption_filler",
                        sourceUrl: null,
                        gramPathway: "user_edited",
                        bandHalfPct: 0.2,
                        isEstimate: true,
                        assumptions: [{ type: `oil_for:${row.id}`, userConfirmed: true }],
                        macrosUserEdited: false,
                        corrections: [],
                    });
                }
            }
            row.corrections.push({ at: new Date(), field: "cooking_oil", from: null, to: null });
        }

        // Confirm the assumption on the row.
        const tag = row.assumptions.find((a) => a.type === attribute);
        if (tag) tag.userConfirmed = true;
        else row.assumptions.push({ type: attribute, userConfirmed: true });

        // Answer memory — a frequency table, not ML (repair §8.7).
        const conceptKey = row.sourceFoodId ? `fdc:${row.sourceFoodId}` : canonicalConceptKey(row.displayName, null);
        const mem = await MealAnswerMemory.findOne({ userId: req.userId, foodConceptKey: conceptKey, attribute });
        const updated = repair.recordAnswer(mem ? { foodConceptKey: conceptKey, attribute, value: mem.value, answerCount: mem.answerCount } : null, conceptKey, attribute, value);
        await MealAnswerMemory.updateOne(
            { userId: req.userId, foodConceptKey: conceptKey, attribute },
            { $set: { value: updated.value, answerCount: updated.answerCount } },
            { upsert: true },
        );

        await meal.save();
        res.json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("assumption apply error:", e.message);
        res.status(500).json({ success: false, message: "Failed to apply correction" });
    }
});

// Swap a row's identity (correction: "this was actually X") — new snapshot
// copied from the corpus row, grams preserved.
router.patch("/meals/:id/rows/:rowId/swap", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });
        const row = meal.ingredients.find((r) => r.id === req.params.rowId);
        if (!row) return res.status(404).json({ success: false, message: "Ingredient not found" });

        const foodId = String((req.body && req.body.sourceFoodId) || "").slice(0, 40);
        const food = await resolver.loadFood(getColl(), foodId);
        if (!food || food.per100g.kcal == null) return res.status(400).json({ success: false, message: "Replacement food not found in the corpus" });

        row.sourceFoodId = food.foodId;
        row.displayName = food.brand ? `${food.brand} ${food.name}`.slice(0, 160) : food.name;
        row.nutrientSnapshot = {
            kcal: food.per100g.kcal,
            protein_g: food.per100g.protein_g,
            fat_g: food.per100g.fat_g,
            carbs_g: food.per100g.carbs_g,
            fiber_g: food.per100g.fiber_g,
            sugar_g: food.per100g.sugar_g,
            sodium_mg: food.per100g.sodium_mg,
        };
        row.isEstimate = false;
        row.corrections.push({ at: new Date(), field: "swap", from: null, to: null });
        await meal.save();
        res.json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("row swap error:", e.message);
        res.status(500).json({ success: false, message: "Failed to swap food" });
    }
});

// Remove one ingredient row (correction: "there was no cheese").
router.delete("/meals/:id/rows/:rowId", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const meal = await Meal.findOne({ _id: req.params.id, userId: req.userId });
        if (!meal) return res.status(404).json({ success: false, message: "Meal not found" });
        const before = meal.ingredients.length;
        meal.ingredients = meal.ingredients.filter((r) => r.id !== req.params.rowId);
        if (meal.ingredients.length === before) return res.status(404).json({ success: false, message: "Ingredient not found" });
        if (meal.ingredients.length === 0) {
            await meal.deleteOne();
            return res.json({ success: true, deleted: true, message: "Meal had no ingredients left and was removed" });
        }
        await meal.save();
        res.json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("row delete error:", e.message);
        res.status(500).json({ success: false, message: "Failed to remove ingredient" });
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

        if (Array.isArray(req.body.ingredients)) {
            if (req.body.ingredients.length === 0) return res.status(400).json({ success: false, message: "A meal needs at least one food" });
            if (req.body.ingredients.length > 30) return res.status(400).json({ success: false, message: "Too many foods in one meal (max 30)" });
            const rows = [];
            for (const raw of req.body.ingredients) {
                const row = await buildIngredientRow(raw);
                if (!row) return res.status(400).json({ success: false, message: "Could not resolve an ingredient against the nutrition corpus", code: "UNRESOLVED_FOOD" });
                rows.push(row);
            }
            meal.ingredients = rows;
        }

        await meal.save();
        res.json({ success: true, meal: mealView(meal) });
    } catch (e) {
        console.error("meal update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update meal" });
    }
});

// Delete a whole meal (logged entry).
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

// Daily totals across a date range (recent history view).
router.get("/summary", auth, async (req, res) => {
    try {
        const tz = await userTz(req.userId);
        const today = todayKeyFor(tz);
        const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
        const from = req.query.from && isValidDateKey(req.query.from) ? req.query.from : null;
        const to = from ? (req.query.to && isValidDateKey(req.query.to) ? req.query.to : today) : today;

        const start = from || new Date(new Date(to + "T12:00:00Z").getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);

        const meals = await Meal.find({ userId: req.userId, date: { $gte: start, $lte: to } })
            .sort({ date: 1 })
            .limit(400);

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
            const day = dayTotals(dayMeals.map((m) => m.toObject()));
            out.push({ date: cursor, totals: day.totals, mealCount: dayMeals.length });
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
