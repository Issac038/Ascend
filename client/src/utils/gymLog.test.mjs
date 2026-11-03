// Client-side unit tests for the gym tracker helpers (no runner needed —
// mirrors the server test harness style). Run: node src/utils/gymLog.test.mjs
import {
    isValidKey, addDaysKey, sanitize, prevSetLabel, prevCardioLabel,
    topOfRangeHint, setSummary
} from "./gymLog.js";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, extra) {
    if (cond) { passed += 1; console.log(`  ok - ${name}`); }
    else { failed += 1; failures.push(name + (extra ? ` (${extra})` : "")); console.log(`  FAIL - ${name}${extra ? ` (${extra})` : ""}`); }
}

// ---- date keys: local calendar math, DST/timezone safe ----
assert(isValidKey("2026-10-05"), "valid date key accepted");
assert(!isValidKey("2026-02-30"), "impossible date rejected");
assert(!isValidKey("10-05-2026"), "wrong format rejected");
assert(!isValidKey("2026-10-05x"), "trailing junk rejected");

assert(addDaysKey("2026-10-05", 7) === "2026-10-12", "+7 days wraps within the month");
assert(addDaysKey("2026-10-05", -7) === "2026-09-28", "-7 days crosses the month back");
assert(addDaysKey("2026-12-31", 1) === "2027-01-01", "year boundary handled");
assert(addDaysKey("2026-03-08", 1) === "2026-03-09", "US DST spring-forward day still advances one calendar day");
assert(addDaysKey("2026-11-01", 1) === "2026-11-02", "US DST fall-back day still advances one calendar day");
assert(addDaysKey("2026-10-05", 0) === "2026-10-05", "+0 is identity");

// ---- input sanitizing: empty allowed while a set is incomplete ----
assert(sanitize("", "weight").value === null && !sanitize("", "weight").error, "empty weight allowed (no placeholder needed)");
assert(sanitize("  ", "reps").value === null && !sanitize("  ", "reps").error, "blank reps allowed");
assert(sanitize(null, "duration").value === null, "null duration allowed");
assert(sanitize("32.5", "weight").value === 32.5, "decimal weight accepted");
assert(sanitize("30", "weight").value === 30, "integer weight accepted");
assert(sanitize("0", "weight").value === 0, "bodyweight-ish zero weight accepted (not auto-completed)");
assert(sanitize("10", "reps").value === 10, "reps accepted");
assert(sanitize("10.5", "reps").error, "non-integer reps rejected");
assert(sanitize("0", "reps").error, "zero reps rejected");
assert(sanitize("abc", "reps").error, "non-numeric reps rejected");
assert(sanitize("1e6", "weight").error, "absurd weight rejected");
assert(sanitize("-3", "weight").error, "negative weight rejected");
assert(sanitize("45", "duration").value === 45, "plank seconds accepted");
assert(sanitize("0", "duration").error, "zero-second plank rejected");
assert(sanitize("45.5", "duration").error, "fractional seconds rejected");
assert(sanitize("1.5", "distance").value === 1.5, "shorter-than-target distance (1.5 km) accepted");
assert(sanitize("0", "distance").value === 0, "zero distance accepted (honest log)");
assert(sanitize("-1", "distance").error, "negative distance rejected");
assert(sanitize("12", "minutes").value === 12, "cardio minutes accepted");
assert(sanitize("99999", "minutes").error, "absurd cardio duration rejected");
assert(typeof sanitize("x", "reps").error === "string", "errors are displayable strings");

// ---- previous-session reference labels (never overwrite current values) ----
assert(prevSetLabel({ weightKg: 30, reps: 11 }) === "prev 30 kg × 11", "previous weight × reps label");
assert(prevSetLabel({ weightKg: null, reps: 9 }) === "prev × 9", "previous reps-only label");
assert(prevSetLabel({ weightKg: 20, reps: null }) === "prev 20 kg", "previous weight-only label");
assert(prevSetLabel({ durationSec: 45 }) === "prev 45 s", "previous plank duration label");
assert(prevSetLabel(null) === "", "no previous session -> no label");
assert(prevSetLabel({ weightKg: null, reps: null, durationSec: null }) === "", "empty previous -> no label");
assert(prevCardioLabel({ distanceKm: 4.2, durationMin: 26 }) === "prev session: 4.2 km · 26 min", "previous cardio label");
assert(prevCardioLabel(null) === "", "no previous cardio -> no label");

// ---- advisory progression suggestion ----
const ex = { metric: "reps", repsMax: 12, sets: 3 };
const full = [
    { completed: true, reps: 12 },
    { completed: true, reps: 13 },
    { completed: true, reps: 12 }
];
assert(topOfRangeHint(ex, full).includes("consider a small weight increase"), "top-of-range on all sets suggests a small increase");
assert(topOfRangeHint(ex, full).includes("form"), "suggestion explicitly defers to form, not the number");
assert(topOfRangeHint(ex, [
    { completed: true, reps: 12 },
    { completed: true, reps: 12 },
    { completed: false, reps: null }
]) === "", "no suggestion while a set is incomplete");
assert(topOfRangeHint(ex, [
    { completed: true, reps: 11 },
    { completed: true, reps: 12 },
    { completed: true, reps: 12 }
]) === "", "no suggestion when any set is below the top of the range");
assert(topOfRangeHint({ metric: "duration", sets: 3, repsMax: null }, full) === "", "duration exercises get no rep-based suggestion");
assert(topOfRangeHint({ metric: "reps", repsMax: null, sets: 3 }, [
    { completed: true, reps: 20 }, { completed: true, reps: 20 }, { completed: true, reps: 20 }
]) === "", "no prescribed range -> no suggestion (e.g. Plank OR Dead Bug)");

// ---- history summary ----
assert(setSummary({ weightKg: 32.5, reps: 10 }) === "32.5 kg × 10", "set summary with weight + reps");
assert(setSummary({ durationSec: 60 }) === "60 s", "set summary for duration");
assert(setSummary({ weightKg: null, reps: null }) === "", "empty set summarizes to nothing");

console.log(`\ngymLog tests: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
