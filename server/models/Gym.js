const mongoose = require("mongoose");

// ------------------------------------------------------------
// GYM / WORKOUT PLANNER
//
// Three models, kept minimal on purpose:
//
//   Workout        — a reusable routine ("Push") owned by one user.
//   WeeklyPlan     — one doc per user: weekday -> workoutId (null = rest).
//   WorkoutSession — per (user, date) completion record. Stores a SNAPSHOT
//                    of the workout's exercises at first check-in, so
//                    history stays truthful when the plan/workout changes
//                    later. Completions are per-date by design — checking
//                    an exercise on Monday never carries to next Monday.
// ------------------------------------------------------------

const EXERCISE_TYPES = ["reps", "duration"];

const exerciseSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },

        // reps     -> sets × reps            ("4 × 8")
        // duration -> sets × durationSec    ("3 × 60 sec", or "20 min")
        type: { type: String, enum: EXERCISE_TYPES, default: "reps" },

        sets: { type: Number, default: 1, min: 1, max: 30 },
        reps: { type: Number, default: null, min: 1, max: 1000 },      // reps-type
        durationSec: { type: Number, default: null, min: 1, max: 14400 }, // duration-type
        restSec: { type: Number, default: null, min: 0, max: 1200 },   // optional
        weightKg: { type: Number, default: null, min: 0, max: 1000 },  // optional
        notes: { type: String, default: "", maxlength: 200 }
    },
    { _id: false }
);

const workoutSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        notes: { type: String, default: "", maxlength: 500 },
        exercises: {
            type: [exerciseSchema],
            validate: {
                validator: (v) => Array.isArray(v) && v.length <= 40,
                message: "A workout can have at most 40 exercises"
            }
        }
    },
    { timestamps: true }
);

workoutSchema.index({ userId: 1 });

// One plan per user. Weekday keys are fixed: mon..sun -> workoutId | null.
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const dayEntrySchema = new mongoose.Schema(
    {
        // null = rest day. ObjectId = workout (validated to belong to the user).
        workoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Workout", default: null }
    },
    { _id: false }
);

const weeklyPlanSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true
        },
        days: {
            type: mongoose.Schema.Types.Map,
            of: dayEntrySchema,
            default: () => ({}),
            validate: {
                validator: (map) => {
                    if (!map) return true;
                    for (const key of map.keys()) {
                        if (!DAY_KEYS.includes(String(key))) return false;
                    }
                    return true;
                },
                message: "Weekday keys must be mon..sun"
            }
        }
    },
    { timestamps: true }
);

// Per-day completion. exercises is the snapshot at first check-in.
const sessionExerciseSchema = new mongoose.Schema(
    {
        // stable identity = normalized exercise name
        key: { type: String, required: true, maxlength: 80 },
        name: { type: String, required: true, maxlength: 80 },
        detail: { type: String, default: "", maxlength: 120 }, // "4 × 8" snapshot
        done: { type: Boolean, default: false },
        doneAt: { type: Date, default: null }
    },
    { _id: false }
);

const workoutSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: { type: String, required: true, maxlength: 10 }, // YYYY-MM-DD (user's tz)

        // Snapshot data — the session survives workout renames/deletes.
        workoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Workout", default: null },
        workoutName: { type: String, required: true, maxlength: 60 },
        exercises: {
            type: [sessionExerciseSchema],
            validate: {
                validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 40,
                message: "A session needs 1–40 exercises"
            }
        },

        // set when every exercise is done; cleared on any uncheck
        completedAt: { type: Date, default: null },

        notes: { type: String, default: "", maxlength: 500 }
    },
    { timestamps: true }
);

workoutSessionSchema.index({ userId: 1, date: 1 }, { unique: true });

// ------------------------------------------------------------
// FIXED-PLAN SESSION LOGS
//
// The weekly split now lives ONLY in code (server/plan/fixedPlan.js).
// Nothing here stores the template — sessions reference stable
// exercise ids and prescribed set numbers, and the server resolves
// names/set counts/rep ranges from the canonical plan on read.
//
//   PlanSession — one doc per (user, date): the session-level
//                 alternative choice, cardio log, completion state.
//   SetLog      — one doc per (user, date, exercise, set): actual
//                 weight / reps / duration + completion. Sparse:
//                 a set only exists once the user touched it.
//
// Both are new collections; the legacy Workout/WeeklyPlan/
// WorkoutSession models above stay untouched so existing workout
// history remains readable.
// ------------------------------------------------------------

const planSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: { type: String, required: true, maxlength: 10 }, // YYYY-MM-DD (local date key)
        planDay: { type: Number, required: true, min: 1, max: 7 }, // which fixed day this date maps to

        // slotId -> optionId. Server-validated against the canonical
        // plan's prescribed alternatives (never an arbitrary exercise).
        choices: { type: Map, of: String, default: () => ({}) },

        cardio: {
            distanceKm: { type: Number, default: null, min: 0, max: 500 },
            durationMin: { type: Number, default: null, min: 0, max: 1440 },
            notes: { type: String, default: "", maxlength: 500 },
            completed: { type: Boolean, default: false },
            loggedAt: { type: Date, default: null }
        },

        // set when every prescribed set of that date is complete (or the
        // cardio session is marked done); per-DATE state, never template state
        completedAt: { type: Date, default: null },
        notes: { type: String, default: "", maxlength: 500 }
    },
    { timestamps: true }
);

// Hard guarantee against duplicate sessions from rapid taps / repeated requests.
planSessionSchema.index({ userId: 1, date: 1 }, { unique: true });
planSessionSchema.index({ userId: 1, planDay: 1, date: -1 });

const setLogSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: { type: String, required: true, maxlength: 10 },
        planDay: { type: Number, required: true, min: 1, max: 7 },

        // Stable exercise id from the canonical plan (server-resolved;
        // a crafted client payload can only reference real exercises).
        exId: { type: String, required: true, maxlength: 64 },
        setNo: { type: Number, required: true, min: 1, max: 30 },

        // Actual performance. Empty (null) values are allowed while a set
        // is incomplete. Bodyweight/duration exercises never store weight.
        weightKg: { type: Number, default: null, min: 0, max: 1000 },
        reps: { type: Number, default: null, min: 1, max: 999 },
        durationSec: { type: Number, default: null, min: 1, max: 7200 },

        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

// Duplicate-proof: one log per (user, date, exercise, set), ever.
setLogSchema.index({ userId: 1, date: 1, exId: 1, setNo: 1 }, { unique: true });
setLogSchema.index({ userId: 1, planDay: 1, date: -1, exId: 1 });

module.exports = {
    Workout: mongoose.model("Workout", workoutSchema),
    WeeklyPlan: mongoose.model("WeeklyPlan", weeklyPlanSchema),
    WorkoutSession: mongoose.model("WorkoutSession", workoutSessionSchema),
    PlanSession: mongoose.model("PlanSession", planSessionSchema),
    SetLog: mongoose.model("SetLog", setLogSchema),
    DAY_KEYS,
    EXERCISE_TYPES
};
