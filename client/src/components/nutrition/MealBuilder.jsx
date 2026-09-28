import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, ConfirmDialog } from "../ui/Primitives";
import { toGrams, clampGrams, totalsFor, scaleRow, fmt, fmtG, UNIT_OPTIONS } from "../../utils/nutritionMath";
import IngredientPicker from "./IngredientPicker";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function guessMealType() {
    const h = new Date().getHours();
    if (h < 11) return "breakfast";
    if (h < 15) return "lunch";
    if (h < 21) return "dinner";
    return "snack";
}

let rowSeq = 0;

/**
 * Multi-ingredient meal builder (Part 1B).
 * Add several ingredients via the shared food search, edit quantities/units,
 * remove rows, and watch totals recalculate deterministically in real time.
 * Nothing is saved until "Save meal" — cancel discards everything.
 */
export default function MealBuilder({ open, onClose, capabilities, onSaved, initialIngredients = null, initialName = "", editingRecipe = null }) {
    const { toast } = useStore();
    const editing = !!editingRecipe;

    const [name, setName] = useState(editingRecipe ? editingRecipe.name : initialName);
    const [mealType, setMealType] = useState(editingRecipe ? editingRecipe.mealType : guessMealType());
    const [rows, setRows] = useState(() =>
        editingRecipe
            ? (editingRecipe.ingredients || []).map((ing) => ({
                key: `r${++rowSeq}`,
                foodKind: ing.foodKind,
                foodId: ing.foodId,
                name: ing.displayName,
                brand: ing.brand,
                per100g: ing.per100g,
                unit: ing.unit || "g",
                quantity: String(ing.quantity ?? ing.grams),
                grams: ing.grams,
                servingSizeG: null,
                portionPerUnitG: null,
            }))
            : (initialIngredients || []).map((ing) => ({ ...ing, key: `r${++rowSeq}`, quantity: String(ing.quantity ?? ing.grams) }))
    );
    const [saving, setSaving] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false); // ingredient picker layered above

    // Reset when (re)opening for a different recipe / fresh build.
    useEffect(() => {
        if (open) {
            setPickerOpen(false);
            setConfirmDiscard(false);
        }
    }, [open, editingRecipe]);

    // ---- row management (stable keys: inputs never remount mid-typing) ----
    const addIngredient = useCallback((item) => {
        setRows((prev) => {
            const unit = item.unit || "g";
            const defaultQty = unit === "g" ? 100 : 1;
            const g = clampGrams(item.grams ?? 100);
            return [...prev, {
                key: `r${++rowSeq}`,
                foodKind: item.foodKind || "corpus",
                foodId: item.foodId,
                name: item.name,
                brand: item.brand || null,
                per100g: item.per100g,
                // known unit weights carried from the food detail so unit
                // chips (piece/serving/scoop) can convert deterministically
                portionPerUnitG: item.portionPerUnitG ?? null,
                servingSizeG: item.servingSizeG ?? null,
                unit,
                quantity: String(defaultQty),
                grams: g,
            }];
        });
        setPickerOpen(false); // close the picker back into the builder
    }, []);

    function removeRow(key) {
        setRows((prev) => prev.filter((r) => r.key !== key));
    }

    // Recompute grams when quantity or unit changes. Missing conversions
    // surface as grams=null and flag the row — never a silent zero.
    function setRowAmount(key, quantity, unit) {
        setRows((prev) => prev.map((r) => {
            if (r.key !== key) return r;
            const q = quantity;
            const u = unit ?? r.unit;
            const foodLike = { portionPerUnitG: r.portionPerUnitG, servingSizeG: r.servingSizeG };
            const g = toGrams(Number(q), u, foodLike);
            return { ...r, quantity: q, unit: u, grams: g == null ? null : g };
        }));
    }

    // ---- totals: deterministic client arithmetic (server re-validates) ----
    const totals = useMemo(() => totalsFor(rows.filter((r) => r.grams != null)), [rows]);
    const anyMissing = rows.some((r) => r.grams == null || r.per100g?.kcal == null);

    const canSave = name.trim().length > 0 && rows.length > 0 && rows.every((r) => r.grams != null) && !saving;

    async function save() {
        if (!canSave) return;
        setSaving(true);
        const payload = {
            name: name.trim(),
            mealType,
            ingredients: rows.map((r) => ({
                foodKind: r.foodKind,
                foodId: r.foodId,
                grams: r.grams,
                quantity: Number(r.quantity) || r.grams,
                unit: r.unit,
                // nutrition values intentionally NOT sent — server resolves
            })),
        };
        try {
            const res = editing
                ? await api.patch(`/nutrition/library/recipes/${editingRecipe._id}`, payload)
                : await api.post("/nutrition/library/recipes", payload);
            toast(editing ? "Meal updated" : "Meal saved — find it under My Meals");
            onSaved && onSaved(res.data.recipe);
            onClose();
        } catch (e) {
            toast(e.response?.data?.message || "Failed to save the meal");
        } finally {
            setSaving(false);
        }
    }

    function requestClose() {
        if (rows.length > 0 && !saving) setConfirmDiscard(true);
        else onClose();
    }

    return (
        <>
            <Modal
                open={open}
                onClose={requestClose}
                title={editing ? "Edit meal" : "Build a meal"}
                subtitle="Add each ingredient — totals update as you go. Save it to reuse any day."
                large
                actions={
                    <>
                        <button className="btn ghost" onClick={requestClose} disabled={saving}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={!canSave}>
                            {saving ? "Saving…" : editing ? "Save changes" : "Save meal"}
                        </button>
                    </>
                }
            >
                <Field label="Meal name">
                    <input
                        className="input"
                        placeholder='e.g. "Protein oats", "Homemade chicken momos"'
                        value={name}
                        maxLength={160}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                    />
                </Field>

                <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Meal type" style={{ marginTop: 12 }}>
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

                {/* ---- ingredient rows ---- */}
                {rows.length > 0 && (
                    <div className="grid" style={{ gap: 8, marginTop: 14 }}>
                        {rows.map((r) => {
                            const contribution = r.grams != null ? scaleRow(r.per100g, r.grams) : null;
                            return (
                                <div key={r.key} className="card plain nutrition-builder-row">
                                    <div className="nutrition-builder-row-head">
                                        <span className="nutrition-meal-name">{r.brand ? `${r.brand} ` : ""}{r.name}</span>
                                        <button className="icon-btn" onClick={() => removeRow(r.key)} aria-label={`Remove ${r.name}`}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    <div className="nutrition-serving-row">
                                        <Field label="Quantity">
                                            <input
                                                className="input"
                                                type="number"
                                                inputMode="decimal"
                                                min="0.01"
                                                step="any"
                                                value={r.quantity}
                                                onChange={(e) => setRowAmount(r.key, e.target.value)}
                                            />
                                        </Field>
                                        <Field label="Unit">
                                            <select
                                                className="input"
                                                value={r.unit}
                                                onChange={(e) => setRowAmount(r.key, r.quantity, e.target.value)}
                                            >
                                                {UNIT_OPTIONS.filter((u) => u.value === "g" || u.value === "ml" || u.value === r.unit || toGrams(Number(r.quantity), u.value, { portionPerUnitG: r.portionPerUnitG, servingSizeG: r.servingSizeG }) != null).map((u) => (
                                                    <option key={u.value} value={u.value}>{u.label}</option>
                                                ))}
                                            </select>
                                        </Field>
                                    </div>
                                    {r.grams != null ? (
                                        <p className="hint" style={{ marginTop: 6 }}>
                                            {Math.round(r.grams)} g
                                            {r.per100g?.kcal == null
                                                ? " · energy not reported for this food"
                                                : ` · ${fmt(contribution.kcal)} kcal · P ${fmtG(contribution.protein_g)} · C ${fmtG(contribution.carbs_g)} · F ${fmtG(contribution.fat_g)}`}
                                        </p>
                                    ) : (
                                        <p className="hint nutrition-missing" role="status">
                                            <AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                                            No known gram weight for “{r.unit}” — switch to grams, or log this ingredient with a weight.
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <button className="btn ghost wide" style={{ marginTop: 10 }} onClick={() => setPickerOpen(true)} disabled={!capabilities?.search}>
                    <Plus size={15} /> {rows.length ? "Add another ingredient" : "Add first ingredient"}
                </button>

                {/* ---- live totals preview ---- */}
                <div className="card plain" style={{ padding: "12px 14px", marginTop: 14 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="p-label">MEAL TOTAL{rows.length ? ` · ${rows.length} INGREDIENT${rows.length === 1 ? "" : "S"}` : ""}</span>
                        {anyMissing && <span className="hint">some rows missing weights</span>}
                    </div>
                    <div className="nutrition-macros" style={{ marginTop: 8 }}>
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
                    <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
                        Deterministic totals from each ingredient's nutrition data — recalculated server-side when saved.
                    </p>
                </div>
            </Modal>

            {/* ingredient picker layered above the builder */}
            <IngredientPicker
                open={pickerOpen}
                capabilities={capabilities}
                onPick={addIngredient}
                onClose={() => setPickerOpen(false)}
            />

            <ConfirmDialog
                open={confirmDiscard}
                onClose={() => setConfirmDiscard(false)}
                onConfirm={() => { setConfirmDiscard(false); onClose(); }}
                title="Discard this meal?"
                message="Your ingredients and name won't be saved. This can't be undone."
                confirmLabel="Discard"
                danger
            />
        </>
    );
}
