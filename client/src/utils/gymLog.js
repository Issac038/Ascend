// Pure helpers for the fixed 7-day gym tracker. No React, no network —
// these guard the arithmetic and input validation the UI applies BEFORE
// saving, mirroring the server's rules (server always re-validates).

// Local date-key helpers (device calendar, never UTC-shifted).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidKey(key) {
    if (typeof key !== "string" || !DATE_RE.test(key)) return false;
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Add whole days to a YYYY-MM-DD key using UTC math so DST never shifts
// the calendar date (the timezone-boundary guard for date keys).
export function addDaysKey(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Input sanitizing. Empty is always allowed (an incomplete set needs no
// placeholder values); provided values must be finite numbers in range.
// Returns { value } (number | null) or { error } so the UI can show an
// inline message WITHOUT clearing the field or stealing focus.
// ---------------------------------------------------------------------------
const RANGES = {
    weight: { min: 0, max: 1000, integer: false, label: "Weight" },
    reps: { min: 1, max: 999, integer: true, label: "Reps" },
    duration: { min: 1, max: 7200, integer: true, label: "Duration" },
    distance: { min: 0, max: 500, integer: false, label: "Distance" },
    minutes: { min: 0, max: 1440, integer: false, label: "Duration" }
};

export function sanitize(raw, kind) {
    const rule = RANGES[kind];
    if (!rule) return { value: null, error: "Unknown field" };
    const s = raw == null ? "" : String(raw).trim();
    if (s === "") return { value: null };
    const n = Number(s);
    if (!Number.isFinite(n)) return { value: null, error: `${rule.label} must be a number` };
    if (rule.integer && !Number.isInteger(n)) return { value: null, error: `${rule.label} must be a whole number` };
    if (n < rule.min || n > rule.max) {
        return { value: null, error: `${rule.label} must be ${rule.min}–${rule.max}` };
    }
    return { value: n };
}

// ---------------------------------------------------------------------------
// Previous-session reference labels (display only — never copied into the
// current session's inputs).
// ---------------------------------------------------------------------------
export function prevSetLabel(prev) {
    if (!prev) return "";
    const w = prev.weightKg;
    const r = prev.reps;
    const t = prev.durationSec;
    if (t != null) return `prev ${t} s`;
    if (w != null && r != null) return `prev ${w} kg × ${r}`;
    if (w != null) return `prev ${w} kg`;
    if (r != null) return `prev × ${r}`;
    return "";
}

export function prevCardioLabel(prev) {
    if (!prev) return "";
    const bits = [];
    if (prev.distanceKm != null) bits.push(`${prev.distanceKm} km`);
    if (prev.durationMin != null) bits.push(`${prev.durationMin} min`);
    return bits.length ? `prev session: ${bits.join(" · ")}` : "";
}

// ---------------------------------------------------------------------------
// Advisory progression suggestion (Part 5): when EVERY prescribed set of an
// exercise is complete and every logged rep count reached the top of the
// prescribed range. Strictly a suggestion — it never changes the plan or any
// logged value, and it explicitly does not assume good technique.
// ---------------------------------------------------------------------------
export function topOfRangeHint(ex, entries) {
    if (!ex || ex.metric !== "reps" || ex.repsMax == null) return "";
    if (!entries || entries.length !== ex.sets) return "";
    const done = entries.filter((e) => e.completed);
    if (done.length !== ex.sets) return "";
    if (done.some((e) => e.reps == null)) return "";
    if (done.some((e) => e.reps < ex.repsMax)) return "";
    return `All ${ex.sets} sets hit ${ex.repsMax}+ reps — consider a small weight increase next session. Check your form first; a high rep count alone doesn't prove good technique.`;
}

// "32.5 kg × 10" style summary of one logged set (history rows).
export function setSummary(entry) {
    if (!entry) return "";
    if (entry.durationSec != null) return `${entry.durationSec} s`;
    const w = entry.weightKg != null ? `${entry.weightKg} kg` : "";
    const r = entry.reps != null ? `× ${entry.reps}` : "";
    if (!w && !r) return "";
    return [w, r].filter(Boolean).join(" ");
}
