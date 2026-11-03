const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    SLIDER_CATEGORY_KEYS,
    validateSliderAnswers,
    scoreSliderAnswers,
    averageSliderRating
} = require("../services/baselineScores");

const keys = ["body", "discipline", "learning", "productivity"];

test("the local scoring service exposes exactly the four slider categories", () => {
    assert.deepEqual(SLIDER_CATEGORY_KEYS, keys);
});

test("slider answers are stored as ratings at 1, 5, and 10", () => {
    for (const answer of [1, 5, 10]) {
        const assessments = scoreSliderAnswers(Object.fromEntries(keys.map((key) => [key, answer])));
        for (const key of keys) {
            assert.equal(assessments[key].score, answer);
            assert.equal(assessments[key].insufficient, false);
            assert.match(assessments[key].explanation, new RegExp(`${answer}/10`));
        }
    }
});

test("overall rating is the mean of the four saved slider ratings", () => {
    const assessments = scoreSliderAnswers({ body: 1, discipline: 5, learning: 10, productivity: 7 });
    assert.equal(averageSliderRating(assessments), 5.75);
    assert.equal(averageSliderRating({ body: { score: 1 } }), null);
});

test("only integer slider answers from 1 to 10 validate", () => {
    const valid = Object.fromEntries(keys.map((key) => [key, 7]));
    assert.deepEqual(validateSliderAnswers(valid), { clean: valid, errors: [] });

    for (const value of [0, 11, 5.5, "5", null]) {
        const result = validateSliderAnswers({ ...valid, body: value });
        assert.equal(result.clean, null, `${String(value)} should be rejected`);
        assert.match(result.errors.join(" "), /body must be an integer from 1 to 10/);
    }
});

test("missing slider answers are rejected rather than defaulted", () => {
    const result = validateSliderAnswers({ body: 5, discipline: 5, learning: 5 });
    assert.equal(result.clean, null);
    assert.match(result.errors.join(" "), /productivity must be an integer from 1 to 10/);
    assert.throws(() => scoreSliderAnswers({ body: 5 }), RangeError);
});
