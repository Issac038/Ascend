// ------------------------------------------------------------
// Ascend nutrition engine — composition root.
//
// The deterministic pipeline, exactly in Nut AI's order
// (SPEC-accuracy-engine.md §3–§7):
//
//   vision payload (validated, NO totals field exists)
//     -> clamp (non-negotiable arithmetic sanity, flags recorded)
//     -> resolve each item against the USDA corpus (6-signal scoring)
//     -> gram engine (6-tier reconciliation ladder, trust hierarchy not averages)
//     -> ingredient rows: (food_reference, grams, per-100g snapshot) — the
//        ONLY storage shape, per Nut AI's domain invariant
//     -> totals: pure arithmetic + Atwater reconciliation
//     -> confidence: measured per-pathway bands in quadrature
//     -> repair: expected-value question selection
//
// The AI never owns a number the user sees. It describes; the tables decide.
// ------------------------------------------------------------

const { clamp } = require("./clamp");
const engine = require("./gramEngine");
const totals = require("./totals");
const confidence = require("./confidence");
const repair = require("./repair");
const resolver = require("./resolver");

// Uncertainty reason → the prep facet the resolver should prefer.
const PREP_FROM_REASONS = null; // (reserved) prep currently flows from cues below

function prepFacetFor(item) {
    const method = engine.methodFromCues(item.cooking_method_cues || []);
    if (method) return method;
    const key = String(item.canonical_food_key || "");
    if (/\bgrilled|grill\b/.test(key)) return "grilled";
    if (/\bfried\b/.test(key)) return "fried";
    if (/\bbaked|roasted\b/.test(key)) return "baked";
    if (/\bboiled|poached|steamed\b/.test(key)) return "poached";
    return null;
}

/** Corpus adapter the gram engine consumes. */
function makeFoodDb(coll) {
    return {
        // FNDDS Portions-and-Weights lookup: per_unit for countable foods,
        // small/medium/large for qualitative sizes.
        async fnddsPortionGrams(foodId, measure) {
            const food = await resolver.loadFood(coll, foodId);
            if (!food) return null;
            if (measure === "per_unit") return food.portionPerUnitG;
            if (measure === "small") return food.portionSmallG;
            if (measure === "medium") return food.portionMediumG;
            if (measure === "large") return food.portionLargeG;
            return food.servingSizeG;
        },
    };
}

function makePriorsAdapter(userPriors) {
    // userPriors: Map<conceptKey, prior> from the user's MealPrior documents.
    const map = userPriors || new Map();
    return {
        get(conceptKey) {
            return map.get(conceptKey) || null;
        },
        containers: new Map(),
    };
}

/**
 * Turn one clamped vision item into a stored IngredientRow.
 * Returns { row, resolution, questionInputs } — never throws for a miss:
 * a DB miss produces an explicit "AI estimate" row (isEstimate: true) using
 * the model's fallback macros AT the estimated grams, exactly like Nut AI's
 * miss path.
 */
async function buildRow(coll, db, priors, item, gramsResult) {
    const ctx = {
        canonicalFoodKey: item.canonical_food_key,
        observedBrand: item.brand || null,
        prepFacet: prepFacetFor(item),
        modelCategory: item.cuisine_hint || null,
        estimatedGrams: gramsResult.grams,
    };

    const resolution = await resolver.resolveByText(coll, ctx);
    const accepted = resolution.outcome.kind === "auto_accepted" ? resolution.outcome.candidate : null;

    if (!accepted) {
        // ---- DB-miss path: explicit AI estimate, lowest trust, flagged ----
        const m = item.fallback_macros_at_estimate;
        return {
            row: {
                id: `est-${Math.random().toString(36).slice(2, 10)}`,
                displayName: item.name,
                sourceFoodId: null,
                grams: Math.round(gramsResult.grams * 10) / 10,
                // Snapshot per 100 g, derived from the clamp-corrected macros
                // at the model's estimate — arithmetic, not fabrication.
                nutrientSnapshot: {
                    kcal: gramsResult.grams > 0 ? Math.round((m.calories_kcal * 100 / gramsResult.grams) * 10) / 10 : m.calories_kcal,
                    protein_g: gramsResult.grams > 0 ? Math.round((m.protein_g * 100 / gramsResult.grams) * 10) / 10 : m.protein_g,
                    fat_g: gramsResult.grams > 0 ? Math.round((m.fat_g * 100 / gramsResult.grams) * 10) / 10 : m.fat_g,
                    carbs_g: gramsResult.grams > 0 ? Math.round((m.carbs_g * 100 / gramsResult.grams) * 10) / 10 : m.carbs_g,
                    fiber_g: m.fiber_g != null && gramsResult.grams > 0 ? Math.round((m.fiber_g * 100 / gramsResult.grams) * 10) / 10 : null,
                    sugar_g: null,
                    sodium_mg: m.sodium_mg != null && gramsResult.grams > 0 ? Math.round((m.sodium_mg * 100 / gramsResult.grams) * 10) / 10 : null,
                },
                origin: "vision_model",
                sourceUrl: null,
                gramPathway: gramsResult.pathway,
                bandHalfPct: Math.max(gramsResult.halfPct, 0.45),
                isEstimate: true, // drives the "AI estimate" badge — a DB miss, not mere low confidence
                assumptions: item.stated_assumptions.map((a) => ({ type: a, userConfirmed: false })),
                macrosUserEdited: false,
            },
            resolution,
            gramResult: gramsResult,
        };
    }

    // ---- DB hit: snapshot copied from the corpus row, immutable -----------
    const food = await resolver.loadFood(coll, accepted.foodId);
    if (!food || food.per100g.kcal == null) {
        return buildRowMissOnly(coll, db, priors, item, gramsResult, resolution);
    }
    const p = food.per100g;
    return {
        row: {
            id: `fdc-${food.foodId}-${Math.random().toString(36).slice(2, 8)}`,
            displayName: food.brand ? `${food.brand} ${food.name}`.slice(0, 120) : food.name,
            sourceFoodId: food.foodId,
            grams: Math.round(gramsResult.grams * 10) / 10,
            nutrientSnapshot: {
                kcal: p.kcal,
                protein_g: p.protein_g,
                fat_g: p.fat_g,
                carbs_g: p.carbs_g,
                fiber_g: p.fiber_g,
                sugar_g: p.sugar_g,
                sodium_mg: p.sodium_mg,
            },
            origin: "vision_model",
            sourceUrl: null,
            gramPathway: gramsResult.pathway,
            bandHalfPct: gramsResult.halfPct,
            isEstimate: false,
            assumptions: item.stated_assumptions.map((a) => ({ type: a, userConfirmed: false })),
            macrosUserEdited: false,
        },
        resolution,
        gramResult: gramsResult,
        food,
    };
}

/** Force the miss path (used when a corpus row lacks usable energy data). */
async function buildRowMissOnly(_coll, _db, _priors, item, gramsResult, resolution) {
    const m = item.fallback_macros_at_estimate;
    return {
        row: {
            id: `est-${Math.random().toString(36).slice(2, 10)}`,
            displayName: item.name,
            sourceFoodId: null,
            grams: Math.round(gramsResult.grams * 10) / 10,
            nutrientSnapshot: {
                kcal: gramsResult.grams > 0 ? Math.round((m.calories_kcal * 100 / gramsResult.grams) * 10) / 10 : m.calories_kcal,
                protein_g: gramsResult.grams > 0 ? Math.round((m.protein_g * 100 / gramsResult.grams) * 10) / 10 : m.protein_g,
                fat_g: gramsResult.grams > 0 ? Math.round((m.fat_g * 100 / gramsResult.grams) * 10) / 10 : m.fat_g,
                carbs_g: gramsResult.grams > 0 ? Math.round((m.carbs_g * 100 / gramsResult.grams) * 10) / 10 : m.carbs_g,
                fiber_g: null,
                sugar_g: null,
                sodium_mg: null,
            },
            origin: "vision_model",
            sourceUrl: null,
            gramPathway: gramsResult.pathway,
            bandHalfPct: Math.max(gramsResult.halfPct, 0.45),
            isEstimate: true,
            assumptions: item.stated_assumptions.map((a) => ({ type: a, userConfirmed: false })),
            macrosUserEdited: false,
        },
        resolution,
        gramResult: gramsResult,
    };
}

/**
 * Full deterministic pipeline for a validated vision payload.
 * Returns { items: [{row, gramResult, resolution}], mealTotals, mealBand,
 * questions, clampFlags, overall }.
 */
async function analyzePayload(coll, payload, opts) {
    const options = opts || {};
    const { payload: clamped, flags } = clamp(payload);
    const db = makeFoodDb(coll);
    const priors = makePriorsAdapter(options.priors);

    const outItems = [];
    for (const item of clamped.items) {
        // Segment-free web scan: no pixel geometry is available, so the ladder
        // uses label/discrete/prior/standard-portion/model tiers honestly.
        const gramsResult = engine.estimateGrams({
            item,
            priors,
            db,
            resolved: null, // resolved lazily inside buildRow via the resolver
            isMixedDish: confidence.classifyCategory(item) === confidence.FoodCategory.MIXED_COMPOSITE,
        });
        const built = await buildRow(coll, db, priors, item, gramsResult);
        outItems.push(built);
    }

    // ---- totals: pure arithmetic over the rows -------------------------
    const loggedMeal = { ingredients: outItems.map((o) => o.row), portionEatenFraction: options.portionEatenFraction || 1 };
    const rawTotals = totals.recomputeTotals(loggedMeal);

    // ---- confidence: per-row bands -> meal band in quadrature ----------
    const banded = outItems.map((o) => {
        const item = clamped.items.find((it) => it.name === o.row.displayName) || clamped.items[0];
        const band = confidence.computeBand({
            row: o.row,
            item,
            baselines: confidence.SEEDED_BASELINES,
            path: "cloud",
            hadClampFlag: flags.some((f) => f.item === null || f.item === item.name),
        });
        return { kcal: totals.itemCalories(o.row), band, rowId: o.row.id };
    });
    const band = confidence.mealBand(banded);

    // ---- repair: EV-gated question selection ---------------------------
    const questions = repair.selectMealQuestions(
        clamped.items.map((item) => ({
            item,
            gramDisagreement: null, // surfaced from gram results below if present
        })),
    );
    // If any item's gram engine produced a real disagreement, wire that question.
    const disagreeing = outItems.find((o) => o.gramResult && o.gramResult.surfaceDisagreementQuestion);
    if (disagreeing) {
        const g = disagreeing.gramResult;
        const existing = questions.find((q) => q.question.id === "gram_disagreement");
        if (existing) {
            existing.appliedDefault = null;
            existing.state = "highlighted";
            existing.text = existing.question.text
                .replace("{low}", String(Math.round(Math.min(g.grams, g.rivalGrams))))
                .replace("{high}", String(Math.round(Math.max(g.grams, g.rivalGrams))));
        }
    }

    return {
        items: outItems,
        totals: rawTotals,
        displayTotals: totals.toDisplayTotals(rawTotals),
        band,
        clampFlags: flags,
        questions,
        overall: clamped.meal_overall,
        isFood: clamped.is_food,
        refusalReason: clamped.refusal_reason,
    };
}

module.exports = {
    clamp, engine, totals, confidence, repair, resolver,
    makeFoodDb, makePriorsAdapter, analyzePayload, prepFacetFor,
};
