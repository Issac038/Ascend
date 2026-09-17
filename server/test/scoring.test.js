// ------------------------------------------------------------
// Scoring unit tests — pure functions, NO database required.
// Run standalone:  node server/test/scoring.test.js
// Run via suite:   cd server && npm test   (runs both suites)
//
// Covers the regression matrix for computeDayScore (the
// habitsDone > habitsScheduled bug) and the times_per_week
// weekly-target semantics.
// ------------------------------------------------------------
const assert = require("assert");
const {
    isHabitScheduledOn,
    weeklyTarget,
    isQualifyingCompletion,
    countQualifyingDays,
    evaluateWeeklyDay,
    computeDayScore,
    xpForDayScore,
    levelForXp
} = require("../utils/scoring");

const WED = "2026-09-16"; // a Wednesday
const MON = "2026-09-14"; // Monday of that week (weeks start Monday)

function booleanHabit(overrides = {}) {
    return { _id: "bool1", type: "boolean", frequency: "daily", target: 1, ...overrides };
}
function numericHabit(overrides = {}) {
    return { _id: "num1", type: "numeric", frequency: "daily", target: 10, unit: "pages", ...overrides };
}
function day(habits, completions, tasks = []) {
    return computeDayScore({
        habits: habits.map((h) => ({ ...h, dateKey: WED })),
        habitCompletions: completions,
        tasks
    });
}

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

console.log("\n=== SCORING UNIT TESTS ===\n");

// ---------- scheduling ----------
test("daily habit scheduled any day", () => {
    assert.strictEqual(isHabitScheduledOn(booleanHabit(), WED), true);
});
test("specific_days scheduled only on chosen weekdays", () => {
    const h = booleanHabit({ frequency: "specific_days", specificDays: [3] }); // Wednesday
    assert.strictEqual(isHabitScheduledOn(h, WED), true);
    assert.strictEqual(isHabitScheduledOn(h, MON), false);
});
test("habit not scheduled before startDate", () => {
    assert.strictEqual(isHabitScheduledOn(booleanHabit({ startDate: "2026-09-17" }), WED), false);
});
test("archived habit never scheduled", () => {
    assert.strictEqual(isHabitScheduledOn(booleanHabit({ archived: true }), WED), false);
});

// ---------- section 19 matrix: boolean ----------
test("boolean scheduled+completed: scheduled=1 done=1 pct=100", () => {
    const r = day([booleanHabit()], { bool1: { completed: true } });
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone, r.score], [1, 1, 100]);
});
test("boolean scheduled+incomplete: scheduled=1 done=0 pct=0", () => {
    const r = day([booleanHabit()], {});
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone, r.score], [1, 0, 0]);
});

// ---------- section 19 matrix: numeric ----------
test("numeric target=10 value=10: scheduled=1 done=1 pct=100", () => {
    const r = day([numericHabit()], { num1: { value: 10 } });
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone, r.score], [1, 1, 100]);
});
test("numeric target=10 value=5: scheduled=1 done=0", () => {
    const r = day([numericHabit()], { num1: { value: 5 } });
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone], [1, 0]);
    assert.strictEqual(r.score, 0);
});
test("numeric target=10 value=15: scheduled=1 done=1 pct=100", () => {
    const r = day([numericHabit()], { num1: { value: 15 } });
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone, r.score], [1, 1, 100]);
});
test("numeric with no completion: scheduled=1 done=0", () => {
    const r = day([numericHabit()], {});
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone], [1, 0]);
});

// ---------- the regression: mixed boolean + numeric ----------
test("REGRESSION: boolean(done) + numeric(done) -> done(2) <= scheduled(2), score <= 100", () => {
    const r = day(
        [booleanHabit(), numericHabit()],
        { bool1: { completed: true }, num1: { value: 12 } }
    );
    assert.strictEqual(r.habitsScheduled, 2);
    assert.strictEqual(r.habitsDone, 2);
    assert.ok(r.habitsDone <= r.habitsScheduled);
    assert.ok(r.score <= 100, `score must be <= 100, got ${r.score}`);
});
test("REGRESSION: boolean(done) + numeric(incomplete) -> done(1) < scheduled(2)", () => {
    const r = day(
        [booleanHabit(), numericHabit()],
        { bool1: { completed: true }, num1: { value: 4 } }
    );
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone], [2, 1]);
    assert.ok(r.score < 100);
});
test("REGRESSION: numeric(done) + boolean(incomplete) -> done(1) < scheduled(2)", () => {
    const r = day(
        [booleanHabit(), numericHabit()],
        { num1: { value: 10 } }
    );
    assert.deepStrictEqual([r.habitsScheduled, r.habitsDone], [2, 1]);
});

// ---------- invariant across randomized multi-habit days ----------
test("invariant done<=scheduled holds across many randomized habit sets", () => {
    for (let i = 0; i < 200; i += 1) {
        const habits = [];
        const completions = {};
        const n = 1 + (i % 6);
        for (let j = 0; j < n; j += 1) {
            const numeric = (i + j) % 2 === 0;
            const h = numeric ? numericHabit({ _id: `h${j}`, target: 10 }) : booleanHabit({ _id: `h${j}` });
            habits.push(h);
            const roll = (i * 7 + j * 13) % 3;
            if (roll === 0) completions[`h${j}`] = numeric ? { value: 10 } : { completed: true };
            else if (roll === 1 && numeric) completions[`h${j}`] = { value: 3 };
        }
        const r = day(habits, completions);
        assert.ok(r.habitsDone <= r.habitsScheduled, `done ${r.habitsDone} > scheduled ${r.habitsScheduled}`);
        assert.ok(r.score === null || r.score <= 100, `score ${r.score} > 100`);
    }
});

// ---------- tasks ----------
test("tasks weigh 40%, habits 60%", () => {
    // 1/2 habits done (50% -> 30 pts) + 1/2 tasks done (50% -> 20 pts) = 50
    const r = day(
        [booleanHabit(), booleanHabit({ _id: "b2" })],
        { bool1: { completed: true } },
        [{ completed: true }, { completed: false }]
    );
    assert.strictEqual(r.score, 50);
    assert.deepStrictEqual([r.tasksDone, r.tasksTotal], [1, 2]);
});
test("nothing scheduled -> null score (rest day)", () => {
    const r = day([], {});
    assert.strictEqual(r.score, null);
});
test("tasks-only day scores from tasks", () => {
    const r = day([], {}, [{ completed: true }, { completed: true }]);
    assert.strictEqual(r.score, 100);
});

// ---------- weekly target (times_per_week) ----------
console.log("\n-- times_per_week --");
test("weeklyTarget: boolean habit target 4 -> 4 days/week", () => {
    assert.strictEqual(weeklyTarget({ type: "boolean", target: 4 }), 4);
});
test("weeklyTarget: minimum 1, never 0 or NaN", () => {
    assert.strictEqual(weeklyTarget({ type: "boolean", target: 0 }), 1);
    assert.strictEqual(weeklyTarget({ type: "boolean", target: undefined }), 1);
});
test("isQualifyingCompletion: boolean requires completed=true", () => {
    assert.strictEqual(isQualifyingCompletion(booleanHabit(), { completed: true }), true);
    assert.strictEqual(isQualifyingCompletion(booleanHabit(), { completed: false }), false);
    assert.strictEqual(isQualifyingCompletion(booleanHabit(), null), false);
});
test("isQualifyingCompletion: numeric requires value >= target", () => {
    const h = { type: "numeric", target: 20 };
    assert.strictEqual(isQualifyingCompletion(h, { value: 20 }), true);
    assert.strictEqual(isQualifyingCompletion(h, { value: 19 }), false);
});
test("countQualifyingDays: counts only in-range qualifying days", () => {
    const h = booleanHabit();
    const comps = [
        { date: "2026-09-14", completed: true }, // Mon
        { date: "2026-09-15", completed: true }, // Tue
        { date: "2026-09-16", completed: false }, // Wed — not qualifying
        { date: "2026-09-10", completed: true } // previous week — out of range
    ];
    assert.strictEqual(countQualifyingDays(h, comps, MON, WED), 2);
});
test("countQualifyingDays: numeric habit counts qualifying values only", () => {
    const h = numericHabit(); // target 10
    const comps = [
        { date: MON, value: 10 },
        { date: "2026-09-15", value: 4 },
        { date: WED, value: 11 }
    ];
    assert.strictEqual(countQualifyingDays(h, comps, MON, WED), 2);
});

// weekly-day evaluation matrix (target 4x/week)
test("weekly 0 completions so far -> day scheduled, not done", () => {
    assert.deepStrictEqual(evaluateWeeklyDay({ target: 4 }, 0, false), { scheduled: true, done: false });
});
test("weekly 1 completion so far -> day scheduled", () => {
    assert.deepStrictEqual(evaluateWeeklyDay({ target: 4 }, 1, false), { scheduled: true, done: false });
});
test("weekly partial (3/4) -> still scheduled, today can complete it", () => {
    assert.deepStrictEqual(evaluateWeeklyDay({ target: 4 }, 3, true), { scheduled: true, done: true });
});
test("weekly target met by earlier days -> rest day (not scheduled, not a miss)", () => {
    assert.deepStrictEqual(evaluateWeeklyDay({ target: 4 }, 4, false), { scheduled: false, done: false });
    assert.deepStrictEqual(evaluateWeeklyDay({ target: 4 }, 5, true), { scheduled: false, done: false });
});
test("days outside the applicable week never count (range enforced by caller)", () => {
    const h = booleanHabit();
    const comps = [{ date: "2026-09-07", completed: true }, { date: "2026-09-08", completed: true }]; // last week
    assert.strictEqual(countQualifyingDays(h, comps, MON, WED), 0);
});
test("numeric weekly habit: qualifying days capped evaluation works", () => {
    const h = numericHabit({ target: 20 }); // numeric, 20/day, 20x/week target
    // 20 qualifying days already this week -> rest day
    assert.deepStrictEqual(evaluateWeeklyDay(h, 20, true), { scheduled: false, done: false });
});

// ---------- XP / levels ----------
test("xpForDayScore tiers", () => {
    assert.strictEqual(xpForDayScore(null), 0);
    assert.strictEqual(xpForDayScore(0), 0);
    assert.strictEqual(xpForDayScore(29), 0);
    assert.strictEqual(xpForDayScore(30), 10);
    assert.strictEqual(xpForDayScore(50), 15);
    assert.strictEqual(xpForDayScore(80), 20);
    assert.strictEqual(xpForDayScore(100), 20);
});
test("levelForXp boundaries", () => {
    assert.strictEqual(levelForXp(0).level, 1);
    assert.strictEqual(levelForXp(499).level, 1);
    assert.strictEqual(levelForXp(500).level, 2);
    assert.strictEqual(levelForXp(4000).level, 9);
    assert.strictEqual(levelForXp(999999).progressToNext, 100);
});

console.log(`\n=== SCORING RESULTS: ${passed} passed, ${failed} failed ===`);
if (fails.length) {
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
}
