// Client-side unit tests for the shared nutrition math (no runner needed —
// mirrors the server test harness style). Run: node src/utils/nutritionMath.test.mjs
// These guard the deterministic arithmetic the UI shows before saving.
import {
    portionAnchors, toGrams, scaleRow, sumTotals, displayTotals, totalsFor, scaleIngredients, clampGrams,
} from "./nutritionMath.js";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, extra) {
    if (cond) { passed += 1; console.log(`  ok - ${name}`); }
    else { failed += 1; failures.push(name + (extra ? ` (${extra})` : "")); console.log(`  FAIL - ${name}${extra ? ` (${extra})` : ""}`); }
}

const close = (a, b, eps = 0.001) => Math.abs(a - b) < eps;

// ---- portion anchors: only known weights ----
const egg = { portionPerUnitG: 50, portionSmallG: 38, portionMediumG: 44, portionLargeG: 50, servingSizeG: 50 };
assert(portionAnchors(egg).length === 5, "anchors built from known weights");
assert(portionAnchors({}).length === 0, "no anchors when nothing is known (no silent 1-piece assumption)");

// ---- toGrams: conversions only when the weight is known ----
assert(toGrams(2, "egg", egg) === 100, "2 eggs x 50 g anchor = 100 g");
assert(toGrams(200, "g", null) === 200, "grams pass through");
assert(toGrams(150, "ml", null) === 150, "ml converts 1:1 for water-like liquids");
assert(toGrams(1, "piece", {}) === null, "unknown piece weight returns null (flagged, not guessed)");
assert(toGrams(1, "cup", {}) === null, "unknown cup weight returns null");
assert(toGrams(2, "scoop", { servingSizeG: 30 }) === 60, "scoop uses declared serving weight");
assert(toGrams(-5, "g", null) === null, "negative quantity rejected");
assert(toGrams("abc", "g", null) === null, "non-numeric quantity rejected");
assert(clampGrams(99999) === 5000, "grams clamped to the sane maximum");
assert(clampGrams(0) === 1, "grams clamped to the sane minimum");

// ---- deterministic scaling (server-mirrored) ----
const oats = { kcal: 372, protein_g: 18.9, carbs_g: 51, fat_g: 8.1 };
const row100 = scaleRow(oats, 100);
assert(close(row100.kcal, 372) && close(row100.protein_g, 18.9), "100 g scales 1:1 with per-100g snapshot");
const row250 = scaleRow(oats, 250);
assert(close(row250.kcal, 930) && close(row250.protein_g, 47.25), "250 g scales proportionally");

// ---- summation + regime-B display rounding (self-consistent kcal) ----
const banana = { kcal: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3 };
const rows = [
    { per100g: oats, grams: 100 },
    { per100g: banana, grams: 118 },
];
const raw = sumTotals(rows);
assert(close(raw.kcal, 372 + 105.02), "raw kcal sums across ingredients", `kcal=${raw.kcal}`);
const dt = displayTotals(raw);
// raw: P 18.9+1.298=20.198 -> 20; C 51+26.904=77.904 -> 78; F 8.1+0.354=8.454 -> 8.5
// kcal = 20*4 + 78*4 + 8.5*9 = 80+312+76.5 = 468.5 -> round 469? Math.round(468.5)=469
assert(dt.kcal === Math.round(dt.protein_g * 4 + dt.carbs_g * 4 + dt.fat_g * 9), "display kcal self-consistent with displayed macros");
assert(dt.protein_g === 20 && dt.carbs_g === 78 && dt.fat_g === 8.5, "display rounding matches the server regime", JSON.stringify(dt));
assert(totalsFor(rows).kcal === dt.kcal, "totalsFor convenience matches sumTotals+displayTotals");

// ---- recipe scaling keeps ratios ----
const ings = [
    { grams: 100, per100g: oats },
    { grams: 118, per100g: banana },
];
const half = scaleIngredients(ings, 0.5);
assert(half[0].grams === 50 && half[1].grams === 59, "half portions halve every ingredient");
const oneAndHalf = scaleIngredients(ings, 1.5);
assert(oneAndHalf[0].grams === 150 && oneAndHalf[1].grams === 177, "1.5 portions scale every ingredient");
assert(scaleIngredients(ings, NaN)[0].grams === 100, "invalid portions leave ingredients untouched");

// missing nutrient stays distinct from zero at the row level
assert(scaleRow({ kcal: 100, protein_g: null, carbs_g: 5, fat_g: 1 }, 100).protein_g === 0, "missing macro contributes 0 to sums (arithmetic, not a claim)");

console.log(`\nnutritionMath tests: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
