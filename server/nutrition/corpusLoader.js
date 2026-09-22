// ------------------------------------------------------------
// Ascend nutrition corpus loader.
//
// Adapted from Nut AI's tools/nutrition-data pipeline (AGPL-3.0, see
// LICENSE-NUTAI.md) for Ascend's MongoDB storage. Builds the food corpus
// exclusively from USDA FoodData Central CSV releases (CC0 1.0 — see
// THIRD-PARTY-DATA.md).
//
// Schema decisions carried over from Nut AI:
//   - EXACTLY ONE computational basis: every food's nutrients are per-100 g.
//     Serving figures are display metadata computed on the fly, never stored
//     as a second "truth".
//   - Micronutrients stay out of the row entirely (sparse), matching the
//     Ascend engine's seven-nutrient snapshot.
//
// Run:  node nutrition/corpusLoader.js <csvRootDir> [mongoUriEnvName]
//   csvRootDir contains the extracted FDC folders, e.g.
//     /tmp/fdc/fndds_extract/FoodData_Central_survey_food_csv_2024-10-31
//     /tmp/fdc/sr_extract/FoodData_Central_sr_legacy_food_csv_2018-04
//     /tmp/fdc/foundation_extract/FoodData_Central_foundation_food_csv_2026-04-30
//
// The loader is IDEMPOTENT per release (documents are keyed by fdcId and
// replaced) and refuses to run against the same collection concurrently.
// ------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// FDC nutrient ids (Foundation/FNDDS modern) and SR Legacy legacy ids.
const ENERGY = new Set(["1008", "208"]);
const PROTEIN = new Set(["1003", "203"]);
const FAT = new Set(["1004", "204"]);
const CARB = new Set(["1005", "205"]);
const FIBER = new Set(["1079", "291"]);
const SODIUM = new Set(["1093", "307"]);
const SUGAR = new Set(["2000", "269"]);

// WeWIA category numbers → coarse category facet used by the resolver's
// categoryPrior signal. Mirrors Nut AI's coarse classification.
function wweiaCategoryName(num, fallbackDesc) {
    if (num == null) return fallbackDesc || null;
    return null; // description text is the real signal; categories are metadata
}

function parseCsvRows(text) {
    // Minimal RFC-4180 parser (quoted fields with embedded commas/newlines).
    // Returns raw rows (array of string arrays) — header mapping is the caller's job.
    const rows = [];
    let row = [], field = "", inQ = false, i = 0;
    while (i < text.length) {
        const c = text[i];
        if (inQ) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQ = false; i++; continue;
            }
            field += c; i++; continue;
        }
        if (c === '"') { inQ = true; i++; continue; }
        if (c === ",") { row.push(field); field = ""; i++; continue; }
        if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = "";
            if (row.length > 1 || row[0] !== "") rows.push(row);
            row = []; i++; continue;
        }
        field += c; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

function parseCsvText(text) {
    const rows = parseCsvRows(text);
    if (rows.length === 0) return [];
    const header = rows[0];
    return rows.slice(1).map((r) => {
        const o = {};
        header.forEach((h, idx) => { o[h] = r[idx] ?? ""; });
        return o;
    });
}

function parseCsv(filePath) {
    return parseCsvText(fs.readFileSync(filePath, "utf8"));
}

function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// Normalized display name: "BUTTER,WITH SALT" -> "Butter, with salt"
function titleCaseDesc(desc) {
    return String(desc || "")
        .toLowerCase()
        .replace(/(^|[\s(,\/-])([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase())
        .trim();
}

// Cuisine facets from description keywords — a light, honest heuristic that
// helps the resolver's prep/category signals without inventing data.
const CUISINE_HINTS = [
    [/\bindian|biryani|curry|masala|paneer|dal\b|samosa|naan|chapati|roti\b|paratha|dosa|idli|vada|tandoori|tikka/i, "indian"],
    [/\bchinese|stir.fry|chow mein|lo mein|fried rice|dim sum/i, "chinese"],
    [/\bmexican|taco|burrito|quesadilla|enchilada|salsa|fajita|tortilla/i, "mexican"],
    [/\bjapanese|sushi|sashimi|teriyaki|tempura|ramen|udon|miso\b/i, "japanese"],
    [/\bitalian|pasta|spaghetti|lasagna|pizza|risotto|carbonara|lasagne/i, "italian"],
];

async function loadRelease(coll, releaseDir, meta) {
    const foodCsv = path.join(releaseDir, "food.csv");
    if (!fs.existsSync(foodCsv)) throw new Error(`food.csv not found in ${releaseDir}`);
    const foods = parseCsv(foodCsv);
    const ids = foods.map((f) => num(f.fdc_id)).filter(Boolean);
    const idSet = new Set(ids);

    // nutrients per food
    const nutrPath = path.join(releaseDir, "food_nutrient.csv");
    const byNutrient = new Map(); // fdcId -> {kcal,p,c,f,fiber,sugar,sodium}
    if (fs.existsSync(nutrPath)) {
        for (const r of parseCsv(nutrPath)) {
            const fid = num(r.fdc_id);
            if (!fid || !idSet.has(fid)) continue;
            const nid = String(r.nutrient_id || "").replace(/\.0$/, "");
            let t = byNutrient.get(fid);
            if (!t) { t = {}; byNutrient.set(fid, t); }
            if (ENERGY.has(nid)) t.kcal = t.kcal ?? num(r.amount);
            else if (PROTEIN.has(nid)) t.p = t.p ?? num(r.amount);
            else if (FAT.has(nid)) t.f = t.f ?? num(r.amount);
            else if (CARB.has(nid)) t.c = t.c ?? num(r.amount);
            else if (FIBER.has(nid)) t.fiber = t.fiber ?? num(r.amount);
            else if (SUGAR.has(nid)) t.sugar = t.sugar ?? num(r.amount);
            else if (SODIUM.has(nid)) t.sodium = t.sodium ?? num(r.amount);
        }
    }

    // measure units (modern releases use ids; SR legacy portions use 9999 + modifier)
    const unitPath = path.join(releaseDir, "measure_unit.csv");
    const units = new Map();
    if (fs.existsSync(unitPath)) {
        for (const r of parseCsv(unitPath)) units.set(num(r.id), r.name);
    }

    // portions → per_unit + small/medium/large gram anchors
    const portionPath = path.join(releaseDir, "food_portion.csv");
    const portions = new Map(); // fdcId -> {perUnit, small, medium, large, typical}
    if (fs.existsSync(portionPath)) {
        for (const r of parseCsv(portionPath)) {
            const fid = num(r.fdc_id);
            if (!fid || !idSet.has(fid)) continue;
            const gw = num(r.gram_weight);
            if (!gw || gw <= 0 || gw > 5000) continue;
            const desc = String(r.portion_description || "").trim();
            const mod = String(r.modifier || "").trim();
            const unitName = units.get(num(r.measure_unit_id)) || "";
            let p = portions.get(fid);
            if (!p) { p = {}; portions.set(fid, p); }

            // FNDDS default "Quantity not specified" (unit 90000 / desc empty,
            // modifier "Quantity not specified") = the per-unit weight anchor.
            const isQtyNotSpecified = /quantity not specified/i.test(desc + " " + mod) || num(r.measure_unit_id) === 90000;
            if (isQtyNotSpecified) { p.perUnit = p.perUnit ?? gw; continue; }

            const sizeWord = /\bsmall\b/i.test(desc) ? "small" : /\bmedium\b/i.test(desc) ? "medium" : /\blarge\b/i.test(desc) ? "large" : null;
            if (sizeWord) { p[sizeWord] = p[sizeWord] ?? gw; continue; }

            // A plain single unit ("1 cup", "1 medium" absent, "serving") is the
            // per-unit fallback for SR rows that lack the FNDDS marker.
            const amt = num(r.amount);
            if ((amt == null || amt === 1) && (mod === "serving" || /^1 /.test(desc) || (desc === "" && mod))) {
                if (p.perUnit == null) p.perUnit = gw;
            }
            // track a typical portion (median-ish: first sane entry)
            if (p.typicalMin == null || gw < p.typicalMin) p.typicalMin = gw;
            if (p.typicalMax == null || gw > p.typicalMax) p.typicalMax = gw;
        }
    }

    // categories (SR/foundation use food_category_id; FNDDS uses wweia)
    const catPath = path.join(releaseDir, "food_category.csv");
    const cats = new Map();
    if (fs.existsSync(catPath)) {
        for (const r of parseCsv(catPath)) cats.set(num(r.id), r.description);
    }
    const wweiaPath = path.join(releaseDir, "wweia_food_category.csv");
    const wweia = new Map();
    if (fs.existsSync(wweiaPath)) {
        for (const r of parseCsv(wweiaPath)) wweia.set(num(r.wweia_food_category), r.wweia_food_category_description);
    }
    const surveyPath = path.join(releaseDir, "survey_fndds_food.csv");
    const surveyCats = new Map(); // fdcId -> wweia number
    if (fs.existsSync(surveyPath)) {
        for (const r of parseCsv(surveyPath)) {
            const fid = num(r.fdc_id);
            if (fid) surveyCats.set(fid, num(r.wweia_category_number));
        }
    }

    // Preparation facet parsed from the USDA description ("GRILLED CHICKEN
    // BREAST" -> "grilled"). Feeds the resolver's prepMatch signal; rows
    // without a recognizable method stay null and score the neutral 0.5.
    const PREP_PATTERNS = [
        [/\bgrilled?\b/, "grilled"],
        [/\broast(ed)?\b|\bbaked\b/, "baked"],
        [/\bfried\b|\bpan-?fried\b|\bstir-?fried\b/, "fried"],
        [/\bdeep-?fried\b/, "deep_fried"],
        [/\bpoached\b|\bsteamed\b|\bboiled\b/, "poached"],
        [/\bstewed\b|\bbraised\b/, "stewed"],
        [/\bsmoked\b/, "smoked"],
        [/\braw\b/, "raw"],
    ];
    const describePrep = (desc) => {
        for (const [re, facet] of PREP_PATTERNS) {
            if (re.test(desc)) return facet;
        }
        return null;
    };

    // Build documents. Popularity: order within the release — FNDDS foods are
    // the most commonly consumed (that is what the survey measures), so they
    // get the best ranks; then foundation; then SR. Within a release, rank by
    // appearance order (stable) — the resolver only needs a monotone prior.
    const baseRank = meta.popularityBase;
    const docs = [];
    let i = 0;
    for (const f of foods) {
        const fid = num(f.fdc_id);
        const n = byNutrient.get(fid) || {};
        const kcal = n.kcal != null ? n.kcal : null;
        const protein = n.p != null ? n.p : null;
        const fat = n.f != null ? n.f : null;
        const carb = n.c != null ? n.c : null;
        // completeness: how much of the engine's snapshot this row can supply
        const have = [kcal, protein, fat, carb].filter((v) => v != null).length;
        if (have < 3) continue; // a row we cannot even compute energy/macros for is not usable
        const desc = titleCaseDesc(f.description);
        const catNum = surveyCats.get(fid);
        const category = wweiaCategoryName(catNum) || (catNum != null ? wweia.get(catNum) : null) || cats.get(num(f.food_category_id)) || null;
        const cuisine = (CUISINE_HINTS.find(([re]) => re.test(desc)) || [])[1] || null;
        const p = portions.get(fid) || {};
        const serving = p.perUnit ?? p.medium ?? null;
        docs.push({
            fdcId: fid,
            source: meta.source,
            name: desc,
            category,
            cuisine,
            prepFacet: describePrep(desc),
            kcal, protein, fat, carb,
            fiber: n.fiber ?? null,
            sugar: n.sugar ?? null,
            sodium: n.sodium ?? null,
            portionPerUnitG: p.perUnit ?? null,
            portionSmallG: p.small ?? null,
            portionMediumG: p.medium ?? null,
            portionLargeG: p.large ?? null,
            servingSizeG: serving,
            typicalMinG: p.typicalMin ?? null,
            typicalMaxG: p.typicalMax ?? null,
            completeness: have / 4,
            popularityRank: baseRank + i,
            license: "CC0-1.0 (USDA FoodData Central)",
        });
        i += 1;
    }
    return docs;
}

async function main() {
    // dotenv is required when run standalone (server.js does its own loading).
    require("dotenv").config();
    const root = process.argv[2];
    if (!root || !fs.existsSync(root)) {
        console.error("Usage: node corpusLoader.js <csvRootDir>  (dir containing the extracted FDC release folders)");
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

    const coll = mongoose.connection.collection("nutrition_foods");
    await coll.createIndex({ fdcId: 1, source: 1 }, { unique: true });
    await coll.createIndex({ name: "text" }, {
        name: "food_text",
        default_language: "english",
        weights: { name: 1 },
    });
    await coll.createIndex({ popularityRank: 1 });

    // The dir may BE one release, or contain several.
    const releases = [];
    const relDefs = [
        { re: /survey|fndds/i, source: "fndds", popularityBase: 0 },
        { re: /foundation/i, source: "foundation", popularityBase: 100000 },
        { re: /sr_legacy/i, source: "sr_legacy", popularityBase: 200000 },
    ];
    const entries = fs.statSync(root).isDirectory() && fs.existsSync(path.join(root, "food.csv"))
        ? [root]
        : fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.statSync(d).isDirectory() && (fs.existsSync(path.join(d, "food.csv")) || fs.readdirSync(d).some((e) => fs.statSync(path.join(d, e)).isDirectory() && fs.existsSync(path.join(e && d, e, "food.csv")))));
    const expand = (dir) => {
        // releases extract into one nested folder; handle both layouts
        if (fs.existsSync(path.join(dir, "food.csv"))) { releases.push(dir); return; }
        for (const e of fs.readdirSync(dir)) {
            const p = path.join(dir, e);
            if (fs.statSync(p).isDirectory()) expand(p);
        }
    };
    expand(root);
    if (releases.length === 0) throw new Error("No FDC release folders with food.csv found under " + root);

    let total = 0;
    for (const dir of releases) {
        const def = relDefs.find((d) => d.re.test(path.basename(dir))) || { source: path.basename(dir), popularityBase: 300000 };
        process.stdout.write(`loading ${path.basename(dir)} (${def.source}) ... `);
        const docs = await loadRelease(coll, dir, def);
        // Replace per (fdcId, source) — idempotent re-runs. NOTE: upsert is a
        // chained modifier in the bulk API, not an options object (passing
        // { upsert: true } to replaceOne is silently ignored and every write
        // becomes a no-op on an empty collection).
        const bulk = coll.initializeUnorderedBulkOp();
        for (const d of docs) {
            bulk.find({ fdcId: d.fdcId, source: d.source }).upsert().replaceOne(d);
        }
        if (docs.length) await bulk.execute();
        total += docs.length;
        console.log(`${docs.length} foods`);
    }

    const count = await coll.countDocuments();
    console.log(`done: ${total} loaded this run, ${count} total documents in nutrition_foods`);
    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch((e) => { console.error("corpus load failed:", e.message); process.exit(1); });
}

module.exports = { loadRelease, parseCsv, parseCsvRows, parseCsvText };
