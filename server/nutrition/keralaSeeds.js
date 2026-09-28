// ------------------------------------------------------------
// Curated seed foods that extend the local USDA corpus with the
// Kerala / Indian dishes, everyday snacks and brand-name products the
// USDA release simply does not cover (USDA FDC is CC0; these rows are
// common-knowledge compositions expressed per 100 g — the same single
// computational basis the corpus loader uses).
//
// Docs are written into the SAME nutrition_foods collection with
// source: "ascend_seed", so search, detail and meal rows treat them
// identically to USDA rows. Loader is IDEMPOTENT (replace by fdcId+source).
// ------------------------------------------------------------

// fdcId range chosen to never collide with real USDA ids (which are < 2,000,000 for SR/FNDDS and < 18,000,000 for Foundation; we use 90,000,000+).
const SEED_BASE = 90000000;

// name, aliasTokens, kcal/p/f/c/fiber/sugar/sodium per 100 g, servingSizeG
const SEEDS = [
    // ---- Kerala breakfast / snacks ----
    { fdcId: 1, name: "Pazham pori (ethakka appam)", aliases: ["pazham pori", "ethakka appam", "ethakkaappam", "banana fry", "banana fritter", "pazham pori kerala"], category: "Snacks", cuisine: "indian", kcal: 268, p: 3.1, f: 9.2, c: 44, fiber: 3.2, sugar: 17, sodium: 120, servingSizeG: 80, portionPerUnitG: 80, popularityRank: 1 },
    { fdcId: 2, name: "Appam", aliases: ["appam", "palappam", "aappam", "kallappam", "vellayappam"], category: "Breakfast", cuisine: "indian", kcal: 168, p: 3.8, f: 4.9, c: 28, fiber: 1.1, sugar: 0.6, sodium: 190, servingSizeG: 85, portionPerUnitG: 85, popularityRank: 2 },
    { fdcId: 3, name: "Puttu", aliases: ["puttu", "kerala puttu", "steam cake", "rice flour steamed"], category: "Breakfast", cuisine: "indian", kcal: 216, p: 6.2, f: 4.1, c: 38, fiber: 2.4, sugar: 0.4, sodium: 95, servingSizeG: 120, portionPerUnitG: 120, popularityRank: 3 },
    { fdcId: 4, name: "Idiyappam", aliases: ["idiyappam", "nool appam", "string hoppers", "sevai"], category: "Breakfast", cuisine: "indian", kcal: 172, p: 4.2, f: 2.1, c: 34, fiber: 1.6, sugar: 0.3, sodium: 80, servingSizeG: 90, portionPerUnitG: 90, popularityRank: 4 },
    { fdcId: 5, name: "Kerala parotta", aliases: ["kerala porotta", "parotta", "porotta", "malabar parotta", "porota"], category: "Bread", cuisine: "indian", kcal: 330, p: 6.8, f: 13.5, c: 45, fiber: 1.8, sugar: 1.2, sodium: 320, servingSizeG: 90, portionPerUnitG: 90, popularityRank: 5 },
    { fdcId: 6, name: "Chapati (roti)", aliases: ["chapati", "roti", "chappathi", "chappati", "phulka", "fulka"], category: "Bread", cuisine: "indian", kcal: 297, p: 9.6, f: 5.4, c: 51, fiber: 4.2, sugar: 0.8, sodium: 190, servingSizeG: 45, portionPerUnitG: 45, popularityRank: 6 },
    { fdcId: 7, name: "Dosa (plain)", aliases: ["dosa", "plain dosa", "sada dosa", "thosai"], category: "Breakfast", cuisine: "indian", kcal: 218, p: 6.2, f: 7.6, c: 31, fiber: 1.5, sugar: 0.5, sodium: 240, servingSizeG: 85, portionPerUnitG: 85, popularityRank: 7 },
    { fdcId: 8, name: "Masala dosa", aliases: ["masala dosa", "masala dose", "dosa masala"], category: "Breakfast", cuisine: "indian", kcal: 205, p: 4.9, f: 8.3, c: 27, fiber: 2.0, sugar: 1.4, sodium: 280, servingSizeG: 190, portionPerUnitG: 190, popularityRank: 8 },
    { fdcId: 9, name: "Idli", aliases: ["idli", "idly", "steamed rice cake"], category: "Breakfast", cuisine: "indian", kcal: 138, p: 4.5, f: 1.0, c: 28, fiber: 1.0, sugar: 0.3, sodium: 95, servingSizeG: 55, portionPerUnitG: 55, popularityRank: 9 },
    { fdcId: 10, name: "Medu vada", aliases: ["medu vada", "medhu vada", "vada", "urad dal vada", "uzhunnu vada"], category: "Snacks", cuisine: "indian", kcal: 296, p: 7.4, f: 15.6, c: 31, fiber: 2.3, sugar: 0.7, sodium: 260, servingSizeG: 40, portionPerUnitG: 40, popularityRank: 10 },
    { fdcId: 11, name: "Samosa", aliases: ["samosa", "punjabi samosa", "veg samosa"], category: "Snacks", cuisine: "indian", kcal: 308, p: 5.1, f: 17.2, c: 34, fiber: 2.6, sugar: 1.5, sodium: 360, servingSizeG: 60, portionPerUnitG: 60, popularityRank: 11 },

    // ---- Kerala curries / mains ----
    { fdcId: 12, name: "Sambar", aliases: ["sambar", "sambhar", "sambur"], category: "Curry", cuisine: "indian", kcal: 78, p: 3.6, f: 2.7, c: 10, fiber: 2.8, sugar: 2.0, sodium: 310, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 12 },
    { fdcId: 13, name: "Avial", aliases: ["avial", "aviyal", "mixed vegetable coconut curry"], category: "Curry", cuisine: "indian", kcal: 121, p: 3.2, f: 8.1, c: 9.5, fiber: 3.1, sugar: 3.0, sodium: 180, servingSizeG: 140, portionPerUnitG: 140, popularityRank: 13 },
    { fdcId: 14, name: "Kadala curry", aliases: ["kadala curry", "kadala", "chana masala kerala", "black chana curry", "kadala kari"], category: "Curry", cuisine: "indian", kcal: 142, p: 6.4, f: 5.8, c: 16, fiber: 4.5, sugar: 2.2, sodium: 330, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 14 },
    { fdcId: 15, name: "Kerala fish curry", aliases: ["fish curry", "meen curry", "kerala fish curry", "fish kuzhambu", "meen kuzhambu", "alleppey fish curry"], category: "Curry", cuisine: "indian", kcal: 108, p: 11.5, f: 5.6, c: 3.4, fiber: 0.9, sugar: 1.3, sodium: 420, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 15 },
    { fdcId: 16, name: "Chicken curry", aliases: ["chicken curry", "kerala chicken curry", "chicken kuzhambu", "chicken masala", "kori chicken curry"], category: "Curry", cuisine: "indian", kcal: 152, p: 13.8, f: 9.1, c: 3.2, fiber: 0.8, sugar: 1.5, sodium: 410, servingSizeG: 160, portionPerUnitG: 160, popularityRank: 16 },
    { fdcId: 17, name: "Chicken biryani", aliases: ["biryani", "biriyani", "chicken biriyani", "biriani"], category: "Mixed dishes", cuisine: "indian", kcal: 172, p: 8.5, f: 6.2, c: 20.1, fiber: 1.2, sugar: 1.1, sodium: 320, servingSizeG: 350, portionPerUnitG: 350, popularityRank: 17 },
    { fdcId: 18, name: "Egg curry", aliases: ["egg curry", "mutta curry", "egg masala", "mutta roast"], category: "Curry", cuisine: "indian", kcal: 128, p: 7.8, f: 8.6, c: 3.1, fiber: 0.7, sugar: 1.2, sodium: 380, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 18 },
    { fdcId: 19, name: "Paneer curry", aliases: ["paneer curry", "paneer butter masala", "palak paneer", "paneer masala"], category: "Curry", cuisine: "indian", kcal: 198, p: 9.4, f: 14.2, c: 7.8, fiber: 1.6, sugar: 2.4, sodium: 360, servingSizeG: 160, portionPerUnitG: 160, popularityRank: 19 },
    { fdcId: 20, name: "Dal (thoran-style lentil curry)", aliases: ["dal", "daal", "dhal", "parippu", "thoran dal", "lentil curry", "dal fry", "dal tadka"], category: "Curry", cuisine: "indian", kcal: 96, p: 5.2, f: 2.9, c: 12, fiber: 3.4, sugar: 1.1, sodium: 290, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 20 },
    { fdcId: 21, name: "Beef fry (Kerala style)", aliases: ["beef fry", "beef ularthiyathu", "kerala beef roast", "beef varattiyathu"], category: "Meat", cuisine: "indian", kcal: 226, p: 19.4, f: 15.2, c: 2.6, fiber: 0.6, sugar: 0.8, sodium: 440, servingSizeG: 140, portionPerUnitG: 140, popularityRank: 21 },
    { fdcId: 22, name: "Fish fry (Kerala style)", aliases: ["fish fry", "meen varuthathu", "fish pollichathu", "kingfish fry"], category: "Meat", cuisine: "indian", kcal: 187, p: 19.8, f: 10.4, c: 3.8, fiber: 0.5, sugar: 0.6, sodium: 390, servingSizeG: 130, portionPerUnitG: 130, popularityRank: 22 },

    // ---- everyday snacks / street food / meals ----
    { fdcId: 23, name: "Egg bun (bakery)", aliases: ["egg bun", "egg buns", "mutta bun", "bakery egg bun"], category: "Snacks", cuisine: "indian", kcal: 312, p: 8.2, f: 11.4, c: 43, fiber: 1.4, sugar: 5.2, sodium: 310, servingSizeG: 70, portionPerUnitG: 70, popularityRank: 23 },
    { fdcId: 24, name: "Bread omelette", aliases: ["bread omelette", "bread omlette", "bread omelet", "omelette sandwich", "bread omlet"], category: "Snacks", cuisine: "indian", kcal: 264, p: 11.2, f: 15.4, c: 21, fiber: 1.2, sugar: 2.1, sodium: 420, servingSizeG: 120, portionPerUnitG: 120, popularityRank: 24 },
    { fdcId: 25, name: "Chicken momos (steamed)", aliases: ["chicken momos", "steamed chicken momos", "momos", "momo", "chicken momo"], category: "Snacks", cuisine: "indian", kcal: 172, p: 10.8, f: 5.2, c: 20, fiber: 0.9, sugar: 0.8, sodium: 340, servingSizeG: 30, portionPerUnitG: 30, popularityRank: 25 },
    { fdcId: 26, name: "Paneer sandwich (grilled)", aliases: ["paneer sandwich", "grilled paneer sandwich", "paneer toast sandwich"], category: "Snacks", cuisine: "indian", kcal: 258, p: 11.6, f: 12.4, c: 24, fiber: 1.8, sugar: 2.6, sodium: 430, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 26 },
    { fdcId: 27, name: "Corn cheese sandwich (grilled)", aliases: ["corn cheese sandwich", "cheese corn sandwich", "corn sandwich", "sweet corn sandwich"], category: "Snacks", cuisine: "indian", kcal: 262, p: 9.8, f: 12.2, c: 28, fiber: 2.0, sugar: 3.4, sodium: 460, servingSizeG: 150, portionPerUnitG: 150, popularityRank: 27 },
    { fdcId: 28, name: "Instant noodles (Maggi, prepared)", aliases: ["maggi", "maggi noodles", "instant noodles", "noodles maggi", "masala noodles", "2 minute noodles"], category: "Snacks", cuisine: "indian", kcal: 158, p: 3.9, f: 6.6, c: 20.4, fiber: 1.2, sugar: 1.1, sodium: 520, servingSizeG: 205, portionPerUnitG: 205, popularityRank: 28 },
    { fdcId: 29, name: "Poha", aliases: ["poha", "aval", "flattened rice", "aval upma", "kanda poha"], category: "Breakfast", cuisine: "indian", kcal: 148, p: 3.4, f: 4.2, c: 24, fiber: 1.4, sugar: 1.0, sodium: 260, servingSizeG: 160, portionPerUnitG: 160, popularityRank: 29 },
    { fdcId: 30, name: "Upma", aliases: ["upma", " uppuma", "rava upma", "semolina upma"], category: "Breakfast", cuisine: "indian", kcal: 156, p: 4.1, f: 5.6, c: 22, fiber: 1.6, sugar: 0.9, sodium: 300, servingSizeG: 160, portionPerUnitG: 160, popularityRank: 30 },
    { fdcId: 31, name: "Pongal (ven pongal)", aliases: ["pongal", "ven pongal", "khara pongal"], category: "Breakfast", cuisine: "indian", kcal: 142, p: 4.0, f: 5.1, c: 19, fiber: 1.3, sugar: 0.5, sodium: 280, servingSizeG: 180, portionPerUnitG: 180, popularityRank: 31 },
    { fdcId: 32, name: "Rasam", aliases: ["rasam", "saaru", "thuli rasam"], category: "Curry", cuisine: "indian", kcal: 42, p: 1.6, f: 1.4, c: 6.0, fiber: 1.1, sugar: 1.6, sodium: 380, servingSizeG: 120, portionPerUnitG: 120, popularityRank: 32 },
    { fdcId: 33, name: "Thoran (vegetable stir fry)", aliases: ["thoran", "poriyal", "cabbage thoran", "beans thoran", "vegetable thoran"], category: "Side", cuisine: "indian", kcal: 108, p: 2.4, f: 6.8, c: 9.8, fiber: 3.2, sugar: 2.6, sodium: 210, servingSizeG: 120, portionPerUnitG: 120, popularityRank: 33 },
    { fdcId: 34, name: "Olan", aliases: ["olan", "kerala olan"], category: "Curry", cuisine: "indian", kcal: 92, p: 2.2, f: 5.4, c: 8.9, fiber: 2.4, sugar: 2.8, sodium: 170, servingSizeG: 140, portionPerUnitG: 140, popularityRank: 34 },
    { fdcId: 35, name: "Parippu vada", aliases: ["parippu vada", "masala vada", "dal vada", "parippuvada"], category: "Snacks", cuisine: "indian", kcal: 312, p: 8.6, f: 16.4, c: 32, fiber: 3.6, sugar: 1.0, sodium: 280, servingSizeG: 35, portionPerUnitG: 35, popularityRank: 35 },
    { fdcId: 36, name: "Sukhiyan", aliases: ["sukhiyan", "sugiyan", "sukhian"], category: "Snacks", cuisine: "indian", kcal: 286, p: 6.8, f: 12.6, c: 36, fiber: 3.0, sugar: 6.4, sodium: 210, servingSizeG: 45, portionPerUnitG: 45, popularityRank: 36 },
    { fdcId: 37, name: "Unniyappam", aliases: ["unniyappam", "unni appam"], category: "Snacks", cuisine: "indian", kcal: 324, p: 4.8, f: 13.2, c: 46, fiber: 1.4, sugar: 18, sodium: 130, servingSizeG: 35, portionPerUnitG: 35, popularityRank: 37 },
    { fdcId: 38, name: "Banana chips (Kerala)", aliases: ["banana chips", "nenthiran chips", "upperi", "kaya varuthathu", "kerala banana chips"], category: "Snacks", cuisine: "indian", kcal: 519, p: 3.4, f: 33.6, c: 58, fiber: 4.6, sugar: 12, sodium: 260, servingSizeG: 30, portionPerUnitG: 30, popularityRank: 38 },
    { fdcId: 39, name: "Idli sambar (plate)", aliases: ["idli sambar", "idly sambar"], category: "Mixed dishes", cuisine: "indian", kcal: 138, p: 4.6, f: 1.6, c: 26, fiber: 1.6, sugar: 1.0, sodium: 220, servingSizeG: 260, portionPerUnitG: 260, popularityRank: 39 },

    // ---- protein / fitness staples & brands ----
    { fdcId: 40, name: "Whey protein shake (with water)", aliases: ["protein shake", "whey shake", "whey protein", "protein drink", "whey"], category: "Protein", cuisine: null, kcal: 82, p: 16.8, f: 1.2, c: 2.2, fiber: 0.2, sugar: 1.0, sodium: 90, servingSizeG: 300, portionPerUnitG: 300, popularityRank: 40 },
    { fdcId: 41, name: "Yogabar protein oats (per serving)", aliases: ["yogabar protein oats", "yogabar oats", "yoga bar oats", "yogabar"], category: "Cereal", cuisine: null, kcal: 372, p: 18.9, f: 8.1, c: 51, fiber: 7.8, sugar: 6.2, sodium: 95, servingSizeG: 60, portionPerUnitG: 60, popularityRank: 41 },
    { fdcId: 42, name: "Protein oats bowl (homemade)", aliases: ["protein oats", "oats protein bowl", "oats with protein powder", "protein oatmeal"], category: "Cereal", cuisine: null, kcal: 148, p: 10.2, f: 3.6, c: 18, fiber: 2.8, sugar: 2.2, sodium: 70, servingSizeG: 300, portionPerUnitG: 300, popularityRank: 42 },
    { fdcId: 43, name: "Peanut butter (smooth)", aliases: ["peanut butter", "peanutbutter", "p b"], category: "Spread", cuisine: null, kcal: 588, p: 25.1, f: 50.4, c: 19.6, fiber: 6.0, sugar: 9.2, sodium: 430, servingSizeG: 32, portionPerUnitG: 32, popularityRank: 43 },
    { fdcId: 44, name: "Banana (medium)", aliases: ["banana", "kela", "bananas", "plantain raw"], category: "Fruit", cuisine: null, kcal: 89, p: 1.1, f: 0.3, c: 22.8, fiber: 2.6, sugar: 12.2, sodium: 1, servingSizeG: 118, portionPerUnitG: 118, popularityRank: 44 },
    { fdcId: 45, name: "Wheat pasta (cooked)", aliases: ["pasta", "cooked pasta", "macaroni", "penne"], category: "Grain", cuisine: "italian", kcal: 158, p: 5.8, f: 0.9, c: 30.9, fiber: 1.8, sugar: 0.6, sodium: 1, servingSizeG: 180, portionPerUnitG: 180, popularityRank: 45 },
];

const toDoc = (s) => ({
    fdcId: SEED_BASE + s.fdcId,
    source: "ascend_seed",
    name: s.name,
    brand: null,
    category: s.category,
    cuisine: s.cuisine,
    prepFacet: null,
    aliases: s.aliases,
    kcal: s.kcal,
    protein: s.p,
    fat: s.f,
    carb: s.c,
    fiber: s.fiber,
    sugar: s.sugar,
    sodium: s.sodium,
    portionPerUnitG: s.portionPerUnitG,
    portionSmallG: null,
    portionMediumG: null,
    portionLargeG: null,
    servingSizeG: s.servingSizeG,
    typicalMinG: null,
    typicalMaxG: null,
    completeness: 1,
    popularityRank: s.popularityRank,
    license: "Ascend seed data (common-knowledge composition, per 100 g)",
});

const SEED_DOCS = SEEDS.map(toDoc);

/**
 * Idempotently merge the seed docs into the corpus collection.
 * - Adds rows whose (fdcId, source) key is new.
 * - Refreshes nutrition numbers on existing seed rows (only rows written by
 *   this loader — USDA rows are never touched).
 * - DOES NOT delete: if a seed row is removed from this file, stale copies
 *   remain until manually cleared (kept deliberately simple + safe).
 */
async function seedKeralaFoods(coll) {
    const bulk = coll.initializeUnorderedBulkOp();
    for (const d of SEED_DOCS) {
        bulk.find({ fdcId: d.fdcId, source: d.source }).upsert().replaceOne(d);
    }
    await bulk.execute();
    return SEED_DOCS.length;
}

module.exports = { SEED_DOCS, seedKeralaFoods, SEED_BASE };
