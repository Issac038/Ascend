// ------------------------------------------------------------
// FIXED 7-DAY PLAN — unit tests. Pure functions, NO database.
// Run standalone:  node test/fixedplan.test.js
// Run via suite:    cd server && npm test
//
// Verifies the canonical plan matches the specification exactly:
// seven days, exercise names, order, prescribed set counts, rep
// ranges, cardio instructions, the anchor, the two prescribed
// alternatives, and that the plan is immutable through helpers.
// ------------------------------------------------------------
const assert = require("assert");

const {
    FIXED_PLAN,
    ANCHOR_DATE,
    getDay,
    planDayForDate,
    defaultChoices,
    normalizeChoices,
    resolveExercises,
    totalSets,
    setRepLabel,
    dayView,
    publicPlan,
    isValidChoice,
    slotsOf
} = require("../plan/fixedPlan");

let passed = 0;
let failed = 0;
const fails = [];

function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok - ${name}`);
    } catch (e) {
        failed += 1;
        fails.push(`${name}: ${e.message}`);
        console.log(`  FAIL - ${name}: ${e.message}`);
    }
}

// [name, sets, minReps, maxReps] — exactly as prescribed.
const D1 = [
    ["Incline Dumbbell Press", 3, 8, 12],
    ["Flat Dumbbell Press", 3, 8, 12],
    ["Incline Dumbbell Curl", 3, 10, 12],
    ["Hammer Curl", 2, 10, 15],
    ["Cable Crunch", 3, 10, 15],
    ["Plank OR Dead Bug", 3, null, null]
];
const D2 = [
    ["Lat Pulldown", 3, 8, 12],
    ["Chest-Supported Row", 3, 8, 12],
    ["Cable Pressdown", 3, 10, 15],
    ["Overhead Triceps Extension", 2, 10, 15],
    ["Lateral Raise", 3, 12, 20],
    ["Rear Delt Fly", 2, 12, 20]
];
const D3 = [
    ["Squat", 3, 6, 10],
    ["Romanian Deadlift", 3, 8, 12],
    ["Hamstring Curl", 3, 10, 15],
    ["Calf Raise", 3, 12, 20],
    ["Pallof Press OR Back Extension", 3, null, null]
];
const D4 = [
    ["Flat Barbell Bench Press", 3, 6, 10],
    ["Seated Cable Row", 3, 8, 12],
    ["Machine Chest Press", 2, 10, 15],
    ["Neutral-Grip Lat Pulldown", 3, 8, 12],
    ["Cable Chest Fly", 2, 12, 15]
];
const D5 = [
    ["Bulgarian Split Squat", 3, 8, 12],
    ["Hip Thrust", 3, 8, 12],
    ["Leg Extension", 2, 10, 15],
    ["Seated Leg Curl", 2, 10, 15],
    ["Reverse Crunch", 3, 10, 15],
    ["Pallof Press", 2, 10, 12]
];

function checkDay(dayNumber, spec, title) {
    const day = getDay(dayNumber);
    assert.strictEqual(day.title, title, `day ${dayNumber} title`);
    assert.strictEqual(day.exercises.length, spec.length, `day ${dayNumber} exercise count`);
    spec.forEach(([name, sets, min, max], i) => {
        const ex = day.exercises[i];
        const label = ex.slotId ? ex.name : ex.name; // slots carry "X OR Y" as name
        assert.strictEqual(label, name, `day ${dayNumber} exercise ${i + 1} name`);
        assert.strictEqual(ex.sets, sets, `day ${dayNumber} "${name}" prescribed sets`);
        if (min !== null) {
            assert.strictEqual(ex.repsMin, min, `day ${dayNumber} "${name}" min reps`);
            assert.strictEqual(ex.repsMax, max, `day ${dayNumber} "${name}" max reps`);
        }
    });
}

console.log("\n=== FIXED PLAN UNIT TESTS ===\n");

test("exactly seven days", () => {
    assert.strictEqual(FIXED_PLAN.days.length, 7);
    FIXED_PLAN.days.forEach((d, i) => assert.strictEqual(d.day, i + 1));
});

test("anchor is a valid, documented date", () => {
    assert.strictEqual(ANCHOR_DATE, "2026-09-21");
    assert.strictEqual(planDayForDate(ANCHOR_DATE), 1);
    assert.strictEqual(new Date(`${ANCHOR_DATE}T12:00:00`).getDay(), 1, "anchor is a Monday");
});

test("day mapping repeats weekly and is anchored (never shifts)", () => {
    assert.strictEqual(planDayForDate("2026-09-21"), 1); // anchor Monday
    assert.strictEqual(planDayForDate("2026-09-27"), 7); // same week, Sunday
    assert.strictEqual(planDayForDate("2026-09-28"), 1); // +7 days -> Day 1 again
    assert.strictEqual(planDayForDate("2026-10-04"), 7);
    assert.strictEqual(planDayForDate("2026-09-20"), 7); // day before anchor
    assert.strictEqual(planDayForDate("2027-06-14"), 1); // far future still lands on Monday
    for (let d = 0; d < 70; d += 1) {
        const key = new Date(Date.UTC(2026, 8, 21 + d)).toISOString().slice(0, 10);
        assert.strictEqual(planDayForDate(key), (d % 7) + 1, `day ${d} offset`);
    }
    assert.throws(() => planDayForDate("2026-13-45"), /Invalid date/);
    assert.throws(() => planDayForDate("not-a-date"), /Invalid date/);
});

test("DAY 1 — CHEST / BICEPS / ABS matches the spec", () => checkDay(1, D1, "CHEST / BICEPS / ABS"));
test("DAY 2 — BACK / TRICEPS / DELTS matches the spec", () => checkDay(2, D2, "BACK / TRICEPS / DELTS"));
test("DAY 3 — LEGS / CORE matches the spec", () => checkDay(3, D3, "LEGS / CORE"));
test("DAY 4 — BACK / CHEST matches the spec", () => checkDay(4, D4, "BACK / CHEST"));
test("DAY 5 — LEGS / CORE matches the spec", () => checkDay(5, D5, "LEGS / CORE"));

test("Day 1/2/4 prescribe 3 km run/walk; Day 3/5 say No running", () => {
    [1, 2, 4].forEach((n) => {
        const c = getDay(n).cardio;
        assert.strictEqual(c.text, "3 km run/walk.");
        assert.strictEqual(c.targetKm, 3);
        assert.ok(c.loggable, `day ${n} cardio is loggable`);
    });
    [3, 5].forEach((n) => {
        const c = getDay(n).cardio;
        assert.strictEqual(c.text, "No running.");
        assert.strictEqual(c.loggable, false, `day ${n} has no cardio log`);
    });
});

test("DAY 6 — CARDIO guidance matches the spec, no forced progression", () => {
    const d = getDay(6);
    assert.deepStrictEqual(d.guidance, [
        "Run/walk session — start with 3 km total.",
        "Gradually increase distance as endurance improves.",
        "Keep most sessions at a comfortable, conversational pace.",
        "Work toward completing 10 km over approximately 6 months."
    ]);
    assert.strictEqual(d.cardio.targetKm, 3);
    assert.strictEqual(d.cardio.goalKm, 10);
    assert.strictEqual(d.exercises.length, 0, "cardio day has no strength exercises");
    assert.strictEqual(totalSets(d, {}), 0, "cardio never counts as strength sets");
});

test("DAY 7 — REST is built in, not a workout to create", () => {
    const d = getDay(7);
    assert.strictEqual(d.rest, true);
    assert.deepStrictEqual(d.notes, [
        "Full rest and recovery.",
        "Prioritize sleep, hydration, and adequate nutrition.",
        "No mandatory workout."
    ]);
    assert.strictEqual(d.exercises.length, 0);
    assert.strictEqual(d.cardio, null);
    assert.strictEqual(totalSets(d, {}), 0);
});

test("prescribed alternative slots: Day 1 Plank OR Dead Bug, Day 3 Pallof Press OR Back Extension", () => {
    const d1 = slotsOf(getDay(1));
    assert.deepStrictEqual(Object.keys(d1), ["d1_core"]);
    assert.deepStrictEqual(d1.d1_core, ["d1_plank", "d1_dead_bug"], "Plank is the default (first) option");

    const d3 = slotsOf(getDay(3));
    assert.deepStrictEqual(Object.keys(d3), ["d3_core"]);
    assert.deepStrictEqual(d3.d3_core, ["d3_pallof_press", "d3_back_extension"], "Pallof Press is the default");

    assert.strictEqual(defaultChoices(getDay(1)).d1_core, "d1_plank");
    assert.strictEqual(defaultChoices(getDay(3)).d3_core, "d3_pallof_press");
});

test("both alternatives of a slot share the prescribed set count", () => {
    const d1 = getDay(1);
    const plank = resolveExercises(d1, { d1_core: "d1_plank" }).find((e) => e.id === "d1_plank");
    const deadbug = resolveExercises(d1, { d1_core: "d1_dead_bug" }).find((e) => e.id === "d1_dead_bug");
    assert.strictEqual(plank.sets, 3);
    assert.strictEqual(deadbug.sets, 3);

    const d3 = getDay(3);
    const pallof = resolveExercises(d3, { d3_core: "d3_pallof_press" }).find((e) => e.id === "d3_pallof_press");
    const backext = resolveExercises(d3, { d3_core: "d3_back_extension" }).find((e) => e.id === "d3_back_extension");
    assert.strictEqual(pallof.sets, 3);
    assert.strictEqual(backext.sets, 3);
});

test("only the two prescribed options can be chosen (no arbitrary exercises)", () => {
    const d1 = getDay(1);
    assert.ok(isValidChoice(d1, "d1_core", "d1_plank"));
    assert.ok(isValidChoice(d1, "d1_core", "d1_dead_bug"));
    assert.ok(!isValidChoice(d1, "d1_core", "barbell_curl"), "arbitrary exercise rejected");
    assert.ok(!isValidChoice(d1, "d9_core", "d1_plank"), "unknown slot rejected");
    assert.ok(!isValidChoice(getDay(2), "d1_core", "d1_plank"), "slot from another day rejected");

    // Normalize drops junk and falls back to the default.
    const choices = normalizeChoices(d1, { d1_core: "hacked_exercise", bogus: "x" });
    assert.strictEqual(choices.d1_core, "d1_plank");
});

test("bodyweight/duration exercises never require weight", () => {
    const d1 = getDay(1);
    const plank = resolveExercises(d1, {}).find((e) => e.id === "d1_plank");
    assert.strictEqual(plank.metric, "duration", "Plank records seconds");
    assert.strictEqual(plank.bodyweight, true);

    const deadbug = resolveExercises(d1, { d1_core: "d1_dead_bug" }).find((e) => e.id === "d1_dead_bug");
    assert.strictEqual(deadbug.metric, "reps");
    assert.strictEqual(deadbug.bodyweight, true);

    const backext = resolveExercises(getDay(3), { d3_core: "d3_back_extension" }).find((e) => e.id === "d3_back_extension");
    assert.strictEqual(backext.bodyweight, true);

    // The Day 5 Pallof Press is prescribed with reps only (per side).
    const d5 = getDay(5);
    const d5pallof = d5.exercises.find((e) => e.id === "d5_pallof_press");
    assert.strictEqual(d5pallof.repNote, "per side");
});

test("unilateral labelling: Bulgarian Split Squat per leg, Day 5 Pallof per side", () => {
    const d5 = getDay(5);
    const bulgarian = d5.exercises.find((e) => e.id === "d5_bulgarian_split_squat");
    assert.strictEqual(bulgarian.repNote, "per leg");
    assert.strictEqual(setRepLabel(bulgarian), "3 sets × 8–12 reps per leg");
    const pallof = d5.exercises.find((e) => e.id === "d5_pallof_press");
    assert.strictEqual(setRepLabel(pallof), "2 sets × 10–12 reps per side");
});

test("set/rep labels render the prescribed prescription", () => {
    assert.strictEqual(setRepLabel(getDay(1).exercises[0]), "3 sets × 8–12 reps");
    assert.strictEqual(setRepLabel(getDay(4).exercises[0]), "3 sets × 6–10 reps");
    assert.strictEqual(setRepLabel(getDay(2).exercises[5]), "2 sets × 12–20 reps");
    const plank = resolveExercises(getDay(1), {}).find((e) => e.id === "d1_plank");
    assert.strictEqual(setRepLabel(plank), "3 sets × hold (sec)");
    const slotLabel = getDay(1).exercises[5].name;
    assert.strictEqual(slotLabel, "Plank OR Dead Bug");
    assert.strictEqual(getDay(3).exercises[4].name, "Pallof Press OR Back Extension");
});

test("prescribed set totals per day", () => {
    assert.strictEqual(totalSets(getDay(1), {}), 17);
    assert.strictEqual(totalSets(getDay(2), {}), 16);
    assert.strictEqual(totalSets(getDay(3), {}), 15);
    assert.strictEqual(totalSets(getDay(4), {}), 13);
    assert.strictEqual(totalSets(getDay(5), {}), 15);
    assert.strictEqual(totalSets(getDay(6), {}), 0);
    assert.strictEqual(totalSets(getDay(7), {}), 0);
    // Total never changes when the alternative choice changes (same sets).
    assert.strictEqual(totalSets(getDay(1), { d1_core: "d1_dead_bug" }), 17);
    assert.strictEqual(totalSets(getDay(3), { d3_core: "d3_back_extension" }), 15);
});

test("progression rules are advisory and include the spec text", () => {
    const rules = FIXED_PLAN.progression;
    assert.ok(rules.length >= 6, "progression section present");
    assert.ok(rules.some((r) => /exercise selection and weekly schedule fixed/.test(r)));
    assert.ok(rules.some((r) => /Increase weights gradually/.test(r)));
    assert.ok(rules.some((r) => /top of the prescribed rep range/.test(r)));
    assert.ok(rules.some((r) => /1–3 reps short of failure/.test(r)));
    assert.ok(rules.some((r) => /run\/walk intervals/.test(r)));
    assert.ok(rules.some((r) => /Repeat a running distance/.test(r)));
    assert.ok(rules.some((r) => /reducing training volume and prioritizing recovery/.test(r)));
    assert.ok(rules.some((r) => /does not prove good technique|good technique/.test(r)), "suggestion is labelled as advisory");
});

test("publicPlan exposes all seven days read-only with stable ids", () => {
    const p = publicPlan();
    assert.strictEqual(p.days.length, 7);
    assert.strictEqual(p.anchor, ANCHOR_DATE);
    const ids = new Set();
    for (const d of p.days) {
        for (const ex of d.exercises) {
            assert.ok(ex.id && /^[a-z0-9_]+$/.test(ex.id), `stable id ${ex.id}`);
            assert.ok(!ids.has(ex.id), `duplicate exercise id ${ex.id}`);
            ids.add(ex.id);
            assert.ok(typeof ex.name === "string" && ex.name.length > 0);
            assert.ok(Number.isInteger(ex.sets) && ex.sets > 0);
            assert.ok(["reps", "duration"].includes(ex.metric));
        }
    }
    assert.strictEqual(ids.size, 28, "28 prescribed exercises visible in the default week view");

    // Every id in the template (including both alternative options) is stable + unique.
    const allIds = new Set();
    for (const d of FIXED_PLAN.days) {
        for (const ex of d.exercises) {
            if (ex.options) ex.options.forEach((o) => allIds.add(o.id));
            else allIds.add(ex.id);
        }
    }
    assert.strictEqual(allIds.size, 30, "30 distinct exercise ids across the full template");
});

test("dayView includes entries-ready shape without leaking template mutation", () => {
    const day = getDay(1);
    const v = dayView(day, {});
    assert.strictEqual(v.totalSets, 17);
    assert.strictEqual(v.exercises.length, 6);
    assert.strictEqual(v.displayTitle, "Day 1 — CHEST / BICEPS / ABS");
    // Mutating the view must not corrupt the canonical template.
    v.exercises[0].sets = 99;
    v.exercises[0].name = "HACKED";
    assert.strictEqual(getDay(1).exercises[0].sets, 3, "template sets unchanged");
    assert.strictEqual(getDay(1).exercises[0].name, "Incline Dumbbell Press", "template name unchanged");
    const again = dayView(day, {});
    assert.strictEqual(again.exercises[0].sets, 3);
    assert.strictEqual(again.exercises[0].name, "Incline Dumbbell Press");
});

console.log(`\n=== FIXED PLAN RESULTS: ${passed} passed, ${failed} failed ===`);
if (fails.length) {
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
}
