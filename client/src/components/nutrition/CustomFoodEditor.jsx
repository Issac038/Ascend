import { useState } from "react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field } from "../ui/Primitives";

/**
 * Custom food flow (Part 1A.10): name, optional brand, serving unit/weight,
 * nutrition values. Values may be entered per 100 g or per serving; when
 * per-serving is chosen the serving weight is REQUIRED so the server can
 * normalize everything to the per-100g basis deterministically.
 * Saved foods are reusable from My Foods and the search.
 */
export default function CustomFoodEditor({ open, onClose, food = null, onSaved }) {
    const { toast } = useStore();
    const editing = !!food;
    const [name, setName] = useState(food?.name || "");
    const [brand, setBrand] = useState(food?.brand || "");
    const [basis, setBasis] = useState(food?.basis || "per_100g");
    const [servingSizeG, setServingSizeG] = useState(food?.servingSizeG ? String(food.servingSizeG) : "");
    const [kcal, setKcal] = useState(food?.kcal != null ? String(Math.round(food.kcal)) : "");
    const [protein, setProtein] = useState(food?.protein_g != null ? String(food.protein_g) : "");
    const [carbs, setCarbs] = useState(food?.carbs_g != null ? String(food.carbs_g) : "");
    const [fat, setFat] = useState(food?.fat_g != null ? String(food.fat_g) : "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // client-side mirror of the server validation — fast feedback, server is authority
    function validate() {
        if (!name.trim()) return "Give the food a name.";
        const k = Number(kcal);
        if (!Number.isFinite(k) || k < 0 || k > 950) return "Calories must be between 0 and 950.";
        for (const [label, v] of [["Protein", protein], ["Carbs", carbs], ["Fat", fat]]) {
            if (v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 200)) return `${label} must be between 0 and 200 g.`;
        }
        if (basis === "per_serving") {
            const g = Number(servingSizeG);
            if (!Number.isFinite(g) || g < 1 || g > 5000) return "Enter the serving weight in grams (1–5000) so values can be converted.";
            if (kcal * (100 / g) > 950) return "Calories per 100 g would exceed 950 — check the values.";
        }
        const macroKcal = (Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9;
        if (macroKcal > k * 1.6 + 60) return "Protein/carbs/fat don't add up to the calories — check the values.";
        return null;
    }

    async function save() {
        const v = validate();
        if (v) { setError(v); return; }
        setError(null);
        setSaving(true);
        try {
            const body = {
                name: name.trim(),
                brand: brand.trim() || null,
                basis,
                servingSizeG: basis === "per_serving" ? Number(servingSizeG) : (servingSizeG ? Number(servingSizeG) : null),
                kcal: Number(kcal),
                protein_g: protein === "" ? null : Number(protein),
                carbs_g: carbs === "" ? null : Number(carbs),
                fat_g: fat === "" ? null : Number(fat),
            };
            const res = editing
                ? await api.patch(`/nutrition/library/foods/${food._id}`, body)
                : await api.post("/nutrition/library/foods", body);
            toast(editing ? "Food updated" : "Food saved — find it under My Foods");
            onSaved && onSaved(res.data.food);
            onClose();
        } catch (e) {
            setError(e.response?.data?.message || "Failed to save the food");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={editing ? "Edit food" : "Create a custom food"}
            subtitle={editing ? "Changes apply to future logs — already-logged meals stay as they were." : "Save it once, reuse it any time from My Foods."}
            actions={
                <>
                    <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save food"}</button>
                </>
            }
        >
            <Field label="Food name">
                <input className="input" placeholder="e.g. Amma's fish curry" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Brand (optional)" style={{ marginTop: 12 }}>
                <input className="input" placeholder="Leave empty for homemade" value={brand} maxLength={120} onChange={(e) => setBrand(e.target.value)} autoComplete="off" />
            </Field>

            <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Value basis" style={{ marginTop: 14 }}>
                <button type="button" role="radio" aria-checked={basis === "per_100g"} className={`nutrition-mealtype-btn${basis === "per_100g" ? " active" : ""}`} onClick={() => setBasis("per_100g")}>
                    Per 100 g
                </button>
                <button type="button" role="radio" aria-checked={basis === "per_serving"} className={`nutrition-mealtype-btn${basis === "per_serving" ? " active" : ""}`} onClick={() => setBasis("per_serving")}>
                    Per serving
                </button>
            </div>

            {basis === "per_serving" && (
                <Field label="Serving weight (grams)" hint="Needed so any quantity can be converted precisely." style={{ marginTop: 12 }}>
                    <input className="input" type="number" inputMode="decimal" min="1" max="5000" placeholder="e.g. 80" value={servingSizeG} onChange={(e) => setServingSizeG(e.target.value)} />
                </Field>
            )}

            <div className="nutrition-manual-grid" style={{ marginTop: 14 }}>
                <Field label="Calories">
                    <input className="input" type="number" inputMode="decimal" min="0" placeholder="kcal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
                </Field>
                <Field label="Protein (g)">
                    <input className="input" type="number" inputMode="decimal" min="0" placeholder="g" value={protein} onChange={(e) => setProtein(e.target.value)} />
                </Field>
                <Field label="Carbs (g)">
                    <input className="input" type="number" inputMode="decimal" min="0" placeholder="g" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
                </Field>
                <Field label="Fat (g)">
                    <input className="input" type="number" inputMode="decimal" min="0" placeholder="g" value={fat} onChange={(e) => setFat(e.target.value)} />
                </Field>
            </div>

            {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
            <p className="hint" style={{ marginTop: 10 }}>
                These are values you entered — the app marks them as user-provided everywhere they appear.
            </p>
        </Modal>
    );
}
