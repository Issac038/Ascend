import { useEffect, useMemo, useState } from "react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field } from "../ui/Primitives";
import { scaleIngredients, totalsFor, fmt, fmtG } from "../../utils/nutritionMath";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

const PORTION_PRESETS = [
    { label: "½ portion", value: 0.5 },
    { label: "1 portion", value: 1 },
    { label: "1½ portions", value: 1.5 },
    { label: "2 portions", value: 2 },
];

/**
 * Log a saved recipe with a portions scale (0.25–5). The preview scales
 * every ingredient deterministically; the server recomputes and validates
 * the same arithmetic before storing — client totals are never trusted.
 */
export default function LogMealDialog({ open, recipe, date, onClose, onSaved }) {
    const { toast } = useStore();
    const [portions, setPortions] = useState("1");
    const [mealType, setMealType] = useState(recipe?.mealType || "snack");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open && recipe) {
            setPortions("1");
            setMealType(recipe.mealType || "snack");
        }
    }, [open, recipe]);

    const p = Number(portions);
    const scaled = useMemo(
        () => (recipe && Number.isFinite(p) && p > 0 ? scaleIngredients(recipe.ingredients || [], p) : recipe?.ingredients || []),
        [recipe, p]
    );
    const totals = useMemo(() => totalsFor(scaled), [scaled]);

    if (!open || !recipe) return null;

    async function save() {
        setSaving(true);
        try {
            const res = await api.post(`/nutrition/library/recipes/${recipe._id}/log`, {
                date,
                mealType,
                portions: p,
            });
            toast(`Logged ${p === 1 ? recipe.name : `${portions} × ${recipe.name}`}`);
            onSaved && onSaved(res.data.meal);
            onClose();
        } catch (e) {
            toast(e.response?.data?.message || "Failed to log the meal");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={`Log “${recipe.name}”`}
            subtitle={`${(recipe.ingredients || []).length} ingredients · saved meal`}
            actions={
                <>
                    <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn primary" onClick={save} disabled={saving || !Number.isFinite(p) || p <= 0}>
                        {saving ? "Logging…" : `Log — ${fmt(totals.kcal)} kcal`}
                    </button>
                </>
            }
        >
            <Field label="How much of the recipe?">
                <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min="0.25"
                    max="5"
                    step="0.25"
                    value={portions}
                    onChange={(e) => setPortions(e.target.value)}
                />
            </Field>
            <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Portion presets" style={{ marginTop: 8 }}>
                {PORTION_PRESETS.map((pr) => (
                    <button
                        key={pr.value}
                        type="button"
                        className={`nutrition-mealtype-btn${Number(portions) === pr.value ? " active" : ""}`}
                        onClick={() => setPortions(String(pr.value))}
                    >
                        {pr.label}
                    </button>
                ))}
            </div>

            <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Meal type" style={{ marginTop: 14 }}>
                {MEAL_TYPES.map((t) => (
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

            <div className="card plain" style={{ padding: "12px 14px", marginTop: 14 }}>
                <span className="p-label">PREVIEW · {portions || "?"} PORTION{p === 1 ? "" : "S"}</span>
                <div className="grid" style={{ gap: 4, marginTop: 8 }}>
                    {scaled.map((ing, i) => (
                        <div key={i} className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                            <span className="nutrition-meal-name" style={{ fontSize: 13 }}>{ing.displayName}</span>
                            <span className="hint mono-num">{Math.round(ing.grams)} g</span>
                        </div>
                    ))}
                </div>
                <div className="nutrition-macros" style={{ marginTop: 10 }}>
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
                <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>Ingredient ratios stay consistent at any portion size.</p>
            </div>
        </Modal>
    );
}
