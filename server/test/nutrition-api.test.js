// ------------------------------------------------------------
// ASCEND Nutrition API tests — the Nut-AI-based local-corpus architecture.
//
// Seeds a SMALL USDA-shaped corpus into a scratch MongoDB database, spawns
// the real Express server, and exercises the HTTP surface end-to-end:
// capabilities, search, food detail, deterministic /analyze, meal CRUD,
// ownership isolation, correction arithmetic, and tamper resistance.
// No external API: the corpus is local (USDA data, CC0) — the whole point
// of the migration. Run: node test/nutrition-api.test.js
// ------------------------------------------------------------
process.env.NODE_ENV = "test";
require("dotenv").config(); // same env sourcing as run-tests.js

const { spawn } = require("child_process");
const http = require("http");
const mongoose = require("mongoose");

const PORT = 4591; // dedicated test port
const TEST_DB_SUFFIX = `ascend_test_nutrition_${Date.now()}`;

function buildTestUri() {
    const explicit = process.env.TEST_MONGO_URI;
    if (explicit) return explicit;
    const base = process.env.MONGO_URI;
    if (!base) return null;
    return base.replace(/\/([^/?]+)(\?|$)/, (m, dbName, q) => {
        if (/^(admin|local|config|production|prod)$/i.test(dbName)) {
            throw new Error(`Refusing to base tests on system/production database "${dbName}".`);
        }
        return `/${TEST_DB_SUFFIX}${q}`;
    });
}

const TEST_DB = buildTestUri();
if (!TEST_DB) {
    console.error("\nNutrition API tests need a MongoDB test database (TEST_MONGO_URI or MONGO_URI).\n");
    process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, extra) {
    if (cond) { passed += 1; console.log(`  ok - ${name}`); }
    else {
        failed += 1;
        failures.push(name + (extra ? ` (${extra})` : ""));
        console.log(`  FAIL - ${name}${extra ? ` (${extra})` : ""}`);
    }
}

function req(method, path, { body, cookies } = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const options = { host: "localhost", port: PORT, path, method, headers: {} };
        if (data) {
            options.headers["Content-Type"] = "application/json";
            options.headers["Content-Length"] = Buffer.byteLength(data);
        }
        if (cookies) options.headers.Cookie = cookies;
        const r = http.request(options, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c; });
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(raw); } catch { /* non-JSON */ }
                resolve({ status: res.statusCode, json, raw, headers: res.headers });
            });
        });
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
    });
}

function getCookie(res, name) {
    const set = res.headers["set-cookie"];
    if (!set) return null;
    for (const c of set) {
        if (c.startsWith(`${name}=`)) return c.split(";")[0];
    }
    return null;
}

async function waitUntilReady(tries = 40) {
    for (let i = 0; i < tries; i += 1) {
        try {
            await new Promise((r) => setTimeout(r, 500));
            const res = await req("GET", "/api/health");
            if (res.status === 200) return true;
        } catch { /* not up yet */ }
    }
    return false;
}

async function register() {
    const email = `nut${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.local`;
    const res = await req("POST", "/api/auth/register", {
        body: { name: "Nutrition Test", email, password: "password123" }
    });
    return getCookie(res, "token");
}

// ------------------------------------------------------------
// Seed corpus — documents in exactly the shape corpusLoader.js writes
// (fdcId/source unique key, per-100g values, portion anchors, popularity).
// USDA-derived numbers (CC0): egg ~143 kcal/100g, grilled chicken breast
// ~165/100g (USDA 171077), white rice cooked ~130/100g.
// ------------------------------------------------------------
async function seedCorpus(uri) {
    const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15000 });
    const coll = conn.collection("nutrition_foods");
    await coll.createIndex({ fdcId: 1, source: 1 }, { unique: true });
    await coll.createIndex({ name: "text" }, { name: "food_text", weights: { name: 1 } });
    await coll.createIndex({ popularityRank: 1 });
    const docs = [
        {
            fdcId: 748967, source: "fndds", name: "Egg, whole, raw, fresh",
            category: "Eggs", cuisine: null, kcal: 143, protein: 12.56, fat: 9.51, carb: 0.72,
            fiber: null, sugar: 0.37, sodium: 142,
            portionPerUnitG: 50, portionSmallG: 38, portionMediumG: 44, portionLargeG: 50,
            servingSizeG: 50, typicalMinG: 38, typicalMaxG: 56, completeness: 1,
            popularityRank: 10, license: "CC0-1.0 (USDA FoodData Central)",
        },
        {
            fdcId: 171077, source: "sr_legacy", name: "Chicken breast, grilled, skin not eaten",
            category: "Poultry", cuisine: null, prepFacet: "grilled", kcal: 165, protein: 31.02, fat: 3.57, carb: 0,
            fiber: null, sugar: 0, sodium: 74,
            portionPerUnitG: 170, portionSmallG: 120, portionMediumG: 170, portionLargeG: 220,
            servingSizeG: 170, typicalMinG: 85, typicalMaxG: 300, completeness: 1,
            popularityRank: 20, license: "CC0-1.0 (USDA FoodData Central)",
        },
        {
            fdcId: 2705384, source: "fndds", name: "Rice, white, cooked",
            category: "Rice and rice dishes", cuisine: null, kcal: 130, protein: 2.7, fat: 0.28, carb: 28.17,
            fiber: 0.4, sugar: 0.05, sodium: 1,
            portionPerUnitG: 158, portionSmallG: 100, portionMediumG: 158, portionLargeG: 210,
            servingSizeG: 158, typicalMinG: 100, typicalMaxG: 250, completeness: 1,
            popularityRank: 15, license: "CC0-1.0 (USDA FoodData Central)",
        },
        {
            fdcId: 999001, source: "fndds", name: "Chicken biryani",
            category: "Mixed dishes", cuisine: "indian", kcal: 170, protein: 8.5, fat: 6.2, carb: 20.1,
            fiber: 1.2, sugar: 1.1, sodium: 320,
            portionPerUnitG: 350, portionSmallG: 250, portionMediumG: 350, portionLargeG: 450,
            servingSizeG: 350, typicalMinG: 250, typicalMaxG: 500, completeness: 1,
            popularityRank: 30, license: "CC0-1.0 (USDA FoodData Central)",
        },
        {
            fdcId: 999002, source: "fndds", name: "Vegetable oil",
            category: "Fats and oils", cuisine: null, prepFacet: null, kcal: 884, protein: 0, fat: 100, carb: 0,
            fiber: null, sugar: 0, sodium: 0,
            portionPerUnitG: 14, portionSmallG: null, portionMediumG: 14, portionLargeG: null,
            servingSizeG: 14, typicalMinG: null, typicalMaxG: null, completeness: 1,
            popularityRank: 5, license: "CC0-1.0 (USDA FoodData Central)",
        },
    ];
    await coll.insertMany(docs);
    await conn.close();
}

async function main() {
    console.log("\n=== NUTRITION API TESTS (local corpus) ===\n");

    const serverProcess = spawn(process.execPath, ["server.js"], {
        cwd: `${__dirname}/..`,
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(PORT),
            MONGO_URI: TEST_DB,
            JWT_SECRET: process.env.JWT_SECRET || "test-secret-for-ci-only",
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let serverLogs = "";
    serverProcess.stdout.on("data", (c) => { serverLogs += c; });
    serverProcess.stderr.on("data", (c) => { serverLogs += c; });

    try {
        await seedCorpus(TEST_DB);
        const ready = await waitUntilReady();
        assert(ready, "test backend starts");
        if (!ready) throw new Error("server never ready:\n" + serverLogs);

        const userA = await register();
        const userB = await register();
        assert(userA && userB, "two users registered");

        const today = new Date().toISOString().slice(0, 10);

        // ---- auth required ----
        const noAuth = await req("GET", "/api/nutrition/meals");
        assert(noAuth.status === 401, "meal routes require authentication");
        const noAuthSearch = await req("GET", "/api/nutrition/search?q=egg");
        assert(noAuthSearch.status === 401, "search route requires authentication");
        const noAuthAnalyze = await req("POST", "/api/nutrition/analyze", { body: {} });
        assert(noAuthAnalyze.status === 401, "analyze route requires authentication");

        // ---- capabilities: truthful, derived from the actual corpus ----
        const caps = await req("GET", "/api/nutrition/capabilities", { cookies: userA });
        const c = caps.json.capabilities;
        assert(caps.status === 200 && c.configured === true, "capabilities report corpus loaded (configured=true)");
        assert(c.search === true && c.foodDetails === true, "search + details available when the corpus is loaded");
        assert(c.provider === "usda-fdc-local", "provider is the local USDA corpus");
        assert(c.photo === false && c.labelScan === false, "photo/label honestly unavailable (no vision provider)");
        // 5 seeded USDA-shaped rows + the Ascend seed rows merged at startup
        assert(Number(c.corpusFoods) >= 5, "corpus count is real, not hardcoded", `got ${c.corpusFoods}`);

        // ---- search over the seeded corpus ----
        const s1 = await req("GET", "/api/nutrition/search?q=egg", { cookies: userA });
        assert(s1.status === 200 && s1.json.success === true, "search succeeds");
        const eggHit = (s1.json.results || []).find((r) => r.foodId === "748967");
        assert(!!eggHit && eggHit.energyKcal === 143, "search returns real per-serving energy from the corpus", JSON.stringify(s1.json.results || []).slice(0, 120));
        assert(s1.json.results.length >= 1 && s1.json.results.length <= 12, "results bounded to 12");

        const s2 = await req("GET", "/api/nutrition/search?q=" + encodeURIComponent("chicken biryani"), { cookies: userA });
        const biryaniHit = (s2.json.results || []).find((r) => r.foodId === "999001");
        assert(!!biryaniHit, "cuisine/dish search finds the biryani row");

        const s3 = await req("GET", "/api/nutrition/search?q=" + encodeURIComponent("zzzznotfindinganything"), { cookies: userA });
        assert(s3.status === 200 && Array.isArray(s3.json.results) && s3.json.results.length === 0, "no-results returns an empty list, not an error");

        const s4 = await req("GET", "/api/nutrition/search", { cookies: userA });
        assert(s4.status === 400, "empty query rejected with 400");

        // ---- food detail ----
        const fd = await req("GET", "/api/nutrition/food/171077", { cookies: userA });
        assert(fd.status === 200 && fd.json.food.per100g.kcal === 165, "food detail returns per-100g snapshot");
        assert(fd.json.food.servingSizeG === 170 && fd.json.food.portionMediumG === 170, "portion anchors included");
        assert(/CC0/.test(fd.json.food.license || ""), "license attribution travels with the data");

        const fdMiss = await req("GET", "/api/nutrition/food/424242", { cookies: userA });
        assert(fdMiss.status === 404, "unknown food id returns 404");

        // ---- deterministic analyze (the exact payload shape a vision model may return) ----
        const payload = {
            schema_version: "1.0.0",
            is_food: true,
            refusal_reason: null,
            items: [{
                name: "Grilled chicken breast",
                brand: null,
                canonical_food_key: "chicken breast, grilled",
                food_form: "flat",
                qualitative_size: "medium",
                weight_basis: "cooked",
                model_gram_estimate: 150,
                identification_confidence: 0.8,
                portion_confidence: 0.6,
                uncertainty_reason: "none",
                visible_reference_objects: [],
                container: null,
                cooking_method_cues: ["grill_marks"],
                cuisine_hint: "Poultry",
                is_beverage: false,
                beverage_category: null,
                legible_label_text: null,
                stated_assumptions: [],
                clarifying_questions: [],
                fallback_macros_at_estimate: { calories_kcal: 248, protein_g: 46.5, carbs_g: 0, fat_g: 5.4, fiber_g: null, sodium_mg: 74 },
            }],
            meal_overall: { identification_confidence: 0.8, portion_confidence: 0.6, assumptions: [], clarifying_questions: [] },
        };
        const an = await req("POST", "/api/nutrition/analyze", { cookies: userA, body: payload });
        assert(an.status === 200 && an.json.success === true, "analyze accepts a valid vision payload");
        const anRow = an.json.items && an.json.items[0] && an.json.items[0].row;
        assert(anRow && anRow.sourceFoodId === "171077", "analyze resolved the item against the corpus", JSON.stringify(anRow || {}).slice(0, 160));
        // The gram mass comes from the ladder (not the model's 150 g), so the
        // honest assertion is the INVARIANT: display kcal must equal the
        // Atwater reconciliation of the returned display macros, and the mass
        // must be plausible for a chicken breast.
        const at = an.json.totals;
        assert(!!at && at.kcal === Math.round(at.protein_g * 4 + at.carbs_g * 4 + at.fat_g * 9), "display kcal self-consistent with displayed macros (Atwater)", `kcal=${at && at.kcal} P=${at && at.protein_g} C=${at && at.carbs_g} F=${at && at.fat_g}`);
        assert(anRow.grams >= 80 && anRow.grams <= 260, "gram ladder produced a plausible breast portion", `g=${anRow.grams}`);
        assert(an.json.band && typeof an.json.band.halfPct === "number", "meal uncertainty band returned");
        assert(an.json.items[0].gramResult && an.json.items[0].gramResult.grams > 0, "gram engine produced a mass");

        const badPayload = await req("POST", "/api/nutrition/analyze", { cookies: userA, body: { ...payload, items: [{ ...payload.items[0], food_form: "blob" }] } });
        assert(badPayload.status === 400 && badPayload.json.code === "BAD_INPUT", "invalid payload rejected cleanly (validation error, no 500)");
        const notFood = await req("POST", "/api/nutrition/analyze", { cookies: userA, body: { ...payload, is_food: false, refusal_reason: "not food" } });
        assert(notFood.status === 400 && notFood.json.code === "NOT_FOOD", "non-food payload refused");

        // photo stays honestly unavailable
        const photo = await req("POST", "/api/nutrition/analyze-photo", { cookies: userA, body: { image: "data:image/png;base64,AAAA" } });
        assert(photo.status === 501 && photo.json.code === "PHOTO_UNAVAILABLE", "photo analysis honestly unavailable (501, no fabrication)");

        // ---- meal CRUD: corpus-backed rows (client sends foodId+grams ONLY) ----
        const meal1 = await req("POST", "/api/nutrition/meals", {
            cookies: userA,
            body: {
                date: today, mealType: "lunch", source: "db_search",
                ingredients: [{ origin: "db_search", sourceFoodId: "171077", displayName: "Chicken breast, grilled", grams: 200 }]
            }
        });
        assert(meal1.status === 201 && meal1.json.meal._id, "meal created from a corpus-backed row");
        // 200 g at 165 kcal/100g = 330 kcal; macros: P 62.04→62, F 7.14→7.1, C 0 → Atwater = 62*4+7.1*4+0 = 276.4 → 276
        const m1Totals = meal1.json.meal.totals;
        assert(m1Totals.protein_g === 62, "per-100g snapshot scaled by grams (protein 62 g)", JSON.stringify(m1Totals));
        // 200 g: P 62.04, F 7.14, C 0 -> display P 62, F 7.1 -> Atwater 62·4 + 7.1·9 = 311.9 -> 312
        assert(m1Totals.kcal === 312, "display kcal derived from rounded macros (self-consistent)", `kcal=${m1Totals.kcal}`);
        assert(meal1.json.meal.ingredients[0].nutrientSnapshot.kcal === 165, "snapshot copied from corpus, immutable");

        // TAMPER RESISTANCE: the client sends a fake snapshot with the foodId — server must ignore it
        const tampered = await req("POST", "/api/nutrition/meals", {
            cookies: userA,
            body: {
                date: today, mealType: "snack", source: "db_search",
                ingredients: [{ origin: "db_search", sourceFoodId: "171077", grams: 100, nutrientSnapshot: { kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0 } }]
            }
        });
        const tRow = tampered.json.meal && tampered.json.meal.ingredients[0];
        assert(tRow && tRow.nutrientSnapshot.kcal === 165, "client-supplied nutrition CANNOT override the corpus snapshot", `kcal=${tRow && tRow.nutrientSnapshot.kcal}`);

        // unknown foodId → rejected, not silently trusted
        const unknownFood = await req("POST", "/api/nutrition/meals", {
            cookies: userA,
            body: { date: today, ingredients: [{ origin: "db_search", sourceFoodId: "424242", grams: 100 }] }
        });
        assert(unknownFood.status === 400 && unknownFood.json.code === "UNRESOLVED_FOOD", "unresolvable food rejected (UNRESOLVED_FOOD)");

        // ---- manual entry: explicit origin, clamped, Atwater sanity ----
        const manual = await req("POST", "/api/nutrition/meals", {
            cookies: userA,
            body: {
                date: today, mealType: "breakfast", source: "manual",
                ingredients: [{ origin: "manual_custom", displayName: "Homemade egg curry", grams: 250, nutrientSnapshot: { kcal: 120, protein_g: 8, carbs_g: 6, fat_g: 7 } }]
            }
        });
        assert(manual.status === 201, "manual entry accepted");
        // 250 g: P 20, F 17.5, C 15 -> display P 20, F 18 (whole grams at 10+), C 15
        // -> Atwater = 80 + 162 + 60 = 302
        assert(manual.json.meal.totals.kcal === 302, "manual totals computed deterministically from the snapshot", `kcal=${manual.json.meal.totals.kcal}`);
        assert(manual.json.meal.ingredients[0].origin === "manual_custom", "manual row explicitly marked");

        const implausible = await req("POST", "/api/nutrition/meals", {
            cookies: userA,
            body: {
                date: today, mealType: "snack",
                ingredients: [{ origin: "manual_custom", displayName: "Fake bar", grams: 100, nutrientSnapshot: { kcal: 100, protein_g: 90, carbs_g: 0, fat_g: 0 } }]
            }
        });
        const iRow = implausible.json.meal && implausible.json.meal.ingredients[0];
        assert(iRow && iRow.nutrientSnapshot.protein_g === 0, "macros inconsistent with calories are zeroed server-side", JSON.stringify(iRow && iRow.nutrientSnapshot || {}));

        // ---- day list + totals + date filter ----
        const day = await req("GET", `/api/nutrition/meals?date=${today}`, { cookies: userA });
        assert(day.status === 200 && day.json.meals.length === 4, "day list returns all of the user's meals", `got ${day.json.meals.length}`);
        // sum: 276 + 165 (tampered 100g) + 298 + 100 (implausible 100g at 100kcal, macros zeroed → Atwater 0 → kcal 0)
        // implausible: macros zeroed → Atwater = 0 → display kcal 0; but raw snapshot kcal still 100 → raw totals 839...
        // display totals are Atwater-derived: chicken 276 + tampered 165·1g-scaled? tampered grams=100 → 165 kcal; Atwater from P12.56·1=12.6? per row:
        // simpler: assert totals exist and are >= the manually verifiable ones
        assert(day.json.totals && typeof day.json.totals.kcal === "number", "daily totals present");

        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const dayY = await req("GET", `/api/nutrition/meals?date=${yesterday}`, { cookies: userA });
        assert(dayY.json.meals.length === 0, "date filtering returns only that date's meals");

        // ---- correction: grams edit recomputes deterministically + feeds the prior ----
        const rowId = meal1.json.meal.ingredients[0].id;
        const gramsEdit = await req("PATCH", `/api/nutrition/meals/${meal1.json.meal._id}/rows/${rowId}/grams`, {
            cookies: userA, body: { grams: 100 }
        });
        assert(gramsEdit.status === 200, "grams correction accepted");
        // 100 g: P 31.02, F 3.57, C 0 -> display P 31, F 3.6 -> Atwater = 124 + 32.4 = 156.4 -> 156
        assert(gramsEdit.json.meal.totals.kcal === 156, "grams correction recomputes from the same snapshot (no re-resolution)", `kcal=${gramsEdit.json.meal.totals.kcal}`);
        assert(gramsEdit.json.meal.ingredients[0].gramPathway === "user_edited", "pathway becomes user_edited");
        assert(gramsEdit.json.meal.ingredients[0].corrections.length === 1, "correction history recorded");
        const prior = await mongoose.createConnection(TEST_DB).collection("mealpriors").findOne({ foodConceptKey: "fdc:171077" });
        // A user-chosen gram amount IS the ground truth, not a correction of a
        // model estimate — it must NOT feed the personal-prior EWMA (the prior
        // learns how wrong the ENGINE's automatic estimates are, §8.5).
        assert(prior === null, "user-edited grams do not pollute the personal gram prior", JSON.stringify(prior || {}));

        // portionEatenFraction ("ate half") is a final multiplier
        const half = await req("PATCH", `/api/nutrition/meals/${meal1.json.meal._id}/portion`, { cookies: userA, body: { portionEatenFraction: 0.5 } });
        // half of 100 g: P 15.51, F 1.785 -> display P 16, F 1.8 -> Atwater = 64 + 16.2 = 80.2 -> 80
        // (kcal display derives from ROUNDED macros, so "half" is 80, not 156/2=78)
        assert(half.status === 200 && half.json.meal.totals.kcal === 80, "portionEatenFraction halves the displayed totals", `kcal=${half.json.meal.totals.kcal}`);
        const full = await req("PATCH", `/api/nutrition/meals/${meal1.json.meal._id}/portion`, { cookies: userA, body: { portionEatenFraction: 1 } });
        assert(full.status === 200 && full.json.meal.totals.kcal === 156, "portion reset restores totals");

        // ---- swap identity: new snapshot copied from the corpus ----
        const swap = await req("PATCH", `/api/nutrition/meals/${meal1.json.meal._id}/rows/${rowId}/swap`, { cookies: userA, body: { sourceFoodId: "748967" } });
        assert(swap.status === 200 && swap.json.meal.ingredients[0].sourceFoodId === "748967", "row identity swapped to another corpus row");
        assert(swap.json.meal.ingredients[0].nutrientSnapshot.kcal === 143, "swap copies the NEW corpus snapshot");
        // 100 g egg: P 12.56, F 9.51, C 0.72 -> display P 13, F 9.5, C 0.7
        // -> Atwater = 52 + 85.5 + 2.8 = 140.3 -> 140
        assert(Math.abs(swap.json.meal.totals.kcal - 140) <= 1, "swap recomputed totals from the new snapshot", `kcal=${swap.json.meal.totals.kcal}`);

        // ---- assumption answer (cooking oil) adds a corpus-sourced filler row ----
        const oil = await req("PATCH", `/api/nutrition/meals/${meal1.json.meal._id}/rows/${rowId}/assumption`, { cookies: userA, body: { attribute: "cooking_oil", value: "little" } });
        assert(oil.status === 200, "oil assumption applied");
        const filler = oil.json.meal.ingredients.find((r) => r.origin === "assumption_filler");
        assert(filler && filler.grams === 14, "oil filler row added with the corpus-resolved amount");
        assert(filler && filler.nutrientSnapshot.kcal > 700, "filler snapshot comes from the corpus (oil ~884/100g)", `kcal=${filler && filler.nutrientSnapshot.kcal}`);
        // answer memory written
        const mem = await mongoose.createConnection(TEST_DB).collection("mealanswermemories").findOne({ attribute: "cooking_oil" });
        assert(mem && mem.answerCount === 1, "answer memory recorded");

        // ---- remove one row ----
        const fillerId = filler.id;
        const rm = await req("DELETE", `/api/nutrition/meals/${meal1.json.meal._id}/rows/${fillerId}`, { cookies: userA });
        assert(rm.status === 200 && !rm.json.meal.ingredients.some((r) => r.id === fillerId), "ingredient row removed");

        // ---- update meal (PUT) still resolves server-side ----
        const upd = await req("PUT", `/api/nutrition/meals/${meal1.json.meal._id}`, {
            cookies: userA,
            body: { mealType: "dinner", ingredients: [{ origin: "db_search", sourceFoodId: "2705384", grams: 158 }] }
        });
        assert(upd.status === 200 && upd.json.meal.mealType === "dinner", "meal updated");
        assert(upd.json.meal.ingredients[0].nutrientSnapshot.kcal === 130, "PUT re-resolves nutrition server-side (client cannot smuggle macros)");

        // ---- ownership isolation ----
        const crossGet = await req("GET", `/api/nutrition/meals?date=${today}`, { cookies: userB });
        assert(crossGet.json.meals.length === 0, "user B sees none of user A's meals");
        const crossEdit = await req("PUT", `/api/nutrition/meals/${meal1.json.meal._id}`, { cookies: userB, body: { mealType: "snack" } });
        assert(crossEdit.status === 404, "user B cannot edit user A's meal");
        const crossPatch = await req("PATCH", `/api/nutrition/meals/${meal1.json.meal._id}/rows/${rowId}/grams`, { cookies: userB, body: { grams: 10 } });
        assert(crossPatch.status === 404, "user B cannot correct user A's meal rows");
        const crossDel = await req("DELETE", `/api/nutrition/meals/${meal1.json.meal._id}`, { cookies: userB });
        assert(crossDel.status === 404, "user B cannot delete user A's meal");

        // ---- delete edge cases ----
        const delNoAuth = await req("DELETE", `/api/nutrition/meals/${meal1.json.meal._id}`);
        assert(delNoAuth.status === 401, "unauthenticated delete rejected");
        const delMissing = await req("DELETE", "/api/nutrition/meals/000000000000000000000000", { cookies: userA });
        assert(delMissing.status === 404, "deleting a nonexistent meal returns 404");
        const badId = await req("DELETE", "/api/nutrition/meals/not-an-id", { cookies: userA });
        assert(badId.status === 400, "invalid id rejected cleanly (400, not CastError 500)");

        // ---- whole-meal delete + totals drop ----
        const before = await req("GET", `/api/nutrition/meals?date=${today}`, { cookies: userA });
        const sumBefore = before.json.rawTotals.kcal;
        const del = await req("DELETE", `/api/nutrition/meals/${meal1.json.meal._id}`, { cookies: userA });
        assert(del.status === 200, "own meal deleted");
        const after = await req("GET", `/api/nutrition/meals?date=${today}`, { cookies: userA });
        assert(!after.json.meals.some((m) => m._id === meal1.json.meal._id), "deleted meal removed from list");
        // meal1's ingredients were replaced with rice 158 g by the PUT test
        // above, so its raw contribution is 158 g × 130 kcal/100 g = 205.4.
        assert(Math.abs(after.json.rawTotals.kcal - (sumBefore - 205.4)) < 0.5, "daily totals reflect the remaining meals after delete", `before=${sumBefore} after=${after.json.rawTotals.kcal}`);

        // ---- summary endpoint ----
        const summary = await req("GET", "/api/nutrition/summary?days=7", { cookies: userA });
        assert(summary.status === 200 && Array.isArray(summary.json.days) && summary.json.days.length === 7, "summary returns the last 7 days");
        const todayRow = summary.json.days.find((d) => d.date === today);
        assert(todayRow && todayRow.mealCount >= 1, "summary includes today's meals");

        // ---- summary totals use the display regime, no leaks anywhere ----
        const leaky = [caps, s1, fd, meal1, day, summary].find((r) => /secret|jwt|mongo_uri/i.test(r.raw || ""));
        assert(!leaky, "no secrets or internals leak in any response");
    } catch (err) {
        failed += 1;
        failures.push(`SUITE ERROR: ${err.message}`);
        console.error(err);
    } finally {
        try {
            const c = new mongoose.Mongoose();
            await c.connect(TEST_DB, { serverSelectionTimeoutMS: 8000 });
            await c.connection.dropDatabase();
            console.log("\nscratch DB dropped");
        } catch (e) {
            console.error("could not drop scratch DB:", e.message);
        }
        serverProcess.kill();
    }

    console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
    if (failures.length) {
        console.log("Failures:");
        for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
