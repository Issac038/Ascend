// ------------------------------------------------------------
// Goal progress — single authoritative implementation.
// Every surface (Goals page, Dashboard, Analytics, Reviews, Profile)
// must use this function so a goal never shows conflicting percentages.
//
// Progress is computed from live data (milestones, linked tasks,
// linked-habit consistency) — no stale cache.
// ------------------------------------------------------------

const Habit = require("../models/Habit");
const HabitCompletion = require("../models/HabitCompletion");
const Task = require("../models/Task");
const { isHabitScheduledOn } = require("./scoring");
const { eachDay, addDays, todayKey } = require("./date");

// Linked-habit consistency window (days).
const HABIT_WINDOW = 28;

function milestonePart(goal) {
    const list = goal.milestones || [];
    if (!list.length) return null;
    return list.filter((m) => m.done).length / list.length;
}

async function taskPart(goal, userId) {
    const ids = (goal.taskIds || []).filter(Boolean);
    if (!ids.length) return null;
    const done = await Task.countDocuments({ userId, _id: { $in: ids }, completed: true });
    return done / ids.length;
}

async function habitPart(goal, userId) {
    const ids = (goal.habitIds || []).filter(Boolean);
    if (!ids.length) return null;

    const today = todayKey();
    const from = addDays(today, -(HABIT_WINDOW - 1));
    const days = eachDay(from, today);

    const habits = await Habit.find({ userId, _id: { $in: ids } });
    if (!habits.length) return null;

    const completions = await HabitCompletion.find({
        userId,
        habitId: { $in: ids },
        date: { $gte: from, $lte: today }
    });
    const compByHabitDate = new Map();
    for (const c of completions) {
        compByHabitDate.set(`${c.habitId.toString()}|${c.date}`, c);
    }

    let total = 0;
    let done = 0;
    for (const habit of habits) {
        for (const d of days) {
            if (!isHabitScheduledOn(habit, d)) continue;
            total += 1;
            const c = compByHabitDate.get(`${habit._id.toString()}|${d}`);
            if (c && (habit.type === "numeric" ? (c.value || 0) >= habit.target : c.completed)) {
                done += 1;
            }
        }
    }
    return total ? done / total : null;
}

// Authoritative goal progress: 0..100, rounded.
// Completed goals are pinned at 100.
async function goalProgress(goal, userId) {
    if (goal.status === "completed") return 100;

    const parts = [milestonePart(goal), await taskPart(goal, userId), await habitPart(goal, userId)]
        .filter((p) => p !== null);
    if (!parts.length) return 0;

    return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

// Compute progress for many goals with shared queries (avoids N+1 for tasks/habits).
async function goalProgressMany(goals, userId) {
    const result = new Map();
    if (!goals.length) return result;

    const allTaskIds = [];
    const allHabitIds = [];
    for (const g of goals) {
        for (const id of g.taskIds || []) allTaskIds.push(id);
        for (const id of g.habitIds || []) allHabitIds.push(id);
    }

    const today = todayKey();
    const from = addDays(today, -(HABIT_WINDOW - 1));
    const days = eachDay(from, today);

    const [doneTaskIds, habits, completions] = await Promise.all([
        allTaskIds.length
            ? Task.find({ userId, _id: { $in: allTaskIds }, completed: true }).select("_id").lean()
            : Promise.resolve([]),
        allHabitIds.length
            ? Habit.find({ userId, _id: { $in: allHabitIds } }).lean()
            : Promise.resolve([]),
        allHabitIds.length
            ? HabitCompletion.find({ userId, habitId: { $in: allHabitIds }, date: { $gte: from, $lte: today } }).lean()
            : Promise.resolve([])
    ]);
    const doneSet = new Set(doneTaskIds.map((t) => t._id.toString()));

    const habitById = new Map(habits.map((h) => [h._id.toString(), h]));
    const compByHabitDate = new Map();
    for (const c of completions) {
        compByHabitDate.set(`${c.habitId.toString()}|${c.date}`, c);
    }

    for (const g of goals) {
        if (g.status === "completed") {
            result.set(g._id.toString(), 100);
            continue;
        }

        const parts = [];
        const mList = g.milestones || [];
        if (mList.length) parts.push(mList.filter((m) => m.done).length / mList.length);

        const taskIds = (g.taskIds || []).filter(Boolean);
        if (taskIds.length) {
            const done = taskIds.filter((id) => doneSet.has(id.toString())).length;
            parts.push(done / taskIds.length);
        }

        const habitIds = (g.habitIds || []).filter(Boolean).map((id) => id.toString());
        if (habitIds.length) {
            let total = 0;
            let done = 0;
            for (const hid of habitIds) {
                const habit = habitById.get(hid);
                if (!habit) continue;
                for (const d of days) {
                    if (!isHabitScheduledOn(habit, d)) continue;
                    total += 1;
                    const c = compByHabitDate.get(`${hid}|${d}`);
                    if (c && (habit.type === "numeric" ? (c.value || 0) >= habit.target : c.completed)) done += 1;
                }
            }
            if (total) parts.push(done / total);
        }

        result.set(
            g._id.toString(),
            parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : 0
        );
    }

    return result;
}

module.exports = { goalProgress, goalProgressMany, HABIT_WINDOW };
