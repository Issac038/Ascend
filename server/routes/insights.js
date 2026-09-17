const express = require("express");

const auth = require("../middleware/auth");
const {
    todayKey, todayKeyFor, addDays, startOfWeek, eachDay,
    startOfMonth, endOfMonth, monthKey, formatShort, monthName
} = require("../utils/date");
const { isHabitScheduledOn } = require("../utils/scoring");
const { recomputeAndSnapshot, evaluateAchievements } = require("../utils/engine");
const { ACHIEVEMENTS } = require("../utils/achievements");
const { goalProgressMany } = require("../utils/goalProgress");

const User = require("../models/User");
const Settings = require("../models/Settings");
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

async function userTz(userId) {
    const u = await User.findById(userId).select("timezoneOffset").lean();
    return (u && u.timezoneOffset) || 0;
}

// ============================================================
// DAY DETAIL (Today page)
// ============================================================
router.get("/day/:date", auth, async (req, res) => {
    try {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(req.params.date)
            ? req.params.date
            : todayKeyFor(await userTz(req.userId));
        const { getDayData } = require("../utils/engine");

        const { habits, completions, tasks, journalLogged } = await getDayData(req.userId, date);

        const snap = await ProgressSnapshot.findOne({ userId: req.userId, date });
        const prevSnap = await ProgressSnapshot.findOne({ userId: req.userId, date: addDays(date, -1) });

        const goals = await Goal.find({ userId: req.userId, status: "active" })
            .sort({ createdAt: -1 })
            .limit(4)
            .select("title area deadline");

        res.json({
            success: true,
            date,
            snapshot: snap,
            prevScore: prevSnap ? prevSnap.score : null,
            habits,
            habitCompletions: completions,
            tasks,
            journalLogged,
            goals
        });
    } catch (e) {
        console.error("day detail error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load day" });
    }
});

// ============================================================
// WEEKLY REVIEW
// ============================================================
router.get("/review/weekly", auth, async (req, res) => {
    try {
        const tz = await userTz(req.userId);
        const today = todayKeyFor(tz);
        const weekStart = startOfWeek(today);
        const days = eachDay(weekStart, today);

        await recomputeAndSnapshot(req.userId, today, undefined, tz);

        const snapshots = await ProgressSnapshot.find({
            userId: req.userId,
            date: { $gte: weekStart, $lte: today }
        });

        const habits = await Habit.find({ userId: req.userId });
        const completions = await HabitCompletion.find({
            userId: req.userId,
            date: { $gte: weekStart, $lte: today }
        });
        const tasks = await Task.find({ userId: req.userId, date: { $gte: weekStart, $lte: today } });
        const journals = await JournalEntry.find({ userId: req.userId, date: { $gte: weekStart, $lte: today } });
        const goals = await Goal.find({ userId: req.userId });

        // per-area consistency
        const schedByArea = {};
        const doneByArea = {};
        let habitSch = 0;
        let habitDn = 0;

        for (const d of days) {
            for (const habit of habits) {
                if (!isHabitScheduledOn(habit, d)) continue;
                habitSch += 1;

                const done = completions.some((c) =>
                    c.habitId.toString() === habit._id.toString() &&
                    (habit.type === "numeric" ? (c.value || 0) >= habit.target : c.completed)
                );
                if (done) habitDn += 1;

                schedByArea[habit.area] = (schedByArea[habit.area] || 0) + 1;
                if (done) doneByArea[habit.area] = (doneByArea[habit.area] || 0) + 1;
            }
        }

        const areas = await Area.find({ userId: req.userId, archived: false });
        const areaStats = areas.map((a) => {
            const scheduled = schedByArea[a.key] || 0;
            const done = doneByArea[a.key] || 0;
            return {
                key: a.key,
                name: a.name,
                consistency: scheduled ? Math.round((done / scheduled) * 100) : null
            };
        });

        // most consistent habit
        let mostConsistent = null;
        let bestRate = -1;
        for (const habit of habits) {
            let sch = 0;
            let dn = 0;
            for (const d of days) {
                if (!isHabitScheduledOn(habit, d)) continue;
                sch += 1;
                const done = completions.some((c) =>
                    c.habitId.toString() === habit._id.toString() &&
                    (habit.type === "numeric" ? (c.value || 0) >= habit.target : c.completed)
                );
                if (done) dn += 1;
            }
            if (sch > 0) {
                const rate = dn / sch;
                if (rate > bestRate) {
                    bestRate = rate;
                    mostConsistent = { name: habit.name, rate: Math.round(rate * 100) };
                }
            }
        }

        const scoredDays = snapshots.filter((s) => s.score !== null);
        const bestDay = scoredDays.reduce((b, s) => (!b || s.score > b.score ? s : b), null);
        const ranked = areaStats.filter((a) => a.consistency !== null).sort((a, b) => b.consistency - a.consistency);

        const avg = scoredDays.length
            ? Math.round(scoredDays.reduce((sum, s) => sum + s.score, 0) / scoredDays.length)
            : null;

        const plannedTasks = tasks.length;
        const doneTasks = tasks.filter((t) => t.completed).length;

        res.json({
            success: true,
            weekStart,
            days: days.map((d) => {
                const s = snapshots.find((x) => x.date === d);
                return { date: d, score: s ? s.score : null, counted: s ? s.counted : false };
            }),
            avgScore: avg,
            habitConsistency: habitSch ? Math.round((habitDn / habitSch) * 100) : null,
            completedActions: scoredDays.reduce((sum, s) => sum + s.habitsDone + s.tasksDone, 0),
            tasksPlanned: plannedTasks,
            tasksDone: doneTasks,
            reflections: journals.length,
            bestDay: bestDay ? { date: bestDay.date, score: bestDay.score } : null,
            mostConsistent,
            strongestArea: ranked[0] || null,
            weakestArea: ranked[ranked.length - 1] || null,
            areaStats,
            goalsActive: goals.filter((g) => g.status === "active").length
        });
    } catch (e) {
        console.error("weekly review error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load weekly review" });
    }
});

// ============================================================
// MONTHLY REVIEW
// ============================================================
router.get("/review/monthly", auth, async (req, res) => {
    try {
        const today = todayKeyFor(await userTz(req.userId));
        const mStart = startOfMonth(today);
        const days = eachDay(mStart, today);

        const snapshots = await ProgressSnapshot.find({ userId: req.userId, date: { $gte: mStart, $lte: today } });
        const goals = await Goal.find({ userId: req.userId });
        const journals = await JournalEntry.find({ userId: req.userId, date: { $gte: mStart, $lte: today } });

        const scored = snapshots.filter((s) => s.score !== null);
        const avg = scored.length ? Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length) : null;

        const completedGoals = goals.filter(
            (g) => g.status === "completed" && g.completedAt &&
            monthKey(g.completedAt.toISOString().slice(0, 10)) === monthKey(today)
        ).length;

        // weekly trend within month
        const weeks = [];
        let cursor = mStart;
        while (cursor <= today) {
            const wEnd = addDays(cursor, 6) > today ? today : addDays(cursor, 6);
            const wSnaps = snapshots.filter((s) => s.date >= cursor && s.date <= wEnd && s.score !== null);
            const wAvg = wSnaps.length ? Math.round(wSnaps.reduce((sum, s) => sum + s.score, 0) / wSnaps.length) : null;
            weeks.push({ start: cursor, avg: wAvg });
            cursor = addDays(cursor, 7);
        }

        // area performance
        const habits = await Habit.find({ userId: req.userId });
        const completions = await HabitCompletion.find({ userId: req.userId, date: { $gte: mStart, $lte: today } });
        const areas = await Area.find({ userId: req.userId, archived: false });

        const areaStats = areas.map((a) => {
            let sch = 0, dn = 0;
            for (const habit of habits) {
                if (habit.area !== a.key) continue;
                for (const d of days) {
                    if (!isHabitScheduledOn(habit, d)) continue;
                    sch += 1;
                    const done = completions.some((c) =>
                        c.habitId.toString() === habit._id.toString() &&
                        (habit.type === "numeric" ? (c.value || 0) >= habit.target : c.completed)
                    );
                    if (done) dn += 1;
                }
            }
            return { key: a.key, name: a.name, consistency: sch ? Math.round((dn / sch) * 100) : null };
        });

        const ranked = areaStats.filter((a) => a.consistency !== null).sort((a, b) => b.consistency - a.consistency);

        const bestDay = scored.reduce((b, s) => (!b || s.score > b.score ? s : b), null);

        res.json({
            success: true,
            monthStart: mStart,
            monthLabel: monthName(today),
            avgScore: avg,
            totalActions: scored.reduce((sum, s) => sum + s.actions, 0),
            reflections: journals.length,
            completedGoals,
            activeGoals: goals.filter((g) => g.status === "active").length,
            bestStreak: snapshots.reduce((m, s) => Math.max(m, s.bestStreak || 0), 0),
            bestDay: bestDay ? { date: bestDay.date, score: bestDay.score } : null,
            weeklyTrend: weeks,
            areaStats,
            strongestArea: ranked[0] || null,
            weakestArea: ranked[ranked.length - 1] || null,
            interpretation: buildMonthlyInterpretation({ avg, ranked, completedGoals })
        });
    } catch (e) {
        console.error("monthly review error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load monthly review" });
    }
});

function buildMonthlyInterpretation({ avg, ranked, completedGoals }) {
    const lines = [];
    if (avg === null) {
        lines.push("No scored days yet this month. Your story starts today.");
    } else if (avg >= 80) {
        lines.push(`Averaging ${avg}% — you're operating at a high standard. Protect the routine.`);
    } else if (avg >= 60) {
        lines.push(`Averaging ${avg}% — solid consistency with room to sharpen.`);
    } else if (avg >= 40) {
        lines.push(`Averaging ${avg}% — the foundation is there. Anchor one habit and build around it.`);
    } else {
        lines.push(`Averaging ${avg}% — start smaller. One habit, done daily, rebuilds momentum.`);
    }

    if (ranked.length > 0) {
        lines.push(`${ranked[0].name} is your strongest area (${ranked[0].consistency}%); ${ranked[ranked.length - 1].name} needs attention (${ranked[ranked.length - 1].consistency}%).`);
    }
    if (completedGoals > 0) {
        lines.push(`${completedGoals} goal${completedGoals > 1 ? "s" : ""} delivered this month.`);
    }
    return lines;
}

// ============================================================
// ANALYTICS
// ============================================================
router.get("/analytics", auth, async (req, res) => {
    try {
        const range = ["7", "30", "90", "365", "all"].includes(req.query.range) ? req.query.range : "30";
        const today = todayKeyFor(await userTz(req.userId));
        const from = range === "all" ? "0000-01-01" : addDays(today, -(Number(range) - 1));

        const snapshots = await ProgressSnapshot.find({
            userId: req.userId,
            date: { $gte: from, $lte: today }
        }).sort({ date: 1 });

        const journals = await JournalEntry.find({ userId: req.userId, date: { $gte: from, $lte: today } }).sort({ date: 1 });

        const scored = snapshots.filter((s) => s.score !== null);

        // series
        let series;
        if (range === "7" || range === "30") {
            series = snapshots.map((s) => ({ label: formatShort(s.date), value: s.score }));
        } else if (range === "90") {
            series = bucket(snapshots, 7);
        } else if (range === "365") {
            series = bucket(snapshots, 30);
        } else {
            series = bucket(snapshots, 90);
        }

        // mood trends
        const reflectionTrend = journals.map((j) => ({
            date: j.date,
            mood: j.mood,
            energy: j.energy,
            stress: j.stress,
            confidence: j.confidence
        }));

        const areaStats = await computeAreaStats(req.userId, from, today);
        const habitStats = await computeHabitStats(req.userId, from, today);

        const goals = await Goal.find({ userId: req.userId, status: "active" });
        const progressMap = await goalProgressMany(goals, req.userId);
        const goalProgress = goals.map((g) => ({
            id: g._id,
            title: g.title,
            area: g.area,
            progress: progressMap.get(g._id.toString()) || 0
        }));

        const avg = scored.length ? Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length) : null;

        res.json({
            success: true,
            range,
            series,
            avgScore: avg,
            totalActions: scored.reduce((sum, s) => sum + s.actions, 0),
            activeDays: scored.length,
            perfectDays: scored.filter((s) => s.score >= 100).length,
            reflectionTrend,
            areaStats,
            goalProgress,
            habitStats,
            bestDay: scored.reduce((b, s) => (!b || s.score > b.score ? s : b), null)
        });
    } catch (e) {
        console.error("analytics error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load analytics" });
    }
});

function bucket(snapshots, sizeDays) {
    const out = [];
    for (let i = 0; i < snapshots.length; i += sizeDays) {
        const chunk = snapshots.slice(i, i + sizeDays);
        const scoredChunk = chunk.filter((s) => s.score !== null);
        const avg = scoredChunk.length
            ? Math.round(scoredChunk.reduce((sum, s) => sum + s.score, 0) / scoredChunk.length)
            : null;
        out.push({ label: formatShort(chunk[0].date), value: avg });
    }
    return out;
}

async function computeAreaStats(userId, from, to) {
    const [habits, completions, areas] = await Promise.all([
        Habit.find({ userId }),
        HabitCompletion.find({ userId, date: { $gte: from, $lte: to } }),
        Area.find({ userId, archived: false })
    ]);

    const start = from === "0000-01-01"
        ? habits.reduce((m, h) => (h.startDate && h.startDate < m ? h.startDate : m), todayKey())
        : from;

    const days = eachDay(start, to);

    return areas.map((a) => {
        let sch = 0, dn = 0;
        for (const habit of habits) {
            if (habit.area !== a.key) continue;
            for (const d of days) {
                if (!isHabitScheduledOn(habit, d)) continue;
                sch += 1;
                const done = completions.some((c) =>
                    c.habitId.toString() === habit._id.toString() &&
                    (habit.type === "numeric" ? (c.value || 0) >= habit.target : c.completed)
                );
                if (done) dn += 1;
            }
        }
        return { key: a.key, name: a.name, consistency: sch ? Math.round((dn / sch) * 100) : null };
    });
}

async function computeHabitStats(userId, from, to) {
    const habits = await Habit.find({ userId });
    const completions = await HabitCompletion.find({ userId, date: { $gte: from, $lte: to } });
    const days = eachDay(from === "0000-01-01" ? (habits.reduce((m, h) => (h.startDate && h.startDate < m ? h.startDate : m), to)) : from, to);

    return habits
        .filter((h) => !h.archived)
        .map((h) => {
            let sch = 0, dn = 0;
            for (const d of days) {
                if (!isHabitScheduledOn(h, d)) continue;
                sch += 1;
                const done = completions.some((c) =>
                    c.habitId.toString() === h._id.toString() &&
                    (h.type === "numeric" ? (c.value || 0) >= h.target : c.completed)
                );
                if (done) dn += 1;
            }
            return {
                id: h._id,
                name: h.name,
                area: h.area,
                scheduled: sch,
                done: dn,
                rate: sch ? Math.round((dn / sch) * 100) : null
            };
        })
        .sort((a, b) => (b.rate || 0) - (a.rate || 0));
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
router.get("/achievements", auth, async (req, res) => {
    try {
        const earned = await UserAchievement.find({ userId: req.userId }).sort({ earnedAt: 1 });
        const earnedMap = {};
        for (const a of earned) earnedMap[a.code] = a.earnedAt;

        const list = ACHIEVEMENTS.map((def) => ({
            code: def.code,
            name: def.name,
            description: def.description,
            how: def.how,
            earnedAt: earnedMap[def.code] || null,
            earned: !!earnedMap[def.code]
        }));

        res.json({
            success: true,
            achievements: list,
            earnedCount: earned.length,
            totalCount: ACHIEVEMENTS.length
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load achievements" });
    }
});

// ============================================================
// NOTIFICATIONS
// ============================================================
router.get("/notifications", auth, async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(30);
        const unread = notifications.filter((n) => !n.read).length;
        res.json({ success: true, notifications, unread });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load notifications" });
    }
});

router.post("/notifications/read", auth, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.userId, read: false }, { read: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to update notifications" });
    }
});

// ============================================================
// SETTINGS
// ============================================================
router.get("/settings", auth, async (req, res) => {
    try {
        let settings = await Settings.findOne({ userId: req.userId });
        if (!settings) settings = await Settings.create({ userId: req.userId });
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load settings" });
    }
});

router.patch("/settings", auth, async (req, res) => {
    try {
        let settings = await Settings.findOne({ userId: req.userId });
        if (!settings) settings = await Settings.create({ userId: req.userId });

        const sections = ["notifications", "appearance", "privacy", "account"];
        for (const section of sections) {
            if (req.body[section] && typeof req.body[section] === "object") {
                for (const [key, value] of Object.entries(req.body[section])) {
                    if (settings[section][key] !== undefined) {
                        settings[section][key] = !!value;
                    }
                }
            }
        }
        if (req.body.notifications && req.body.notifications.dailyReminderTime) {
            settings.notifications.dailyReminderTime = String(req.body.notifications.dailyReminderTime).slice(0, 5);
        }

        await settings.save();
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to save settings" });
    }
});

// ============================================================
// DATA: EXPORT / RESET / DELETE
// ============================================================
router.get("/export", auth, async (req, res) => {
    try {
        const [user, settings, areas, habits, completions, tasks, goals, journals, snapshots, achievements] = await Promise.all([
            User.findById(req.userId).select("-password -__v"),
            Settings.find({ userId: req.userId }).select("-__v"),
            Area.find({ userId: req.userId }).select("-__v"),
            Habit.find({ userId: req.userId }).select("-__v"),
            HabitCompletion.find({ userId: req.userId }).select("-__v"),
            Task.find({ userId: req.userId }).select("-__v"),
            Goal.find({ userId: req.userId }).select("-__v"),
            JournalEntry.find({ userId: req.userId }).select("-__v"),
            ProgressSnapshot.find({ userId: req.userId }).select("-__v"),
            UserAchievement.find({ userId: req.userId }).select("-__v")
        ]);

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="ascend-export-${todayKey()}.json"`);
        res.json({
            app: "ASCEND",
            exportedAt: new Date().toISOString(),
            user,
            settings,
            areas,
            habits,
            completions,
            tasks,
            goals,
            journals,
            snapshots,
            achievements
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Export failed" });
    }
});

router.post("/reset", auth, async (req, res) => {
    try {
        // destructive — require explicit confirmation flag from the client
        if (req.body.confirm !== "RESET") {
            return res.status(400).json({ success: false, message: "Missing confirmation" });
        }
        await Promise.all([
            Habit.deleteMany({ userId: req.userId }),
            HabitCompletion.deleteMany({ userId: req.userId }),
            Task.deleteMany({ userId: req.userId }),
            Goal.deleteMany({ userId: req.userId }),
            JournalEntry.deleteMany({ userId: req.userId }),
            ProgressSnapshot.deleteMany({ userId: req.userId }),
            UserAchievement.deleteMany({ userId: req.userId }),
            Notification.deleteMany({ userId: req.userId })
        ]);
        await User.updateOne({ _id: req.userId }, { $set: { xp: 0, onboarded: false } });
        res.json({ success: true, message: "All progress cleared. Fresh start." });
    } catch (e) {
        res.status(500).json({ success: false, message: "Reset failed" });
    }
});

router.post("/delete-account", auth, async (req, res) => {
    try {
        // destructive — require explicit confirmation flag from the client
        if (req.body.confirm !== "DELETE") {
            return res.status(400).json({ success: false, message: "Missing confirmation" });
        }
        const uid = req.userId;
        await Promise.all([
            Habit.deleteMany({ userId: uid }),
            HabitCompletion.deleteMany({ userId: uid }),
            Task.deleteMany({ userId: uid }),
            Goal.deleteMany({ userId: uid }),
            JournalEntry.deleteMany({ userId: uid }),
            ProgressSnapshot.deleteMany({ userId: uid }),
            UserAchievement.deleteMany({ userId: uid }),
            Notification.deleteMany({ userId: uid }),
            Settings.deleteMany({ userId: uid }),
            Area.deleteMany({ userId: uid })
        ]);
        await User.findByIdAndDelete(uid);
        res.clearCookie("token");
        res.json({ success: true, message: "Account deleted" });
    } catch (e) {
        res.status(500).json({ success: false, message: "Account deletion failed" });
    }
});

// ============================================================
// DEMO DATA — strictly development-only.
// Registered ONLY when NODE_ENV !== "production". In production this
// endpoint does not exist at all (404 via the API-wide handler).
// ============================================================
if (process.env.NODE_ENV !== "production") {
    router.post("/seed-demo", auth, async (req, res) => {
        try {
            const { seedDemoData } = require("../utils/engine");
            const result = await seedDemoData(req.userId);
            res.json({ success: true, message: "Demo data generated", result });
        } catch (e) {
            console.error("seed error:", e.message);
            res.status(500).json({ success: false, message: "Seeding failed" });
        }
    });
}

module.exports = router;
