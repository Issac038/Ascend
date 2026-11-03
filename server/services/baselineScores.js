const SLIDER_CATEGORY_KEYS = ["body", "discipline", "learning", "productivity"];

function validateSliderAnswers(input) {
    const errors = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { clean: null, errors: ["slider answers must be an object"] };
    }

    const clean = {};
    for (const key of SLIDER_CATEGORY_KEYS) {
        const answer = input[key];
        if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 1 || answer > 10) {
            errors.push(`${key} must be an integer from 1 to 10`);
        } else {
            clean[key] = answer;
        }
    }
    return { clean: errors.length ? null : clean, errors };
}

function scoreSliderAnswers(answers) {
    const { clean, errors } = validateSliderAnswers(answers);
    if (!clean) throw new RangeError(errors.join("; "));

    const assessments = Object.fromEntries(SLIDER_CATEGORY_KEYS.map((key) => [
        key,
        {
            score: clean[key],
            explanation: `Self-reported rating (${clean[key]}/10).`,
            confidence: null,
            followUpQuestion: null,
            insufficient: false
        }
    ]));
    assessments.goalDrive = {
        score: null,
        explanation: "Saved as personal motivation and is not scored.",
        confidence: null,
        followUpQuestion: null,
        insufficient: true
    };
    return assessments;
}

function averageSliderRating(assessments) {
    const scores = SLIDER_CATEGORY_KEYS.map((key) => assessments?.[key]?.score);
    if (scores.some((score) => typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 10)) {
        return null;
    }
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

module.exports = { SLIDER_CATEGORY_KEYS, validateSliderAnswers, scoreSliderAnswers, averageSliderRating };
