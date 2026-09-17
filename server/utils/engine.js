const { todayKey, todayKeyFor, addDays, dayOfWeek } = require("./date");
const { isHabitScheduledOn, computeDayScore, xpForDayScore } = require("./scoring");
const { ACHIEVEMENTS, buildContext } = require("./achievements");

const User = require("../models/User");
const Habit = require("../models/Habit");
const HabitCompletion = require("../models/HabitCompletion");
const Task = require("../models/Task");
const ProgressSnapshot = require("../models/ProgressSnapshot");
const JournalEntry = require("../models/JournalEntry");
const UserAchievement = require("../models/Achievement");

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

const XP_PER_LEVEL = 500;

function getLevel(xp) {
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

    return {
        level: idx + 1,
        name: current.name,
        xp,
        xpIntoLevel: into,
        xpForNext: next ? next.min - xp : 0,
        progressToNext: progress,
        nextName: next ? next.name : null
    };
}

// ------------------------------------------------------------
// DAY DATA
// ------------------------------------------------------------

// Load everything needed to score a day.
// `scheduleDate` controls which date's tasks/habits are considered scheduled.
async function getDayData(userId, dateKey, scheduleDate) {
    const sched = scheduleDate || dateKey;

    const [habits, completions, tasks, journal] = await Promise.all([
        Habit.find({ userId, archived: { $ne: true } }),
        HabitCompletion.find({ userId, date: dateKey }),
        Task.find({ userId, date: sched }),
        JournalEntry.findOne({ userId, date: dateKey }).select("date").lean()
    ]);

    const scheduledHabits = habits.filter((h) => isHabitScheduledOn(h, sched));
    const completionMap = {};
    for (const c of completions) {
        completionMap[c.habitId.toString()] = { completed: c.completed, value: c.value };
    }

    return {
        habits: scheduledHabits.map((h) => ({ ...h.toObject(), dateKey })),
        tasks,
        completions: completionMap,
        journalLogged: !!journal
    };
}

// ------------------------------------------------------------
// SNAPSHOT ENGINE
// ------------------------------------------------------------

// Recompute the day score for `dateKey` and persist a snapshot.
// Habits are scheduled per `scheduleDate` (defaults to dateKey).
// `tzOffset` is the user's timezone offset (Date#getTimezoneOffset convention)
// so XP for "today" is granted relative to the user's local day.
// Returns the snapshot document.
async function recomputeAndSnapshot(userId, dateKey, scheduleDate, tzOffset) {
    const sched = scheduleDate || dateKey;
    const { habits, tasks, completions, journalLogged } = await getDayData(userId, dateKey, sched);

    const day = computeDayScore({
        habits,
        tasks: tasks.map((t) => ({ completed: t.completed, skipped: t.skipped })),
        habitCompletions: completions
    });

    // Reflection adds a small bonus to the day score (capped) — journaling
    // counts toward the Ascend Score but never dominates it.
    if (day.score !== null && journalLogged) {
        day.score = Math.min(100, day.score + 5);
    }

    // streak as of this date
    const priorSnapshots = await ProgressSnapshot.find({ userId, date: { $lte: dateKey } }).sort({ date: 1 });
    const byDate = new Map(priorSnapshots.map((s) => [s.date, s]));
    byDate.set(dateKey, { date: dateKey, counted: day.score !== null && day.score >= 30 });

    let bestStreak = 0;
    let run = 0;
    let prev = null;
    for (const s of byDate.values()) {
        if (!s.counted) {
            run = 0;
            prev = s.date;
            continue;
        }
        run = prev && diffDaysSafe(prev, s.date) === 1 ? run + 1 : 1;
        bestStreak = Math.max(bestStreak, run);
        prev = s.date;
    }

    const actions = day.habitsDone + day.tasksDone;

    const snap = await ProgressSnapshot.findOneAndUpdate(
        { userId, date: dateKey },
        {
            habitsDone: day.habitsDone,
            habitsScheduled: day.habitsScheduled,
            tasksDone: day.tasksDone,
            tasksTotal: day.tasksTotal,
            score: day.score,
            counted: day.score !== null && day.score >= 30,
            actions,
            journalLogged
        },
        { upsert: true, new: true }
    );

    // --- XP delta: day score + reflection ---
    // Idempotent: each snapshot tracks the total XP it has granted
    // (day-score XP + reflection XP). Recomputing the same day adjusts the
    // delta to the new total — a recompute can never double-grant. After
    // the day passes (or the snapshot's total changes to lower XP), deltas
    // settle; completed days are only ever granted their final total.
    const user = await User.findById(userId);
    const beforeXp = user.xp || 0;
    let gained = 0;

    if (snap.date === todayKeyFor(tzOffset)) {
        const dayXp = xpForDayScore(day.score);
        const reflXp = journalLogged ? 10 : 0;
        const totalXp = dayXp + reflXp;
        if ((snap.xpGranted || 0) !== totalXp) {
            gained = totalXp - (snap.xpGranted || 0);
            snap.xpGranted = totalXp;
            await snap.save();
        }
    }

    if (gained !== 0) {
        user.xp = Math.max(0, beforeXp + gained);
        await user.save();

        // level-up notification
        const beforeLevel = getLevel(beforeXp).level;
        const afterLevel = getLevel(user.xp).level;
        if (afterLevel > beforeLevel) {
            const Notification = require("../models/Notification");
            await Notification.create({
                userId,
                type: "level",
                title: `Level ${afterLevel} — ${getLevel(user.xp).name}`,
                body: "Keep ascending."
            });
        }
    }

    // bestStreak stored separately to avoid snapshot churn
    if (bestStreak !== (snap.bestStreak || 0)) {
        snap.bestStreak = bestStreak;
        await snap.save();
    }

    return snap;
}

function diffDaysSafe(a, b) {
    const { diffDays } = require("./date");
    return diffDays(a, b);
}

// ------------------------------------------------------------
// ACHIEVEMENT EVALUATION
// ------------------------------------------------------------

async function evaluateAchievements(userId) {
    const user = await User.findById(userId);
    const today = todayKey();

    const [habits, tasksAll, goals, journalCount, snapshots, earned] = await Promise.all([
        Habit.find({ userId }),
        Task.find({ userId }),
        require("../models/Goal").find({ userId }),
        JournalEntry.countDocuments({ userId }),
        ProgressSnapshot.find({ userId }).sort({ date: 1 }),
        UserAchievement.find({ userId })
    ]);

    const earnedCodes = new Set(earned.map((a) => a.code));

    // morning block completions
    const morningBlocks = tasksAll.filter(
        (t) => t.completed && t.timeBlock === "morning"
    ).length;

    const context = buildContext({
        goals,
        habits,
        dayScores: snapshots.map((s) => ({
            date: s.date,
            score: s.score,
            scheduled: s.habitsScheduled + s.tasksTotal,
            counted: s.counted,
            habitsDone: s.habitsDone,
            tasksDone: s.tasksDone,
            bestStreak: s.bestStreak
        })),
        journalCount,
        today,
        weekDays: last7(today),
        morningBlocks
    });

    const newlyEarned = [];
    for (const def of ACHIEVEMENTS) {
        if (earnedCodes.has(def.code)) continue;
        try {
            if (def.check(context)) {
                await UserAchievement.create({ userId, code: def.code });
                user.xp += 25;
                newlyEarned.push(def);
            }
        } catch (e) {
            // ignore individual achievement failures
        }
    }

    if (newlyEarned.length > 0) {
        await user.save();
        // respect the user's "Achievement alerts" setting
        const Settings = require("../models/Settings");
        const s = await Settings.findOne({ userId }).select("notifications.achievements").lean();
        if (!s || s.notifications?.achievements !== false) {
            const Notification = require("../models/Notification");
            for (const def of newlyEarned) {
                await Notification.create({
                    userId,
                    type: "achievement",
                    title: `Achievement unlocked — ${def.name}`,
                    body: def.description
                });
            }
        }
    }

    return newlyEarned;
}

function last7(today) {
    const days = [];
    for (let i = 6; i >= 0; i -= 1) days.push(addDays(today, -i));
    return days;
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

// recent day keys (for recompute loops)
function allDayKeys(userId, days) {
    const keys = [];
    const today = todayKey();
    for (let i = days - 1; i >= 0; i -= 1) {
        keys.push(addDays(today, -i));
    }
    return keys;
}

// recovery state from missed-day count
function computeRecovery(missedDays, today) {
    if (missedDays >= 3) {
        return { active: true, since: addDays(today, -missedDays), missedDays };
    }
    return { active: false, since: null, missedDays };
}

// ------------------------------------------------------------
// DEMO DATA SEEDING
// ------------------------------------------------------------

async function seedDemoData(userId) {
    const {
        eachDay
    } = require("./date");
    const Goal = require("../models/Goal");
    const Area = require("../models/Area");

    const today = todayKey();

    // ---- Habits ----
    const habitSpecs = [
        { name: "Drink 3L water", area: "body", type: "numeric", target: 3, unit: "L", frequency: "daily", difficulty: "easy" },
        { name: "Workout", area: "body", type: "boolean", frequency: "times_per_week", target: 4, difficulty: "hard" },
        { name: "Read 20 pages", area: "learning", type: "numeric", target: 20, unit: "pages", frequency: "daily", difficulty: "medium" },
        { name: "Meditate 10 minutes", area: "mind", type: "boolean", frequency: "daily", difficulty: "medium" },
        { name: "Deep work block", area: "productivity", type: "boolean", frequency: "specific_days", specificDays: [1, 2, 3, 4, 5], difficulty: "hard" },
        { name: "No phone before bed", area: "discipline", type: "boolean", frequency: "daily", difficulty: "hard" },
        { name: "Journal", area: "mind", type: "boolean", frequency: "daily", difficulty: "easy" },
        { name: "Study Spanish", area: "skills", type: "boolean", frequency: "specific_days", specificDays: [1, 3, 5], difficulty: "medium" }
    ];

    const habits = [];
    for (const spec of habitSpecs) {
        const h = await Habit.create({
            userId,
            ...spec,
            startDate: addDays(today, -45)
        });
        habits.push(h);
    }

    // ---- Completions: 45 days of realistic history ----
    const days = eachDay(addDays(today, -44), today);
    for (const d of days) {
        const dow = dayOfWeek(d);
        const isWeekend = dow === 0 || dow === 6;
        // a rough patch days -20..-17 (recovery story)
        const roughPatch = d >= addDays(today, -20) && d <= addDays(today, -17);

        for (const habit of habits) {
            if (!isHabitScheduledOn(habit, d)) continue;

            // per-habit consistency personality
            const consistency = {
                "Drink 3L water": 0.9,
                Workout: 0.65,
                "Read 20 pages": 0.8,
                "Meditate 10 minutes": 0.75,
                "Deep work block": isWeekend ? 0 : 0.85,
                "No phone before bed": 0.6,
                Journal: 0.7,
                "Study Spanish": 0.8
            }[habit.name] ?? 0.7;

            const roll = Math.random();
            if (roughPatch && roll > 0.25) continue;

            if (habit.type === "numeric") {
                if (roll < consistency) {
                    const value = habit.name === "Drink 3L water"
                        ? Math.round((2 + Math.random() * 1.5) * 10) / 10
                        : Math.round(15 + Math.random() * 20);
                    await HabitCompletion.create({
                        userId,
                        habitId: habit._id,
                        date: d,
                        value,
                        target: habit.target,
                        completed: value >= habit.target
                    });
                }
            } else if (roll < consistency) {
                await HabitCompletion.create({
                    userId,
                    habitId: habit._id,
                    date: d,
                    completed: true
                });
            }
        }

        // ---- Tasks ----
        const taskTemplates = [
            { title: "Morning workout session", timeBlock: "morning", priority: "high" },
            { title: "Deep work: project task", timeBlock: "morning", priority: "high" },
            { title: "Read and take notes", timeBlock: "afternoon", priority: "normal" },
            { title: "Review goals", timeBlock: "evening", priority: "normal" },
            { title: "Plan tomorrow", timeBlock: "evening", priority: "low" }
        ];

        const dayNum = diffDaysSafe(d, today);
        const futureDay = dayNum < 0; // task date is after today

        for (const t of taskTemplates) {
            if (isWeekend && t.timeBlock === "morning" && t.priority === "high") continue;
            if (futureDay) {
                await Task.create({ userId, title: t.title, date: d, timeBlock: t.timeBlock, priority: t.priority, completed: false });
                continue;
            }
            const doneRoll = Math.random();
            const completed = roughPatch ? doneRoll < 0.3 : doneRoll < 0.75;
            await Task.create({
                userId,
                title: t.title,
                date: d,
                timeBlock: t.timeBlock,
                priority: t.priority,
                completed,
                completedAt: completed ? new Date(d + "T18:00:00") : null
            });
        }

        // ---- Journal entries (about 3 per week) ----
        if (dow === 1 || dow === 3 || dow === 5 || Math.random() < 0.15) {
            const moods = [2, 3, 3, 4, 4, 4, 5, 5];
            await JournalEntry.create({
                userId,
                date: d,
                text: roughPatch
                    ? "Rough stretch. Energy low, skipped a lot today. Tomorrow is a new page."
                    : "Solid day. Kept the promises I made to myself this morning.",
                prompts: {
                    wentWell: roughPatch ? "Showed up anyway." : "Training done before work.",
                    couldImprove: roughPatch ? "Sleep schedule slipped." : "Less scrolling in the evening.",
                    learned: roughPatch ? "Rest is part of the process." : "Mornings decide the day.",
                    proudOf: roughPatch ? "Didn't quit." : "Consistency compounding.",
                    tomorrow: roughPatch ? "One habit. Just one." : "Start with the hardest thing."
                },
                mood: moods[Math.floor(Math.random() * moods.length)],
                energy: roughPatch ? 2 : 4,
                stress: roughPatch ? 4 : 2,
                confidence: roughPatch ? 2 : 4
            });
        }
    }

    // ---- Goals ----
    const goalSpecs = [
        {
            title: "BUILD A STRONGER PHYSIQUE",
            area: "body",
            horizon: "long",
            deadline: addDays(today, 120),
            milestones: [
                { title: "Establish workout routine", done: true },
                { title: "Train consistently for 8 weeks", done: true },
                { title: "Increase strength on key lifts", done: false },
                { title: "Reach target physique", done: false }
            ],
            habitIdx: [1]
        },
        {
            title: "READ 12 BOOKS THIS YEAR",
            area: "learning",
            horizon: "long",
            deadline: addDays(today, 200),
            milestones: [
                { title: "Build a reading list", done: true },
                { title: "Finish 4 books", done: true },
                { title: "Finish 8 books", done: false },
                { title: "Finish 12 books", done: false }
            ],
            habitIdx: [2]
        },
        {
            title: "SHIP PERSONAL PROJECT",
            area: "productivity",
            horizon: "medium",
            deadline: addDays(today, 45),
            milestones: [
                { title: "Define scope", done: true },
                { title: "Build core feature", done: false },
                { title: "Launch", done: false }
            ],
            habitIdx: [4]
        },
        {
            title: "30 DAYS OF MEDITATION",
            area: "mind",
            horizon: "short",
            deadline: addDays(today, 20),
            milestones: [
                { title: "Week 1 complete", done: true },
                { title: "Week 2 complete", done: true },
                { title: "Week 3 complete", done: false },
                { title: "Week 4 complete", done: false }
            ],
            habitIdx: [3]
        }
    ];

    const goals = [];
    for (const spec of goalSpecs) {
        const goal = await Goal.create({
            userId,
            title: spec.title,
            area: spec.area,
            horizon: spec.horizon,
            deadline: spec.deadline,
            milestones: spec.milestones,
            habitIds: spec.habitIdx.map((i) => habits[i]._id)
        });
        goals.push(goal);
    }

    // ---- Recompute all snapshots ----
    for (const d of days) {
        await recomputeAndSnapshot(userId, d);
    }
    await evaluateAchievements(userId);

    return { habits: habits.length, goals: goals.length, days: days.length };
}

module.exports = {
    getDayData,
    recomputeAndSnapshot,
    evaluateAchievements,
    allDayKeys,
    computeRecovery,
    getLevel,
    seedDemoData
};
