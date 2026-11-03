// ------------------------------------------------------------
// Baseline UI helpers (self-reported slider ratings and Goal Drive motivation).
// Pure functions only — unit-tested in baseline.test.mjs.
// Goal Drive text limits mirror the server's existing rubric validation.
// ------------------------------------------------------------

export const BASELINE_SLIDER_KEYS = ["body", "discipline", "learning", "productivity"];
export const BASELINE_CATEGORY_KEYS = [...BASELINE_SLIDER_KEYS, "goalDrive"];

export const MAX_ANSWER_CHARS = 600;

export const emptyAnswers = () => ({
    body: null,
    discipline: null,
    learning: null,
    productivity: null,
    goalDrive: ""
});

export function isValidSliderAnswer(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

export function parseStoredSliderAnswer(value) {
    if (isValidSliderAnswer(value)) return value;
    return typeof value === "string" && /^(?:[1-9]|10)$/.test(value) ? Number(value) : null;
}

export function sliderRatingPercentage(value) {
    const rating = parseStoredSliderAnswer(value);
    return rating === null ? null : rating * 10;
}

export function areSliderAnswersValid(answers, confirmed = {}) {
    return BASELINE_SLIDER_KEYS.every((key) => isValidSliderAnswer(answers?.[key]) && confirmed[key] === true);
}

export function baselineMatchesAnswers(baseline, answers) {
    if (!baseline?.answers || typeof baseline.answers !== "object") return false;
    const slidersMatch = BASELINE_SLIDER_KEYS.every((key) =>
        parseStoredSliderAnswer(baseline.answers[key]) === answers?.[key]
    );
    const savedGoalDrive = typeof baseline.answers.goalDrive === "string" ? baseline.answers.goalDrive.trim() : "";
    const currentGoalDrive = typeof answers?.goalDrive === "string" ? answers.goalDrive.trim() : "";
    return slidersMatch && savedGoalDrive === currentGoalDrive;
}

/**
 * Merge server-saved answers over local drafts. Slider answers accept only
 * the current 1–10 integer format; legacy text answers are not coerced.
 * Goal Drive retains its existing trimmed, capped string behavior.
 */
export function mergeAnswers(local, incoming) {
    const out = emptyAnswers();
    for (const key of BASELINE_SLIDER_KEYS) {
        const localV = isValidSliderAnswer(local?.[key]) ? local[key] : null;
        const incomingV = parseStoredSliderAnswer(incoming?.[key]);
        out[key] = incomingV ?? localV;
    }

    const key = "goalDrive";
    const localV = typeof local?.[key] === "string" ? local[key] : "";
    const savedV = typeof incoming?.[key] === "string" ? incoming[key] : "";
    const v = savedV.trim() ? savedV : localV;
    out[key] = v.slice(0, MAX_ANSWER_CHARS);
    return out;
}

/**
 * The validated score for a category, or null when unassessed.
 * Never coerces: strings, floats out of range, or missing entries
 * are all "no score" so the UI can't render a fabricated percentage.
 */
export function scoreOf(assessments, key) {
    const a = assessments && typeof assessments === "object" ? assessments[key] : null;
    if (!a || typeof a !== "object") return null;
    const s = a.score;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 100) return null;
    return s;
}

export function overallBaselineRating(answers) {
    const ratings = BASELINE_SLIDER_KEYS.map((key) => parseStoredSliderAnswer(answers?.[key]));
    if (ratings.some((rating) => rating === null)) return null;
    return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

export function ratingProgressFraction(rating) {
    if (typeof rating !== "number" || !Number.isFinite(rating)) return 0;
    return Math.max(0, Math.min(1, rating / 10));
}

export function formatBaselineRating(rating) {
    return rating.toFixed(1);
}

/** true when the baseline has at least one saved slider result to review. */
export function hasResults(baseline) {
    if (!baseline || !baseline.assessments || typeof baseline.assessments !== "object") return false;
    return BASELINE_SLIDER_KEYS.some((key) => scoreOf(baseline.assessments, key) !== null);
}

/**
 * Whether Continue on the baseline step is allowed: a saved result exists,
 * or saving failed (graceful skip — unassessed categories stay explicit).
 */
export function canContinueToReview(baseline, assessError) {
    return Boolean(baseline) || Boolean(assessError);
}
