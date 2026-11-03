const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateBaselineAnswers } = require("../services/baselineValidation");

const sliderKeys = ["body", "discipline", "learning", "productivity"];

function validAnswers() {
    return {
        body: 5,
        discipline: 5,
        learning: 5,
        productivity: 5,
        goalDrive: "I am training for a race."
    };
}

test("baseline request validation accepts 1–10 integer values for all slider fields", () => {
    for (const key of sliderKeys) {
        for (let value = 1; value <= 10; value += 1) {
            const result = validateBaselineAnswers({ ...validAnswers(), [key]: value });
            assert.ok(result.clean, `${key}=${value} should be accepted`);
            assert.equal(result.clean[key], value);
        }
    }
});

test("baseline request validation rejects strings, decimals, missing and out-of-range slider values", () => {
    const invalidValues = ["5", 5.5, 0, 11, undefined];
    for (const key of sliderKeys) {
        for (const value of invalidValues) {
            const answers = { ...validAnswers(), [key]: value };
            const result = validateBaselineAnswers(answers);
            assert.equal(result.clean, null, `${key}=${String(value)} should be rejected`);
            assert.match(result.errors.join(" "), new RegExp(`${key} must be an integer from 1 to 10`));
        }
    }
});

test("Goal Drive remains optional plain text and does not accept a slider value", () => {
    const result = validateBaselineAnswers({ ...validAnswers(), goalDrive: "I am training for a race." });
    assert.ok(result.clean);
    assert.equal(result.clean.goalDrive, "I am training for a race.");

    const invalid = validateBaselineAnswers({ ...validAnswers(), goalDrive: 5 });
    assert.equal(invalid.clean, null);
    assert.ok(invalid.errors.includes("goalDrive must be a string"));
});
