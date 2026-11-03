const express = require("express");

const auth = require("../middleware/auth");
const { todayKeyFor, isValidDateKey, dayOfWeek, startOfWeek, eachDay, addDays } = require("../utils/date");
const User = require("../models/User");
const { Workout, WorkoutSession, PlanSession, SetLog } = require("../models/Gym");
const plan = require("../plan/fixedPlan");

const router = express.Router();

// JS getDay(): 0=Sunday ... 6=Saturday -> mon..sun keys (weekday labels only)
const DOW_TO_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ============================================================
// THE PLAN IS FIXED — builder endpoints are locked.
//
// The old workout-builder API (create/edit/delete workouts, edit the
// weekly plan, toggle exercise snapshots) is replaced by the canonical
// plan in plan/fixedPlan.js. These handlers stay registered so stale
// clients get a clear, honest error instead of a silent 404 — they can
// never modify the plan. GET endpoints that still serve historical
// data remain read-only.
// ============================================================
function planFixed(req, res) {
    res.status(403).json({
        success: false,
        code: "PLAN_FIXED",
        message: "The workout plan is fixed and cannot be changed."
    });
}

function legacyFlowGone(req, res) {
    res.status(410).json({
        success: false,
        code: "PLAN_FIXED",
        message: "The workout builder was replaced by the fixed 7-day tracker."
    });
}

router.put("/plan", auth, planFixed);
router.post("/workouts", auth, planFixed);
router.patch("/workouts/:id", auth, planFixed);
router.delete("/workouts/:id", auth, planFixed);
router.post("/sessions/:date/toggle", auth, legacyFlowGone);
router.post("/sessions/:date/refresh", auth, legacyFlowGone);

// ---------- helpers ----------

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

// Resolve which date a request is about. Explicit date keys (validated)
// win; otherwise fall back to the user's timezone "today" (legacy calls
// such as the Dashboard's /gym/today).
async function resolveDate(req, fromParams = true) {
    const raw = (fromParams ? req.params.date : null) || req.query.date;
    if (raw !== undefined && raw !== null && raw !== "") {
        if (!isValidDateKey(raw)) return { error: "Invalid date" };
        return { date: raw };
    }
    const tz = await userTzOffset(req.userId);
    return { date: todayKeyFor(tz) };
}

// Optional numeric field: empty (undefined/null/"") is always allowed and
// stores null; provided values must be finite numbers inside range.
// Booleans/arrays/objects are rejected outright.
function parseNumber(raw, { min, max, integer = false, label }) {
    if (raw === undefined || raw === null || raw === "") return { value: null };
    if (typeof raw !== "number" && typeof raw !== "string") {
        return { error: `${label} must be a number` };
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `${label} must be a number` };
    if (integer && !Number.isInteger(n)) return { error: `${label} must be a whole number` };
    if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}` };
    return { value: n };
}

function parseBoolean(raw, label) {
    if (raw === undefined) return { value: undefined };
    if (typeof raw !== "boolean") return { error: `${label} must be true or false` };
    return { value: raw };
}

// Create-on-write session meta (reads never create documents).
async function ensurePlanSession(userId, date, planDay) {
    try {
        return await PlanSession.create({ userId, date, planDay });
    } catch (e) {
        if (e && e.code === 11000) {
            // Concurrent first write (rapid taps / two tabs) — unique index did its job.
            return PlanSession.findOne({ userId, date });
        }
        throw e;
    }
}

async function storedChoices(userId, date, day) {
    const ps = await PlanSession.findOne({ userId, date }).select("choices");
    const raw = ps && ps.choices ? Object.fromEntries(ps.choices) : {};
    return plan.normalizeChoices(day, raw);
}

// Idempotent upsert of one set log. Re-sending the same payload is a
// no-op update on the same unique (user, date, exercise, set) document.
async function upsertSetLog(userId, date, planDay, exId, setNo, fields) {
    const filter = { userId, date, exId, setNo };
    try {
        return await SetLog.findOneAndUpdate(
            filter,
            { $set: { planDay, ...fields } },
            { upsert: true, new: true, runValidators: true }
        );
    } catch (e) {
        if (e && e.code === 11000) {
            // Lost an upsert race — the doc exists now; apply as a plain update.
            await SetLog.updateOne(filter, { $set: { planDay, ...fields } }, { runValidators: true });
            return SetLog.findOne(filter);
        }
        throw e;
    }
}

// Session completion state — recomputed from this date's logs only.
// Never touches the template, never touches other dates.
async function refreshCompletion(userId, date, day, choices) {
    const resolved = plan.resolveExercises(day, choices);
    const total = plan.totalSets(day, choices);
    let done = 0;
    if (total > 0) {
        done = await SetLog.countDocuments({
            userId,
            date,
            completed: true,
            exId: { $in: resolved.map((e) => e.id) }
        });
    }
    let allDone = total > 0 && done === total;
    if (total === 0 && day.cardio && day.cardio.loggable) {
        const ps = await PlanSession.findOne({ userId, date }).select("cardio.completed");
        allDone = !!(ps && ps.cardio && ps.cardio.completed);
    }
    await PlanSession.updateOne({ userId, date }, { $set: { completedAt: allDone ? new Date() : null } });
    return { done, total, pct: total ? Math.round((done / total) * 100) : (allDone ? 100 : 0) };
}

function sessionView(ps, day, progress) {
    const cardio = (ps && ps.cardio) || {};
    return {
        date: ps ? ps.date : null,
        planDay: day.day,
        workoutName: plan.displayTitle(day),
        choices: ps && ps.choices ? Object.fromEntries(ps.choices) : plan.defaultChoices(day),
        cardio: {
            distanceKm: cardio.distanceKm ?? null,
            durationMin: cardio.durationMin ?? null,
            notes: cardio.notes || "",
            completed: !!cardio.completed,
            loggedAt: cardio.loggedAt || null
        },
        completed: !!(ps && ps.completedAt),
        completedAt: (ps && ps.completedAt) || null
    };
}

// Full day payload shared by GET /today, GET /sessions/:date and the
// write endpoints' responses (so the client always reconciles from truth).
async function buildDayPayload(userId, date) {
    const dayNum = plan.planDayForDate(date);
    const day = plan.getDay(dayNum);
    const weekdayKey = DOW_TO_KEY[dayOfWeek(date)];

    if (day.rest) {
        const legacy = await WorkoutSession.findOne({ userId, date })
            .select("workoutName exercises completedAt")
            .lean();
        return {
            success: true,
            date,
            weekdayKey,
            dayNumber: dayNum,
            restDay: true,
            day: plan.dayView(day, {}),
            workout: null,
            session: null,
            progress: { done: 0, total: 0, pct: 0 },
            previous: { sets: {}, cardio: null },
            legacy: legacy ? legacySummary(legacy) : null
        };
    }

    const ps = await PlanSession.findOne({ userId, date });
    const choices = plan.normalizeChoices(day, ps && ps.choices ? Object.fromEntries(ps.choices) : {});
    const dayInfo = plan.dayView(day, choices);

    const logs = await SetLog.find({ userId, date });
    const logMap = new Map(logs.map((l) => [`${l.exId}#${l.setNo}`, l]));

    let done = 0;
    dayInfo.exercises = dayInfo.exercises.map((ex) => {
        const entries = [];
        for (let n = 1; n <= ex.sets; n += 1) {
            const l = logMap.get(`${ex.id}#${n}`);
            const completed = !!(l && l.completed);
            if (completed) done += 1;
            entries.push({
                setNo: n,
                weightKg: l ? l.weightKg : null,
                reps: l ? l.reps : null,
                durationSec: l ? l.durationSec : null,
                completed
            });
        }
        return { ...ex, entries };
    });

    const total = dayInfo.totalSets;
    const cardioDone = !!(ps && ps.cardio && ps.cardio.completed);
    const pct = total ? Math.round((done / total) * 100) : (cardioDone ? 100 : 0);

    // Previous-session reference: same fixed day, earlier dates only.
    const prevLogs = await SetLog.find({
        userId,
        planDay: dayNum,
        date: { $lt: date },
        exId: { $in: dayInfo.exercises.map((e) => e.id) }
    }).sort({ date: -1 }).limit(400);
    const prevSets = {};
    for (const l of prevLogs) {
        const k = `${l.exId}#${l.setNo}`;
        if (!prevSets[k]) {
            prevSets[k] = {
                date: l.date,
                weightKg: l.weightKg,
                reps: l.reps,
                durationSec: l.durationSec,
                completed: l.completed
            };
        }
    }
    let prevCardio = null;
    const prevSessions = await PlanSession.find({ userId, planDay: dayNum, date: { $lt: date } })
        .sort({ date: -1 })
        .limit(6)
        .select("date cardio");
    for (const s of prevSessions) {
        const c = s.cardio || {};
        if (c.distanceKm != null || c.durationMin != null || c.completed) {
            prevCardio = { date: s.date, distanceKm: c.distanceKm ?? null, durationMin: c.durationMin ?? null, completed: !!c.completed };
            break;
        }
    }

    const legacy = await WorkoutSession.findOne({ userId, date })
        .select("workoutName exercises completedAt")
        .lean();

    const progress = { done, total, pct };
    return {
        success: true,
        date,
        weekdayKey,
        dayNumber: dayNum,
        restDay: false,
        day: dayInfo,
        workout: { _id: null, name: plan.displayTitle(day) },
        session: sessionView(ps, day, progress),
        progress,
        previous: { sets: prevSets, cardio: prevCardio },
        legacy: legacy ? legacySummary(legacy) : null
    };
}

// Legacy builder-era session, kept as read-only historical context.
function legacySummary(s) {
    const exercises = Array.isArray(s.exercises) ? s.exercises : [];
    const total = exercises.length;
    const done = exercises.filter((x) => x.done).length;
    return {
        legacy: true,
        date: s.date,
        workoutName: s.workoutName,
        done,
        total,
        pct: total ? Math.round((done / total) * 100) : 0,
        completed: !!(s.completedAt),
        completedAt: s.completedAt || null
    };
}

// ============================================================
// CANONICAL PLAN (read-only)
// ============================================================
router.get("/plan", auth, async (req, res) => {
    try {
        res.json({ success: true, plan: plan.publicPlan() });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load the workout plan" });
    }
});

// ============================================================
// TODAY / DAY VIEW
// ============================================================
router.get("/today", auth, async (req, res) => {
    try {
        const r = await resolveDate(req, false);
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        res.json(await buildDayPayload(req.userId, r.date));
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load today's workout" });
    }
});

router.get("/sessions/:date", auth, async (req, res) => {
    try {
        const r = await resolveDate(req, true);
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        res.json(await buildDayPayload(req.userId, r.date));
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load that workout day" });
    }
});

// ============================================================
// WEEK OVERVIEW — fixed day per date, set progress per date.
// ============================================================
router.get("/week", auth, async (req, res) => {
    try {
        const tz = await userTzOffset(req.userId);
        const anchor = isValidDateKey(req.query.start) ? req.query.start : todayKeyFor(tz);
        const today = isValidDateKey(req.query.today) ? req.query.today : todayKeyFor(tz);
        const start = startOfWeek(anchor);
        const dates = eachDay(start, addDays(start, 6));

        const [logs, sessions] = await Promise.all([
            SetLog.find({ userId: req.userId, date: { $in: dates }, completed: true })
                .select("date exId"),
            PlanSession.find({ userId: req.userId, date: { $in: dates } })
                .select("date planDay choices cardio completedAt")
        ]);
        const sessionsByDate = new Map(sessions.map((s) => [s.date, s]));

        const days = dates.map((date) => {
            const dayNum = plan.planDayForDate(date);
            const day = plan.getDay(dayNum);
            const ps = sessionsByDate.get(date);
            const choices = plan.normalizeChoices(day, ps && ps.choices ? Object.fromEntries(ps.choices) : {});
            const total = plan.totalSets(day, choices);
            const ids = new Set(plan.resolveExercises(day, choices).map((e) => e.id));
            const done = logs.filter((l) => l.date === date && ids.has(l.exId)).length;
            const cardioDone = !!(ps && ps.cardio && ps.cardio.completed);
            return {
                date,
                weekdayKey: DOW_TO_KEY[dayOfWeek(date)],
                dayNumber: dayNum,
                title: day.title,
                workoutName: plan.displayTitle(day),
                restDay: day.rest,
                scheduled: true,
                done,
                total,
                pct: total ? Math.round((done / total) * 100) : (cardioDone ? 100 : null),
                completed: ps ? !!ps.completedAt : false,
                cardioDone,
                isToday: date === today
            };
        });

        res.json({ success: true, start, days });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load week" });
    }
});

// ============================================================
// SESSION WRITES — per-set logging (idempotent, ownership-scoped)
// ============================================================
router.post("/sessions/:date/set", auth, async (req, res) => {
    try {
        const r = await resolveDate(req, true);
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        const date = r.date;

        const dayNum = plan.planDayForDate(date);
        const day = plan.getDay(dayNum);
        if (day.rest) {
            return res.status(400).json({ success: false, code: "REST_DAY", message: "Rest day — nothing to log." });
        }

        const body = req.body || {};
        const exId = typeof body.exId === "string" ? body.exId.trim() : "";
        if (!exId || exId.length > 64) {
            return res.status(400).json({ success: false, message: "A valid exercise id is required" });
        }
        const setNo = Number(body.setNo);
        if (!Number.isInteger(setNo) || setNo < 1 || setNo > 30) {
            return res.status(400).json({ success: false, message: "setNo must be a positive whole number" });
        }

        // Resolve the exercise from the CANONICAL plan for this date.
        // Crafted payloads can only ever reference real prescribed sets.
        const choices = await storedChoices(req.userId, date, day);
        const resolved = plan.resolveExercises(day, choices);
        const ex = plan.findExercise(resolved, exId);
        if (!ex) {
            return res.status(400).json({
                success: false,
                message: "That exercise is not part of this day's fixed plan"
            });
        }
        if (setNo > ex.sets) {
            return res.status(400).json({
                success: false,
                message: `${ex.name} prescribes ${ex.sets} set${ex.sets === 1 ? "" : "s"}`
            });
        }

        const fields = {};
        const completed = parseBoolean(body.completed, "completed");
        if (completed.error) return res.status(400).json({ success: false, message: completed.error });
        if (completed.value !== undefined) {
            fields.completed = completed.value;
            fields.completedAt = completed.value ? new Date() : null;
        }

        if (ex.metric === "duration") {
            const d = parseNumber(body.durationSec, { min: 1, max: 7200, integer: true, label: "duration (seconds)" });
            if (d.error) return res.status(400).json({ success: false, message: d.error });
            fields.durationSec = d.value;
            fields.reps = null;
            fields.weightKg = null; // bodyweight/duration exercises never require weight
        } else {
            const rep = parseNumber(body.reps, { min: 1, max: 999, integer: true, label: "reps" });
            if (rep.error) return res.status(400).json({ success: false, message: rep.error });
            fields.reps = rep.value;
            fields.durationSec = null;
            if (ex.bodyweight) {
                fields.weightKg = null;
            } else {
                const w = parseNumber(body.weightKg, { min: 0, max: 1000, label: "weight" });
                if (w.error) return res.status(400).json({ success: false, message: w.error });
                fields.weightKg = w.value;
            }
        }

        await ensurePlanSession(req.userId, date, dayNum);
        const saved = await upsertSetLog(req.userId, date, dayNum, exId, setNo, fields);
        const progress = await refreshCompletion(req.userId, date, day, choices);
        const ps = await PlanSession.findOne({ userId: req.userId, date });

        // Echo the saved set so the client reconciles from server truth.
        const setView = saved
            ? {
                exId: saved.exId,
                setNo: saved.setNo,
                weightKg: saved.weightKg ?? null,
                reps: saved.reps ?? null,
                durationSec: saved.durationSec ?? null,
                completed: !!saved.completed
            }
            : null;

        res.json({ success: true, set: setView, session: sessionView(ps, day, progress), progress });
    } catch (e) {
        res.status(500).json({ success: false, message: "Couldn't save that set" });
    }
});

// ============================================================
// SESSION-LEVEL ALTERNATIVE CHOICE ("Plank OR Dead Bug" etc.)
// ============================================================
router.post("/sessions/:date/choice", auth, async (req, res) => {
    try {
        const r = await resolveDate(req, true);
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        const date = r.date;

        const dayNum = plan.planDayForDate(date);
        const day = plan.getDay(dayNum);
        if (day.rest) {
            return res.status(400).json({ success: false, code: "REST_DAY", message: "Rest day — nothing to choose." });
        }

        const body = req.body || {};
        const slotId = typeof body.slotId === "string" ? body.slotId : "";
        const choiceId = typeof body.choiceId === "string" ? body.choiceId : "";
        if (!plan.isValidChoice(day, slotId, choiceId)) {
            return res.status(400).json({
                success: false,
                message: "Only this day's two prescribed alternatives can be chosen"
            });
        }

        await ensurePlanSession(req.userId, date, dayNum);
        await PlanSession.updateOne(
            { userId: req.userId, date },
            { $set: { [`choices.${slotId}`]: choiceId } }
        );
        res.json(await buildDayPayload(req.userId, date));
    } catch (e) {
        res.status(500).json({ success: false, message: "Couldn't save that choice" });
    }
});

// ============================================================
// CARDIO LOG (Days 1/2/4 run-walk, Day 6 main endurance session)
// ============================================================
router.post("/sessions/:date/cardio", auth, async (req, res) => {
    try {
        const r = await resolveDate(req, true);
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        const date = r.date;

        const dayNum = plan.planDayForDate(date);
        const day = plan.getDay(dayNum);
        if (day.rest) {
            return res.status(400).json({ success: false, code: "REST_DAY", message: "Rest day — no cardio to log." });
        }
        if (!day.cardio || !day.cardio.loggable) {
            return res.status(400).json({ success: false, message: "No cardio is prescribed on this day." });
        }

        const body = req.body || {};
        const fields = {};

        const dist = parseNumber(body.distanceKm, { min: 0, max: 500, label: "distance (km)" });
        if (dist.error) return res.status(400).json({ success: false, message: dist.error });
        if (body.distanceKg !== undefined || dist.value !== undefined) fields["cardio.distanceKm"] = dist.value;

        const dur = parseNumber(body.durationMin, { min: 0, max: 1440, label: "duration (minutes)" });
        if (dur.error) return res.status(400).json({ success: false, message: dur.error });
        if (body.durationMin !== undefined || dur.value !== undefined) fields["cardio.durationMin"] = dur.value;

        if (body.notes !== undefined) {
            if (typeof body.notes !== "string") return res.status(400).json({ success: false, message: "notes must be text" });
            fields["cardio.notes"] = body.notes.slice(0, 500);
        }
        const done = parseBoolean(body.completed, "completed");
        if (done.error) return res.status(400).json({ success: false, message: done.error });
        if (done.value !== undefined) {
            fields["cardio.completed"] = done.value;
            fields["cardio.loggedAt"] = done.value ? new Date() : null;
        }

        await ensurePlanSession(req.userId, date, dayNum);
        if (Object.keys(fields).length) {
            await PlanSession.updateOne({ userId: req.userId, date }, { $set: fields });
        }

        const choices = await storedChoices(req.userId, date, day);
        const progress = await refreshCompletion(req.userId, date, day, choices);
        const ps = await PlanSession.findOne({ userId: req.userId, date });
        res.json({ success: true, session: sessionView(ps, day, progress), progress });
    } catch (e) {
        res.status(500).json({ success: false, message: "Couldn't save that cardio log" });
    }
});

// ============================================================
// HISTORY — new fixed-plan sessions + untouched legacy sessions.
// ============================================================
router.get("/history", auth, async (req, res) => {
    try {
        const limit = Math.min(90, Math.max(1, Math.round(Number(req.query.limit) || 30)));
        const [sessions, legacySessions] = await Promise.all([
            PlanSession.find({ userId: req.userId }).sort({ date: -1 }).limit(limit),
            WorkoutSession.find({ userId: req.userId }).sort({ date: -1 }).limit(limit)
                .select("date workoutName exercises completedAt")
                .lean()
        ]);

        const dates = sessions.map((s) => s.date);
        const logs = dates.length
            ? await SetLog.find({ userId: req.userId, date: { $in: dates }, completed: true }).select("date exId")
            : [];

        const fixedRows = sessions.map((s) => {
            const day = plan.getDay(s.planDay);
            const choices = plan.normalizeChoices(day, s.choices ? Object.fromEntries(s.choices) : {});
            const total = plan.totalSets(day, choices);
            const ids = new Set(plan.resolveExercises(day, choices).map((e) => e.id));
            const done = logs.filter((l) => l.date === s.date && ids.has(l.exId)).length;
            const cardio = s.cardio || {};
            return {
                legacy: false,
                date: s.date,
                planDay: s.planDay,
                workoutName: plan.displayTitle(day),
                restDay: day.rest,
                done,
                total,
                pct: total ? Math.round((done / total) * 100) : (cardio.completed ? 100 : 0),
                completed: s.completedAt ? true : false,
                completedAt: s.completedAt || null,
                cardio: (cardio.distanceKm != null || cardio.durationMin != null || cardio.completed)
                    ? {
                        distanceKm: cardio.distanceKm ?? null,
                        durationMin: cardio.durationMin ?? null,
                        completed: !!cardio.completed
                    }
                    : null
            };
        });

        const legacyRows = legacySessions.map((s) => legacySummary(s));
        const merged = [...fixedRows, ...legacyRows]
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
            .slice(0, limit);

        res.json({ success: true, sessions: merged });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load history" });
    }
});

// ============================================================
// LEGACY READ-ONLY ENDPOINTS
// The builder-era workouts stay in the database as history; this
// endpoint only lists them (no create/edit/delete exists anymore).
// ============================================================
router.get("/workouts", auth, async (req, res) => {
    try {
        const workouts = await Workout.find({ userId: req.userId }).sort({ updatedAt: -1 });
        res.json({ success: true, workouts });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to load workouts" });
    }
});

module.exports = router;
