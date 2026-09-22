// ------------------------------------------------------------
// Ascend nutrition engine unit tests — the deterministic core.
//
// Runs standalone: node test/nutrition-engine.test.js
// The corpus, the AI provider and MongoDB are NOT required — every fixture
// mirrors the real data shapes from the USDA CSVs and the Nut AI payload
// schema (see ../nutrition/THIRD-PARTY-DATA.md + LICENSE-NUTAI.md).
// ------------------------------------------------------------
process.env.NODE_ENV = "test";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
    if (cond) { pass++; }
    else { fail++; failures.push(name + (extra ? ` :: ${JSON.stringify(extra).slice(0, 200)}` : "")); }
}
function section(name) { console.log(`\n## ${name}`); }
function done(suite) {
    console.log(`\n${suite}: ${pass} passed, ${fail} failed`);
    if (failures.length) failures.forEach((f) => console.log("  FAIL: " + f));
    process.exit(fail > 0 ? 1 : 0);
}

const engine = require("../nutrition/gramEngine");
const clampMod = require("../nutrition/clamp");
const totalsMod = require("../nutrition/totals");
const confidenceMod = require("../nutrition/confidence");
const repairMod = require("../nutrition/repair");
const resolverMod = require("../nutrition/resolver");
const schema = require("../nutrition/schema");

// ---------------- schema validation ----------------
section("schema");

function validItem(over) {
    return {
        name: "Chicken breast",
        brand: null,
        canonical_food_key: "chicken breast, grilled",
        food_form: "flat",
        qualitative_size: "medium",
        weight_basis: "cooked",
        model_gram_estimate: 150,
        identification_confidence: 0.8,
        portion_confidence: 0.6,
        uncertainty_reason: "none",
        visible_reference_objects: [],
        container: null,
        cooking_method_cues: ["grill_marks"],
        is_beverage: false,
        beverage_category: null,
        legible_label_text: null,
        stated_assumptions: [],
        clarifying_questions: [],
        fallback_macros_at_estimate: {
            calories_kcal: 248, protein_g: 46.5, carbs_g: 0, fat_g: 5.4,
            fiber_g: null, sodium_mg: 74,
        },
        ...over,
    };
}
function validPayload(items) {
    return {
        schema_version: "1.0.0",
        is_food: true,
        refusal_reason: null,
        items,
        meal_overall: {
            identification_confidence: 0.8,
            portion_confidence: 0.6,
            assumptions: [],
            clarifying_questions: [],
        },
    };
}

check("valid payload passes", (() => { try { schema.validateVisionPayload(validPayload([validItem()])); return true; } catch (e) { return false; } })());
check("missing meal_totals is fine (it does not exist)", (() => { try { schema.validateVisionPayload({ ...validPayload([validItem()]), meal_totals: { kcal: 999999 } }); return true; } catch { return false; } })());
check("bad food_form rejected", (() => { try { schema.validateVisionPayload(validPayload([validItem({ food_form: "blob" })])); return false; } catch { return true; } })());
check("bad qualitative_size rejected", (() => { try { schema.validateVisionPayload(validPayload([validItem({ qualitative_size: "huge" })])); return false; } catch { return true; } })());
check("count:N accepted", (() => { try { schema.validateVisionPayload(validPayload([validItem({ qualitative_size: "count:2", food_form: "discrete" })])); return true; } catch { return false; } })());
check("model_gram_estimate out of range is NOT a validation error (clamp's job)", (() => { try { schema.validateVisionPayload(validPayload([validItem({ model_gram_estimate: 999999 })])); return true; } catch { return false; } })());
check("empty items rejected when is_food", (() => { try { schema.validateVisionPayload(validPayload([])); return false; } catch { return true; } })());
check("non-food payload needs no items", (() => { try { schema.validateVisionPayload({ ...validPayload([]), is_food: false, refusal_reason: "not food" }); return true; } catch { return false; } })());
check("label payload round-trips", (() => { try {
    const l = schema.validateLabelPayload({ product_name: "Choco Puffs", serving_desc: "1 cup (30g)", serving_g: 30, servings_per_container: 10, per_serving: { calories_kcal: 120, protein_g: 2, carbs_g: 24, fat_g: 1.5, fiber_g: 1, sugar_g: 12, sodium_mg: 150 } });
    return l.serving_g === 30 && l.per_serving.sugar_g === 12;
} catch { return false; } })());

// ---------------- clamp ----------------
section("clamp");

// 27M-calorie class: kcal reported as kJ etc.
const absurd = validPayload([validItem({
    model_gram_estimate: 3000,
    fallback_macros_at_estimate: { calories_kcal: 27, protein_g: 0.1, carbs_g: 0, fat_g: 0, fiber_g: null, sodium_mg: 0 },
})]);
{
    const { payload, flags } = clampMod.clamp(absurd);
        check("absurd kcal replaced by Atwater from its macros", payload.items[0].fallback_macros_at_estimate.calories_kcal === 0.4, payload.items[0].fallback_macros_at_estimate);
    check("clamp flags do not delete the item", payload.items.length === 1);
    // kJ-vs-kcal case: a protein-free fat-free item with only carb grams
    // reported as kJ would survive macro recompute, so density check catches
    // it only when grams are present — verified via the 27M-calorie fixture
    // in the API suite. Here: flag must NOT fire for the corrected 0.4 kcal.
    check("no impossible-density flag once arithmetic is coherent", !flags.some((f) => f.kind === "impossible_energy_density"), flags);
}
{
    // macro mismatch: model says 500 kcal but macros say 4*20+4*50+9*10 = 390
    const { payload, flags } = clampMod.clamp(validPayload([validItem({
        fallback_macros_at_estimate: { calories_kcal: 500, protein_g: 20, carbs_g: 50, fat_g: 10, fiber_g: null, sodium_mg: 0 },
    })]));
    const f = flags.find((f) => f.kind === "macro_arithmetic_mismatch");
    check("macro arithmetic mismatch flagged", !!f);
    check("calories REPLACED by Atwater (370 = 4*20+4*50+9*10), not warned-and-kept", payload.items[0].fallback_macros_at_estimate.calories_kcal === 370);
    check("pure function: input payload not mutated", absurd.items[0].fallback_macros_at_estimate.calories_kcal === 27);
}
{
    // grams out of bounds -> demoted to null, ladder falls through
    const { payload, flags } = clampMod.clamp(validPayload([validItem({ model_gram_estimate: 5000 })]));
    check("grams 5000 out of bounds flagged", flags.some((f) => f.kind === "grams_out_of_bounds"));
    check("grams demoted to null (not deleted)", payload.items[0].model_gram_estimate === null);
}
check("920 kcal/100g ceiling admits lard (902) — real USDA max", clampMod.CLAMP_BOUNDS.MAX_KCAL_PER_100G === 920);

// ---------------- totals ----------------
section("totals");

{
    const row = {
        grams: 150,
        nutrientSnapshot: { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, fiber_g: null, sugar_g: null, sodium_mg: 74 },
        macrosUserEdited: false,
    };
    const rt = totalsMod.rowTotals(row);
    check("rowTotals: 150g of 165kcal/100g = 247.5", Math.abs(rt.kcal - 247.5) < 1e-9);
    check("rowTotals: null micronutrient sums as 0", rt.fiber_g === 0);
    const meal = { ingredients: [row], portionEatenFraction: 0.5 };
    const t = totalsMod.recomputeTotals(meal);
    check("portionEatenFraction is a final multiplier", Math.abs(t.kcal - 123.75) < 1e-9);
    check("Atwater reconcile: 4/4/9", totalsMod.reconcileFromMacros(20, 50, 10) === 370);
    // Display regime: kcal computed FROM rounded macros so users can hand-check.
    const display = totalsMod.toDisplayTotals({ kcal: 480.9, protein_g: 52.69, fat_g: 6.19, carbs_g: 50.0, fiber_g: 2.4, sugar_g: 3.6, sodium_mg: 512.4 });
    check("display kcal = round(4*53 + 4*50 + 9*6.2) = 468", display.kcal === 468, display);
    check("grams rounding: one decimal below 10g, whole at 10g+", display.fiber_g === 2.4 && display.sodium_mg === 512);
    check("label rounding: calories <5 -> 0, <=50 -> 5s, else 10s", totalsMod.labelRounding.calories(3) === 0 && totalsMod.labelRounding.calories(47) === 45 && totalsMod.labelRounding.calories(240) === 240);
}

// ---------------- gram engine: reconciliation ladder ----------------
section("gram engine — reconcile");

check("disagreement >35% surfaces a question, never averages", (() => {
    const out = engine.reconcile([
        { grams: 140, pathway: "fndds_standard_portion", weight: 0.55, spread: 0.25 },
        { grams: 220, pathway: "model_guess", weight: 0.25, spread: 0.4 },
    ]);
    return out.surfaceDisagreementQuestion === true && out.rivalGrams === 220 && out.grams === 140;
})());
check("close candidates blend top-two by trust", (() => {
    const out = engine.reconcile([
        { grams: 150, pathway: "a", weight: 0.9, spread: 0.1 },
        { grams: 160, pathway: "b", weight: 0.5, spread: 0.2 },
    ]);
    return !out.surfaceDisagreementQuestion && Math.abs(out.grams - (150 * 0.9 + 160 * 0.5) / 1.4) < 1e-9;
})());
check("empty ladder falls to 150g generic fallback with forced low confidence", (() => {
    const out = engine.reconcile([]);
    return out.grams === 150 && out.pathway === "clamped" && out.forceLowConfidence === true;
})());
check("clampGrams flags out-of-bounds instead of silent truncation", (() => {
    const out = engine.clampGrams({ grams: 9999, pathway: "model_guess", spread: 0.4 });
    return out.grams === 3000 && out.pathway === "clamped" && out.forceLowConfidence === true;
})());

// ---------------- gram engine: pathways ----------------
section("gram engine — pathways");

const dbStub = {
    fnddsPortionGrams(foodId, measure) {
        if (foodId === "egg") return measure === "per_unit" ? 50 : null;
        if (foodId === "banana") return measure === "medium" ? 118 : measure === "large" ? 136 : measure === "small" ? 101 : 118;
        return null;
    },
};
const emptyPriors = { get: () => null, containers: new Map() };

check("tier 1 discrete count: 2 eggs x 50g = 100g (spread 0.125)", (() => {
    const out = engine.estimateGrams({
        item: validItem({ food_form: "discrete", qualitative_size: "count:2", canonical_food_key: "egg", model_gram_estimate: 60 }),
        priors: emptyPriors, db: dbStub, resolved: { foodId: "egg" },
    });
    return out.grams === 100 && out.pathway === "discrete_count" && out.halfPct === 0.125;
})());
check("tier 4 FNDDS standard portion: medium banana = 118g", (() => {
    const out = engine.estimateGrams({
        item: validItem({ food_form: "piled", qualitative_size: "medium", canonical_food_key: "banana", model_gram_estimate: 200 }),
        priors: emptyPriors, db: dbStub, resolved: { foodId: "banana" },
    });
    return out.pathway === "fndds_standard_portion" && Math.round(out.grams) === 118;
})());
check("tier 5 model guess is the fallback (weight 0.25; spread floor 0.4)", (() => {
    const out = engine.estimateGrams({
        item: validItem({ canonical_food_key: "mystery dish", model_gram_estimate: 200 }),
        priors: emptyPriors, db: dbStub, resolved: null,
    });
    return out.pathway === "model_guess" && out.grams === 200 && out.halfPct === 0.4;
})());
check("tier 0 packaged label short-circuits exactly", (() => {
    const out = engine.estimateGrams({
        item: validItem({ legible_label_text: "Per serving (30g): 120 calories", model_gram_estimate: null }),
        priors: emptyPriors, db: dbStub,
        resolved: { foodId: "x", servingSizeG: 30 },
        servingsConsumed: 2, barcodeMatch: true,
    });
    return out.pathway === "packaged_exact" && out.grams === 60 && out.halfPct === 0.02;
})());

// personal priors
check("prior below 3 samples is not trusted", !engine.isTrusted({ sampleCount: 2, ewmaRatio: 1.2, ratioVariance: 0 }));
check("trusted prior adjusts the model estimate", (() => {
    const priors = { get: (k) => ({ foodConceptKey: k, ewmaRatio: 1.2, ratioVariance: 0.01, sampleCount: 5, medianGrams: 240 }), containers: new Map() };
    const out = engine.estimateGrams({
        item: validItem({ canonical_food_key: "chicken breast", model_gram_estimate: 200 }),
        priors, db: dbStub, resolved: null,
    });
    return out.pathway === "personal_prior" && Math.abs(out.grams - 240) < 1e-9 && out.personalPriorApplied.sampleCount === 5;
})());
check("EWMA update math", (() => {
    const p = engine.updatePrior(null, "k", 100, 150, 0); // ratio 1.5
    const p2 = engine.updatePrior(p, "k", 100, 100, 1);   // ratio 1.0
    const expected = 0.3 * 1.0 + 0.7 * 1.5;
    return p.sampleCount === 1 && Math.abs(p2.ewmaRatio - expected) < 1e-9 && p2.sampleCount === 2;
})());
check("canonical concept key normalizes noise words", engine.canonicalConceptKey("grilled chicken breast") === "breast chicken");

// yields + oil
check("yield lookup is food-class-specific (bacon 0.31, chicken breast 0.72)", (() => {
    const bacon = engine.lookupYield("bacon", "pan_fried");
    const breast = engine.lookupYield("chicken breast", "baked");
    return bacon.yield === 0.31 && breast.yield === 0.72;
})());
check("no generic meat constant: unknown class returns null", engine.lookupYield("mystery meat", "grilled") === null);
check("raw->cooked yield conversion widens the band", (() => {
    // Nut AI's table has no grilled entry for chicken breast; "dry surface"
    // maps to baked (0.72, range 0.61-0.82).
    const out = engine.applyYieldFactor(
        { grams: 100, pathway: "model_guess", spread: 0.4 },
        validItem({ weight_basis: "raw", canonical_food_key: "chicken breast", cooking_method_cues: ["dry_surface"] }),
        null,
    );
    const rangeSpread = (0.82 - 0.61) / 2 / 0.72;
    return Math.abs(out.grams - 100 / 0.72) < 1e-9 && Math.abs(out.spread - Math.sqrt(0.4 ** 2 + rangeSpread ** 2)) < 1e-9;
})());
check("no yield entry for unknown class+method combo -> unchanged", (() => {
    const out = engine.applyYieldFactor(
        { grams: 100, pathway: "model_guess", spread: 0.4 },
        validItem({ weight_basis: "raw", canonical_food_key: "chicken breast", cooking_method_cues: ["grill_marks"] }),
        null,
    );
    return out.grams === 100 && out.spread === 0.4;
})());
check("cooked-basis item skips yield conversion entirely", (() => {
    const out = engine.applyYieldFactor(
        { grams: 100, pathway: "model_guess", spread: 0.4 },
        validItem({ weight_basis: "cooked", canonical_food_key: "chicken breast", cooking_method_cues: ["dry_surface"] }),
        null,
    );
    return out.grams === 100;
})());
check("oil-sheen cue maps to pan-fried method", engine.methodFromCues(["visible_oil_sheen"]) === "pan_fried");
check("deep-fried cues add absorbed oil mass", (() => {
    const out = engine.applyOilCorrection(
        { grams: 200, pathway: "model_guess", spread: 0.4 },
        validItem({ canonical_food_key: "french fries", cooking_method_cues: ["deep_fried_color"] }),
    );
    return Math.abs(out.grams - 250) < 1e-9 && Math.abs(out.addedOilGrams - 50) < 1e-9;
})());

// bands
check("mixed dish widens in quadrature, not additively", (() => {
    const a = engine.computeGramBand({ pathway: "model_guess" });
    const b = engine.computeGramBand({ pathway: "model_guess", isMixedDish: true });
    const expected = Math.sqrt(0.375 ** 2 + 0.45 ** 2);
    return b.halfPct > a.halfPct && Math.abs(b.halfPct - expected) < 1e-9;
})());
check("bands are clamped to [0.02, 0.8]", (() => {
    const lo = engine.computeGramBand({ pathway: "user_edited", measuredSpread: 0 });
    const hi = engine.computeGramBand({ pathway: "clamped", measuredSpread: 0.9 });
    return lo.halfPct === 0.02 && hi.halfPct === 0.8;
})());

// density
check("density never fails: resolves through tiers and records tier", (() => {
    const exact = engine.lookupDensity("rice, cooked");
    const group = engine.lookupDensity("grilled chicken breast");
    const def = engine.lookupDensity("grandma's mystery casserole");
    return exact.gPerMl === 0.725 && group.tier === "food_group" && def.tier === "default" && def.gPerMl === 0.9;
})());
check("leafy greens 0.06-0.08 vs casserole 1.04 — the 17x spread is preserved", engine.DENSITY_TABLE["salad greens, raw"] === 0.06 && engine.DENSITY_TABLE.lasagna === 1.04);

// ---------------- confidence ----------------
section("confidence");

check("mixed composite dish gets the 0.45 category band", (() => {
    const band = confidenceMod.computeBand({
        row: { gramPathway: "model_guess", id: "r1", grams: 300 },
        item: validItem({ canonical_food_key: "chicken curry", cooking_method_cues: ["sauce_coating"] }),
        baselines: confidenceMod.SEEDED_BASELINES,
        path: "cloud",
    });
    return band.halfPct === 0.45 && band.reasons.some((r) => /Mixed dishes/.test(r));
})());
check("model portion_confidence is a modifier only (x1.5 when < 0.4)", (() => {
    const band = confidenceMod.computeBand({
        row: { gramPathway: "model_guess", id: "r1", grams: 300 },
        item: validItem({ canonical_food_key: "plain rice", portion_confidence: 0.3, cooking_method_cues: ["none_visible"] }),
        baselines: confidenceMod.SEEDED_BASELINES,
        path: "cloud",
    });
    return Math.abs(band.halfPct - Math.min(0.6, 0.375 * 1.5)) < 1e-9;
})());
check("clamp flags FLOOR the band at 0.5", (() => {
    const band = confidenceMod.computeBand({
        row: { gramPathway: "packaged_exact", id: "r1", grams: 30 },
        item: validItem({ canonical_food_key: "crackers" }),
        baselines: confidenceMod.SEEDED_BASELINES,
        path: "cloud",
        hadClampFlag: true,
    });
    return band.halfPct === 0.5;
})());
check("meal band: quadrature weighted by kcal, floored at 0.7x dominant", (() => {
    const items = [
        { kcal: 500, band: { halfPct: 0.4, reasons: ["dominant"] } },
        { kcal: 50, band: { halfPct: 0.02, reasons: [] } },
    ];
    const mb = confidenceMod.mealBand(items);
    const w1 = 500 / 550, w2 = 50 / 550;
    const variance = (w1 * 0.4) ** 2 + (w2 * 0.02) ** 2;
    const expected = Math.max(Math.sqrt(variance), 0.4 * 0.7);
    return Math.abs(mb.halfPct - expected) < 1e-6;
})());
check("baselines carry provenance 'seeded' (never claim measured)", confidenceMod.SEEDED_BASELINES.provenance.all === "seeded");

// ---------------- repair ----------------
section("repair");

check("rank-1 portion_eaten always applies (multiplicative)", (() => {
    const qs = repairMod.selectQuestions({ item: validItem({ canonical_food_key: "banana", uncertainty_reason: "none" }) });
    const q = qs.find((x) => x.question.id === "portion_eaten");
    return q && (q.state === "highlighted" || q.state === "pre_answered");
})());
check("oil question EV-gates: plain grilled breast, confident -> pre-answered", (() => {
    const qs = repairMod.selectQuestions({ item: validItem({ canonical_food_key: "chicken breast, grilled", uncertainty_reason: "none", portion_confidence: 0.85 }) });
    const oil = qs.find((x) => x.question.id === "cooking_oil");
    return oil === undefined; // not applicable: not structural, reason 'none'
})());
check("structural uncertainty fires on curry regardless of model confidence", (() => {
    const structural = repairMod.inferStructuralUncertainty(validItem({ canonical_food_key: "chicken curry", uncertainty_reason: "none", portion_confidence: 0.95 }));
    return structural.questionIds.includes("cooking_oil") && structural.assumptions.length > 0;
})());
check("max 2 highlighted questions per meal", (() => {
    const items = [
        { item: validItem({ canonical_food_key: "chicken curry" }) },
        { item: validItem({ canonical_food_key: "vegetable stir fry", beverage_category: "blended_shake_or_smoothie", is_beverage: true }) },
    ];
    const qs = repairMod.selectMealQuestions(items);
    return qs.filter((q) => q.state === "highlighted").length <= repairMod.MAX_QUESTIONS;
})());
check("answer memory: same answer 3x applies silently, changed answer resets", (() => {
    let m = repairMod.recordAnswer(null, "k", "milk_type", "whole");
    m = repairMod.recordAnswer(m, "k", "milk_type", "whole");
    m = repairMod.recordAnswer(m, "k", "milk_type", "whole");
    const silent = repairMod.shouldApplySilently(m);
    const reset = repairMod.recordAnswer(m, "k", "milk_type", "skim");
    return silent && reset.answerCount === 1;
})());
check("gram disagreement question renders both numbers", (() => {
    const qs = repairMod.selectQuestions({
        item: validItem({ canonical_food_key: "rice portion", uncertainty_reason: "portion_depth_not_visible" }),
        gramDisagreement: { low: 140, high: 220 },
    });
    const q = qs.find((x) => x.question.id === "gram_disagreement");
    return q && q.text.includes("140") && q.text.includes("220");
})());

// ---------------- resolver scoring ----------------
section("resolver");

check("ladder drops trailing tokens first (head noun leads)", (() => {
    const ladder = resolverMod.searchLadder("chicken breast, grilled");
    return ladder[0] === "chicken breast grilled" && ladder[1] === "chicken breast" && ladder[2] === "chicken" && ladder[ladder.length - 1] === "chicken breast grilled";
})());
check("FTS-special characters are stripped", (() => {
    const ladder = resolverMod.searchLadder('chicken "-breast" OR NOT');
    return ladder.every((expr) => !/["()*:^-]/.test(expr));
})());
check("auto-accept needs BOTH score >= 0.6 AND gap >= 0.12", (() => {
    const strong = { foodId: "1", score: 0.8, breakdown: {} };
    const weak = { foodId: "2", score: 0.3, breakdown: {} };
    const ok = resolverMod.decideOutcome([strong, weak]);
    const close = resolverMod.decideOutcome([{ ...strong }, { ...weak, score: 0.72 }]);
    const weakTop = resolverMod.decideOutcome([{ ...strong, score: 0.5 }, weak]);
    return ok.kind === "auto_accepted" && close.kind === "needs_disambiguation" && weakTop.kind === "needs_disambiguation";
})());
check("text-score normalization: single candidate gets 0.5, not 1.0", (() => {
    const m = resolverMod.normalizeTextScores([{ foodId: "a", textScore: 2.3 }]);
    return m.get("a") === 0.5;
})());
check("portion plausibility decays smoothly outside the row's range", (() => {
    const c = { typicalMinG: 100, typicalMaxG: 200 };
    const inRange = resolverMod.portionPlausibility(c, { estimatedGrams: 150 });
    const far = resolverMod.portionPlausibility(c, { estimatedGrams: 1000 });
    const none = resolverMod.portionPlausibility(c, { estimatedGrams: null });
    return inRange === 1 && far > 0 && far < 1 && none === 0.5;
})());

// ---------------- corpus loader (pure CSV part) ----------------
section("corpus loader");

const { parseCsvRows } = require("../nutrition/corpusLoader");
check("RFC-4180 CSV: quoted fields with commas and escaped quotes", (() => {
    const csv = ['a,b', '"hello, world","say ""hi"""', '"line', 'break",2'].join("\n");
    const rows = parseCsvRows(csv);
    return rows.length === 3 && rows[1][0] === "hello, world" && rows[1][1] === 'say "hi"' && rows[2][0] === "line\nbreak" && rows[2][1] === "2";
})());

done("nutrition-engine.test.js");
