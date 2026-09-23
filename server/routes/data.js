const express = require("express");

const auth = require("../middleware/auth");
const { requireJournalUnlock } = require("./journalSecurity");
const { todayKey, todayKeyFor, addDays, startOfWeek, eachDay, diffDays, dayOfWeek, startOfMonth, endOfMonth, isValidDateKey } = require("../utils/date");
const { isHabitScheduledOn, computeDayScore, computeStreak, xpForDayScore } = require("../utils/scoring");
const { ACHIEVEMENTS, buildContext } = require("../utils/achievements");
const { recomputeAndSnapshot, evaluateAchievements, getDayData, allDayKeys } = require("../utils/engine");
const { goalProgress, goalProgressMany } = require("../utils/goalProgress");

const User = require("../models/User");
const Area = require("../models/Area");
const Habit = require("../models/Habit");
const HabitCompletion = require("../models/HabitCompletion");
const Task = require("../models/Task");
const Goal = require("../models/Goal");
const JournalEntry = require("../models/JournalEntry");
const ProgressSnapshot = require("../models/ProgressSnapshot");
const UserAchievement = require("../models/Achievement");
const Notification = require("../models/Notification");

const router = express.Router();

const USER_TZ_CACHE = new Map(); // userId -> { tz, at } — short TTL so profile updates propagate
const TZ_TTL_MS = 30 * 1000;
async function userTzOffset(userId) {
    const hit = USER_TZ_CACHE.get(userId);
    if (hit && Date.now() - hit.at < TZ_TTL_MS) return hit.tz;
    const u = await User.findById(userId).select("timezoneOffset").lean();
    const tz = (u && u.timezoneOffset) || 0;
    USER_TZ_CACHE.set(userId, { tz, at: Date.now() });
    return tz;
}
function clearTzCache(userId) {
    USER_TZ_CACHE.delete(userId);
}

function validIdOr400(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id || ""));
}

async function notify(userId, type, title, body) {
    try {
        await Notification.create({ userId, type, title, body });
    } catch (e) { /* non-fatal */ }
}

// ============================================================
// AREAS
// ============================================================
router.get("/areas", auth, async (req, res) => {
    try {
        const areas = await Area.find({ userId: req.userId }).sort({ order: 1 });
        res.json({ success: true, areas });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load areas" });
    }
});

router.post("/areas", auth, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim().slice(0, 40);
        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const count = await Area.countDocuments({ userId: req.userId });
        const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${Date.now() % 10000}`;
        const area = await Area.create({ userId: req.userId, key, name, order: count });
        res.status(201).json({ success: true, area });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to create area" });
    }
});

router.patch("/areas/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const updates = {};
        if (req.body.name !== undefined) {
            const name = String(req.body.name).trim().slice(0, 40);
            if (!name) return res.status(400).json({ success: false, message: "Name cannot be empty" });
            updates.name = name;
        }
        if (req.body.focus !== undefined) updates.focus = !!req.body.focus;
        if (req.body.order !== undefined) {
            const n = Number(req.body.order);
            if (!Number.isFinite(n)) return res.status(400).json({ success: false, message: "Invalid order" });
            updates.order = Math.round(n);
        }
        if (req.body.archived !== undefined) updates.archived = !!req.body.archived;

        const area = await Area.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, updates, { new: true });
        res.json({ success: true, area });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to update area" });
    }
});

router.delete("/areas/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const area = await Area.findOne({ _id: req.params.id, userId: req.userId });
        if (!area) return res.status(404).json({ success: false, message: "Area not found" });
        await area.deleteOne();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to delete area" });
    }
});

// ============================================================
// HABITS
// ============================================================
router.get("/habits", auth, async (req, res) => {
    try {
        const habits = await Habit.find({ userId: req.userId }).sort({ createdAt: 1 });
        res.json({ success: true, habits });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load habits" });
    }
});

router.post("/habits", auth, async (req, res) => {
    try {
        const { name, description, area, type, frequency, specificDays, target, unit, difficulty, reminderTime, startDate } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: "Name is required" });
        }
        const habitCount = await Habit.countDocuments({ userId: req.userId });
        if (habitCount >= 100) {
            return res.status(400).json({ success: false, message: "Habit limit reached (100). Archive unused habits first." });
        }

        const tz = await userTzOffset(req.userId);
        const numericTarget = Math.max(0.1, Math.min(100000, Number(target) || 1));

        const habit = await Habit.create({
            userId: req.userId,
            name: String(name).trim().slice(0, 80),
            description: String(description || "").slice(0, 500),
            area: String(area || "personal").slice(0, 30),
            type: type === "numeric" ? "numeric" : "boolean",
            frequency: ["daily", "specific_days", "times_per_week"].includes(frequency) ? frequency : "daily",
            specificDays: Array.isArray(specificDays) ? specificDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).slice(0, 7) : [],
            target: type === "numeric" ? numericTarget : 1,
            unit: String(unit || "").slice(0, 20),
            difficulty: ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium",
            reminderTime: typeof reminderTime === "string" && /^\d{2}:\d{2}$/.test(reminderTime) ? reminderTime : null,
            startDate: isValidDateKey(startDate) ? startDate : todayKeyFor(tz)
        });

        const user = await User.findById(req.userId);
        user.xp += 5;
        await user.save();

        res.status(201).json({ success: true, habit });
    } catch (e) {
        console.error("create habit error:", e.message);
        res.status(500).json({ success: false, message: "Failed to create habit" });
    }
});

router.patch("/habits/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId });
        if (!habit) return res.status(404).json({ success: false, message: "Habit not found" });

        const fields = ["name", "description", "area", "type", "frequency", "difficulty", "unit"];
        for (const f of fields) {
            if (req.body[f] !== undefined) habit[f] = req.body[f];
        }
        if (req.body.reminderTime !== undefined) {
            habit.reminderTime = /^\d{2}:\d{2}$/.test(String(req.body.reminderTime)) ? String(req.body.reminderTime) : null;
        }
        if (req.body.startDate !== undefined) {
            habit.startDate = isValidDateKey(req.body.startDate) ? req.body.startDate : habit.startDate;
        }
        if (req.body.specificDays !== undefined) {
            habit.specificDays = Array.isArray(req.body.specificDays)
                ? req.body.specificDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).slice(0, 7)
                : [];
        }
        if (req.body.target !== undefined) {
            const t = Number(req.body.target);
            habit.target = Number.isFinite(t) && t > 0 ? Math.min(100000, t) : 1;
        }
        if (req.body.archived !== undefined) habit.archived = !!req.body.archived;

        await habit.save();
        await recomputeAndSnapshot(req.userId, todayKey());

        res.json({ success: true, habit });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to update habit" });
    }
});

router.delete("/habits/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId });
        if (!habit) return res.status(404).json({ success: false, message: "Habit not found" });
        await habit.deleteOne();
        await HabitCompletion.deleteMany({ userId: req.userId, habitId: habit._id });

        // remove from goal links
        await Goal.updateMany({ userId: req.userId, habitIds: habit._id }, { $pull: { habitIds: habit._id } });

        // recompute recent history
        for (const d of allDayKeys(req.userId, 90)) {
            await recomputeAndSnapshot(req.userId, d);
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to delete habit" });
    }
});

// TOGGLE / LOG a habit for a date
router.post("/habits/:id/toggle", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId });
        if (!habit) return res.status(404).json({ success: false, message: "Habit not found" });

        const tz = await userTzOffset(req.userId);
        const date = isValidDateKey(req.body.date) ? req.body.date : todayKeyFor(tz);
        let completion = await HabitCompletion.findOne({ userId: req.userId, habitId: habit._id, date });

        if (habit.type === "numeric") {
            let delta = Number(req.body.delta);
            if (!Number.isFinite(delta)) delta = 0;
            // one atomic pipeline update — no read-modify-write race,
            // value clamped at 0 inside the same atomic operation.
            // NOTE: only value/target are set here — the identity fields come
            // from the filter (Mongoose casts them), pipeline values are raw.
            const updated = await HabitCompletion.findOneAndUpdate(
                { userId: req.userId, habitId: habit._id, date },
                [
                    {
                        $set: {
                            value: { $max: [0, { $add: [{ $ifNull: ["$value", 0] }, delta] }] },
                            target: habit.target
                        }
                    }
                ],
                { upsert: true, new: true, updatePipeline: true }
            );
            completion = updated;
        } else {
            if (completion && completion.completed) {
                await completion.deleteOne();
            } else {
                completion = await HabitCompletion.findOneAndUpdate(
                    { userId: req.userId, habitId: habit._id, date },
                    { completed: true },
                    { upsert: true, new: true }
                );
            }
        }

        await recomputeAndSnapshot(req.userId, date, undefined, tz);
        await evaluateAchievements(req.userId);

        res.json({ success: true, completion });
    } catch (e) {
        console.error("toggle habit error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update habit" });
    }
});

// HISTORY for one habit (completions + stats)
router.get("/habits/:id/history", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId });
        if (!habit) return res.status(404).json({ success: false, message: "Habit not found" });

        const completions = await HabitCompletion.find({ userId: req.userId, habitId: habit._id });
        const byDate = {};
        for (const c of completions) {
            byDate[c.date] = habit.type === "numeric" ? c.value : c.completed;
        }

        // stats
        const start = habit.startDate || completions.reduce((m, c) => (c.date < m ? c.date : m), todayKey());
        const today = todayKey();
        const days = eachDay(start, today);

        let scheduled = 0;
        let done = 0;
        for (const d of days) {
            if (isHabitScheduledOn(habit, d)) {
                scheduled += 1;
                const v = byDate[d];
                if (habit.type === "numeric" ? v >= habit.target : v === true) done += 1;
            }
        }

        // weekly consistency (last 4 full weeks)
        const weeks = [];
        for (let w = 0; w < 4; w += 1) {
            const wkStart = addDaysStr(startOfWeek(today), -7 * w);
            const wkDays = eachDay(wkStart, addDaysStr(wkStart, 6));
            let sch = 0;
            let dn = 0;
            for (const d of wkDays) {
                if (isHabitScheduledOn(habit, d)) {
                    sch += 1;
                    const v = byDate[d];
                    if (habit.type === "numeric" ? v >= habit.target : v === true) dn += 1;
                }
            }
            weeks.unshift({ start: wkStart, scheduled: sch, done: dn, pct: sch ? Math.round((dn / sch) * 100) : null });
        }

        res.json({
            success: true,
            habit,
            completions: byDate,
            stats: {
                completionRate: scheduled ? Math.round((done / scheduled) * 100) : null,
                totalCompletions: done
            },
            weeks
        });
    } catch (e) {
        console.error("habit history error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load habit history" });
    }
});

function addDaysStr(key, n) {
    const { addDays } = require("../utils/date");
    return addDays(key, n);
}

// ============================================================
// TASKS
// ============================================================
router.get("/tasks", auth, async (req, res) => {
    try {
        const date = isValidDateKey(req.query.date) ? req.query.date : todayKeyFor(await userTzOffset(req.userId));
        const tasks = await Task.find({ userId: req.userId, date }).sort({ createdAt: 1 });
        res.json({ success: true, tasks });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load tasks" });
    }
});

router.post("/tasks", auth, async (req, res) => {
    try {
        const { title, notes, date, timeBlock, priority, recurrence, goalId } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ success: false, message: "Title is required" });
        }
        if (req.body.goalId && !validIdOr400(req.body.goalId)) {
            return res.status(400).json({ success: false, message: "Invalid goal" });
        }

        const tz = await userTzOffset(req.userId);
        const task = await Task.create({
            userId: req.userId,
            title: String(title).trim().slice(0, 140),
            notes: String(notes || "").slice(0, 1000),
            date: isValidDateKey(date) ? date : todayKeyFor(tz),
            timeBlock: ["morning", "afternoon", "evening", "anytime"].includes(timeBlock) ? timeBlock : "anytime",
            priority: ["low", "normal", "high"].includes(priority) ? priority : "normal",
            recurrence: ["none", "daily", "weekdays", "weekly"].includes(recurrence) ? recurrence : "none",
            goalId: goalId || null
        });

        // link to goal (ownership verified)
        if (goalId) {
            await Goal.updateOne({ _id: goalId, userId: req.userId }, { $addToSet: { taskIds: task._id } });
        }

        res.status(201).json({ success: true, task });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to create task" });
    }
});

router.patch("/tasks/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
        if (!task) return res.status(404).json({ success: false, message: "Task not found" });

        const fields = ["title", "notes", "timeBlock", "priority", "recurrence"];
        for (const f of fields) {
            if (req.body[f] !== undefined) task[f] = req.body[f];
        }
        if (req.body.title !== undefined && !String(req.body.title).trim()) {
            return res.status(400).json({ success: false, message: "Title cannot be empty" });
        }
        if (req.body.date !== undefined) {
            if (!isValidDateKey(req.body.date)) return res.status(400).json({ success: false, message: "Invalid date" });
            task.date = req.body.date;
        }

        if (req.body.completed !== undefined) {
            task.completed = !!req.body.completed;
            task.completedAt = task.completed ? new Date() : null;
        }
        if (req.body.skipped !== undefined) task.skipped = !!req.body.skipped;

        await task.save();

        const tz = await userTzOffset(req.userId);
        await recomputeAndSnapshot(req.userId, task.date, undefined, tz);

        // ---- Recurring tasks: spawn the next occurrence on completion ----
        // One live instance per (title, next date) — no duplicates.
        if (task.completed && task.completedAt && task.recurrence && task.recurrence !== "none") {
            const nextDate = nextRecurrenceDate(task.date, task.recurrence, tz);
            const exists = await Task.findOne({
                userId: req.userId,
                title: task.title,
                date: nextDate,
                recurrence: task.recurrence
            }).lean();
            if (!exists) {
                await Task.create({
                    userId: req.userId,
                    title: task.title,
                    notes: task.notes,
                    date: nextDate,
                    timeBlock: task.timeBlock,
                    priority: task.priority,
                    recurrence: task.recurrence,
                    goalId: task.goalId
                });
                if (task.goalId) {
                    await Goal.updateOne(
                        { _id: task.goalId, userId: req.userId },
                        { $addToSet: { taskIds: { $each: [] } } } // taskIds link handled below
                    ).catch(() => {});
                }
            }
        }

        await evaluateAchievements(req.userId);

        res.json({ success: true, task });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to update task" });
    }
});

// Next date for a recurrence, anchored to the task's own date (timezone-safe
// because all date math is string-based).
function nextRecurrenceDate(dateKey, recurrence) {
    if (recurrence === "daily") return addDays(dateKey, 1);
    if (recurrence === "weekly") return addDays(dateKey, 7);
    if (recurrence === "weekdays") {
        let next = addDays(dateKey, 1);
        while (dayOfWeek(next) === 0 || dayOfWeek(next) === 6) next = addDays(next, 1);
        return next;
    }
    return null;
}

router.delete("/tasks/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
        if (!task) return res.status(404).json({ success: false, message: "Task not found" });
        await task.deleteOne();
        await Goal.updateOne({ userId: req.userId, taskIds: task._id }, { $pull: { taskIds: task._id } });
        await recomputeAndSnapshot(req.userId, task.date);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to delete task" });
    }
});

// ============================================================
// GOALS
// ============================================================
router.get("/goals", auth, async (req, res) => {
    try {
        const goals = await Goal.find({ userId: req.userId }).sort({ createdAt: -1 });
        const progressMap = await goalProgressMany(goals, req.userId);

        const enriched = goals.map((g) => {
            const obj = g.toObject();
            obj.progress = progressMap.get(g._id.toString()) || 0;
            return obj;
        });

        res.json({ success: true, goals: enriched });
    } catch (e) {
        console.error("goals error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load goals" });
    }
});

router.post("/goals", auth, async (req, res) => {
    try {
        const { title, description, area, horizon, deadline, milestones } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ success: false, message: "Title is required" });
        }
        const goalCount = await Goal.countDocuments({ userId: req.userId });
        if (goalCount >= 100) {
            return res.status(400).json({ success: false, message: "Goal limit reached (100)." });
        }

        const goal = await Goal.create({
            userId: req.userId,
            title: String(title).trim().slice(0, 120),
            description: String(description || "").slice(0, 1000),
            area: String(area || "personal").slice(0, 30),
            horizon: ["short", "medium", "long"].includes(horizon) ? horizon : "medium",
            deadline: isValidDateKey(deadline) ? deadline : null,
            milestones: Array.isArray(milestones)
                ? milestones.slice(0, 12).map((m) => ({ title: String(m.title || m).slice(0, 120), done: false }))
                : []
        });

        res.status(201).json({ success: true, goal });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to create goal" });
    }
});

router.patch("/goals/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const goal = await Goal.findOne({ _id: req.params.id, userId: req.userId });
        if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });

        const fields = ["title", "description", "area", "horizon", "notes"];
        for (const f of fields) {
            if (req.body[f] !== undefined) goal[f] = req.body[f];
        }
        if (req.body.title !== undefined && !String(req.body.title).trim()) {
            return res.status(400).json({ success: false, message: "Title cannot be empty" });
        }
        if (req.body.deadline !== undefined) {
            goal.deadline = req.body.deadline === null || req.body.deadline === "" ? null
                : isValidDateKey(req.body.deadline) ? req.body.deadline : goal.deadline;
        }
        if (req.body.status !== undefined && !["active", "completed", "archived"].includes(req.body.status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        if (Array.isArray(req.body.milestones)) {
            goal.milestones = req.body.milestones.slice(0, 12).map((m) => ({
                title: String(m.title || "").slice(0, 120),
                done: !!m.done
            }));
        }
        if (Array.isArray(req.body.habitIds)) {
            // only allow linking habits the user actually owns
            const owned = await Habit.find({ userId: req.userId, _id: { $in: req.body.habitIds.slice(0, 20) } }).select("_id").lean();
            goal.habitIds = owned.map((h) => h._id);
        }

        // ---- XP on ONE-WAY completion transition only (idempotent) ----
        // XP is granted when a goal moves active -> completed. Reverting
        // (completed -> active) does NOT clear completedAt and does NOT refund;
        // re-completing therefore never re-awards. completedAt is the
        // one-way "has ever been completed" flag.
        const wasCompleted = goal.status === "completed" || !!goal.completedAt;
        const completing = req.body.status === "completed" && !wasCompleted;

        if (completing) {
            goal.completedAt = new Date();
        }

        if (req.body.status !== undefined) goal.status = req.body.status;

        await goal.save();

        if (completing) {
            const updated = await User.updateOne(
                { _id: req.userId },
                { $inc: { xp: 100 } }
            );
            if (updated.acknowledged) {
                await notify(req.userId, "goal", "Goal completed", `You delivered: ${goal.title}`);
                await evaluateAchievements(req.userId);
            }
        }

        res.json({ success: true, goal });
    } catch (e) {
        console.error("goal update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update goal" });
    }
});

router.delete("/goals/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const goal = await Goal.findOne({ _id: req.params.id, userId: req.userId });
        if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });
        await goal.deleteOne();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to delete goal" });
    }
});

// ============================================================
// JOURNAL
// ============================================================
// All journal content endpoints sit behind the optional PIN gate:
// when the user has configured a Journal PIN, reads AND writes require a
// valid unlock token (x-journal-unlock header) — a locked journal can
// neither be read nor overwritten. See routes/journalSecurity.js.
router.get("/journal", auth, requireJournalUnlock, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const entries = await JournalEntry.find({ userId: req.userId }).sort({ date: -1 }).limit(limit);
        res.json({ success: true, entries });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load journal" });
    }
});

router.get("/journal/:date", auth, requireJournalUnlock, async (req, res) => {
    try {
        const entry = await JournalEntry.findOne({ userId: req.userId, date: req.params.date });
        res.json({ success: true, entry: entry || null });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load entry" });
    }
});

router.put("/journal/:date", auth, requireJournalUnlock, async (req, res) => {
    try {
        const date = req.params.date;
        if (!isValidDateKey(date)) {
            return res.status(400).json({ success: false, message: "Invalid date" });
        }
        const { text, prompts, mood, energy, stress, confidence } = req.body;

        const snap = await ProgressSnapshot.findOne({ userId: req.userId, date });

        const entry = await JournalEntry.findOneAndUpdate(
            { userId: req.userId, date },
            {
                text: String(text || "").slice(0, 8000),
                prompts: {
                    wentWell: String(prompts?.wentWell || "").slice(0, 2000),
                    couldImprove: String(prompts?.couldImprove || "").slice(0, 2000),
                    learned: String(prompts?.learned || "").slice(0, 2000),
                    proudOf: String(prompts?.proudOf || "").slice(0, 2000),
                    tomorrow: String(prompts?.tomorrow || "").slice(0, 2000)
                },
                mood: clampRating(mood),
                energy: clampRating(energy),
                stress: clampRating(stress),
                confidence: clampRating(confidence),
                dayScore: snap ? snap.score : null
            },
            { upsert: true, new: true, runValidators: true }
        );

        // Mark reflection in the snapshot. The reflection XP (+10) is granted
        // ONLY by the snapshot engine's idempotent delta (xpGranted), which
        // includes the reflection bonus for the user's "today" — so a journal
        // entry can never award XP twice regardless of how many times it is
        // saved, edited, or re-saved.
        await ProgressSnapshot.updateOne({ userId: req.userId, date }, { journalLogged: true });
        const tz = await userTzOffset(req.userId);
        await recomputeAndSnapshot(req.userId, date, undefined, tz);
        await evaluateAchievements(req.userId);

        res.json({ success: true, entry });
    } catch (e) {
        console.error("journal save error:", e.message);
        res.status(500).json({ success: false, message: "Failed to save entry" });
    }
});

router.delete("/journal/:date", auth, requireJournalUnlock, async (req, res) => {
    try {
        if (!isValidDateKey(req.params.date)) {
            return res.status(400).json({ success: false, message: "Invalid date" });
        }
        await JournalEntry.deleteOne({ userId: req.userId, date: req.params.date });
        const tz = await userTzOffset(req.userId);
        await recomputeAndSnapshot(req.userId, req.params.date, undefined, tz);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to delete entry" });
    }
});

function clampRating(v) {
    const n = Number(v);
    if (!n || n < 1 || n > 5) return null;
    return Math.round(n);
}

// ============================================================
// DASHBOARD AGGREGATE
// ============================================================
router.get("/dashboard", auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("-password -__v");
        const tz = await userTzOffset(req.userId);
        const today = todayKeyFor(tz);

        await recomputeAndSnapshot(req.userId, today, undefined, tz);

        const habits = await Habit.find({ userId: req.userId });
        const completions = await HabitCompletion.find({ userId: req.userId, date: today });
        const tasks = await Task.find({ userId: req.userId, date: today });
        const snapshots = await ProgressSnapshot.find({ userId: req.userId }).sort({ date: 1 });
        const goals = await Goal.find({ userId: req.userId, status: "active" });

        const { computeRecovery, getLevel } = require("../utils/engine");

        // streak from snapshots
        const { streak, best } = computeStreakFromSnapshots(snapshots);

        // authoritative goal progress (same calculator as GET /goals)
        const progressMap = await goalProgressMany(goals, req.userId);

        // score trend (last 14 days)
        const trend = [];
        for (let i = 13; i >= 0; i -= 1) {
            const d = addDays(today, -i);
            const snap = snapshots.find((s) => s.date === d);
            trend.push({ date: d, score: snap ? snap.score : null });
        }

        // area progress: average of recent scores weighted by area activities (simplified: from snapshots + goals)
        const areas = await Area.find({ userId: req.userId, archived: false }).sort({ order: 1 });
        const areaProgress = areas.map((a) => {
            const areaGoals = goals.filter((g) => g.area === a.key);
            const avgGoalProgress = areaGoals.length
                ? Math.round(
                    areaGoals.reduce((sum, g) => sum + (progressMap.get(g._id.toString()) || 0), 0) / areaGoals.length
                )
                : null;
            return { key: a.key, name: a.name, focus: a.focus, goalProgress: avgGoalProgress };
        });

        const joinDate = (user.ascendDate || user.createdAt).toISOString().slice(0, 10);
        const missed = countMissedDays(snapshots, today, joinDate);
        const recovery = computeRecovery(missed, today);

        // persist recovery state on the user record (used by profile)
        if ((user.recovery?.active || false) !== recovery.active
            || (user.recovery?.missedDays || 0) !== recovery.missedDays) {
            await User.updateOne({ _id: req.userId }, { $set: { recovery } });
        }

        const level = getLevel(user.xp);

        const completionMap = {};
        for (const c of completions) {
            completionMap[c.habitId.toString()] = { completed: c.completed, value: c.value, target: c.target };
        }

        res.json({
            success: true,
            today,
            user: { ...user.toObject(), recovery },
            habits: habits.filter((h) => !h.archived),
            habitCompletions: completionMap,
            tasks,
            snapshot: snapshots.find((s) => s.date === today) || null,
            streak,
            bestStreak: best,
            trend,
            areas: areaProgress,
            activeGoals: goals.length,
            // Per-goal progress for the Profile page (same authoritative
            // calculator as GET /goals — one source of truth).
            goals: goals.map((g) => ({
                _id: g._id,
                title: g.title,
                area: g.area,
                status: g.status,
                progress: progressMap.get(g._id.toString()) || 0
            })),
            level
        });
    } catch (e) {
        console.error("dashboard error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load dashboard" });
    }
});

function computeStreakFromSnapshots(snapshots) {
    const today = todayKey();
    const byDate = new Map(snapshots.map((s) => [s.date, s]));
    const isGood = (d) => {
        const s = byDate.get(d);
        return s && s.counted;
    };

    let streak = 0;
    let cursor = isGood(today) ? today : addDays(today, -1);
    while (isGood(cursor)) {
        streak += 1;
        cursor = addDays(cursor, -1);
    }

    let best = 0;
    let run = 0;
    let prev = null;
    for (const s of snapshots) {
        if (!s.counted) {
            run = 0;
            prev = s.date;
            continue;
        }
        run = prev && diffDays(prev, s.date) === 1 ? run + 1 : 1;
        best = Math.max(best, run);
        prev = s.date;
    }

    return { streak, best: Math.max(best, streak) };
}

function countMissedDays(snapshots, today, startDate) {
    let missed = 0;
    for (let i = 1; i <= 7; i += 1) {
        const d = addDays(today, -i);
        if (startDate && d < startDate) break; // no history before joining
        const snap = snapshots.find((s) => s.date === d);
        if (snap && snap.counted) break;
        missed += 1;
    }
    return missed;
}

module.exports = router;
