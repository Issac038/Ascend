const {
    addDays,
    startOfWeek,
    dayOfWeek,
    eachDay,
    diffDays
} = require("./date");

// ============================================================
// SCHEDULING
// ============================================================

// Is a habit scheduled on dateKey?
function isHabitScheduledOn(habit, dateKey) {
    if (habit.archived) return false;
    if (habit.startDate && dateKey < habit.startDate) return false;
    if (habit.endDate && dateKey > habit.endDate) return false;

    if (habit.frequency === "daily") return true;

    // "specific_days": only on the selected weekdays (0=Sun .. 6=Sat).
    if (habit.frequency === "specific_days") {
        if (Array.isArray(habit.specificDays) && habit.specificDays.length > 0) {
            return habit.specificDays.includes(dayOfWeek(dateKey));
        }
        return false;
    }

    // "X times per week" — flexible. Treat every day as available,
    // targets are checked week by week, not day by day.
    if (habit.frequency === "times_per_week") return true;

    return false;
}

// Expected number of scheduled days for a habit in a date range (inclusive).
function scheduledDaysInRange(habit, fromKey, toKey) {
    let count = 0;
    for (const day of eachDay(fromKey, toKey)) {
        if (isHabitScheduledOn(habit, day)) count += 1;
    }
    return count;
}

// ============================================================
// WEEKLY TARGET ("times_per_week" habits)
// ============================================================

// A flexible habit's weekly target = how many qualifying days it needs
// per week. Boolean habits: target = days/week. Numeric habits: the day
// qualifies when value >= target AND each qualifying day counts once
// toward the weekly number of days (also habit.target).
function weeklyTarget(habit) {
    return Math.max(1, Math.round(Number(habit.target) || 1));
}

// Does a completion record count as a qualifying day for this habit?
function isQualifyingCompletion(habit, completion) {
    if (!completion) return false;
    if (habit.type === "numeric" && habit.target > 0) {
        return (completion.value || 0) >= habit.target;
    }
    return completion.completed === true;
}

// Count qualifying days for a habit within [fromKey, toKey] given a list
// of completion docs (each has .date).
function countQualifyingDays(habit, completions, fromKey, toKey) {
    let count = 0;
    for (const c of completions || []) {
        if (!c || c.date < fromKey || c.date > toKey) continue;
        if (isQualifyingCompletion(habit, c)) count += 1;
    }
    return count;
}

// Evaluate a times_per_week habit against its weekly target.
// weekToDateCount = qualifying days already logged EARLIER in this week.
// Returns { scheduled, done } for the day:
//   - once the weekly target is met by earlier days, the habit is no
//     longer scheduled (a rest day — it can never punish the score or
//     break a streak)
//   - otherwise the day is scheduled and `done` reflects today's rule
function evaluateWeeklyDay(habit, weekToDateCount, doneToday) {
    const target = weeklyTarget(habit);
    if ((weekToDateCount || 0) >= target) return { scheduled: false, done: false };
    return { scheduled: true, done: !!doneToday };
}

// ============================================================
// DAY SCORE
// ============================================================

// A day's "did the work" score from completions. Weights: habits 60%,
// tasks 40%. Numeric habits count when they hit target.
//
// INVARIANT: habitsDone <= habitsScheduled. Every scheduled habit
// increments habitsScheduled exactly once and can increment habitsDone
// at most once, so the completion ratio can never exceed 1 and the
// score can never exceed 100 before the (capped) reflection bonus.
// returns { habitsDone, habitsScheduled, tasksDone, tasksTotal, score (0..100) }
function computeDayScore({ habitCompletions, habits, tasks }) {
    let habitsScheduled = 0;
    let habitsDone = 0;

    for (const habit of habits) {
        if (!isHabitScheduledOn(habit, habit.dateKey)) continue;

        // EVERY scheduled habit counts toward the denominator — boolean and
        // numeric alike. (Previously numeric habits were excluded from the
        // denominator but counted in the numerator, producing
        // habitsDone > habitsScheduled and scores above 100%.)
        habitsScheduled += 1;

        const completion = habitCompletions[String(habit._id)];
        const isNumeric = habit.type === "numeric" && habit.target > 0;

        if (isNumeric) {
            // numeric: complete only when the logged value reaches the target
            if (completion && (completion.value || 0) >= habit.target) habitsDone += 1;
        } else if (completion && completion.completed) {
            // boolean (incl. numeric habits with target <= 0, which behave
            // like booleans): complete when the completion record says so
            habitsDone += 1;
        }
    }

    const tasksDone = tasks.filter((t) => t.completed).length;
    const tasksTotal = tasks.length;

    const habitPart = habitsScheduled > 0 ? habitsDone / habitsScheduled : null;
    const taskPart = tasksTotal > 0 ? tasksDone / tasksTotal : null;

    let score;
    if (habitPart === null && taskPart === null) {
        score = null; // nothing scheduled — rest day
    } else if (habitPart === null) {
        score = Math.round(taskPart * 100);
    } else if (taskPart === null) {
        score = Math.round(habitPart * 100);
    } else {
        score = Math.round(habitPart * 60 + taskPart * 40);
    }

    return { habitsDone, habitsScheduled, tasksDone, tasksTotal, score };
}

// ============================================================
// STREAKS (with forgiveness)
// ============================================================

// Streaks count partial days (>= score 30) and never punish rest days.
// A missed day inside the last 2 days does NOT break the streak yet —
// the user may still complete it ("still on the field").
function computeStreak(dayScores) {
    const today = todayKeySafe();
    const byDate = new Map(dayScores.map((d) => [d.date, d]));

    const isGoodDay = (date) => {
        const s = byDate.get(date);
        if (!s) return false;
        return s.counted === true;
    };

    // streak = consecutive good days ending today (or yesterday)
    let streak = 0;
    let cursor = today;
    if (!isGoodDay(cursor) && cursor !== today) {
        return 0;
    }
    if (!isGoodDay(today)) {
        cursor = addDays(today, -1);
    }
    while (isGoodDay(cursor)) {
        streak += 1;
        cursor = addDays(cursor, -1);
    }

    // best streak: scan all history
    const dates = [...byDate.keys()].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const d of dates) {
        if (!isGoodDay(d)) {
            run = 0;
            prev = d;
            continue;
        }
        if (prev && diffDays(prev, d) === 1) {
            run += 1;
        } else {
            run = 1;
        }
        best = Math.max(best, run);
        prev = d;
    }

    return { streak, best: Math.max(best, streak) };
}

function todayKeySafe() {
    const {
        todayKey
    } = require("./date");
    return todayKey();
}

// ============================================================
// LEVELS & XP
// ============================================================

// XP sources: day at/above target +20 (partial 15/10), reflection +10,
// achievement +25, goal completed +100, habit created +5.
const XP_PER_LEVEL = 500;

const LEVELS = [
    { min: 0, name: "Beginner" },
    { min: 500, name: "Starter" },
    { min: 1000, name: "Builder" },
    { min: 1500, name: "Disciplined" },
    { min: 2000, name: "Consistent" },
    { min: 2500, name: "Focused" },
    { min: 3000, name: "Strong" },
    { min: 3500, name: "Advanced" },
    { min: 4000, name: "Ascended" }
];

function levelForXp(xp) {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i += 1) {
        if (xp >= LEVELS[i].min) idx = i;
    }
    const current = LEVELS[idx];
    const next = LEVELS[idx + 1] || null;

    const base = current.min;
    const span = next ? next.min - current.min : 1000;
    const into = xp - base;
    const progress = next ? Math.min(100, Math.round((into / span) * 100)) : 100;

    // Level number = beginner counts as 1
    const levelNumber = idx + 1;

    return {
        level: levelNumber,
        name: next ? `${current.name}` : current.name,
        xp,
        xpIntoLevel: into,
        xpForNext: next ? next.min - xp : 0,
        progressToNext: progress,
        nextName: next ? next.name : null
    };
}

function xpForDayScore(score) {
    if (score === null || score === undefined) return 0;
    if (score >= 80) return 20;
    if (score >= 50) return 15;
    if (score >= 30) return 10;
    return 0;
}

module.exports = {
    isHabitScheduledOn,
    scheduledDaysInRange,
    weeklyTarget,
    isQualifyingCompletion,
    countQualifyingDays,
    evaluateWeeklyDay,
    computeDayScore,
    computeStreak,
    levelForXp,
    xpForDayScore,
    LEVELS,
    XP_PER_LEVEL
};

// -----------------------------------------------------------
// SCORING ALGORITHM (documentation)
// -----------------------------------------------------------
// ASCEND SCORE (per day, 0..100, null = rest day):
//   score = habitCompletionRate * 60 + taskCompletionRate * 40
//   - habitCompletionRate = completed scheduled habits / scheduled habits
//     (numeric habits count only when value >= target)
//   - taskCompletionRate = completed tasks / tasks scheduled that day
//   - a reflection (journal) adds a +5 bonus, capped at 100 (see engine.js)
//   - null when nothing is scheduled (rest day) — never counted as failure
// XP (idempotent, granted via snapshot deltas):
//   - day score >= 80 -> +20; >= 50 -> +15; >= 30 -> +10
//   - journal reflection logged -> +10 (once per day, see engine.js)
//   - achievement unlock -> +25 (once, unique index on code)
//   - goal NOT completed -> completed -> +100 (one-way transition only)
//   - habit created -> +5 (creation only)
// Streaks: a day counts when score >= 30. Rest days (null) never break a
// streak. The current streak can still be extended by completing today.
// Levels: every 500 XP; names Beginner..Ascended (see LEVELS).

