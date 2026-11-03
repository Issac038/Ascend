const CATEGORY_KEYS = ["body", "discipline", "learning", "productivity", "goalDrive"];
const SLIDER_CATEGORY_KEYS = CATEGORY_KEYS.slice(0, 4);
const MAX_GOAL_DRIVE_CHARS = 600;
const RUBRIC_VERSION = "2.0";
const { validateSliderAnswers } = require("./baselineScores");

function validateBaselineAnswers(input) {
    const errors = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { clean: null, errors: ["answers must be an object"] };
    }

    const allowed = new Set(CATEGORY_KEYS);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) errors.push(`unknown field: ${key}`);
    }

    const sliderValidation = validateSliderAnswers(input);
    errors.push(...sliderValidation.errors);
    const clean = sliderValidation.clean || {};

    const goalDrive = input.goalDrive;
    if (goalDrive === undefined || goalDrive === null) {
        clean.goalDrive = "";
    } else if (typeof goalDrive !== "string") {
        errors.push("goalDrive must be a string");
    } else if (goalDrive.length > MAX_GOAL_DRIVE_CHARS) {
        errors.push(`goalDrive exceeds ${MAX_GOAL_DRIVE_CHARS} characters`);
    } else {
        clean.goalDrive = goalDrive.trim();
    }

    return { clean: errors.length ? null : clean, errors };
}

module.exports = {
    CATEGORY_KEYS,
    SLIDER_CATEGORY_KEYS,
    RUBRIC_VERSION,
    validateBaselineAnswers
};
