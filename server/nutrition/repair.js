// ------------------------------------------------------------
// The interruption rule and the ranked question bank.
//
// Port of Nut AI's @nutai/repair (AGPL-3.0 — see LICENSE-NUTAI.md).
//
//   expected_value(Q) = P(assumption_wrong) x expected_kcal_swing(Q) x severity
//
//   ASK Q as a highlighted chip iff  expected_value(Q) > INTERRUPTION_THRESHOLD
//                                    AND selected_this_scan < MAX_QUESTIONS
//   ELSE apply the silent default and render it as a visibly-editable,
//        clearly-labeled, PRE-ANSWERED chip. Never a hidden assumption.
//
// The asymmetry this produces is the whole point: a mixed-dish photo
// surfaces 1-2 questions; a banana logs in one tap.
// ------------------------------------------------------------

const MAX_QUESTIONS = 2;
const INTERRUPTION_THRESHOLD = 45;
const REMEMBER_AFTER_ANSWERS = 3;

const QUESTION_BANK = [
    {
        rank: 1,
        id: "portion_eaten",
        text: "Did you eat all of this, or some of it?",
        expectedSwingKcal: 300,
        multiplicative: true,
        options: [
            { label: "All of it", value: "1.0" },
            { label: "About half", value: "0.5" },
            { label: "A little", value: "0.25" },
        ],
        silentDefault: "1.0",
        defaultDisclosure: "Assuming you ate all of it",
        reasons: ["none"],
    },
    {
        rank: 2,
        id: "servings_consumed",
        text: "This looks like a multi-serving package — how much did you have?",
        expectedSwingKcal: 400,
        multiplicative: true,
        options: [
            { label: "Whole package", value: "all" },
            { label: "1 serving", value: "1" },
        ],
        silentDefault: "1",
        defaultDisclosure: "Assuming 1 serving — tap to change",
        reasons: ["serving_count_ambiguous"],
    },
    {
        rank: 3,
        id: "cooking_oil",
        text: "Was this cooked with oil or butter?",
        expectedSwingKcal: 240,
        multiplicative: false,
        options: [
            { label: "None visible", value: "none" },
            { label: "A little (~1 tsp–1 tbsp)", value: "little" },
            { label: "A lot (2+ tbsp)", value: "lots" },
        ],
        silentDefault: "little",
        defaultDisclosure: "Assumed ~1 tbsp oil — typical for this dish",
        reasons: ["oil_or_fat_not_visually_determinable"],
    },
    {
        rank: 4,
        id: "sauce_type",
        text: "What kind of dressing or sauce, and how much?",
        expectedSwingKcal: 200,
        multiplicative: false,
        options: [
            { label: "Light", value: "light" },
            { label: "Medium", value: "medium" },
            { label: "Heavy", value: "heavy" },
        ],
        silentDefault: "medium",
        defaultDisclosure: "Assumed a medium amount of the most common sauce",
        reasons: ["sauce_type_ambiguous"],
    },
    {
        rank: 5,
        id: "milk_type",
        text: "What kind of milk?",
        expectedSwingKcal: 110,
        multiplicative: false,
        options: [
            { label: "Whole", value: "whole" },
            { label: "2%", value: "2pct" },
            { label: "Skim", value: "skim" },
            { label: "Oat", value: "oat" },
            { label: "Almond", value: "almond" },
            { label: "Soy", value: "soy" },
        ],
        silentDefault: "whole",
        defaultDisclosure: "Assumed whole milk",
        reasons: ["milk_type_ambiguous"],
    },
    {
        rank: 6,
        id: "regular_or_diet",
        text: "Regular or diet?",
        expectedSwingKcal: 145,
        multiplicative: false,
        options: [
            { label: "Regular", value: "regular" },
            { label: "Diet / zero", value: "diet" },
        ],
        // Deliberately the HIGHER-risk direction: silently assuming zero-
        // calorie undercounts, and undercounting is undetectable.
        silentDefault: "regular",
        defaultDisclosure: "Assumed regular, not diet",
        reasons: ["identity_ambiguous"],
    },
    {
        rank: 7,
        id: "meat_fat_pct",
        text: "Lean or regular, and what cut?",
        expectedSwingKcal: 95,
        multiplicative: false,
        options: [
            { label: "80/20", value: "80_20" },
            { label: "85/15", value: "85_15" },
            { label: "90/10", value: "90_10" },
            { label: "93/7", value: "93_7" },
        ],
        silentDefault: "85_15",
        defaultDisclosure: "Assumed 85/15, the most commonly sold",
        reasons: ["meat_fat_percent_ambiguous"],
    },
    {
        rank: 8,
        id: "raw_or_cooked",
        text: "Is that weight before or after cooking?",
        expectedSwingKcal: 80,
        multiplicative: false,
        options: [
            { label: "Raw weight", value: "raw" },
            { label: "Cooked weight", value: "cooked" },
        ],
        silentDefault: "cooked",
        defaultDisclosure: "Assumed cooked weight",
        reasons: ["cooked_vs_raw_ambiguous"],
    },
    {
        rank: 9,
        id: "gram_disagreement",
        text: "Does this look more like {low} g or {high} g?",
        expectedSwingKcal: 250,
        multiplicative: false,
        options: [],
        silentDefault: "higher_weighted",
        defaultDisclosure: "Used the more reliable of two estimates",
        reasons: ["portion_depth_not_visible", "container_size_no_reference"],
    },
    {
        rank: 10,
        id: "alcohol_abv",
        text: "What is this, and roughly what ABV — or what brand and size?",
        expectedSwingKcal: 200,
        multiplicative: false,
        options: [
            { label: "Light beer", value: "light_beer" },
            { label: "Regular beer", value: "regular_beer" },
            { label: "Craft (~7–10%)", value: "craft_beer" },
            { label: "Wine", value: "wine" },
            { label: "Cocktail", value: "cocktail" },
            { label: "Spirit, neat", value: "spirit" },
        ],
        silentDefault: "regular_beer",
        defaultDisclosure: "Assumed 5% ABV at a standard pour — could easily be double",
        reasons: ["abv_unknown"],
    },
    {
        rank: 11,
        id: "shake_recipe",
        text: "What's blended in — milk, water, or an alternative, and any add-ins?",
        expectedSwingKcal: 300,
        multiplicative: false,
        options: [
            { label: "Water", value: "water" },
            { label: "Milk", value: "milk" },
            { label: "Milk alternative", value: "alt_milk" },
        ],
        silentDefault: "water",
        defaultDisclosure: "Assumed a water base with no add-ins",
        reasons: ["shake_recipe_unknown"],
    },
];

function questionByReason(reason) {
    return QUESTION_BANK.find((q) => q.reasons.includes(reason)) || null;
}

/** Categories whose oil use is high-variance regardless of model confidence. */
const HIGH_OIL_VARIANCE = /\b(stir.?fry|saute|sautee|fried rice|curry|scrambled|omelet|hash|roast)\b/;
/** Categories where sauce type is ambiguous by construction. */
const SAUCE_AMBIGUOUS = /\b(salad|pasta|noodle|wings|bowl|burrito|sandwich|wrap)\b/;

/**
 * Derive uncertainty from the FOOD CATEGORY alone, with no model self-report.
 * On model scans it is a FLOOR (applied as a UNION, never a replacement): if
 * the model failed to flag oil on a stir-fry, we flag it anyway.
 */
function inferStructuralUncertainty(item) {
    const out = { reasons: [], assumptions: [], questionIds: [] };
    const key = String(item.canonical_food_key || "").toLowerCase();

    if (HIGH_OIL_VARIANCE.test(key) && !item.cooking_method_cues.includes("visible_oil_pooling")) {
        out.reasons.push("oil_or_fat_not_visually_determinable");
        out.assumptions.push("Assumed ~1 tbsp cooking oil — typical for this dish, not visible once cooked.");
        out.questionIds.push("cooking_oil");
    }
    if (SAUCE_AMBIGUOUS.test(key)) {
        out.reasons.push("sauce_type_ambiguous");
        out.assumptions.push("Assumed a medium amount of the most common sauce for this dish.");
        out.questionIds.push("sauce_type");
    }
    if (item.beverage_category === "alcoholic_poured_or_mixed") {
        out.reasons.push("abv_unknown");
        out.assumptions.push("Assumed 5% ABV at a standard pour — this could easily be double.");
        out.questionIds.push("alcohol_abv");
    }
    if (item.beverage_category === "blended_shake_or_smoothie") {
        out.reasons.push("shake_recipe_unknown");
        out.assumptions.push("Assumed a water base with no add-ins.");
        out.questionIds.push("shake_recipe");
    }
    if (item.visible_reference_objects.length === 0 && item.food_form !== "discrete") {
        out.reasons.push("container_size_no_reference");
    }
    return out;
}

/** Probability the silent default is wrong — RELATIVE, never an absolute. */
function probabilityWrong(q, item, structural) {
    let p = structural ? 0.55 : 0.3;
    if (item.uncertainty_reason !== "none" && q.reasons.includes(item.uncertainty_reason)) {
        p = Math.max(p, 0.7);
    }
    if (item.portion_confidence < 0.4) p = Math.min(0.9, p + 0.15);
    else if (item.portion_confidence > 0.8) p = Math.max(0.15, p - 0.1);
    return p;
}

function expectedValue(q, item, structural, severityWeight) {
    return probabilityWrong(q, item, structural) * q.expectedSwingKcal * severityWeight;
}

/**
 * Select questions for one item. Returns ALL applicable questions —
 * highlighted (asking) AND pre-answered (default applied and disclosed).
 * Nothing applicable is ever dropped silently.
 */
function selectQuestions(input) {
    const { item } = input;
    const severity = input.severityWeight || 1;
    const structural = inferStructuralUncertainty(item);
    const structuralIds = new Set(structural.questionIds);

    const applicable = [];
    for (const q of QUESTION_BANK) {
        if (input.rememberedAnswers && input.rememberedAnswers.has(q.id)) continue;

        let isApplicable = false;
        if (q.id === "portion_eaten") isApplicable = item.legible_label_text == null;
        else if (q.id === "servings_consumed") isApplicable = input.multiServingPackage === true;
        else if (q.id === "gram_disagreement") isApplicable = input.gramDisagreement != null;
        else {
            isApplicable =
                structuralIds.has(q.id) ||
                q.reasons.includes(item.uncertainty_reason) ||
                ((input.extraReasons || []).some((r) => q.reasons.includes(r)));
        }

        if (!isApplicable) continue;
        applicable.push({ q, ev: expectedValue(q, item, structuralIds.has(q.id), severity) });
    }

    // Ranks 1-2 are factual (cheap AND certain resolution) — closer to
    // "always ask when applicable". Ranks 3-11 are EV-gated.
    applicable.sort((a, b) => {
        if (a.q.multiplicative !== b.q.multiplicative) return a.q.multiplicative ? -1 : 1;
        return b.ev - a.ev;
    });

    let highlighted = 0;
    return applicable.map(({ q, ev }) => {
        const clears = q.multiplicative || ev > INTERRUPTION_THRESHOLD;
        const ask = clears && highlighted < MAX_QUESTIONS;
        if (ask) highlighted++;

        let text = q.text;
        if (input.gramDisagreement && q.id === "gram_disagreement") {
            text = text
                .replace("{low}", String(Math.round(input.gramDisagreement.low)))
                .replace("{high}", String(Math.round(input.gramDisagreement.high)));
        }

        return {
            question: q,
            text,
            expectedValue: ev,
            state: ask ? "highlighted" : "pre_answered",
            appliedDefault: ask ? null : q.silentDefault,
            disclosure: q.defaultDisclosure,
        };
    });
}

/** Highlighted questions across a whole meal, respecting the global cap. */
function selectMealQuestions(items) {
    const all = items.flatMap((i) => selectQuestions(i));
    const highlighted = all.filter((q) => q.state === "highlighted");
    if (highlighted.length <= MAX_QUESTIONS) return all;

    const keep = new Set(
        [...highlighted].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, MAX_QUESTIONS),
    );
    return all.map((q) =>
        q.state === "highlighted" && !keep.has(q)
            ? { ...q, state: "pre_answered", appliedDefault: q.question.silentDefault }
            : q,
    );
}

// ---------------- answer memory (a frequency table, not ML) ----------------

function shouldApplySilently(memory) {
    return memory != null && memory.answerCount >= REMEMBER_AFTER_ANSWERS;
}

function recordAnswer(existing, foodConceptKey, attribute, value) {
    if (!existing || existing.value !== value) {
        // A changed answer resets the count.
        return { foodConceptKey, attribute, value, answerCount: 1 };
    }
    return { ...existing, answerCount: existing.answerCount + 1 };
}

module.exports = {
    MAX_QUESTIONS, INTERRUPTION_THRESHOLD, REMEMBER_AFTER_ANSWERS,
    QUESTION_BANK, questionByReason, HIGH_OIL_VARIANCE, SAUCE_AMBIGUOUS,
    inferStructuralUncertainty, probabilityWrong, expectedValue,
    selectQuestions, selectMealQuestions, shouldApplySilently, recordAnswer,
};
