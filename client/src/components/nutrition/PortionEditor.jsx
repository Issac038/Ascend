import { useEffect, useMemo, useState } from "react";
import { Modal, Field } from "../ui/Primitives";
import { portionAnchors, toGrams, totalsFor, fmtG, UNIT_OPTIONS } from "../../utils/nutritionMath";

// Portion / quantity selection for one food (corpus or custom).
//
// Everything shown is deterministic arithmetic over the per-100g snapshot:
// choosing grams scales every nutrient by grams/100. Unit conversions are
// only offered when a KNOWN gram weight backs the unit (portion anchor or
// declared serving weight); unknown ones never appear as options. Real
// not-reported values stay distinct from zero: "—" means not reported.
export default function PortionEditor({ open, food, mealType, setMealType, saving, onClose, onConfirm }) {
    const [quantity, setQuantity] = useState("");
    const [unit, setUnit] = useState("g");

    // portion anchors from the food row (FNDDS standard portions) — only
    // KNOWN weights produce an anchor
    const anchors = useMemo(() => portionAnchors(food), [food]);

    // available units: g/ml always; unit-weights only when known
    const unitOptions = useMemo(() => {
        const known = new Set(["g", "ml"]);
        for (const a of anchors) {
            if (a.unit === "piece" || a.unit === "serving") known.add(a.unit);
        }
        if (food?.servingSizeG) known.add("scoop");
        return UNIT_OPTIONS.filter((u) => known.has(u.value));
    }, [anchors, food]);

    // reset when a different food is opened
    useEffect(() => {
        setQuantity("100");
        setUnit("g");
    }, [food]);

    // per-100g snapshot (null = not reported — stays distinct from 0)
    const per100 = useMemo(() => food?.per100g || {}, [food]);

    const gramsNum = useMemo(() => {
        const q = Number(quantity);
        if (!Number.isFinite(q) || q <= 0) return null;
        const g = toGrams(q, unit, food);
        return g;
    }, [quantity, unit, food]);

    // Deterministic scaling — the entire calculation, exactly like the
    // server does it: nutrient x grams/100.
    const totals = useMemo(() => (gramsNum != null ? totalsFor([{ per100g: per100, grams: gramsNum }]) : null), [gramsNum, per100]);

    const canLog = gramsNum != null && per100.kcal != null;

    const ingredients = useMemo(() => {
        if (!food || gramsNum == null) return [];
        if (food.custom) {
            return [{
                origin: "custom_food",
                sourceFoodId: food.customFoodId,
                grams: Math.round(gramsNum * 10) / 10,
            }];
        }
        return [{
            origin: "db_search",
            sourceFoodId: food.foodId,
            displayName: food.brand ? `${food.brand} ${food.name}` : food.name,
            grams: Math.round(gramsNum * 10) / 10,
        }];
    }, [food, gramsNum]);

    if (!open || !food) return null;

    const fmtKcal = (v) => (v == null ? "—" : Math.round(v).toLocaleString());

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={food.name}
            subtitle={food.brand || undefined}
            large
            actions={
                <>
                    <button className="btn ghost" onClick={onClose} disabled={saving}>Back</button>
                    <button className="btn primary" onClick={() => onConfirm(ingredients)} disabled={saving || !canLog}>
                        {saving ? "Saving…" : canLog ? `Add — ${fmtKcal(totals?.kcal)} kcal` : "Add"}
                    </button>
                </>
            }
        >
            <p className="hint" style={{ marginTop: 0 }}>
                {food.custom
                    ? "Your custom food · user-provided values. Pick a portion — every value below scales deterministically."
                    : "Nutrition per 100 g. Pick a portion — every value below scales deterministically."}
            </p>

            {anchors.length > 0 && (
                <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Portion presets">
                    {anchors.map((a) => (
                        <button
                            key={a.label}
                            type="button"
                            role="radio"
                            aria-checked={unit === a.unit && Number(quantity) === a.quantity && Math.round(gramsNum || 0) === Math.round(a.grams)}
                            className={`nutrition-mealtype-btn${unit === a.unit && Number(quantity) === a.quantity && Math.round(gramsNum || 0) === Math.round(a.grams) ? " active" : ""}`}
                            onClick={() => { setUnit(a.unit); setQuantity(String(a.quantity)); }}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="field-row nutrition-serving-row">
                <Field label="Quantity">
                    <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="any"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                    />
                </Field>
                <Field label="Unit">
                    <select
                        className="input"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                    >
                        {unitOptions.map((u) => (
                            <option key={u.value} value={u.value}>{u.label}</option>
                        ))}
                    </select>
                </Field>
            </div>

            <div className="card plain" style={{ padding: "12px 14px", marginTop: 4 }}>
                {per100.kcal == null ? (
                    <p className="hint" style={{ marginBottom: 0 }} role="alert">
                        This food has no energy value recorded — it cannot be logged. Create a custom food with its nutrition instead.
                    </p>
                ) : (
                    <>
                        <div className="nutrition-macros" style={{ marginTop: 0 }}>
                            <div className="nutrition-macro">
                                <span className="nutrition-macro-label">Calories</span>
                                <span className="mono-num">{fmtKcal(totals?.kcal)}<span className="nutrition-macro-unit"> kcal</span></span>
                            </div>
                            <div className="nutrition-macro">
                                <span className="nutrition-macro-label">Protein</span>
                                <span className="mono-num">{fmtG(totals?.protein_g)}<span className="nutrition-macro-unit"> g</span></span>
                            </div>
                            <div className="nutrition-macro">
                                <span className="nutrition-macro-label">Carbs</span>
                                <span className="mono-num">{fmtG(totals?.carbs_g)}<span className="nutrition-macro-unit"> g</span></span>
                            </div>
                            <div className="nutrition-macro">
                                <span className="nutrition-macro-label">Fat</span>
                                <span className="mono-num">{fmtG(totals?.fat_g)}<span className="nutrition-macro-unit"> g</span></span>
                            </div>
                        </div>
                        <p className="hint" style={{ marginBottom: 0 }}>
                            {gramsNum != null
                                ? `${Math.round(per100.kcal)} kcal per 100 g × ${Math.round(gramsNum * 10) / 10} g — exact arithmetic, no guessing.`
                                : "No known gram weight for that unit — switch to grams."}
                        </p>
                    </>
                )}
            </div>

            <PortionMealType mealType={mealType} setMealType={setMealType} />
        </Modal>
    );
}

function PortionMealType({ mealType, setMealType }) {
    return (
        <div style={{ marginTop: 12 }}>
            <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Meal type">
                {["breakfast", "lunch", "dinner", "snack"].map((t) => (
                    <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={mealType === t}
                        className={`nutrition-mealtype-btn${mealType === t ? " active" : ""}`}
                        onClick={() => setMealType(t)}
                    >
                        {t[0].toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>
        </div>
    );
}
