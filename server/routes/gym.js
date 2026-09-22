const express = require("express");

const auth = require("../middleware/auth");
const { todayKeyFor, isValidDateKey, dayOfWeek, addDays, startOfWeek, eachDay } = require("../utils/date");
const User = require("../models/User");
const { Workout, WeeklyPlan, WorkoutSession, DAY_KEYS, EXERCISE_TYPES } = require("../models/Gym");

const router = express.Router();

// JS getDay(): 0=Sunday ... 6=Saturday -> our mon..sun keys
const DOW_TO_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function validIdOr400(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id || ""));
}

const TZ_CACHE = new Map();
const TZ_TTL_MS = 30 * 1000;
async function userTzOffset(userId) {
    const hit = TZ_CACHE.get(userId);
    if (hit && Date.now() - hit.at < TZ_TTL_MS) return hit.tz;
    const u = await User.findById(userId).select("timezoneOffset").lean();
    const tz = (u && u.timezoneOffset) || 0;
    TZ_CACHE.set(userId, { tz, at: Date.now() });
    return tz;
}

// ---------- helpers ----------

function normalizeKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function exerciseDetail(ex) {
    if (ex.type === "duration") {
        const per = ex.durationSec >= 60 ? `${Math.round(ex.durationSec / 60)} min` : `${ex.durationSec} sec`;
        return ex.sets > 1 ? `${ex.sets} × ${per}` : per;
    }
    return `${ex.sets} × ${ex.reps ?? "?"}`;
}

function validateExercises(raw) {
    if (!Array.isArray(raw)) return { error: "exercises must be an array" };
    if (raw.length > 40) return { error: "A workout can have at most 40 exercises" };
    const out = [];
    for (const e of raw) {
        const name = String((e && e.name) || "").trim().slice(0, 80);
        if (!name) return { error: "Every exercise needs a name" };
        const type = EXERCISE_TYPES.includes(e.type) ? e.type : "reps";
        const sets = Math.min(30, Math.max(1, Math.round(Number(e.sets) || 1)));
        const item = { name, type, sets, notes: String(e.notes || "").slice(0, 200) };

        if (type === "duration") {
            const sec = Math.round(Number(e.durationSec));
            if (!Number.isFinite(sec) || sec < 1 || sec > 14400) {
                return { error: `"${name}": duration must be 1 second – 4 hours` };
            }
            item.durationSec = sec;
            item.reps = null;
        } else {
            const reps = Math.round(Number(e.reps));
            if (!Number.isFinite(reps) || reps < 1 || reps > 1000) {
                return { error: `"${name}": reps must be 1–1000` };
            }
            item.reps = reps;
            item.durationSec = null;
        }
        if (e.restSec !== undefined && e.restSec !== null && e.restSec !== "") {
            const rest = Math.round(Number(e.restSec));
            if (!Number.isFinite(rest) || rest < 0 || rest > 1200) return { error: `"${name}": invalid rest time` };
            item.restSec = rest;
        }
        if (e.weightKg !== undefined && e.weightKg !== null && e.weightKg !== "") {
            const w = Number(e.weightKg);
            if (!Number.isFinite(w) || w < 0 || w > 1000) return { error: `"${name}": invalid target weight` };
            item.weightKg = w;
        }
        out.push(item);
    }
    return { exercises: out };
}

function progressOf(sessionOrExercises) {
    const exercises = Array.isArray(sessionOrExercises) ? sessionOrExercises : sessionOrExercises.exercises;
    const total = exercises.length;
    const done = exercises.filter((x) => x.done).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function sessionView(s) {
    const p = progressOf(s);
    return {
        _id: s._id,
        date: s.date,
        workoutId: s.workoutId,
        workoutName: s.workoutName,
        exercises: s.exercises.map((x) => ({ key: x.key, name: x.name, detail: x.detail, done: x.done })),
        done: p.done,
        total: p.total,
        pct: p.pct,
        completed: p.total > 0 && p.done === p.total,
        completedAt: s.completedAt || null
    };
}

function workoutView(w) {
    return {
        _id: w._id,
        name: w.name,
        notes: w.notes || "",
        exercises: (w.exercises || []).map((ex) => ({
            name: ex.name,
            type: ex.type,
            sets: ex.sets,
            reps: ex.reps,
            durationSec: ex.durationSec,
            restSec: ex.restSec ?? null,
            weightKg: ex.weightKg ?? null,
            notes: ex.notes || "",
            detail: exerciseDetail(ex)
        }))
    };
}

function snapshotExercises(workout) {
    return (workout.exercises || []).map((ex) => ({
        key: normalizeKey(ex.name),
        name: ex.name,
        detail: exerciseDetail(ex),
        done: false,
        doneAt: null
    }));
}

async function getOrCreatePlan(userId) {
    // Atomic upsert: concurrent first loads (double-mount, two tabs) must not
    // race findOne->create into a duplicate-key error on the unique index.
    return WeeklyPlan.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, days: {} } },
        { upsert: true, new: true }
    );
}

// The workout scheduled on a given date for this user (or null = rest day).
async function scheduledWorkout(userId, dateKey) {
    const plan = await getOrCreatePlan(userId);
    const key = DOW_TO_KEY[dayOfWeek(dateKey)];
    const entry = plan.days.get(key);
    if (!entry || !entry.workoutId) return { plan, key, workout: null };
    const workout = await Workout.findOne({ _id: entry.workoutId, userId });
    return { plan, key, workout: workout || null }; // deleted workout -> rest day
}

// Find or create the per-date session, snapshotting the workout at first check-in.
async function ensureSession(userId, dateKey, workout) {
    let s = await WorkoutSession.findOne({ userId, date: dateKey });
    if (s) return s;
    return WorkoutSession.create({
        userId,
        date: dateKey,
        workoutId: workout._id,
        workoutName: workout.name,
        exercises: snapshotExercises(workout)
    });
}

// ============================================================
// TODAY
// ============================================================
router.get("/today", auth, async (req, res) => {
    try {
        const tz = await userTzOffset(req.userId);
        const date = todayKeyFor(tz);
        const weekdayKey = DOW_TO_KEY[dayOfWeek(date)];

        const { workout } = await scheduledWorkout(req.userId, date);
        if (!workout) {
            return res.json({
                success: true,
                date,
                weekdayKey,
                restDay: true,
                workout: null,
                session: null,
                progress: { done: 0, total: 0, pct: 0 }
            });
        }

        const existing = await WorkoutSession.findOne({ userId: req.userId, date });
        // View-only until the first check-in — no document is created just by visiting.
        const p = existing
            ? progressOf(existing)
            : { done: 0, total: workout.exercises.length, pct: 0 };

        res.json({
            success: true,
            date,
            weekdayKey,
            restDay: false,
            workout: workoutView(workout),
            session: existing ? sessionView(existing) : null,
            progress: p
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load today's workout" });
    }
});

// ============================================================
// WEEKLY PLAN + WEEK OVERVIEW
// ============================================================
router.get("/plan", auth, async (req, res) => {
    try {
        const plan = await getOrCreatePlan(req.userId);
        const workouts = await Workout.find({ userId: req.userId }).sort({ updatedAt: -1 });
        res.json({
            success: true,
            plan: { days: Object.fromEntries(plan.days) },
            workouts: workouts.map(workoutView)
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load plan" });
    }
});

router.put("/plan", auth, async (req, res) => {
    try {
        const days = req.body.days;
        if (!days || typeof days !== "object" || Array.isArray(days)) {
            return res.status(400).json({ success: false, message: "days object is required" });
        }
        for (const key of Object.keys(days)) {
            if (!DAY_KEYS.includes(key)) {
                return res.status(400).json({ success: false, message: `Invalid weekday: ${key}` });
            }
        }

        // Collect referenced workout ids and verify each belongs to this user.
        const ids = [...new Set(Object.values(days).filter(Boolean).map(String))];
        for (const id of ids) {
            if (!validIdOr400(id)) return res.status(400).json({ success: false, message: "Invalid workout id" });
        }
        if (ids.length) {
            const owned = await Workout.countDocuments({ _id: { $in: ids }, userId: req.userId });
            if (owned !== ids.length) {
                return res.status(404).json({ success: false, message: "One or more workouts were not found" });
            }
        }

        const plan = await getOrCreatePlan(req.userId);
        const next = {};
        for (const key of DAY_KEYS) next[key] = days[key] ? { workoutId: days[key] } : { workoutId: null };
        plan.days = next;
        await plan.save();
        res.json({ success: true, plan: { days: Object.fromEntries(plan.days) } });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to save plan" });
    }
});

// Week overview: plan + completion for each day of the week containing `start`.
router.get("/week", auth, async (req, res) => {
    try {
        const tz = await userTzOffset(req.userId);
        const anchor = isValidDateKey(req.query.start) ? req.query.start : todayKeyFor(tz);
        const start = startOfWeek(anchor);
        const dates = eachDay(start, addDays(start, 6));

        const plan = await getOrCreatePlan(req.userId);
        const sessions = await WorkoutSession.find({ userId: req.userId, date: { $in: dates } });
        const byDate = new Map(sessions.map((s) => [s.date, s]));

        // Resolve referenced workouts once.
        const wIds = [...new Set(dates.map((d) => {
            const entry = plan.days.get(DOW_TO_KEY[dayOfWeek(d)]);
            return entry && entry.workoutId ? String(entry.workoutId) : null;
        }).filter(Boolean))];
        const workouts = wIds.length
            ? await Workout.find({ _id: { $in: wIds }, userId: req.userId }).select("name")
            : [];
        const wNames = new Map(workouts.map((w) => [String(w._id), w.name]));

        const days = dates.map((date) => {
            const entry = plan.days.get(DOW_TO_KEY[dayOfWeek(date)]);
            const workoutId = entry && entry.workoutId ? String(entry.workoutId) : null;
            const s = byDate.get(date);
            const p = s ? progressOf(s) : null;
            return {
                date,
                weekdayKey: DOW_TO_KEY[dayOfWeek(date)],
                restDay: !workoutId,
                workoutName: workoutId ? (wNames.get(workoutId) || null) : null,
                scheduled: !!workoutId,
                done: p ? p.done : 0,
                total: p ? p.total : 0,
                pct: p ? p.pct : null, // null = not started
                completed: s ? p.total > 0 && p.done === p.total : false,
                isToday: date === todayKeyFor(tz)
            };
        });

        res.json({ success: true, start, days });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load week" });
    }
});

// ============================================================
// WORKOUTS (CRUD)
// ============================================================
router.get("/workouts", auth, async (req, res) => {
    try {
        const workouts = await Workout.find({ userId: req.userId }).sort({ updatedAt: -1 });
        res.json({ success: true, workouts: workouts.map(workoutView) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load workouts" });
    }
});

router.post("/workouts", auth, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim().slice(0, 60);
        if (!name) return res.status(400).json({ success: false, message: "Workout name is required" });
        const v = validateExercises(req.body.exercises);
        if (v.error) return res.status(400).json({ success: false, message: v.error });

        const workout = await Workout.create({
            userId: req.userId,
            name,
            notes: String(req.body.notes || "").slice(0, 500),
            exercises: v.exercises
        });
        res.status(201).json({ success: true, workout: workoutView(workout) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to create workout" });
    }
});

router.patch("/workouts/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const workout = await Workout.findOne({ _id: req.params.id, userId: req.userId });
        if (!workout) return res.status(404).json({ success: false, message: "Workout not found" });

        if (req.body.name !== undefined) {
            const name = String(req.body.name).trim().slice(0, 60);
            if (!name) return res.status(400).json({ success: false, message: "Workout name cannot be empty" });
            workout.name = name;
        }
        if (req.body.notes !== undefined) workout.notes = String(req.body.notes).slice(0, 500);
        if (req.body.exercises !== undefined) {
            const v = validateExercises(req.body.exercises);
            if (v.error) return res.status(400).json({ success: false, message: v.error });
            workout.exercises = v.exercises;
        }
        await workout.save();
        res.json({ success: true, workout: workoutView(workout) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to update workout" });
    }
});

router.delete("/workouts/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const workout = await Workout.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!workout) return res.status(404).json({ success: false, message: "Workout not found" });

        // Clear plan references (those days become rest days).
        const plan = await WeeklyPlan.findOne({ userId: req.userId });
        if (plan) {
            let changed = false;
            for (const key of plan.days.keys()) {
                const entry = plan.days.get(key);
                if (entry && entry.workoutId && String(entry.workoutId) === String(workout._id)) {
                    plan.days.set(key, { workoutId: null });
                    changed = true;
                }
            }
            if (changed) await plan.save();
        }

        // Sessions keep their snapshot (history stays truthful) — only the
        // dangling workoutId reference is nulled.
        await WorkoutSession.updateMany(
            { userId: req.userId, workoutId: workout._id },
            { $set: { workoutId: null } }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to delete workout" });
    }
});

// ============================================================
// SESSIONS — check/uncheck + per-day view
// ============================================================
router.get("/sessions/:date", auth, async (req, res) => {
    try {
        const date = req.params.date;
        if (!isValidDateKey(date)) return res.status(400).json({ success: false, message: "Invalid date" });

        const { workout } = await scheduledWorkout(req.userId, date);
        const existing = await WorkoutSession.findOne({ userId: req.userId, date });

        if (!workout) {
            return res.json({
                success: true, date, restDay: true,
                workout: null,
                session: existing ? sessionView(existing) : null, // orphaned snapshot (workout deleted)
                progress: existing ? progressOf(existing) : { done: 0, total: 0, pct: 0 }
            });
        }
        const p = existing ? progressOf(existing) : { done: 0, total: workout.exercises.length, pct: 0 };
        res.json({
            success: true, date, restDay: false,
            workout: workoutView(workout),
            session: existing ? sessionView(existing) : null,
            progress: p
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load workout day" });
    }
});

// Toggle one exercise for a date. Creates the session snapshot on first check-in.
router.post("/sessions/:date/toggle", auth, async (req, res) => {
    try {
        const date = req.params.date;
        if (!isValidDateKey(date)) return res.status(400).json({ success: false, message: "Invalid date" });
        const key = normalizeKey(req.body.key);
        if (!key) return res.status(400).json({ success: false, message: "Exercise key is required" });

        const { workout } = await scheduledWorkout(req.userId, date);
        if (!workout) {
            return res.status(400).json({ success: false, message: "Rest day — nothing to check off", code: "REST_DAY" });
        }

        const session = await ensureSession(req.userId, date, workout);
        const ex = session.exercises.find((x) => x.key === key);
        if (!ex) return res.status(404).json({ success: false, message: "Exercise not found in this workout" });

        ex.done = !ex.done;
        ex.doneAt = ex.done ? new Date() : null;

        const p = progressOf(session);
        session.completedAt = p.total > 0 && p.done === p.total ? new Date() : null;
        await session.save();

        res.json({ success: true, session: sessionView(session) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to update exercise" });
    }
});

// Re-sync an existing session with the current workout definition
// (after the user edits a workout mid-day). Preserves done state for
// exercises that still exist; removes ones that were deleted.
router.post("/sessions/:date/refresh", auth, async (req, res) => {
    try {
        const date = req.params.date;
        if (!isValidDateKey(date)) return res.status(400).json({ success: false, message: "Invalid date" });

        const session = await WorkoutSession.findOne({ userId: req.userId, date });
        if (!session) return res.status(404).json({ success: false, message: "No workout started for this date" });

        const { workout } = await scheduledWorkout(req.userId, date);
        if (!workout) return res.status(400).json({ success: false, message: "Rest day — nothing to refresh", code: "REST_DAY" });

        const prev = new Map(session.exercises.map((x) => [x.key, x]));
        session.workoutId = workout._id;
        session.workoutName = workout.name;
        session.exercises = snapshotExercises(workout).map((x) => {
            const before = prev.get(x.key);
            if (before) { x.done = before.done; x.doneAt = before.doneAt; }
            return x;
        });
        const p = progressOf(session);
        session.completedAt = p.total > 0 && p.done === p.total ? new Date() : null;
        await session.save();

        res.json({ success: true, session: sessionView(session) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to refresh workout" });
    }
});

// ============================================================
// HISTORY
// ============================================================
router.get("/history", auth, async (req, res) => {
    try {
        const limit = Math.min(90, Math.max(1, Math.round(Number(req.query.limit) || 30)));
        const sessions = await WorkoutSession.find({ userId: req.userId })
            .sort({ date: -1 })
            .limit(limit);
        res.json({
            success: true,
            sessions: sessions.map((s) => {
                const v = sessionView(s);
                return {
                    date: v.date,
                    workoutName: v.workoutName,
                    done: v.done,
                    total: v.total,
                    pct: v.pct,
                    completed: v.completed,
                    completedAt: v.completedAt,
                    exercises: v.exercises
                };
            })
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load history" });
    }
});

module.exports = router;
