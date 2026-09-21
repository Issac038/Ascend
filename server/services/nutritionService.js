// ------------------------------------------------------------
// FatSecret Platform API service (server-side ONLY — credentials never
// leave this module; nothing here is imported by the frontend).
//
// Documentation (verified 2026-09-17): https://platform.fatsecret.com/docs
//   OAuth 2.0 client_credentials:
//     POST https://oauth.fatsecret.com/connect/token
//     -u CLIENT_ID:CLIENT_SECRET  -d "grant_type=client_credentials&scope=basic"
//     → { access_token, token_type:"Bearer", expires_in: 86400 }
//   REST (signed bearer, no per-user profile needed for food data):
//     POST https://platform.fatsecret.com/rest/server.api
//     Header: Authorization: Bearer <token>
//     Params: method=foods.search | food.get.v4 | format=json
//
// Tier facts (verified against the LIVE API 2026-09-20):
//   - foods.search/v3 and v5 require the "premier" scope → error code 14
//     ("Missing scope: scope 'premier'") on a basic account.
//   - foods.search (server.api) on a basic account returns NO servings
//     object — nutrition lives in the human-readable `food_description`
//     string, e.g. "Per 100g - Calories: 147kcal | Fat: 9.94g | Carbs:
//     0.77g | Protein: 12.58g" (parsed deterministically below).
//   - food.get.v4 DOES return full servings (serving_id, calories,
//     carbohydrate, protein, fat, metric_serving_amount/unit, is_default).
//   - Image Recognition, Barcode Scanning and NLP are PREMIER EXCLUSIVE.
// ------------------------------------------------------------

const https = require("https");

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const REST_URL = "https://platform.fatsecret.com/rest/server.api";
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // tokens last 24h; refresh early

// ---- in-process token cache (single deployment instance) ----
let tokenCache = { token: null, expiresAt: 0 };

// ---- short-TTL food-details cache (FatSecret ToS allows ≤24h; we use 6h,
// capped count) — lets meal saves re-resolve the same foods without
// re-hitting the provider for every request ----
const FOOD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FOOD_CACHE_MAX = 200;
const foodCache = new Map(); // foodId -> { food, expiresAt }

function cacheGet(foodId) {
    const hit = foodCache.get(foodId);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        foodCache.delete(foodId);
        return null;
    }
    return hit.food;
}

function cacheSet(foodId, food) {
    if (foodCache.size >= FOOD_CACHE_MAX) {
        const oldest = foodCache.keys().next().value;
        foodCache.delete(oldest);
    }
    foodCache.set(foodId, { food, expiresAt: Date.now() + FOOD_CACHE_TTL_MS });
}

function configured() {
    return Boolean(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET);
}

function tokenFetchFailedAt() {
    return tokenCache.failedAt || 0;
}

// Mark the cache dead for a minute after an auth failure so a down/401-ing
// provider can't be hammered on every request.
function noteTokenFailure() {
    tokenCache = { token: null, expiresAt: 0, failedAt: Date.now() };
}

async function getAccessToken() {
    if (!configured()) {
        const err = new Error("FatSecret credentials are not configured");
        err.code = "NOT_CONFIGURED";
        throw err;
    }
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    if (Date.now() - tokenFetchFailedAt() < 60 * 1000) {
        const err = new Error("FatSecret authentication is temporarily unavailable");
        err.code = "PROVIDER_DOWN_COOLDOWN";
        throw err;
    }

    const body = "grant_type=client_credentials&scope=basic";
    let raw;
    try {
        raw = await postForm(TOKEN_URL, body, {
            Authorization: `Basic ${Buffer.from(
                `${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`
            ).toString("base64")}`
        });
    } catch (e) {
        // DNS failure / timeout / connection refused — distinct from a 401
        noteTokenFailure();
        const err = new Error("Nutrition provider is unreachable");
        err.code = "PROVIDER_DOWN";
        throw err;
    }

    if (raw.status !== 200 || !raw.json || !raw.json.access_token) {
        noteTokenFailure();
        const err = new Error("FatSecret authentication failed");
        err.code = "PROVIDER_AUTH";
        throw err;
    }

    tokenCache = {
        token: raw.json.access_token,
        expiresAt: Date.now() + (Number(raw.json.expires_in) || 86400) * 1000 - 60 * 1000,
        failedAt: 0
    };
    return tokenCache.token;
}

// ---- minimal dependency-free HTTPS helpers ----

function postForm(url, body, headers = {}) {
    return request("POST", url, body, { "Content-Type": "application/x-www-form-urlencoded", ...headers });
}

function getJson(url, headers = {}) {
    return request("GET", url, null, headers);
}

function request(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request(
            {
                method,
                hostname: u.hostname,
                path: u.pathname + u.search,
                headers: {
                    Accept: "application/json",
                    "Content-Length": body ? Buffer.byteLength(body) : 0,
                    ...headers
                },
                timeout: 12000
            },
            (res) => {
                let raw = "";
                res.on("data", (c) => { raw += c; });
                res.on("end", () => {
                    let json = null;
                    try { json = JSON.parse(raw); } catch { /* non-JSON upstream error */ }
                    resolve({ status: res.statusCode, json, raw: raw.slice(0, 2000) });
                });
            }
        );
        req.on("timeout", () => req.destroy(new Error("upstream timeout")));
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

// Call a REST method with the bearer token. Returns {status, json}.
async function callApi(params) {
    const token = await getAccessToken();
    const query = new URLSearchParams({ ...params, format: "json" }).toString();
    try {
        return await request("POST", REST_URL, query, {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Bearer ${token}`
        });
    } catch (e) {
        const err = new Error("Nutrition provider is unreachable");
        err.code = "PROVIDER_DOWN";
        throw err;
    }
}

// ------------------------------------------------------------
// Normalizers — turn FatSecret responses into the shape the app uses.
// ------------------------------------------------------------

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// Like num() but for PROVIDER values that may be genuinely absent: missing
// stays null (rendered as "—" / unavailable), while a real "0" stays 0.
// Never fabricate a zero the provider did not send.
function numOrNull(v) {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// FatSecret's basic-tier foods.search returns no servings object — the
// per-serving nutrition lives in a provider-authored, stable description
// string, e.g.
//   "Per 100g - Calories: 147kcal | Fat: 9.94g | Carbs: 0.77g | Protein: 12.58g"
//   "Per 1 egg - Calories: 70kcal | Fat: 5.00g | Carbs: 0.00g | Protein: 6.00g"
// Parse it deterministically. Any piece the string does not carry stays
// null (a genuine "0.00g" parses to 0). Returns null when nothing usable
// is present — callers must NOT fall back to zeros.
function parseDescriptionNutrition(desc) {
    if (typeof desc !== "string" || !desc.trim()) return null;
    const grab = (label, unit) => {
        const m = desc.match(new RegExp(`${label}:\\s*([\\d.]+)\\s*${unit}`, "i"));
        return m ? Number(m[1]) : null;
    };
    const calories = grab("Calories", "kcal");
    const fat = grab("Fat", "g");
    const carbs = grab("Carbs", "g");
    const protein = grab("Protein", "g");
    if (calories === null && fat === null && carbs === null && protein === null) return null;
    const per = desc.match(/^Per\s+(.+?)\s+-\s+/i);
    let servingDescription = per ? per[1].trim() : "";
    servingDescription = servingDescription.replace(/^(\d+(?:\.\d+)?)g$/i, "$1 g"); // "100g" → "100 g"
    return { servingDescription, calories, protein, carbs, fat };
}

// Choose the default serving: FatSecret marks one with is_default ("1"/
// true). Prefer it when present; otherwise use the first valid serving.
function isDefaultServing(s) {
    return s.is_default === true || String(s.is_default) === "1";
}

function pickDefaultServing(servings) {
    if (!servings.length) return null;
    return servings.find(isDefaultServing) || servings[0];
}

function normalizeSearchHit(hit) {
    const servings = hit.servings && hit.servings.serving
        ? [].concat(hit.servings.serving)
        : [];

    // Nutrition fields are null until the provider actually provides them.
    let n = {
        servingDescription: "",
        servingId: null,
        metricServingAmount: null,
        metricServingUnit: null,
        calories: null,
        protein: null,
        carbs: null,
        fat: null
    };

    const serving = pickDefaultServing(servings);
    if (serving) {
        // Full serving object present (tier/variant that includes it):
        // calories ← serving.calories, carbs ← serving.carbohydrate, etc.
        n = {
            servingDescription: String(serving.serving_description || ""),
            servingId: serving.serving_id ? String(serving.serving_id) : null,
            metricServingAmount: serving.metric_serving_amount !== undefined && serving.metric_serving_amount !== null && serving.metric_serving_amount !== ""
                ? numOrNull(serving.metric_serving_amount)
                : null,
            metricServingUnit: serving.metric_serving_unit || null,
            calories: numOrNull(serving.calories),
            protein: numOrNull(serving.protein),
            carbs: numOrNull(serving.carbohydrate),
            fat: numOrNull(serving.fat)
        };
    } else {
        // Basic-tier search: parse nutrition out of food_description text.
        const parsed = parseDescriptionNutrition(hit.food_description);
        if (parsed) {
            n.servingDescription = parsed.servingDescription;
            n.calories = parsed.calories;
            n.protein = parsed.protein;
            n.carbs = parsed.carbs;
            n.fat = parsed.fat;
        }
    }

    return {
        id: String(hit.food_id || ""),
        name: String(hit.food_name || ""),
        brand: String(hit.brand_name || ""),
        type: hit.food_type === "Brand" ? "brand" : "generic",
        url: hit.food_url || null,
        ...n
    };
}

// ------------------------------------------------------------
// Public service surface
// ------------------------------------------------------------

// Search foods. `maxResults` 1–50, `pageNumber` starts at 0.
async function searchFoods(expression, { maxResults = 12, pageNumber = 0 } = {}) {
    const res = await callApi({
        method: "foods.search",
        search_expression: String(expression || "").slice(0, 120),
        max_results: String(Math.min(Math.max(Number(maxResults) || 12, 1), 50)),
        page_number: String(Math.max(Number(pageNumber) || 0, 0))
    });

    if (res.status === 429 || (res.json && res.json.error && res.json.error.code === "11")) {
        const err = new Error("Nutrition provider rate limit reached");
        err.code = "RATE_LIMITED";
        throw err;
    }
    if (res.status !== 200 || !res.json) {
        const err = new Error("Nutrition search is temporarily unavailable");
        err.code = "PROVIDER_ERROR";
        throw err;
    }
    if (res.json.error) {
        const err = new Error("Nutrition search is temporarily unavailable");
        // FatSecret code 14 = "Missing scope: ..." — the account's tier does
        // not include the requested endpoint (verified live: foods.search/v3
        // on a basic account). Distinct from an outage so the UI can say so.
        if (Number(res.json.error.code) === 14) err.code = "PROVIDER_SCOPE";
        // FatSecret code 21 = "Invalid IP address detected: '<ip>'" — the
        // account's IP allowlist rejected this server's outbound address
        // (verified live). Distinct from auth/outage so the UI can point at
        // the console allowlist instead of blaming credentials or downtime.
        else if (Number(res.json.error.code) === 21) {
            err.code = "PROVIDER_IP";
            const ip = String(res.json.error.message || "").match(/(\d{1,3}(?:\.\d{1,3}){3})/);
            err.detail = ip ? ip[1] : null; // rejected IP — server logs only, never the client
        }
        err.code = err.code || "PROVIDER_ERROR";
        throw err;
    }

    const foods = res.json.foods || {};
    const total = Number(foods.total_results) || 0;
    const page = Number(foods.page_number) || 0;
    const maxPage = Number(foods.max_pages) || 0;
    const hits = foods.food ? [].concat(foods.food) : [];

    return {
        total,
        pageNumber: page,
        maxPages: maxPage,
        foods: hits.map(normalizeSearchHit)
    };
}

// Full food detail incl. every serving. No caching of nutrient values:
// FatSecret's ToS allows caching IDs indefinitely but everything else at
// most 24h — simpler to fetch live per selection.
async function getFood(foodId) {
    if (!/^\d{1,15}$/.test(String(foodId))) {
        const err = new Error("Invalid food id");
        err.code = "BAD_INPUT";
        throw err;
    }
    const res = await callApi({ method: "food.get.v4", food_id: String(foodId) });

    if (res.status !== 200 || !res.json || res.json.error) {
        const err = new Error("Food details are temporarily unavailable");
        if (res.json && res.json.error && Number(res.json.error.code) === 106) err.code = "NOT_FOUND";
        else if (res.json && res.json.error && Number(res.json.error.code) === 21) err.code = "PROVIDER_IP";
        throw err;
    }

    const f = res.json.food || {};
    const servings = f.servings && f.servings.serving ? [].concat(f.servings.serving) : [];
    const servingList = servings.map((s) => ({
        id: s.serving_id ? String(s.serving_id) : null,
        description: String(s.serving_description || ""),
        metricAmount: s.metric_serving_amount !== undefined && s.metric_serving_amount !== "" ? numOrNull(s.metric_serving_amount) : null,
        metricUnit: s.metric_serving_unit || null,
        numberOfUnits: num(s.number_of_units) || 1,
        grams: s.metric_serving_amount && s.metric_serving_unit === "g" ? num(s.metric_serving_amount) : null,
        calories: numOrNull(s.calories),
        protein: numOrNull(s.protein),
        carbs: numOrNull(s.carbohydrate),
        fat: numOrNull(s.fat)
    }));
    // The default serving (is_default) leads the list so the selector opens
    // on it; relative order is otherwise preserved.
    const defIdx = servings.findIndex(isDefaultServing);
    if (defIdx > 0) {
        const [d] = servingList.splice(defIdx, 1);
        servingList.unshift(d);
    }

    return {
        id: String(f.food_id || ""),
        name: String(f.food_name || ""),
        brand: String(f.brand_name || ""),
        type: f.food_type === "Brand" ? "brand" : "generic",
        servings: servingList
    };
}

// ------------------------------------------------------------
// AUTHORITATIVE NUTRITION RESOLUTION (server-side)
//
// Used by the meal routes so a tampered client can never store its own
// numbers for a provider food: given providerFoodId + servingId (+ grams),
// this resolves name/brand/serving/nutrition from FatSecret (cached ≤6h)
// and returns the per-serving values plus the effective quantity.
// Throws BAD_INPUT / NOT_FOUND / PROVIDER_* on failure — callers reject
// the meal rather than trusting client values.
// ------------------------------------------------------------
async function resolveFoodNutrition({ providerFoodId, servingId, grams, quantity }) {
    const id = String(providerFoodId || "");
    if (!/^\d{1,15}$/.test(id)) {
        const err = new Error("Invalid provider food id");
        err.code = "BAD_INPUT";
        throw err;
    }

    let food = cacheGet(id);
    if (!food) {
        food = await getFood(id); // throws on provider failure
        cacheSet(id, food);
    }

    const servings = food.servings || [];
    if (servings.length === 0) {
        const err = new Error("Provider food has no servings");
        err.code = "PROVIDER_ERROR";
        throw err;
    }
    const serving = servings.find((s) => s.id === String(servingId)) || servings[0];

    // Storage needs numbers; v4 detail responses always carry them, but a
    // null here must never reach the DB as NaN/null.
    const n0 = (v) => (Number.isFinite(v) ? v : 0);

    // effective quantity: grams mode (grams / serving-grams) when a valid
    // gram weight is supplied and the serving has a gram basis; else quantity
    let effective = Number(quantity);
    if (!Number.isFinite(effective) || effective <= 0) effective = 1;
    const g = Number(grams);
    if (Number.isFinite(g) && g > 0 && serving.grams > 0) {
        effective = g / serving.grams;
    }
    effective = Math.min(50, Math.max(0.01, effective));

    return {
        name: food.brand ? `${food.brand} ${food.name}` : food.name,
        brand: food.brand || "",
        servingDescription: serving.description,
        servingId: serving.id,
        servingGrams: serving.grams,
        quantity: Math.round(effective * 100) / 100,
        calories: n0(serving.calories),
        protein: n0(serving.protein),
        carbs: n0(serving.carbs),
        fat: n0(serving.fat)
    };
}

// Barcode lookup — Premier-exclusive per the docs. If the app is ever
// upgraded to a Premier key this is the ONLY place to enable it:
// method=food.find_id_for_barcode (scope "barcode"), then food.get.v4.
async function lookupBarcode(barcode) {
    const err = new Error("Barcode lookup requires a FatSecret Premier plan");
    err.code = "PREMIER_REQUIRED";
    throw err;
}

// Photo recognition — Premier-exclusive per the docs. Intentionally not
// implemented against undocumented endpoints. See
// server/services/imageRecognitionService.js for the provider abstraction
// that a Premier key or a third-party vision provider plugs into.
async function analyzePhoto() {
    const err = new Error("Photo analysis requires a FatSecret Premier plan or a vision provider");
    err.code = "PREMIER_REQUIRED";
    throw err;
}

// ------------------------------------------------------------
// What the current credentials actually enable — drives honest UI states.
//
// `configured` only means the env vars exist. `search`/`foodDetails` are
// true only when a provider token can actually be obtained right now
// (cached, so this costs one token request per deployment per ~24h).
// `providerError` distinguishes WHY search is unavailable:
//   "auth"         — FatSecret rejected the credentials (bad key/secret,
//                    or the account lacks access to the endpoint/scope)
//   "network"      — FatSecret is unreachable (DNS/timeout/outage)
//   "rate_limited" — provider rate limit / cooldown active
// Never exposes secrets, token contents, or raw upstream errors.
// ------------------------------------------------------------
async function capabilities() {
    const on = configured();
    const out = {
        configured: on,
        search: false,
        foodDetails: false,
        barcode: process.env.NUTRITION_BARCODE_ENABLED === "true",
        photo: process.env.NUTRITION_PHOTO_ENABLED === "true",
        providerError: null
    };
    if (!on) return out;

    try {
        await getAccessToken(); // cached — free on warm deployments
        out.search = true;
        out.foodDetails = true;
    } catch (e) {
        if (e.code === "PROVIDER_AUTH") out.providerError = "auth";
        else if (e.code === "PROVIDER_DOWN") out.providerError = "network";
        else if (e.code === "RATE_LIMITED" || e.code === "PROVIDER_DOWN_COOLDOWN") out.providerError = "rate_limited";
        else out.providerError = "network";
    }
    return out;
}

module.exports = {
    configured,
    getAccessToken,
    searchFoods,
    getFood,
    resolveFoodNutrition,
    lookupBarcode,
    analyzePhoto,
    capabilities,
    // exposed for tests
    _internals: { normalizeSearchHit, parseDescriptionNutrition, pickDefaultServing, callApi, clearCaches: () => { foodCache.clear(); tokenCache = { token: null, expiresAt: 0 }; } }
};
