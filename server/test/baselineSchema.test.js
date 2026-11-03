const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Baseline = require("../models/Baseline");

const userId = () => new mongoose.Types.ObjectId();

test("baseline schema stores numeric slider answers without casting and keeps Goal Drive a string", async () => {
    const baseline = new Baseline({
        userId: userId(),
        answers: {
            body: 1,
            discipline: 5,
            learning: 10,
            productivity: 7,
            goalDrive: "I am training for a race."
        },
        assessments: {
            body: { score: 1, explanation: "Self-reported rating (1/10)." },
            discipline: { score: 5, explanation: "Self-reported rating (5/10)." },
            learning: { score: 10, explanation: "Self-reported rating (10/10)." },
            productivity: { score: 7, explanation: "Self-reported rating (7/10)." },
            goalDrive: { score: null, explanation: "Saved as personal motivation and is not scored.", insufficient: true }
        },
        assessmentMethod: "self-reported"
    });

    await assert.doesNotReject(() => baseline.validate());
    assert.equal(baseline.answers.body, 1);
    assert.equal(baseline.answers.productivity, 7);
    assert.equal(typeof baseline.answers.goalDrive, "string");
    assert.equal(baseline.assessments.get("learning").score, 10);
    assert.equal(baseline.assessments.get("goalDrive").score, null);
    assert.equal(baseline.assessmentMethod, "self-reported");
});

test("baseline schema continues to accept legacy string slider answers", async () => {
    const baseline = new Baseline({
        userId: userId(),
        answers: {
            body: "I exercised sometimes.",
            discipline: "I followed through regularly.",
            learning: "I studied every week.",
            productivity: "I completed most important tasks.",
            goalDrive: "I am training for a race."
        }
    });

    await assert.doesNotReject(() => baseline.validate());
    assert.equal(baseline.answers.body, "I exercised sometimes.");
});

test("baseline schema rejects invalid numeric slider answers", async () => {
    const baseline = new Baseline({
        userId: userId(),
        answers: {
            body: 0,
            discipline: 5.5,
            learning: 11,
            productivity: 11,
            goalDrive: "I am training for a race."
        }
    });

    let error;
    await assert.rejects(baseline.validate(), (validationError) => {
        error = validationError;
        return true;
    });
    for (const key of ["body", "discipline", "learning", "productivity"]) {
        assert.ok(error.errors[`answers.${key}`], `${key} should fail schema validation`);
    }
});
