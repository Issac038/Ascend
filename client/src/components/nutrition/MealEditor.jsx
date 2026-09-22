import { useState } from "react";
import { Trash2 } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, ConfirmDialog } from "../ui/Primitives";

// Edit an existing meal — the correction flow.
//
// Every edit is a DETERMINISTIC change applied through the dedicated
// correction endpoints (grams, portion eaten, remove row), exactly like
// Nut AI's repair loop: arithmetic over stored per-100g snapshots, no model
// call anywhere. The meal band updates from the server's response.
export default function MealEditor({ meal, onClose, onSaved }) {
    const { toast } = useStore();
    const [rows, setRows] = useState((meal.ingredients || []).map((r) => ({ ...r })));
    const [portion, setPortion] = useState(meal.portionEatenFraction ?? 1);
    const [busyId, setBusyId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const kcal = rows.reduce((s, r) => {
        const snap = r.nutrientSnapshot || {};
        return s + (snap.kcal || 0) * (r.grams / 100);
    }, 0) * portion;

    function replaceMeal(next) {
        setRows((next.ingredients || []).map((r) => ({ ...r })));
        setPortion(next.portionEatenFraction ?? 1);
        onSaved(next);
    }

    // Correction: edit grams on one row (the ONE quantity the user edits).
    async function setRowGrams(row, gramsText) {
        const grams = Number(gramsText);
        if (!Number.isFinite(grams) || grams < 1 || grams > 5000 || grams === row.grams) return;
        setBusyId(row.id);
        try {
            const res = await api.patch(`/nutrition/meals/${meal._id}/rows/${encodeURIComponent(row.id)}/grams`, { grams });
            replaceMeal(res.data.meal);
            toast("Portion updated — recalculated");
        } catch (e) {
            toast(e.response?.data?.message || "Failed to update portion");
        } finally {
            setBusyId(null);
        }
    }

    // Correction: "I ate about half of this plate."
    async function setPortionEaten(value) {
        const p = Number(value);
        if (!Number.isFinite(p) || p < 0.05 || p > 1 || p === portion) return;
        setBusyId("portion");
        try {
            const res = await api.patch(`/nutrition/meals/${meal._id}/portion`, { portionEatenFraction: p });
            replaceMeal(res.data.meal);
            toast("Portion eaten updated");
        } catch (e) {
            toast(e.response?.data?.message || "Failed to update portion eaten");
        } finally {
            setBusyId(null);
        }
    }

    // Correction: remove one ingredient row ("there was no cheese").
    async function removeRow(row) {
        setBusyId(row.id);
        try {
            const res = await api.delete(`/nutrition/meals/${meal._id}/rows/${encodeURIComponent(row.id)}`);
            if (res.data.deleted) {
                toast("Meal removed — no ingredients left");
                onSaved();
                onClose();
                return;
            }
            replaceMeal(res.data.meal);
            toast("Ingredient removed — recalculated");
        } catch (e) {
            toast(e.response?.data?.message || "Failed to remove ingredient");
        } finally {
            setBusyId(null);
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
                subtitle={(meal.ingredients || []).map((r) => r.displayName).join(" + ")}
                large
                actions={
                    <>
                        <button className="btn danger ghost" style={{ marginRight: "auto" }} onClick={() => setConfirmDelete(true)}>
                            <Trash2 size={14} /> Delete
                        </button>
                        <button className="btn ghost" onClick={onClose} disabled={saving}>Done</button>
                    </>
                }
            >
                <p className="hint" style={{ marginTop: 0 }}>
                    Each change recalculates instantly from the stored nutrition data — nothing is re-guessed.
                </p>

                {/* rank-1 question: did you eat all of it? */}
                <Field label="How much of this did you eat?">
                    <select
                        className="input"
                        value={String(portion)}
                        disabled={busyId === "portion"}
                        onChange={(e) => setPortionEaten(e.target.value)}
                    >
                        <option value="1">All of it</option>
                        <option value="0.75">About three quarters</option>
                        <option value="0.5">About half</option>
                        <option value="0.25">A little</option>
                    </select>
                </Field>

                <div className="grid" style={{ gap: 10, marginTop: 4 }}>
                    {rows.map((r) => {
                        const snap = r.nutrientSnapshot || {};
                        const rowKcal = (snap.kcal || 0) * (r.grams / 100) * portion;
                        return (
                            <div key={r.id} className="card plain nutrition-edit-food">
                                <div className="nutrition-edit-food-head">
                                    <span className="nutrition-meal-name">{r.displayName}</span>
                                    <button
                                        className="icon-btn"
                                        aria-label={`Remove ${r.displayName}`}
                                        disabled={busyId === r.id}
                                        onClick={() => removeRow(r)}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <p className="hint">
                                    {snap.kcal != null ? `${Math.round(snap.kcal)} kcal per 100 g` : "energy not reported"}
                                    {r.isEstimate ? " · AI estimate" : ""}
                                </p>
                                <div className="field-row nutrition-serving-row">
                                    <Field label="Grams">
                                        <input
                                            className="input"
                                            type="number"
                                            inputMode="decimal"
                                            min="1"
                                            max="5000"
                                            defaultValue={r.grams}
                                            disabled={busyId === r.id}
                                            onBlur={(e) => setRowGrams(r, e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                                        />
                                    </Field>
                                    <Field label="Calories">
                                        <span className="mono-num" style={{ lineHeight: "42px" }}>
                                            {Math.round(rowKcal).toLocaleString()} kcal
                                        </span>
                                    </Field>
                                </div>
                                {r.assumptions?.filter((a) => !a.userConfirmed).length > 0 && (
                                    <p className="hint" style={{ marginTop: 6 }}>
                                        Assumed: {r.assumptions.filter((a) => !a.userConfirmed).map((a) => a.type).join("; ")}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="card plain" style={{ padding: "12px 14px", marginTop: 10 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="p-label">MEAL TOTAL</span>
                        {meal.band && meal.band.tier !== "none" && (
                            <span className="hint">
                                {meal.band.tier === "tight" ? "±15%" : meal.band.tier === "moderate" ? "±30%" : "±45%+"}
                            </span>
                        )}
                    </div>
                    <div className="mono-num" style={{ fontSize: 22 }}>
                        {Math.round(kcal).toLocaleString()} kcal
                    </div>
                </div>
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
