const express = require("express");

const auth = require("../middleware/auth");
const { NutritionCustomFood, NutritionFoodRef, NutritionRecipe, GRAMS_MAX } = require("../models/NutritionLibrary");
const { Meal } = require("../models/Meal");
const engine = require("../nutrition/index");
const library = require("../nutrition/libraryService");
const searchService = require("../nutrition/searchService");
const { isValidDateKey, todayKeyFor } = require("../utils/date");
const User = require("../models/User");

const router = express.Router();

// ------------------------------------------------------------
// Personal nutrition library:
//   GET  /library            recent + favorites + custom + recipes in one call
//   GET  /library/search?q=  corpus search incl. custom foods, matchType labels
//   POST /library/foods      create custom food
//   GET  /library/foods      list custom foods
//   PATCH /library/foods/:id edit custom food
//   DELETE /library/foods/:id delete custom food
//   POST /library/refs       favorite / record a food reference
//   PATCH /library/refs/:id  toggle favorite
//   DELETE /library/refs/:id remove reference
//   POST /library/recipes    save recipe
//   GET  /library/recipes    list recipes
//   PATCH /library/recipes/:id  edit recipe (never rewrites logged meals)
//   DELETE /library/recipes/:id delete recipe
//   POST /library/recipes/:id/log   log the recipe to the day (portions, mealType)
// All routes are auth-scoped: every query includes userId.
// ------------------------------------------------------------

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function validIdOr400(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id || ""));
}

function corpusColl() {
    return engine.resolver ? require("mongoose").connection.collection("nutrition_foods") : null;
}

function getColl() {
    return require("mongoose").connection.collection("nutrition_foods");
}

async function userTz(userId) {
    const u = await User.findById(userId).select("timezoneOffset").lean();
    return (u && u.timezoneOffset) || 0;
}

function foodRefKey(kind, sourceFoodId, customFoodId) {
    return kind === "corpus" ? { kind, sourceFoodId: String(sourceFoodId || ""), customFoodId: null } : { kind, sourceFoodId: null, customFoodId };
}

// ============================================================
// LIBRARY OVERVIEW — one call powers the "My Foods / My Meals" panel.
// ============================================================
router.get("/library", auth, async (req, res) => {
    try {
        const [refs, customFoods, recipes] = await Promise.all([
            NutritionFoodRef.find({ userId: req.userId }).sort({ lastLoggedAt: -1, updatedAt: -1 }).limit(40).lean(),
            NutritionCustomFood.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(100).lean(),
            NutritionRecipe.find({ userId: req.userId }).sort({ lastLoggedAt: -1, updatedAt: -1 }).limit(60).lean(),
        ]);

        const favorites = refs.filter((r) => r.favorite).slice(0, 24);
        const recents = refs.filter((r) => r.lastLoggedAt).slice(0, 24);

        res.json({
            success: true,
            favorites,
            recents,
            customFoods,
            recipes: recipes.map((r) => ({
                ...r,
                totalsPerPortion: library.recipeDisplayTotals(r.ingredients),
            })),
        });
    } catch (e) {
        console.error("library load error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load your saved foods" });
    }
});

// ============================================================
// SEARCH — corpus + custom foods, with matchType labels.
// ============================================================
router.get("/library/search", auth, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        if (!q) return res.status(400).json({ success: false, message: "Search query is required" });
        if (q.length > 120) return res.status(400).json({ success: false, message: "Search query is too long" });

        const { rows, matchType } = await searchService.searchFoods(getColl(), q, { limit: 12 });

        // user's own custom foods matching the query (name or brand)
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const customFoods = await NutritionCustomFood.find({
            userId: req.userId,
            $or: [
                { name: { $regex: esc, $options: "i" } },
                { brand: { $regex: esc, $options: "i" } },
            ],
        }).limit(4).lean();

        res.json({
            success: true,
            query: q,
            matchType,
            results: rows,
            customResults: customFoods.map((c) => ({
                customFoodId: String(c._id),
                name: c.name,
                brand: c.brand,
                basis: c.basis,
                servingSizeG: c.servingSizeG,
                per100g: { kcal: c.kcal, protein_g: c.protein_g, carbs_g: c.carbs_g, fat_g: c.fat_g },
            })),
        });
    } catch (e) {
        console.error("library search error:", e.message);
        res.status(500).json({ success: false, message: "Food search failed. Please try again.", code: "SEARCH_ERROR" });
    }
});

// ============================================================
// CUSTOM FOODS CRUD
// ============================================================
router.get("/library/foods", auth, async (req, res) => {
    try {
        const foods = await NutritionCustomFood.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(200).lean();
        res.json({ success: true, foods });
    } catch (e) {
        console.error("custom foods list error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load your foods" });
    }
});

router.post("/library/foods", auth, async (req, res) => {
    try {
        const normalized = library.normalizeCustomFoodInput(req.body || {});
        const food = await NutritionCustomFood.create({ ...normalized, userId: req.userId });
        res.status(201).json({ success: true, food });
    } catch (e) {
        if (e instanceof library.ValidationError) return res.status(400).json({ success: false, message: e.message });
        console.error("custom food create error:", e.message);
        res.status(500).json({ success: false, message: "Failed to save the food" });
    }
});

router.patch("/library/foods/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const food = await NutritionCustomFood.findOne({ _id: req.params.id, userId: req.userId });
        if (!food) return res.status(404).json({ success: false, message: "Food not found" });

        const normalized = library.normalizeCustomFoodInput({ ...food.toObject(), ...(req.body || {}) });
        Object.assign(food, normalized);
        await food.save();

        // keep denormalized recipe ingredient labels in sync (display only —
        // nutrition values in already-logged meals are never rewritten)
        await NutritionRecipe.updateMany(
            { userId: req.userId, "ingredients.foodKind": "custom", "ingredients.foodId": String(food._id) },
            {
                $set: {
                    "ingredients.$[el].displayName": food.brand ? `${food.brand} ${food.name}` : food.name,
                    "ingredients.$[el].brand": food.brand,
                    "ingredients.$[el].per100g.kcal": food.kcal,
                    "ingredients.$[el].per100g.protein_g": food.protein_g,
                    "ingredients.$[el].per100g.carbs_g": food.carbs_g,
                    "ingredients.$[el].per100g.fat_g": food.fat_g,
                },
            },
            { arrayFilters: [{ "el.foodKind": "custom", "el.foodId": String(food._id) }] }
        );
        const totals = library.recipeDisplayTotals(
            (await NutritionRecipe.find({ userId: req.userId }).lean()).flatMap((r) => r.ingredients)
        );

        res.json({ success: true, food });
    } catch (e) {
        if (e instanceof library.ValidationError) return res.status(400).json({ success: false, message: e.message });
        console.error("custom food update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update the food" });
    }
});

router.delete("/library/foods/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const food = await NutritionCustomFood.findOne({ _id: req.params.id, userId: req.userId });
        if (!food) return res.status(404).json({ success: false, message: "Food not found" });

        // Recipes referencing this food would log with a missing ingredient —
        // the user decides: block with a clear message listing the recipes.
        const usedBy = await NutritionRecipe.countDocuments({
            userId: req.userId,
            ingredients: { $elemMatch: { foodKind: "custom", foodId: String(food._id) } },
        });
        if (usedBy > 0) {
            return res.status(409).json({
                success: false,
                message: `This food is used in ${usedBy} saved meal${usedBy === 1 ? "" : "s"}. Delete or edit those meals first.`,
                code: "IN_USE",
            });
        }

        await food.deleteOne();
        await NutritionFoodRef.deleteMany({ userId: req.userId, kind: "custom", customFoodId: food._id });
        res.json({ success: true });
    } catch (e) {
        console.error("custom food delete error:", e.message);
        res.status(500).json({ success: false, message: "Failed to delete the food" });
    }
});

// ============================================================
// FOOD REFERENCES (favorites + recents)
// ============================================================
router.post("/library/refs", auth, async (req, res) => {
    try {
        const { kind, sourceFoodId, customFoodId, name, brand, favorite, logCountBump } = req.body || {};
        const refKind = kind === "custom" ? "custom" : "corpus";
        if (refKind === "corpus" && !sourceFoodId) return res.status(400).json({ success: false, message: "sourceFoodId is required" });
        if (refKind === "custom") {
            if (!customFoodId || !validIdOr400(customFoodId)) return res.status(400).json({ success: false, message: "customFoodId is required" });
        }
        const displayName = library.cleanText(name, "Name", { required: true, max: 200 });

        const key = foodRefKey(refKind, sourceFoodId, refKind === "custom" ? customFoodId : null);
        const update = {
            name: displayName,
            brand: library.cleanText(brand, "Brand", { max: 120 }),
        };
        if (favorite !== undefined) update.favorite = !!favorite;
        if (logCountBump) {
            update.$inc = { logCount: 1 };
            update.lastLoggedAt = new Date();
        }

        const ref = await NutritionFoodRef.findOneAndUpdate(
            { userId: req.userId, ...key },
            update,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        res.status(201).json({ success: true, ref });
    } catch (e) {
        console.error("food ref upsert error:", e.message);
        res.status(500).json({ success: false, message: "Failed to save the food reference" });
    }
});

router.patch("/library/refs/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const ref = await NutritionFoodRef.findOne({ _id: req.params.id, userId: req.userId });
        if (!ref) return res.status(404).json({ success: false, message: "Reference not found" });
        if (req.body && req.body.favorite !== undefined) ref.favorite = !!req.body.favorite;
        await ref.save();
        res.json({ success: true, ref });
    } catch (e) {
        console.error("food ref update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update the reference" });
    }
});

router.delete("/library/refs/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const ref = await NutritionFoodRef.findOne({ _id: req.params.id, userId: req.userId });
        if (!ref) return res.status(404).json({ success: false, message: "Reference not found" });
        await ref.deleteOne();
        res.json({ success: true });
    } catch (e) {
        console.error("food ref delete error:", e.message);
        res.status(500).json({ success: false, message: "Failed to remove the reference" });
    }
});

// ============================================================
// RECIPES ("My Meals")
// ============================================================
router.get("/library/recipes", auth, async (req, res) => {
    try {
        const recipes = await NutritionRecipe.find({ userId: req.userId }).sort({ lastLoggedAt: -1, updatedAt: -1 }).limit(100).lean();
        res.json({
            success: true,
            recipes: recipes.map((r) => ({ ...r, totalsPerPortion: library.recipeDisplayTotals(r.ingredients) })),
        });
    } catch (e) {
        console.error("recipes list error:", e.message);
        res.status(500).json({ success: false, message: "Failed to load your meals" });
    }
});

async function resolveIngredients(rawIngredients, userId) {
    if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) {
        throw new library.ValidationError("Add at least one ingredient");
    }
    if (rawIngredients.length > 30) throw new library.ValidationError("Too many ingredients (max 30)");
    const out = [];
    for (const raw of rawIngredients) {
        out.push(await library.resolveRecipeIngredient(raw, {
            corpusColl: getColl(),
            CustomFood: NutritionCustomFood,
            userId,
        }));
    }
    return out;
}

router.post("/library/recipes", auth, async (req, res) => {
    try {
        const name = library.cleanText((req.body || {}).name, "Meal name", { required: true });
        const notes = library.cleanText((req.body || {}).notes, "Notes", { max: 500 }) || "";
        const mealType = MEAL_TYPES.includes((req.body || {}).mealType) ? req.body.mealType : "snack";
        const ingredients = await resolveIngredients((req.body || {}).ingredients, req.userId);

        const recipe = await NutritionRecipe.create({
            userId: req.userId,
            name,
            notes,
            mealType,
            ingredients,
            totalsPerPortion: library.recipeDisplayTotals(ingredients), // recomputed server-side
        });
        res.status(201).json({ success: true, recipe: { ...recipe.toObject(), totalsPerPortion: library.recipeDisplayTotals(recipe.ingredients) } });
    } catch (e) {
        if (e instanceof library.ValidationError) return res.status(400).json({ success: false, message: e.message });
        console.error("recipe create error:", e.message);
        res.status(500).json({ success: false, message: "Failed to save the meal" });
    }
});

router.patch("/library/recipes/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const recipe = await NutritionRecipe.findOne({ _id: req.params.id, userId: req.userId });
        if (!recipe) return res.status(404).json({ success: false, message: "Meal not found" });

        const body = req.body || {};
        if (body.name !== undefined) recipe.name = library.cleanText(body.name, "Meal name", { required: true });
        if (body.notes !== undefined) recipe.notes = library.cleanText(body.notes, "Notes", { max: 500 }) || "";
        if (body.mealType !== undefined) {
            if (!MEAL_TYPES.includes(body.mealType)) return res.status(400).json({ success: false, message: "Invalid meal type" });
            recipe.mealType = body.mealType;
        }
        if (body.ingredients !== undefined) {
            recipe.ingredients = await resolveIngredients(body.ingredients, req.userId);
        }
        recipe.totalsPerPortion = library.recipeDisplayTotals(recipe.ingredients); // recomputed server-side
        await recipe.save();
        res.json({ success: true, recipe: { ...recipe.toObject(), totalsPerPortion: library.recipeDisplayTotals(recipe.ingredients) } });
    } catch (e) {
        if (e instanceof library.ValidationError) return res.status(400).json({ success: false, message: e.message });
        console.error("recipe update error:", e.message);
        res.status(500).json({ success: false, message: "Failed to update the meal" });
    }
});

router.delete("/library/recipes/:id", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const recipe = await NutritionRecipe.findOne({ _id: req.params.id, userId: req.userId });
        if (!recipe) return res.status(404).json({ success: false, message: "Meal not found" });
        await recipe.deleteOne();
        res.json({ success: true });
    } catch (e) {
        console.error("recipe delete error:", e.message);
        res.status(500).json({ success: false, message: "Failed to delete the meal" });
    }
});

// LOG a recipe to a day — copies ingredient rows (with snapshots) into a
// Meal. Historical meals are never rewritten. Portions scale deterministically.
router.post("/library/recipes/:id/log", auth, async (req, res) => {
    try {
        if (!validIdOr400(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
        const recipe = await NutritionRecipe.findOne({ _id: req.params.id, userId: req.userId });
        if (!recipe) return res.status(404).json({ success: false, message: "Meal not found" });

        const tz = await userTz(req.userId);
        const date = isValidDateKey((req.body || {}).date) ? req.body.date : todayKeyFor(tz);
        const mealType = MEAL_TYPES.includes((req.body || {}).mealType) ? req.body.mealType : recipe.mealType;

        const { rows, portions } = library.buildMealRowsFromRecipe(recipe, (req.body || {}).portions ?? 1);

        const meal = await Meal.create({
            userId: req.userId,
            date,
            mealType,
            source: "db_search",
            notes: (recipe.name ? `recipe: ${recipe.name}` : "") + ((req.body || {}).notes ? ` · ${String(req.body.notes).slice(0, 200)}` : ""),
            portionEatenFraction: 1,
            ingredients: rows,
        });

        // usage tracking (non-blocking for the response)
        recipe.lastLoggedAt = new Date();
        recipe.logCount = (recipe.logCount || 0) + 1;
        await recipe.save().catch(() => {});

        res.status(201).json({
            success: true,
            meal: mealView(meal),
            portions,
        });
    } catch (e) {
        if (e instanceof library.ValidationError) return res.status(400).json({ success: false, message: e.message });
        console.error("recipe log error:", e.message);
        res.status(500).json({ success: false, message: "Failed to log the meal" });
    }
});

function mealView(meal) {
    const obj = meal.toObject ? meal.toObject() : meal;
    const raw = engine.totals.recomputeTotals(obj);
    return { ...obj, totals: engine.totals.toDisplayTotals(raw) };
}

module.exports = router;
