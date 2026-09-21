// ------------------------------------------------------------
// Nutrition unit tests — FatSecret service abstraction with a MOCKED
// upstream. No network access, no dependency on live FatSecret
// availability, and the suite never reads real credentials.
// Run: node test/nutrition.test.js
// ------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.FATSECRET_CLIENT_ID = "test-client-id";
process.env.FATSECRET_CLIENT_SECRET = "test-client-secret";

const BASE_URL = "https://platform.fatsecret.com/rest/server.api";

// ---- in-memory mock of https.request used by the service ----
const https = require("https");
const realRequest = https.request;
let mockResponses = []; // queue of {status, json} consumed in order
let capturedCalls = [];  // every outbound call, for assertions

function mockNext(status, json) {
    mockResponses.push({ status, json });
}

function installMock() {
    https.request = function (options, cb) {
        const call = {
            method: options.method,
            host: options.hostname,
            path: options.path,
            headers: options.headers,
            body: ""
        };
        capturedCalls.push(call);
        const res = mockResponses.shift() || { status: 500, json: { error: { code: "1", message: "mock exhausted" } } };
        return {
            on(event, handler) {
                if (event === "timeout") { /* no-op */ }
                if (event === "error") { /* no-op */ }
                return this;
            },
            write(chunk) { call.body += String(chunk); },
            end() {
                setImmediate(() => {
                    cb({
                        statusCode: res.status,
                        on(ev, h) {
                            if (ev === "data") setImmediate(() => h(Buffer.from(JSON.stringify(res.json))));
                            if (ev === "end") setImmediate(() => h());
                            return this;
                        }
                    });
                });
            },
            destroy() {}
        };
    };
}

function restore() {
    https.request = realRequest;
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

function assertThrowsAsync(promise, code, name) {
    return promise.then(
        () => assert(false, name, "expected rejection, got resolution"),
        (err) => assert(err.code === code, name, `got code=${err.code}`)
    );
}

installMock();
const nutrition = require("../services/nutritionService");

// The service sends bodies via req.write(), which the mock records here.
function lastBody() {
    return (capturedCalls.length ? capturedCalls[capturedCalls.length - 1].body : "") || "";
}

async function main() {
    console.log("\n=== NUTRITION SERVICE TESTS (mocked FatSecret) ===\n");

    // ---- token acquisition + caching ----
    mockNext(200, { access_token: "TOKEN_A", expires_in: 86400 });
    const t1 = await nutrition.getAccessToken();
    const tokenBody = capturedCalls.find((c) => c.host.includes("oauth.fatsecret")).body;
    assert(t1 === "TOKEN_A", "fetches an access token on first call");
    const t2 = await nutrition.getAccessToken();
    assert(t2 === "TOKEN_A", "reuses the cached token (no second token request)");
    assert(capturedCalls.filter((c) => c.host.includes("oauth.fatsecret")).length === 1, "exactly one token request made");
    const tokenCall = capturedCalls.find((c) => c.host.includes("oauth.fatsecret"));
    assert(tokenCall.headers.Authorization.startsWith("Basic "), "token request uses HTTP Basic auth with client credentials");
    assert(tokenBody.includes("grant_type=client_credentials") && tokenBody.includes("scope=basic"), "token request uses client_credentials grant with basic scope");

    // ---- search: normalizes the documented foods.search response ----
    mockNext(200, {
        foods: {
            total_results: 2,
            page_number: 0,
            max_pages: 1,
            food: [
                {
                    food_id: "33691", food_name: "Chicken Biryani", brand_name: "",
                    food_type: "Generic", food_url: "x",
                    servings: { serving: [{ serving_id: "100", serving_description: "1 bowl", metric_serving_amount: "350", metric_serving_unit: "g", number_of_units: "1", calories: "580", protein: "30", carbohydrate: "76", fat: "25" }] }
                },
                {
                    food_id: "1234", food_name: "Masala Dosa", brand_name: "Restaurant Chain",
                    food_type: "Brand",
                    servings: { serving: [{ serving_id: "200", serving_description: "1 dosa", calories: "250", protein: "6", carbohydrate: "38", fat: "8" }] }
                }
            ]
        }
    });
    const search = await nutrition.searchFoods("biryani");
    const restCalls = capturedCalls.filter((c) => c.host.includes("platform.fatsecret"));
    assert(restCalls.length === 1, "search hits the REST server.api endpoint once");
    assert(restCalls[0].headers.Authorization === "Bearer TOKEN_A", "REST call sends the bearer token");
    assert(restCalls[0].body.includes("method=foods.search") && restCalls[0].body.includes("search_expression=biryani"), "search requests method=foods.search with the expression");
    assert(search.foods.length === 2, "search returns both foods");
    assert(search.foods[0].name === "Chicken Biryani" && search.foods[0].calories === 580, "search normalizes name + calories");
    assert(search.foods[0].metricServingAmount === 350 && search.foods[0].metricServingUnit === "g", "search normalizes metric serving");
    assert(search.foods[1].brand === "Restaurant Chain" && search.foods[1].type === "brand", "search normalizes brand items");

    // ---- search: no results ----
    mockNext(200, { foods: { total_results: 0, page_number: 0, max_pages: 0 } });
    const empty = await nutrition.searchFoods("zzz-not-a-food-zzz");
    assert(empty.foods.length === 0 && empty.total === 0, "search with no results returns empty list (no error)");

    // ---- search: single food object (not array) is handled ----
    mockNext(200, {
        foods: { total_results: 1, page_number: 0, max_pages: 1, food: { food_id: "9", food_name: "Idli", servings: { serving: { serving_id: "1", serving_description: "1 idli", calories: "60", protein: "2", carbohydrate: "12", fat: "0.2" } } } }
    });
    const single = await nutrition.searchFoods("idli");
    assert(single.foods.length === 1 && single.foods[0].name === "Idli", "single-object serving/food shapes are normalized");

    // ---- BASIC-TIER search: NO servings object — nutrition must be parsed
    // from food_description (the verified real response shape) ----
    mockNext(200, {
        foods: {
            total_results: 2, page_number: 0, max_pages: 1,
            food: [
                {
                    food_id: "3092", food_name: "Egg", food_type: "Generic",
                    food_url: "https://foods.fatsecret.com/calories-nutrition/generic/egg-whole-raw",
                    food_description: "Per 100g - Calories: 147kcal | Fat: 9.94g | Carbs: 0.77g | Protein: 12.58g"
                },
                {
                    food_id: "3093", food_name: "Fried Egg", food_type: "Generic",
                    food_url: "x",
                    food_description: "Per 1 egg - Calories: 90kcal | Fat: 6.83g | Carbs: 0.42g | Protein: 6.27g"
                }
            ]
        }
    });
    const basic = await nutrition.searchFoods("egg");
    assert(basic.foods[0].calories === 147 && basic.foods[0].fat === 9.94, "basic-tier hit maps calories/fat from food_description text");
    assert(basic.foods[0].carbs === 0.77 && basic.foods[0].protein === 12.58, "basic-tier hit maps carbs/protein from food_description text");
    assert(basic.foods[0].servingDescription === "100 g", "description serving label parsed (100g → 100 g)");
    assert(basic.foods[0].servingId === null, "basic-tier hit has no servingId (never invented)");
    assert(basic.foods[1].servingDescription === "1 egg" && basic.foods[1].calories === 90, "per-unit description parsed (Per 1 egg)");

    // ---- zero vs missing: a real 0.00g stays 0; a missing nutrient stays null ----
    const { parseDescriptionNutrition, pickDefaultServing, normalizeSearchHit } = nutrition._internals;
    const zeroCase = parseDescriptionNutrition("Per 1 egg - Calories: 70kcal | Fat: 5.00g | Carbs: 0.00g | Protein: 6.00g");
    assert(zeroCase.carbs === 0, "genuine 0g in the description stays a real 0 (not null)");
    assert(parseDescriptionNutrition("Per serving - Calories: 50kcal").protein === null, "nutrient absent from the description is null, never fabricated 0");
    assert(parseDescriptionNutrition("no nutrition here") === null, "description without any nutrition data parses to null");
    const noDataHit = normalizeSearchHit({ food_id: "1", food_name: "Mystery", food_type: "Generic" });
    assert(noDataHit.calories === null && noDataHit.protein === null, "hit with neither servings nor description yields null nutrition (never 0)");

    // ---- is_default serving preferred; otherwise first serving ----
    const preferred = pickDefaultServing([
        { serving_id: "a", serving_description: "1 small", calories: "50" },
        { serving_id: "b", serving_description: "1 large", calories: "74", is_default: "1" }
    ]);
    assert(preferred.serving_id === "b", "is_default=1 serving is preferred over the first");
    assert(pickDefaultServing([{ serving_id: "a" }, { serving_id: "b" }]).serving_id === "a", "without is_default, the first serving is used");
    assert(pickDefaultServing([]) === null, "empty servings list picks nothing");

    mockNext(200, {
        foods: {
            total_results: 1, page_number: 0, max_pages: 1,
            food: {
                food_id: "77", food_name: "Rice", food_type: "Generic",
                servings: { serving: [
                    { serving_id: "s1", serving_description: "1 cup small", calories: "200", protein: "4", carbohydrate: "44", fat: "0.6" },
                    { serving_id: "s2", serving_description: "1 cup", calories: "240", protein: "4.8", carbohydrate: "53", fat: "0.7", is_default: "1" }
                ] }
            }
        }
    });
    const rice = await nutrition.searchFoods("rice");
    assert(rice.foods[0].servingId === "s2" && rice.foods[0].calories === 240, "search maps nutrition from the is_default serving");

    // ---- upstream error codes are surfaced as safe service errors ----
    mockNext(200, { error: { code: "13", message: "Invalid token: ..." } });
    await assertThrowsAsync(nutrition.searchFoods("x"), "PROVIDER_ERROR", "upstream error response becomes PROVIDER_ERROR (message not leaked)");

    mockNext(429, { error: { code: "11", message: "Application request limit reached" } });
    await assertThrowsAsync(nutrition.searchFoods("x"), "RATE_LIMITED", "429/limit-reached maps to RATE_LIMITED");

    // ---- FatSecret code 21: IP allowlist rejection — distinct, honest error
    // (the real-world failure mode for a server whose outbound IP is not
    // whitelisted; token acquisition is NOT IP-gated, so capabilities can
    // look fine while data calls fail) ----
    mockNext(200, { error: { code: "21", message: "Invalid IP address detected:  '203.0.113.7'" } });
    const ipErr = await nutrition.searchFoods("x").then(
        () => null,
        (e) => e
    );
    assert(ipErr && ipErr.code === "PROVIDER_IP", "upstream IP-restriction (code 21) maps to PROVIDER_IP");
    assert(ipErr && ipErr.detail === "203.0.113.7", "rejected IP captured for server-side logs only");

    // ---- food details ----
    mockNext(200, {
        food: {
            food_id: "33691", food_name: "Chicken Biryani", brand_name: "", food_type: "Generic",
            servings: {
                serving: [
                    { serving_id: "100", serving_description: "1 bowl", metric_serving_amount: "350", metric_serving_unit: "g", number_of_units: "1", calories: "580", protein: "30", carbohydrate: "76", fat: "25" },
                    { serving_id: "101", serving_description: "100 g", metric_serving_amount: "100", metric_serving_unit: "g", number_of_units: "1", calories: "165.71", protein: "8.57", carbohydrate: "21.71", fat: "7.14" }
                ]
            }
        }
    });
    const detail = await nutrition.getFood("33691");
    assert(detail.servings.length === 2, "food details return all servings");
    assert(detail.servings[1].grams === 100, "gram-based servings expose grams for the grams input");

    // ---- portion scaling: grams basis (100 g serving, 165.71 kcal) ----
    // server must compute quantity = grams / serving-grams, so 50 g → ~0.5
    // servings and the meal route's Σ(per-serving × quantity) ≈ 82.9 kcal —
    // never the base calories copied regardless of portion.
    mockNext(200, {
        food: {
            food_id: "33691", food_name: "Chicken Biryani", brand_name: "", food_type: "Generic",
            servings: {
                serving: [
                    { serving_id: "100", serving_description: "1 bowl", metric_serving_amount: "350", metric_serving_unit: "g", number_of_units: "1", calories: "580", protein: "30", carbohydrate: "76", fat: "25" },
                    { serving_id: "101", serving_description: "100 g", metric_serving_amount: "100", metric_serving_unit: "g", number_of_units: "1", calories: "165.71", protein: "8.57", carbohydrate: "21.71", fat: "7.14" }
                ]
            }
        }
    });
    const scaled = await nutrition.resolveFoodNutrition({ providerFoodId: "33691", servingId: "101", grams: 50 });
    assert(scaled.quantity === 0.5, "portion scaling: 50 g of a 100 g serving = 0.5 quantity", `got ${scaled.quantity}`);
    assert(scaled.calories === 165.71 && scaled.protein === 8.57, "resolved nutrition stays per-serving (scaling happens in meal totals)");
    await assertThrowsAsync(nutrition.getFood("not-a-number"), "BAD_INPUT", "non-numeric food id rejected before any network call");
    mockNext(200, { error: { code: "106", message: "Invalid ID: '999999999'" } });
    await assertThrowsAsync(nutrition.getFood("999999999"), "NOT_FOUND", "unknown food id maps to NOT_FOUND");

    // ---- premier-only capabilities fail honestly ----
    await assertThrowsAsync(nutrition.lookupBarcode("8901058000214"), "PREMIER_REQUIRED", "barcode lookup reports Premier requirement (never fabricates)");
    await assertThrowsAsync(nutrition.analyzePhoto(Buffer.from("img"), "image/jpeg"), "PREMIER_REQUIRED", "photo analysis reports Premier requirement (never fabricates)");

    // ---- capability flags ----
    const caps = await nutrition.capabilities();
    assert(caps.search === true && caps.foodDetails === true, "capabilities report search/details available");
    assert(caps.photo === false && caps.barcode === false, "capabilities report photo/barcode unavailable without Premier");
    assert(caps.configured === true && caps.providerError === null, "capabilities distinguish configured from providerError");

    // ---- token auth failure path ----
    restore();
    installMock();
    // reset the module's token cache and failure cooldown via a fresh require
    delete require.cache[require.resolve("../services/nutritionService")];
    const svc = require("../services/nutritionService");
    mockNext(401, { error: "invalid_client" });
    capturedCalls = [];
    await assertThrowsAsync(svc.searchFoods("x"), "PROVIDER_AUTH", "token endpoint failure maps to PROVIDER_AUTH");

    restore();
    console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
    if (failures.length) {
        console.log("Failures:");
        for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { restore(); console.error(e); process.exit(1); });
