import { useEffect, useMemo, useState } from "react";
import { Modal, Field } from "../ui/Primitives";

// Portion / quantity selection for one corpus food.
//
// Everything shown is deterministic arithmetic over the corpus per-100g
// snapshot: choosing grams scales every nutrient by grams/100 (Nut AI §6 —
// the ONE quantity the user edits directly). The per-100g snapshot is
// measured USDA data, so a chosen weight carries no estimation band; when a
// portion is estimated rather than typed, the pathway band comes from the
// server. Real 0 vs not-reported is preserved: "—" means the corpus row
// does not report that nutrient.
export default function PortionEditor({ open, food, mealType, setMealType, saving, onClose, onConfirm }) {
    const [grams, setGrams] = useState("");
    const [servings, setServings] = useState("");

    // portion anchors from the corpus row (FNDDS standard portions)
    const anchors = useMemo(() => {
        const list = [];
        if (food?.portionPerUnitG) list.push({ label: `1 unit (~${Math.round(food.portionPerUnitG)} g)`, g: food.portionPerUnitG });
        if (food?.portionSmallG) list.push({ label: `Small (~${Math.round(food.portionSmallG)} g)`, g: food.portionSmallG });
        if (food?.portionMediumG) list.push({ label: `Medium (~${Math.round(food.portionMediumG)} g)`, g: food.portionMediumG });
        if (food?.portionLargeG) list.push({ label: `Large (~${Math.round(food.portionLargeG)} g)`, g: food.portionLargeG });
        if (food?.servingSizeG && !list.some((a) => a.g === food.servingSizeG)) {
            list.push({ label: `1 serving (~${Math.round(food.servingSizeG)} g)`, g: food.servingSizeG });
        }
        list.push({ label: "100 g", g: 100 });
        return list;
    }, [food]);

    // reset when a different food is opened
    useEffect(() => {
        setGrams(food?.servingSizeG ? String(Math.round(food.servingSizeG)) : "100");
        setServings("");
    }, [food]);

    // per-100g snapshot (null = not reported — stays distinct from 0)
    const per100 = useMemo(() => food?.per100g || {}, [food]);

    const gramsNum = useMemo(() => {
        if (servings !== "" && Number(servings) > 0 && food?.servingSizeG) {
            return Math.min(5000, Math.max(1, Number(servings) * food.servingSizeG));
        }
        const g = Number(grams);
        return Number.isFinite(g) && g > 0 ? Math.min(5000, Math.max(1, g)) : 100;
    }, [grams, servings, food]);

    // Deterministic scaling — the entire calculation, exactly like the
    // server does it: nutrient x grams/100.
    const totals = useMemo(() => {
        const f = gramsNum / 100;
        const scale = (v) => (v == null ? null : v * f);
        return {
            kcal: scale(per100.kcal),
            protein_g: scale(per100.protein_g),
            carbs_g: scale(per100.carbs_g),
            fat_g: scale(per100.fat_g),
        };
    }, [gramsNum, per100]);

    const ingredients = useMemo(() => {
        if (!food) return [];
        return [{
            origin: "db_search",
            sourceFoodId: food.foodId,
            displayName: food.brand ? `${food.brand} ${food.name}` : food.name,
            grams: Math.round(gramsNum * 10) / 10,
        }];
    }, [food, gramsNum]);

    if (!open || !food) return null;

    const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString());
    const fmtG = (v) => (v == null ? "—" : Math.round(v * 10) / 10);

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
                    <button className="btn primary" onClick={() => onConfirm(ingredients)} disabled={saving}>
                        {saving ? "Saving…" : `Add — ${totals.kcal == null ? "?" : Math.round(totals.kcal).toLocaleString()} kcal`}
                    </button>
                </>
            }
        >
            <p className="hint" style={{ marginTop: 0 }}>
                Nutrition per 100 g{food.source ? ` · ${food.source === "fndds" ? "USDA FNDDS" : food.source === "foundation" ? "USDA Foundation" : "USDA SR Legacy"}` : ""}.
                Pick a portion — every value below scales deterministically.
            </p>

            {anchors.length > 1 && (
                <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Portion presets">
                    {anchors.map((a) => (
                        <button
                            key={a.label}
                            type="button"
                            role="radio"
                            aria-checked={Math.round(gramsNum) === Math.round(a.g)}
                            className={`nutrition-mealtype-btn${Math.round(gramsNum) === Math.round(a.g) ? " active" : ""}`}
                            onClick={() => { setGrams(String(Math.round(a.g))); setServings(""); }}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="field-row nutrition-serving-row">
                <Field label="Grams">
                    <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        min="1"
                        max="5000"
                        value={grams}
                        onChange={(e) => { setGrams(e.target.value); setServings(""); }}
                    />
                </Field>
                {food.servingSizeG ? (
                    <Field label={`Servings (${Math.round(food.servingSizeG)} g each)`}>
                        <input
                            className="input"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.25"
                            placeholder="—"
                            value={servings}
                            onChange={(e) => setServings(e.target.value)}
                        />
                    </Field>
                ) : null}
            </div>

            <div className="card plain" style={{ padding: "12px 14px", marginTop: 4 }}>
                <div className="nutrition-macros" style={{ marginTop: 0 }}>
                    <div className="nutrition-macro">
                        <span className="nutrition-macro-label">Calories</span>
                        <span className="mono-num">{fmt(totals.kcal)}<span className="nutrition-macro-unit"> kcal</span></span>
                    </div>
                    <div className="nutrition-macro">
                        <span className="nutrition-macro-label">Protein</span>
                        <span className="mono-num">{fmtG(totals.protein_g)}<span className="nutrition-macro-unit"> g</span></span>
                    </div>
                    <div className="nutrition-macro">
                        <span className="nutrition-macro-label">Carbs</span>
                        <span className="mono-num">{fmtG(totals.carbs_g)}<span className="nutrition-macro-unit"> g</span></span>
                    </div>
                    <div className="nutrition-macro">
                        <span className="nutrition-macro-label">Fat</span>
                        <span className="mono-num">{fmtG(totals.fat_g)}<span className="nutrition-macro-unit"> g</span></span>
                    </div>
                </div>
                <p className="hint" style={{ marginBottom: 0 }}>
                    {per100.kcal != null
                        ? `${Math.round(per100.kcal)} kcal per 100 g × ${gramsNum} g — exact arithmetic, no guessing.`
                        : "This corpus row lacks an energy value — it cannot be logged."}
                </p>
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
