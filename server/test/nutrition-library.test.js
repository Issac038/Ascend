// ------------------------------------------------------------
// ASCEND Nutrition Library API tests — custom foods, favorites/recents,
// recipes (multi-ingredient meals), deterministic scaling, ownership
// isolation, validation, and tamper resistance.
// Same harness as nutrition-api.test.js: spawns server.js on a dedicated
// port against a scratch DB, then drops the scratch DB.
// Run: node test/nutrition-library.test.js
// ------------------------------------------------------------
process.env.NODE_ENV = "test";
require("dotenv").config();

const { spawn } = require("child_process");
const http = require("http");
const mongoose = require("mongoose");

const PORT = 4593; // dedicated library-suite port
const TEST_DB_SUFFIX = `ascend_test_nutlib_${Date.now()}`;

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
    console.error("\nNutrition library tests need a MongoDB test database (TEST_MONGO_URI or MONGO_URI).\n");
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
    const email = `nutlib${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.local`;
    const res = await req("POST", "/api/auth/register", {
        body: { name: "Nutrition Library Test", email, password: "password123" }
    });
    return getCookie(res, "token");
}

// Small corpus so the resolver and meal logging work in this suite.
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
            fdcId: 90000044, source: "ascend_seed", name: "Banana (medium)", aliases: ["banana", "kela", "ethakka"],
            category: "Fruit", cuisine: null, kcal: 89, protein: 1.1, fat: 0.3, carb: 22.8,
            fiber: 2.6, sugar: 12.2, sodium: 1,
            portionPerUnitG: 118, servingSizeG: 118, typicalMinG: null, typicalMaxG: null,
            completeness: 1, popularityRank: 44, license: "Ascend seed data",
        },
        {
            fdcId: 90000043, source: "ascend_seed", name: "Peanut butter (smooth)", aliases: ["peanut butter", "peanutbutter"],
            category: "Spread", cuisine: null, kcal: 588, protein: 25.1, fat: 50.4, carb: 19.6,
            fiber: 6.0, sugar: 9.2, sodium: 430,
            portionPerUnitG: 32, servingSizeG: 32, typicalMinG: null, typicalMaxG: null,
            completeness: 1, popularityRank: 43, license: "Ascend seed data",
        },
        {
            fdcId: 90000041, source: "ascend_seed", name: "Yogabar protein oats (per serving)", aliases: ["yogabar protein oats", "yogabar oats", "yogabar"],
            category: "Cereal", cuisine: null, kcal: 372, protein: 18.9, fat: 8.1, carb: 51,
            fiber: 7.8, sugar: 6.2, sodium: 95,
            portionPerUnitG: 60, servingSizeG: 60, typicalMinG: null, typicalMaxG: null,
            completeness: 1, popularityRank: 41, license: "Ascend seed data",
        },
    ];
    await coll.insertMany(docs);
    await conn.close();
}

async function main() {
    console.log("\n=== NUTRITION LIBRARY API TESTS ===\n");

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
        const noAuth = await req("GET", "/api/nutrition/library");
        assert(noAuth.status === 401, "library routes require authentication");

        // ---- custom foods: create / validation / list ----
        const badFood = await req("POST", "/api/nutrition/library/foods", {
            cookies: userA, body: { name: "", kcal: 100 }
        });
        assert(badFood.status === 400, "custom food without a name is rejected");

        const badKcal = await req("POST", "/api/nutrition/library/foods", {
            cookies: userA, body: { name: "Mystery bar", kcal: -5 }
        });
        assert(badKcal.status === 400, "negative calories are rejected");

        const badServing = await req("POST", "/api/nutrition/library/foods", {
            cookies: userA, body: { name: "Mystery bar", basis: "per_serving", kcal: 100, servingSizeG: null }
        });
        assert(badServing.status === 400, "per-serving basis without a serving weight is rejected");

        const cf1 = await req("POST", "/api/nutrition/library/foods", {
            cookies: userA, body: { name: "Homemade mass gainer", brand: "Kitchen Lab", basis: "per_serving", servingSizeG: 80, kcal: 320, protein_g: 24, carbs_g: 40, fat_g: 6 }
        });
        assert(cf1.status === 201 && cf1.json.food._id, "custom food created (per-serving basis)");
        // per-serving 320 kcal at 80 g -> per-100g = 400 kcal
        assert(Math.abs(cf1.json.food.kcal - 400) < 0.01, "per-serving values converted to per-100g on save", `kcal=${cf1.json.food.kcal}`);
        assert(Math.abs(cf1.json.food.protein_g - 30) < 0.01, "protein converted (24 g per 80 g serving = 30/100 g)", `p=${cf1.json.food.protein_g}`);

        const cfSource = await req("POST", "/api/nutrition/library/foods", {
            cookies: userA, body: { name: "Aunt's pickle", kcal: 50, protein_g: 900, carbs_g: 0, fat_g: 0 }
        });
        assert(cfSource.status === 400, "macros wildly inconsistent with calories are rejected (not zeroed silently)");

        const listFoods = await req("GET", "/api/nutrition/library/foods", { cookies: userA });
        assert(listFoods.status === 200 && listFoods.json.foods.length === 1, "custom food list returns the user's foods");

        // ---- search: alias matching, matchType, custom results ----
        const sAlias = await req("GET", "/api/nutrition/search?q=" + encodeURIComponent("ethakka appam"), { cookies: userA });
        assert(sAlias.status === 200 && (sAlias.json.results || []).length > 0, "transliterated search (ethakka appam) finds pazham pori");
        const pazham = (sAlias.json.results || []).find((r) => /pazham/i.test(r.name || ""));
        assert(!!pazham && pazham.matchType === "exact", "alias hit classified as exact", JSON.stringify((sAlias.json.results || []).slice(0, 2)));

        const sBrand = await req("GET", "/api/nutrition/search?q=" + encodeURIComponent("yogabar protein oats"), { cookies: userA });
        const yogabar = (sBrand.json.results || []).find((r) => /yogabar/i.test(r.name || ""));
        assert(!!yogabar, "brand search (yogabar protein oats) finds the seed row", JSON.stringify((sBrand.json.results || []).slice(0, 2)));

        const sLib = await req("GET", "/api/nutrition/library/search?q=" + encodeURIComponent("mass gainer"), { cookies: userA });
        assert(sLib.status === 200 && (sLib.json.customResults || []).length === 1, "library search includes the user's custom foods");

        const sMiss = await req("GET", "/api/nutrition/library/search?q=zzznothingmatches", { cookies: userA });
        assert(sMiss.status === 200 && sMiss.json.results.length === 0 && sMiss.json.customResults.length === 0, "no match returns empty lists (custom food is offered by the client, not forced)");

        // ---- refs: favorites + recents ----
        const ref1 = await req("POST", "/api/nutrition/library/refs", {
            cookies: userA, body: { kind: "corpus", sourceFoodId: "748967", name: "Egg, whole, raw, fresh", favorite: true, logCountBump: true }
        });
        assert(ref1.status === 201 && ref1.json.ref.favorite === true && ref1.json.ref.logCount === 1, "food reference created as favorite with usage");
        const ref2 = await req("POST", "/api/nutrition/library/refs", {
            cookies: userA, body: { kind: "corpus", sourceFoodId: "748967", name: "Egg, whole, raw, fresh", logCountBump: true }
        });
        assert(ref2.status === 201 && ref2.json.ref.logCount === 2 && ref2.json.ref.favorite === true, "re-adding the same food bumps usage without duplicating");
        const refsList = await req("GET", "/api/nutrition/library", { cookies: userA });
        assert(refsList.status === 200 && refsList.json.favorites.length === 1 && refsList.json.recents.length === 1, "library overview shows favorite + recent");
        const favToggle = await req("PATCH", `/api/nutrition/library/refs/${ref1.json.ref._id}`, { cookies: userA, body: { favorite: false } });
        assert(favToggle.status === 200 && favToggle.json.ref.favorite === false, "favorite can be toggled off");

        // ---- recipes: create with mixed corpus+custom ingredients ----
        const badRecipe = await req("POST", "/api/nutrition/library/recipes", { cookies: userA, body: { name: "No ingredients", ingredients: [] } });
        assert(badRecipe.status === 400, "recipe without ingredients is rejected");

        const tamperedRecipe = await req("POST", "/api/nutrition/library/recipes", {
            cookies: userA,
            body: {
                name: "Tamper attempt",
                ingredients: [{ foodKind: "corpus", foodId: "748967", grams: 100, per100g: { kcal: 9999, protein_g: 0, carbs_g: 0, fat_g: 0 } }],
            }
        });
        assert(tamperedRecipe.status === 201, "recipe created even when the client sends fake per100g data");
        assert(tamperedRecipe.json.recipe.ingredients[0].per100g.kcal === 143, "client-sent nutrition values CANNOT override the corpus snapshot", `kcal=${tamperedRecipe.json.recipe.ingredients[0].per100g.kcal}`);

        const recipe = await req("POST", "/api/nutrition/library/recipes", {
            cookies: userA,
            body: {
                name: "Protein oats",
                mealType: "breakfast",
                ingredients: [
                    { foodKind: "corpus", foodId: "90000041", displayName: "Yogabar protein oats", grams: 100, quantity: 100, unit: "g" },
                    { foodKind: "corpus", foodId: "90000044", displayName: "Banana (medium)", grams: 118, quantity: 1, unit: "piece" },
                    { foodKind: "custom", foodId: cf1.json.food._id, grams: 80, quantity: 1, unit: "serving" },
                ],
            }
        });
        assert(recipe.status === 201 && recipe.json.recipe._id, "recipe with corpus + custom ingredients saved");
        // custom food: per-serving 320 kcal / 24 g protein / 40 g carbs / 6 g fat at 80 g
        // -> per-100g: 400 kcal, 30 P, 50 C, 7.5 F
        // raw: oats 100 g @372 = 372; banana 118 g @89 = 105.02; custom 80 g @400 = 320
        // raw macros: P 18.9 + 1.298 + 24 = 44.198 -> 44; C 51 + 26.904 + 40 = 117.904 -> 118; F 8.1 + 0.354 + 6 = 14.454 -> 14
        // display kcal = 44*4 + 118*4 + 14*9 = 176 + 472 + 126 = 774
        const t = recipe.json.recipe.totalsPerPortion;
        assert(t.kcal === 774, "recipe totals recomputed server-side from snapshots", JSON.stringify(t));
        assert(t.protein_g === 44 && t.carbs_g === 118 && t.fat_g === 14, "macro totals match the deterministic calculation", JSON.stringify(t));

        // unknown ingredient id -> clean 400
        const badIng = await req("POST", "/api/nutrition/library/recipes", {
            cookies: userA,
            body: { name: "Bad recipe", ingredients: [{ foodKind: "corpus", foodId: "424242", grams: 100 }] }
        });
        assert(badIng.status === 400, "unknown corpus ingredient rejected cleanly");

        const badCustomIng = await req("POST", "/api/nutrition/library/recipes", {
            cookies: userB,
            body: { name: "Steal attempt", ingredients: [{ foodKind: "custom", foodId: cf1.json.food._id, grams: 100 }] }
        });
        assert(badCustomIng.status === 400, "another user's custom food cannot be used as an ingredient");

        // ---- recipe edit ----
        const edit = await req("PATCH", `/api/nutrition/library/recipes/${recipe.json.recipe._id}`, {
            cookies: userA,
            body: { ingredients: recipe.json.recipe.ingredients.map((ing) => ({ ...ing, grams: ing.foodId === "90000044" ? 59 : ing.grams, quantity: ing.foodId === "90000044" ? 0.5 : ing.quantity })) }
        });
        assert(edit.status === 200, "recipe edited (half banana)");
        // raw kcal: 372 + 59*0.89 + 320 = 744.51
        // macros: P 18.9 + 0.649 + 24 = 43.549 -> 44 (rounds to whole at >=10); C 51 + 13.452 + 40 = 104.452 -> 104; F 8.1 + 0.177 + 6 = 14.277 -> 14
        // display kcal = 44*4 + 104*4 + 14*9 = 176 + 416 + 126 = 718
        assert(edit.json.recipe.totalsPerPortion.kcal === 718, "editing an ingredient recalculates totals deterministically", JSON.stringify(edit.json.recipe.totalsPerPortion));

        // ---- log the recipe: full portion ----
        // NOTE: the recipe was edited (half banana) BEFORE this log, so the
        // logged meal must use the edited ingredients — its totals equal the
        // recipe's CURRENT totalsPerPortion (718).
        const log1 = await req("POST", `/api/nutrition/library/recipes/${recipe.json.recipe._id}/log`, {
            cookies: userA, body: { date: today, mealType: "breakfast" }
        });
        assert(log1.status === 201 && log1.json.meal._id, "recipe logged to the day");
        assert(log1.json.meal.ingredients.length === 3, "logged meal carries one row per ingredient");
        assert(log1.json.meal.totals.kcal === 718, "logged meal totals equal the recipe's current totals (1 portion)", JSON.stringify(log1.json.meal.totals));
        assert(log1.json.meal.ingredients[0].nutrientSnapshot.kcal === 372, "logged rows carry immutable per-100g snapshots");

        // ---- partial portions: 0.5 ----
        const logHalf = await req("POST", `/api/nutrition/library/recipes/${recipe.json.recipe._id}/log`, {
            cookies: userA, body: { date: today, portions: 0.5 }
        });
        assert(logHalf.status === 201, "half portion logged");
        // grams halve: oats 50 g @372 = 186; banana 29.5 g @89 = 26.255; custom 40 g @400 = 160
        // raw kcal = 372.255; macros raw: P 21.7745 -> 22; C 52.226 -> 52; F 7.1385 -> 7.1
        // display kcal = 22*4 + 52*4 + 7.1*9 = 88 + 208 + 63.9 = 359.9 -> 360
        assert(logHalf.json.meal.totals.kcal === 360, "half portion scales every ingredient and totals deterministically", JSON.stringify(logHalf.json.meal.totals));
        const oatsRowHalf = logHalf.json.meal.ingredients[0];
        assert(oatsRowHalf.grams === 50, "ingredient grams scale with portions (oats 100 -> 50)", `g=${oatsRowHalf.grams}`);

        // ---- 1.5 portions ----
        const log15 = await req("POST", `/api/nutrition/library/recipes/${recipe.json.recipe._id}/log`, {
            cookies: userA, body: { date: today, portions: 1.5 }
        });
        assert(log15.status === 201, "1.5 portions logged");
        // raw kcal = 1116.765; macros raw: P 65.3235 -> 65; C 156.678 -> 157; F 21.4155 -> 21
        // display kcal = 65*4 + 157*4 + 21*9 = 260 + 628 + 189 = 1077
        assert(log15.json.meal.totals.kcal === 1077, "1.5 portions scale ingredient ratios consistently", JSON.stringify(log15.json.meal.totals));

        // ---- logging updates the recipe's usage (recents) ----
        const libAfter = await req("GET", "/api/nutrition/library", { cookies: userA });
        const loggedRecipe = (libAfter.json.recipes || []).find((r) => r._id === recipe.json.recipe._id);
        assert(!!loggedRecipe && loggedRecipe.logCount === 3, "recipe usage tracked (logCount=3)", JSON.stringify((libAfter.json.recipes || []).map((r) => ({ n: r.name, c: r.logCount }))));

        // ---- day list still consistent + historical meals unchanged after recipe EDIT ----
        const day = await req("GET", `/api/nutrition/meals?date=${today}`, { cookies: userA });
        assert(day.status === 200 && day.json.meals.length === 3, "all three logged meals on the day");
        const loggedBefore = day.json.meals.find((m) => m._id === log1.json.meal._id);
        assert(loggedBefore && loggedBefore.totals.kcal === 718, "earlier log keeps its totals");

        // edit the recipe drastically — historical logs must NOT change
        await req("PATCH", `/api/nutrition/library/recipes/${recipe.json.recipe._id}`, {
            cookies: userA,
            body: { ingredients: [{ foodKind: "corpus", foodId: "748967", grams: 1000, quantity: 1000, unit: "g" }] }
        });
        const dayAfterEdit = await req("GET", `/api/nutrition/meals?date=${today}`, { cookies: userA });
        const loggedAfter = dayAfterEdit.json.meals.find((m) => m._id === log1.json.meal._id);
        assert(loggedAfter && loggedAfter.totals.kcal === 718 && loggedAfter.ingredients.length === 3, "editing the saved recipe does NOT rewrite historical meal logs");

        // ---- ownership isolation ----
        const crossRecipes = await req("GET", "/api/nutrition/library/recipes", { cookies: userB });
        assert(crossRecipes.json.recipes.length === 0, "user B sees none of user A's recipes");
        const crossFoods = await req("GET", "/api/nutrition/library/foods", { cookies: userB });
        assert(crossFoods.json.foods.length === 0, "user B sees none of user A's custom foods");
        const crossEdit = await req("PATCH", `/api/nutrition/library/recipes/${recipe.json.recipe._id}`, { cookies: userB, body: { name: "hax" } });
        assert(crossEdit.status === 404, "user B cannot edit user A's recipe");
        const crossLog = await req("POST", `/api/nutrition/library/recipes/${recipe.json.recipe._id}/log`, { cookies: userB, body: {} });
        assert(crossLog.status === 404, "user B cannot log user A's recipe");
        const crossDel = await req("DELETE", `/api/nutrition/library/recipes/${recipe.json.recipe._id}`, { cookies: userB });
        assert(crossDel.status === 404, "user B cannot delete user A's recipe");
        const crossFoodDel = await req("DELETE", `/api/nutrition/library/foods/${cf1.json.food._id}`, { cookies: userB });
        assert(crossFoodDel.status === 404, "user B cannot delete user A's custom food");

        // ---- invalid portions / malformed payloads ----
        const negPortions = await req("POST", `/api/nutrition/library/recipes/${recipe.json.recipe._id}/log`, { cookies: userA, body: { portions: -1 } });
        assert(negPortions.status === 400, "negative portions rejected");
        const hugePortions = await req("POST", `/api/nutrition/library/recipes/${recipe.json.recipe._id}/log`, { cookies: userA, body: { portions: 50 } });
        assert(hugePortions.status === 400, "absurd portions (>10) rejected");
        const nanGrams = await req("POST", "/api/nutrition/library/recipes", {
            cookies: userA, body: { name: "NaN recipe", ingredients: [{ foodKind: "corpus", foodId: "748967", grams: "abc" }] }
        });
        assert(nanGrams.status === 400, "non-numeric grams rejected");
        const negGrams = await req("POST", "/api/nutrition/library/recipes", {
            cookies: userA, body: { name: "Neg recipe", ingredients: [{ foodKind: "corpus", foodId: "748967", grams: -10 }] }
        });
        assert(negGrams.status === 400, "negative grams rejected");

        // ---- custom food used in a recipe cannot be deleted silently ----
        const cfInUse = await req("POST", "/api/nutrition/library/foods", {
            cookies: userA, body: { name: "In-use food", kcal: 100 }
        });
        await req("POST", "/api/nutrition/library/recipes", {
            cookies: userA,
            body: { name: "Uses in-use food", ingredients: [{ foodKind: "custom", foodId: cfInUse.json.food._id, grams: 100 }] }
        });
        const delInUse = await req("DELETE", `/api/nutrition/library/foods/${cfInUse.json.food._id}`, { cookies: userA });
        assert(delInUse.status === 409 && delInUse.json.code === "IN_USE", "custom food used by a recipe is protected with a clear error");

        // ---- delete flows with confirmation semantics (server enforces ownership) ----
        const delOwn = await req("DELETE", `/api/nutrition/library/foods/${cf1.json.food._id}`, { cookies: userA });
        // cf1 is used by the recipe? The recipe was re-edited to only egg — so deletion succeeds.
        assert(delOwn.status === 200, "custom food deleted when no recipe uses it");
        const delRef = await req("DELETE", `/api/nutrition/library/refs/${ref1.json.ref._id}`, { cookies: userA });
        assert(delRef.status === 200, "food reference removed");

        // ---- favorites/custom/recipes remain intact for B (empty but working) ----
        const libB = await req("GET", "/api/nutrition/library", { cookies: userB });
        assert(libB.status === 200 && libB.json.favorites.length === 0 && libB.json.customFoods.length === 0 && libB.json.recipes.length === 0, "user B's library is empty and functional");

        const leaky = [sAlias, recipe, log1, libAfter, day].find((r) => /secret|jwt|mongo_uri/i.test(r.raw || ""));
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
