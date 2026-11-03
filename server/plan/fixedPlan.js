// ============================================================
// ASCEND FIXED 7-DAY WORKOUT PLAN — canonical, non-editable.
//
// This module is the SINGLE source of truth for the weekly split.
// It is code-only configuration: no API mutates it, nothing seeds
// copies of it into MongoDB, and every workout session stores only
// the user's performance data (set logs, cardio, per-session
// alternative choice) referenced by stable exercise ids.
//
// SCHEDULE ANCHOR
// ---------------
// Day 1 of the cycle is anchored to a fixed, documented date:
//
//     ANCHOR_DATE = 2026-09-21  (a Monday)
//
// planDayForDate(date) = ((diffDays(ANCHOR, date) mod 7) + 7) mod 7 + 1
//
// so Day 1 always falls on Mondays and the split can never drift
// (the previous builder-based plan used Monday-first weeks —
// see startOfWeek() in utils/date.js — so Day 1 = Monday preserves
// that behavior). Dates before the anchor map correctly via the
// positive-modulo above. The schedule repeats every 7 days forever.
//
// Date keys are plain local YYYY-MM-DD strings ("date keys"); see
// utils/date.js. No timezone math happens in this module.
// ============================================================

const { isValidDateKey, keyToDate, diffDays } = require("../utils/date");

const PLAN_VERSION = 1;
const ANCHOR_DATE = "2026-09-21"; // Monday — documented, stable Day 1 anchor.

// ---------- small builders (readability only; output is plain data) ----------

function weighted(id, name, { sets, reps = [null, null], repNote = null }) {
    return {
        id,
        name,
        sets,
        metric: "reps",
        repsMin: reps[0],
        repsMax: reps[1],
        repNote,
        bodyweight: false,
        slotId: null,
        options: null
    };
}

function bodyweight(id, name, { sets, reps = [null, null], metric = "reps", repNote = null }) {
    return {
        id,
        name,
        sets,
        metric,
        repsMin: reps ? reps[0] : null,
        repsMax: reps ? reps[1] : null,
        repNote,
        bodyweight: true,
        slotId: null,
        options: null
    };
}

// A prescribed alternative slot ("X OR Y"). Both options share the
// SAME prescribed set count. The first option is the default.
function slot(slotId, sets, options) {
    return {
        id: slotId,
        name: options.map((o) => o.name).join(" OR "),
        sets,
        slotId,
        defaultId: options[0].id,
        options
    };
}

function runCardio() {
    return { mode: "run", text: "3 km run/walk.", targetKm: 3, loggable: true };
}

function noCardio() {
    return { mode: "none", text: "No running.", targetKm: null, loggable: false };
}

// ---------- the canonical plan ----------

const FIXED_PLAN = {
    version: PLAN_VERSION,
    anchor: ANCHOR_DATE,

    days: [
        // ---------------- DAY 1 — CHEST / BICEPS / ABS ----------------
        {
            day: 1,
            title: "CHEST / BICEPS / ABS",
            rest: false,
            exercises: [
                weighted("d1_incline_db_press", "Incline Dumbbell Press", { sets: 3, reps: [8, 12] }),
                weighted("d1_flat_db_press", "Flat Dumbbell Press", { sets: 3, reps: [8, 12] }),
                weighted("d1_incline_db_curl", "Incline Dumbbell Curl", { sets: 3, reps: [10, 12] }),
                weighted("d1_hammer_curl", "Hammer Curl", { sets: 2, reps: [10, 15] }),
                weighted("d1_cable_crunch", "Cable Crunch", { sets: 3, reps: [10, 15] }),
                slot("d1_core", 3, [
                    bodyweight("d1_plank", "Plank", { sets: 3, metric: "duration" }),
                    bodyweight("d1_dead_bug", "Dead Bug", { sets: 3 })
                ])
            ],
            cardio: runCardio(),
            guidance: [],
            notes: []
        },

        // ---------------- DAY 2 — BACK / TRICEPS / DELTS ----------------
        {
            day: 2,
            title: "BACK / TRICEPS / DELTS",
            rest: false,
            exercises: [
                weighted("d2_lat_pulldown", "Lat Pulldown", { sets: 3, reps: [8, 12] }),
                weighted("d2_chest_supported_row", "Chest-Supported Row", { sets: 3, reps: [8, 12] }),
                weighted("d2_cable_pressdown", "Cable Pressdown", { sets: 3, reps: [10, 15] }),
                weighted("d2_overhead_triceps_ext", "Overhead Triceps Extension", { sets: 2, reps: [10, 15] }),
                weighted("d2_lateral_raise", "Lateral Raise", { sets: 3, reps: [12, 20] }),
                weighted("d2_rear_delt_fly", "Rear Delt Fly", { sets: 2, reps: [12, 20] })
            ],
            cardio: runCardio(),
            guidance: [],
            notes: []
        },

        // ---------------- DAY 3 — LEGS / CORE ----------------
        {
            day: 3,
            title: "LEGS / CORE",
            rest: false,
            exercises: [
                weighted("d3_squat", "Squat", { sets: 3, reps: [6, 10] }),
                weighted("d3_rdl", "Romanian Deadlift", { sets: 3, reps: [8, 12] }),
                weighted("d3_hamstring_curl", "Hamstring Curl", { sets: 3, reps: [10, 15] }),
                weighted("d3_calf_raise", "Calf Raise", { sets: 3, reps: [12, 20] }),
                slot("d3_core", 3, [
                    weighted("d3_pallof_press", "Pallof Press", { sets: 3 }),
                    bodyweight("d3_back_extension", "Back Extension", { sets: 3 })
                ])
            ],
            cardio: noCardio(),
            guidance: [],
            notes: []
        },

        // ---------------- DAY 4 — BACK / CHEST ----------------
        {
            day: 4,
            title: "BACK / CHEST",
            rest: false,
            exercises: [
                weighted("d4_flat_barbell_bench", "Flat Barbell Bench Press", { sets: 3, reps: [6, 10] }),
                weighted("d4_seated_cable_row", "Seated Cable Row", { sets: 3, reps: [8, 12] }),
                weighted("d4_machine_chest_press", "Machine Chest Press", { sets: 2, reps: [10, 15] }),
                weighted("d4_neutral_lat_pulldown", "Neutral-Grip Lat Pulldown", { sets: 3, reps: [8, 12] }),
                weighted("d4_cable_chest_fly", "Cable Chest Fly", { sets: 2, reps: [12, 15] })
            ],
            cardio: runCardio(),
            guidance: [],
            notes: []
        },

        // ---------------- DAY 5 — LEGS / CORE ----------------
        {
            day: 5,
            title: "LEGS / CORE",
            rest: false,
            exercises: [
                weighted("d5_bulgarian_split_squat", "Bulgarian Split Squat", { sets: 3, reps: [8, 12], repNote: "per leg" }),
                weighted("d5_hip_thrust", "Hip Thrust", { sets: 3, reps: [8, 12] }),
                weighted("d5_leg_extension", "Leg Extension", { sets: 2, reps: [10, 15] }),
                weighted("d5_seated_leg_curl", "Seated Leg Curl", { sets: 2, reps: [10, 15] }),
                bodyweight("d5_reverse_crunch", "Reverse Crunch", { sets: 3, reps: [10, 15] }),
                weighted("d5_pallof_press", "Pallof Press", { sets: 2, reps: [10, 12], repNote: "per side" })
            ],
            cardio: noCardio(),
            guidance: [],
            notes: []
        },

        // ---------------- DAY 6 — CARDIO (main endurance session) ----------------
        {
            day: 6,
            title: "CARDIO",
            rest: false,
            exercises: [],
            cardio: {
                mode: "endurance",
                text: "Main endurance session. Track actual distance, duration and notes.",
                targetKm: 3,
                targetLabel: "Start with 3 km total.",
                goalKm: 10,
                goalLabel: "Work toward completing 10 km over approximately 6 months.",
                loggable: true
            },
            guidance: [
                "Run/walk session — start with 3 km total.",
                "Gradually increase distance as endurance improves.",
                "Keep most sessions at a comfortable, conversational pace.",
                "Work toward completing 10 km over approximately 6 months."
            ],
            notes: []
        },

        // ---------------- DAY 7 — REST ----------------
        {
            day: 7,
            title: "REST",
            rest: true,
            exercises: [],
            cardio: null,
            guidance: [],
            notes: [
                "Full rest and recovery.",
                "Prioritize sleep, hydration, and adequate nutrition.",
                "No mandatory workout."
            ]
        }
    ],

    // Part 5 — advisory progression rules, displayed in the Gym UI.
    // They never modify the canonical plan or any logged weight.
    progression: [
        "Keep the exercise selection and weekly schedule fixed.",
        "Increase weights gradually while maintaining proper form.",
        "When you reach the top of the prescribed rep range on all sets, consider a small weight increase for the next session. This is only a suggestion — a high rep count alone does not prove good technique, so check your form first.",
        "Keep most working sets about 1–3 reps short of failure.",
        "Start running with manageable run/walk intervals and increase distance gradually.",
        "Repeat a running distance when necessary; do not force increases every week.",
        "If persistent soreness, pain, or declining performance develops, consider reducing training volume and prioritizing recovery."
    ]
};

// ---------- helpers ----------

function getDay(dayNumber) {
    const n = Number(dayNumber);
    if (!Number.isInteger(n) || n < 1 || n > 7) return null;
    return FIXED_PLAN.days[n - 1];
}

// Which plan day (1..7) does a date key belong to? Anchored, repeats weekly.
function planDayForDate(dateKey) {
    if (!isValidDateKey(dateKey)) {
        throw new Error(`Invalid date key: ${dateKey}`);
    }
    const offset = diffDays(ANCHOR_DATE, dateKey);
    return (((offset % 7) + 7) % 7) + 1;
}

// The default session choice for a day's alternative slots.
function defaultChoices(day) {
    const out = {};
    for (const ex of day.exercises) {
        if (ex.slotId) out[ex.slotId] = ex.defaultId;
    }
    return out;
}

// Sanitize a client-supplied (or stored) choices map against the canonical
// plan. Unknown slots and non-prescribed options are dropped; anything
// missing falls back to the default. The client can never smuggle in an
// exercise that is not one of the two prescribed options.
function normalizeChoices(day, rawChoices) {
    const out = defaultChoices(day);
    if (!rawChoices || typeof rawChoices !== "object") return out;
    for (const ex of day.exercises) {
        if (!ex.slotId) continue;
        const picked = rawChoices[ex.slotId];
        if (picked && ex.options.some((o) => o.id === picked)) out[ex.slotId] = picked;
    }
    return out;
}

// Flatten the day's exercises, resolving alternative slots to the
// session's chosen option. The DISPLAY name stays the prescribed
// slot name ("Plank OR Dead Bug") so the alternative remains visible
// in the fixed plan; `chosenId`/`chosenName` carry the selection and
// metric/bodyweight/rep fields follow the chosen option.
function resolveExercises(day, choices) {
    const safe = normalizeChoices(day, choices);
    const out = [];
    for (const ex of day.exercises) {
        if (!ex.slotId) {
            out.push({ ...ex, chosenId: ex.id, chosenName: ex.name, slotId: null, slotOptions: null });
            continue;
        }
        const chosen = ex.options.find((o) => o.id === safe[ex.slotId]) || ex.options[0];
        out.push({
            ...chosen,
            name: ex.name, // keep "X OR Y" visible in the plan
            sets: ex.sets, // both prescribed options share the set count
            chosenId: chosen.id,
            chosenName: chosen.name,
            slotId: ex.slotId,
            slotOptions: ex.options.map((o) => ({ id: o.id, name: o.name, selected: o.id === chosen.id }))
        });
    }
    return out;
}

// Prescribed strength sets for a day (cardio/rest never count).
function totalSets(day, choices) {
    return resolveExercises(day, choices).reduce((sum, e) => sum + e.sets, 0);
}

// "3 sets × 8–12 reps" / "3 sets × 8–12 reps per leg" / "3 sets × hold (sec)"
function setRepLabel(ex) {
    if (ex.metric === "duration") return `${ex.sets} sets × hold (sec)`;
    const note = ex.repNote ? ` ${ex.repNote}` : "";
    if (ex.repsMin == null || ex.repsMax == null) return `${ex.sets} sets × reps${note}`;
    return `${ex.sets} sets × ${ex.repsMin}–${ex.repsMax} reps${note}`;
}

function displayTitle(day) {
    return `Day ${day.day} — ${day.title}`;
}

// Public (API/client) view of one plan day. Read-only data.
function dayView(day, choices) {
    return {
        day: day.day,
        title: day.title,
        displayTitle: displayTitle(day),
        rest: day.rest,
        cardio: day.cardio ? { ...day.cardio } : null,
        guidance: [...day.guidance],
        notes: [...day.notes],
        exercises: resolveExercises(day, choices).map((e) => ({
            id: e.id,
            name: e.name,
            chosenId: e.chosenId,
            chosenName: e.chosenName,
            sets: e.sets,
            metric: e.metric,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
            repNote: e.repNote,
            bodyweight: e.bodyweight,
            slotId: e.slotId || null,
            slotOptions: e.slotOptions || null,
            label: setRepLabel(e)
        })),
        totalSets: totalSets(day, choices)
    };
}

// Whole-plan snapshot for GET /api/gym/plan (immutable through the API).
function publicPlan() {
    return {
        version: FIXED_PLAN.version,
        anchor: FIXED_PLAN.anchor,
        progression: [...FIXED_PLAN.progression],
        days: FIXED_PLAN.days.map((d) => dayView(d, defaultChoices(d)))
    };
}

// Look up a prescribed exercise by id within a resolved day, validating
// that the set number is prescribed for THAT exercise.
function findExercise(resolvedExercises, exId) {
    return resolvedExercises.find((e) => e.id === exId) || null;
}

// All alternative slots on a day: slotId -> option ids.
function slotsOf(day) {
    const out = {};
    for (const ex of day.exercises) {
        if (ex.slotId) out[ex.slotId] = ex.options.map((o) => o.id);
    }
    return out;
}

// Validate a submitted alternative choice against the canonical plan.
function isValidChoice(day, slotId, choiceId) {
    const ex = day.exercises.find((e) => e.slotId === slotId);
    if (!ex) return false;
    return ex.options.some((o) => o.id === choiceId);
}

module.exports = {
    PLAN_VERSION,
    ANCHOR_DATE,
    FIXED_PLAN,
    getDay,
    planDayForDate,
    defaultChoices,
    normalizeChoices,
    resolveExercises,
    totalSets,
    setRepLabel,
    displayTitle,
    dayView,
    publicPlan,
    findExercise,
    slotsOf,
    isValidChoice
};
