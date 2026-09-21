import { useEffect, useMemo, useState } from "react";
import { Modal, Field } from "../ui/Primitives";

// Serving / portion selection for one FatSecret food.
// Shows every serving the API returns; quantity multiplies the nutrition.
// Grams input is enabled when the serving has a metric gram amount.
export default function ServingSelector({ open, food, mealType, setMealType, saving, onClose, onConfirm }) {
    const servings = food?.servings || [];
    const [servingIdx, setServingIdx] = useState(0);
    const [quantity, setQuantity] = useState(1);
    const [grams, setGrams] = useState("");

    // reset when a different food is opened
    useEffect(() => {
        setServingIdx(0);
        setQuantity(1);
        setGrams("");
    }, [food?.id]);

    const serving = servings[servingIdx] || servings[0] || null;

    // nutrition per one serving (memoized so downstream useMemo deps are stable).
    // null means the provider gave nothing for this value — kept distinct
    // from a real 0 so display can show "—" instead of fabricating zero.
    const per = useMemo(
        () => ({
            calories: serving?.calories ?? null,
            protein: serving?.protein ?? null,
            carbs: serving?.carbs ?? null,
            fat: serving?.fat ?? null
        }),
        [serving]
    );

    // grams → quantity override (quantity = grams / serving grams)
    const effectiveQuantity = useMemo(() => {
        const g = Number(grams);
        if (Number.isFinite(g) && g > 0 && serving?.grams) {
            return Math.min(50, Math.max(0.01, g / serving.grams));
        }
        const q = Number(quantity);
        return Number.isFinite(q) && q > 0 ? Math.min(50, Math.max(0.01, q)) : 1;
    }, [grams, quantity, serving]);

    const foods = useMemo(() => {
        if (!serving) return [];
        return [{
            provider: "fatsecret",
            providerFoodId: food.id,
            name: food.brand ? `${food.brand} ${food.name}` : food.name,
            brand: food.brand || "",
            servingDescription: serving.description,
            servingId: serving.id,
            quantity: Math.round(effectiveQuantity * 100) / 100,
            grams: Number(grams) > 0 ? Number(grams) : null,
            calories: per.calories,
            protein: per.protein,
            carbs: per.carbs,
            fat: per.fat,
            estimated: false
        }];
    }, [serving, food, effectiveQuantity, grams, per]);

    const totals = {
        calories: per.calories == null ? null : Math.round(per.calories * effectiveQuantity),
        protein: per.protein == null ? null : Math.round(per.protein * effectiveQuantity * 10) / 10,
        carbs: per.carbs == null ? null : Math.round(per.carbs * effectiveQuantity * 10) / 10,
        fat: per.fat == null ? null : Math.round(per.fat * effectiveQuantity * 10) / 10
    };

    if (!open || !food) return null;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={food.name}
            subtitle={food.brand || undefined}
            large
            actions={
                <>
                    <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn primary" onClick={() => onConfirm(foods)} disabled={saving || !serving}>
                        {saving ? "Saving…" : totals.calories == null ? "Add" : `Add — ${totals.calories.toLocaleString()} kcal`}
                    </button>
                </>
            }
        >
            <Field label="Serving">
                <select
                    className="input"
                    value={servingIdx}
                    onChange={(e) => { setServingIdx(Number(e.target.value)); setGrams(""); }}
                >
                    {servings.map((s, i) => (
                        <option key={s.id || i} value={i}>
                            {s.description}
                            {s.grams ? ` (${s.grams} g)` : s.metricAmount ? ` (${s.metricAmount} ${s.metricUnit})` : ""}
                        </option>
                    ))}
                </select>
            </Field>

            <div className="field-row nutrition-serving-row">
                <Field label="Quantity">
                    <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="50"
                        step="0.25"
                        value={quantity}
                        disabled={!!Number(grams)}
                        onChange={(e) => setQuantity(e.target.value)}
                    />
                </Field>
                <Field label={serving?.grams ? `Grams (${serving.grams} g per serving)` : "Grams"}>
                    <input
                        className="input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="5000"
                        placeholder={serving?.grams ? String(Math.round(serving.grams * quantity * 100) / 100) : "optional"}
                        value={grams}
                        disabled={!serving?.grams}
                        onChange={(e) => setGrams(e.target.value)}
                    />
                </Field>
            </div>

            <Field label="Meal">
                <select className="input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                    <option value="snack">Snack</option>
                </select>
            </Field>

            {/* live nutrition preview for the chosen amount */}
            <div className="nutrition-preview card plain">
                <div className="nutrition-preview-main">
                    <span className="p-label">NUTRITION FOR THIS AMOUNT</span>
                    <span className="mono-num nutrition-preview-kcal">{totals.calories == null ? "— kcal" : `${totals.calories.toLocaleString()} kcal`}</span>
                </div>
                <div className="nutrition-macros">
                    <div className="nutrition-macro"><span className="nutrition-macro-label">Protein</span><span className="mono-num">{totals.protein == null ? "—" : `${totals.protein} g`}</span></div>
                    <div className="nutrition-macro"><span className="nutrition-macro-label">Carbs</span><span className="mono-num">{totals.carbs == null ? "—" : `${totals.carbs} g`}</span></div>
                    <div className="nutrition-macro"><span className="nutrition-macro-label">Fat</span><span className="mono-num">{totals.fat == null ? "—" : `${totals.fat} g`}</span></div>
                </div>
                <p className="hint">Values per {serving?.description || "serving"} × {effectiveQuantity} — recalculated server-side when saved.</p>
            </div>
        </Modal>
    );
}
