import { useState } from "react";
import { Trash2 } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, ConfirmDialog } from "../ui/Primitives";

// Edit an existing meal: change meal type, adjust per-food quantity/grams,
// remove foods, or delete the whole meal. Totals are recomputed server-side.
export default function MealEditor({ meal, onClose, onSaved }) {
    const { toast } = useStore();
    const [mealType, setMealType] = useState(meal.mealType);
    const [foods, setFoods] = useState(meal.foods.map((f) => ({ ...f })));
    const [notes, setNotes] = useState(meal.notes || "");
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const totals = foods.reduce(
        (acc, f) => {
            const q = Number(f.quantity) || 1;
            acc.calories += (Number(f.calories) || 0) * q;
            acc.protein += (Number(f.protein) || 0) * q;
            acc.carbs += (Number(f.carbs) || 0) * q;
            acc.fat += (Number(f.fat) || 0) * q;
            return acc;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    function updateFood(idx, patch) {
        setFoods((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
    }

    async function save() {
        setSaving(true);
        try {
            await api.put(`/nutrition/meals/${meal._id}`, {
                mealType,
                notes,
                foods: foods.map((f) => ({
                    provider: f.provider,
                    providerFoodId: f.providerFoodId,
                    name: f.name,
                    brand: f.brand || "",
                    servingDescription: f.servingDescription || "",
                    servingId: f.servingId || null,
                    quantity: Number(f.quantity) || 1,
                    grams: f.grams != null ? Number(f.grams) : null,
                    calories: Number(f.calories) || 0,
                    protein: Number(f.protein) || 0,
                    carbs: Number(f.carbs) || 0,
                    fat: Number(f.fat) || 0,
                    estimated: !!f.estimated
                }))
            });
            toast("Meal updated");
            onClose();
            onSaved();
        } catch (e) {
            toast(e.response?.data?.message || "Failed to update meal");
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        setSaving(true);
        try {
            await api.delete(`/nutrition/meals/${meal._id}`);
            toast("Meal deleted");
            setConfirmDelete(false);
            onClose();
            onSaved();
        } catch {
            toast("Failed to delete meal");
            setSaving(false);
        }
    }

    return (
        <>
            <Modal
                open
                onClose={onClose}
                title="Edit meal"
                subtitle={meal.foods.map((f) => f.name).join(" + ")}
                large
                actions={
                    <>
                        <button className="btn danger ghost" style={{ marginRight: "auto" }} onClick={() => setConfirmDelete(true)}>
                            <Trash2 size={14} /> Delete
                        </button>
                        <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={saving || foods.length === 0}>
                            {saving ? "Saving…" : `Save — ${Math.round(totals.calories).toLocaleString()} kcal`}
                        </button>
                    </>
                }
            >
                <Field label="Meal">
                    <select className="input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                        <option value="breakfast">Breakfast</option>
                        <option value="lunch">Lunch</option>
                        <option value="dinner">Dinner</option>
                        <option value="snack">Snack</option>
                    </select>
                </Field>

                <div className="grid" style={{ gap: 10, marginTop: 4 }}>
                    {foods.map((f, idx) => (
                        <div key={idx} className="card plain nutrition-edit-food">
                            <div className="nutrition-edit-food-head">
                                <span className="nutrition-meal-name">{f.name}</span>
                                <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFoods((prev) => prev.filter((_, i) => i !== idx))}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <p className="hint">{f.servingDescription || "per serving"} · {Math.round((f.calories || 0) * (Number(f.quantity) || 1))} kcal each serving</p>
                            <div className="field-row nutrition-serving-row">
                                <Field label="Quantity">
                                    <input
                                        className="input"
                                        type="number"
                                        inputMode="decimal"
                                        min="0.01"
                                        max="50"
                                        step="0.25"
                                        value={f.quantity}
                                        onChange={(e) => updateFood(idx, { quantity: e.target.value })}
                                    />
                                </Field>
                                {f.provider === "fatsecret" && f.grams != null && (
                                    <Field label="Grams">
                                        <input
                                            className="input"
                                            type="number"
                                            inputMode="numeric"
                                            min="0"
                                            value={f.grams || ""}
                                            onChange={(e) => updateFood(idx, { grams: e.target.value === "" ? null : Number(e.target.value) })}
                                        />
                                    </Field>
                                )}
                            </div>
                            {f.estimated && <span className="badge">estimated — photo</span>}
                        </div>
                    ))}
                </div>

                <Field label="Notes (optional)">
                    <input className="input" maxLength={500} placeholder="e.g. homemade, extra ghee" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
            </Modal>

            <ConfirmDialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                onConfirm={remove}
                title="Delete this meal?"
                message="This removes the meal and its nutrition from the day's totals. This cannot be undone."
                confirmLabel="Delete meal"
                danger
                busy={saving}
            />
        </>
    );
}
