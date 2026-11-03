// Client-side baseline helper tests. Run: node src/utils/baseline.test.mjs
import {
    BASELINE_CATEGORY_KEYS,
    BASELINE_SLIDER_KEYS,
    MAX_ANSWER_CHARS,
    areSliderAnswersValid,
    baselineMatchesAnswers,
    emptyAnswers,
    isValidSliderAnswer,
    mergeAnswers,
    parseStoredSliderAnswer,
    sliderRatingPercentage,
    scoreOf,
    overallBaselineRating,
    ratingProgressFraction,
    formatBaselineRating,
    hasResults,
    canContinueToReview
} from "./baseline.js";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, extra) {
    if (cond) { passed += 1; console.log(`  ok - ${name}`); }
    else { failed += 1; failures.push(name + (extra ? ` (${extra})` : "")); console.log(`  FAIL - ${name}${extra ? ` (${extra})` : ""}`); }
}

assert(
    JSON.stringify(BASELINE_CATEGORY_KEYS) === JSON.stringify(["body", "discipline", "learning", "productivity", "goalDrive"]),
    "five baseline categories remain in order"
);
assert(
    JSON.stringify(BASELINE_SLIDER_KEYS) === JSON.stringify(["body", "discipline", "learning", "productivity"]),
    "only the four requested categories are sliders"
);

const empty = emptyAnswers();
assert(BASELINE_SLIDER_KEYS.every((key) => empty[key] === null) && empty.goalDrive === "", "unanswered sliders and Goal Drive use distinct empty values");
for (let value = 1; value <= 10; value += 1) {
    assert(isValidSliderAnswer(value), `integer slider answer ${value} is valid`);
}
for (const value of [0, 11, 5.5, "5", null, undefined]) {
    assert(!isValidSliderAnswer(value), `invalid slider answer ${String(value)} is rejected`);
}

const answers = { body: 1, discipline: 5, learning: 10, productivity: 7, goalDrive: "ship app" };
assert(!areSliderAnswersValid(answers, {}), "unconfirmed defaults cannot be submitted");
assert(
    areSliderAnswersValid(answers, Object.fromEntries(BASELINE_SLIDER_KEYS.map((key) => [key, true]))),
    "all confirmed integer answers can be submitted"
);
assert(!areSliderAnswersValid({ ...answers, body: 0 }, Object.fromEntries(BASELINE_SLIDER_KEYS.map((key) => [key, true]))), "invalid value blocks submission");
assert(
    !areSliderAnswersValid(answers, { body: true, discipline: true, learning: true, productivity: false }),
    "unconfirmed category blocks submission"
);

const saved = { body: "1", discipline: "5", learning: "10", productivity: "7", goalDrive: "ship app" };
const merged = mergeAnswers(empty, saved);
assert(merged.body === 1 && merged.discipline === 5 && merged.learning === 10 && merged.productivity === 7, "saved slider values restore as integers");
assert(merged.goalDrive === "ship app", "Goal Drive text restores unchanged");
assert(
    baselineMatchesAnswers({ answers: saved }, merged),
    "persisted five-category answers match the restored form"
);
assert(!baselineMatchesAnswers({ answers: saved }, { ...merged, body: 6 }), "changed slider invalidates stale results");
assert(!baselineMatchesAnswers({ answers: saved }, { ...merged, goalDrive: "changed goal" }), "changed Goal Drive invalidates stale results");
assert(parseStoredSliderAnswer("10") === 10, "string-form schema values restore safely");
assert(parseStoredSliderAnswer("10.0") === null, "non-canonical slider strings are rejected");
for (const [rating, percentage] of [[1, 10], [5, 50], [10, 100]]) {
    assert(sliderRatingPercentage(rating) === percentage, `${rating}/10 displays as ${percentage}%`);
}

const local = { ...empty, body: 8, goalDrive: "local Goal Drive draft" };
const mergedWithLegacy = mergeAnswers(local, {
    body: "I used to exercise often",
    discipline: "sometimes",
    learning: "read daily",
    productivity: "okay",
    goalDrive: ""
});
assert(mergedWithLegacy.body === 8 && mergedWithLegacy.discipline === null, "legacy descriptive answers are not mistaken for slider ratings");
assert(mergedWithLegacy.goalDrive === "local Goal Drive draft", "local Goal Drive draft survives an empty saved answer");

const longGoalDrive = "a".repeat(MAX_ANSWER_CHARS + 50);
assert(mergeAnswers(empty, { goalDrive: longGoalDrive }).goalDrive.length === MAX_ANSWER_CHARS, "Goal Drive text remains length-capped");

assert(scoreOf({ body: { score: 70 } }, "body") === 70, "valid score returned");
assert(scoreOf({ body: { score: 72.5 } }, "body") === null, "fractional score rejected");
assert(scoreOf({ body: { score: "70" } }, "body") === null, "string score rejected");
const answersForRating = (ratings) => Object.fromEntries(
    BASELINE_SLIDER_KEYS.map((key, index) => [key, ratings[index]])
);
for (const [ratings, rating, expectedFraction] of [
    [[1, 1, 1, 1], 1, 0.1],
    [[4, 5, 5, 4], 4.5, 0.45],
    [[10, 10, 10, 10], 10, 1]
]) {
    const overallRating = overallBaselineRating(answersForRating(ratings));
    assert(overallRating === rating, `overall rating calculates as ${rating}/10`);
    assert(ratingProgressFraction(overallRating) === expectedFraction, `${rating}/10 wheel progress is ${expectedFraction * 100}%`);
    assert(formatBaselineRating(overallRating) === rating.toFixed(1), `${rating}/10 display is rounded to one decimal place`);
}
assert(overallBaselineRating({ body: 10, discipline: 5 }) === null, "incomplete slider answers have no overall rating");
assert(ratingProgressFraction(-1) === 0 && ratingProgressFraction(11) === 1, "wheel progress is clamped between 0 and 1");
assert(!hasResults(null), "missing baseline has no results");
assert(!hasResults({ assessments: { goalDrive: { score: 40 } } }), "Goal Drive text alone is not treated as a scored result");
assert(!canContinueToReview(null, ""), "cannot review without result or assessment error");
assert(canContinueToReview(null, "Baseline save unavailable"), "save failure keeps existing review fallback");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
}
