import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Flame, Beef, Wheat, UtensilsCrossed, Trash2 } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { PageSkeleton, EmptyState, ConfirmDialog } from "../ui/Primitives";
import { formatShort, todayKey } from "../../utils/format";
import AddFood from "./AddFood";
import MealEditor from "./MealEditor";

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };

// Mirrors the server's dayTotals exactly (per-100g snapshot x grams/100,
// x portionEatenFraction, display-rounded) so the day's summary updates
// instantly and identically when an entry is deleted.
function recalcDay(meals) {
    const acc = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
    for (const m of meals) {
        const p = m.portionEatenFraction == null ? 1 : m.portionEatenFraction;
        for (const r of m.ingredients || []) {
            const s = r.nutrientSnapshot || {};
            const f = (r.grams / 100) * p;
            acc.kcal += (s.kcal || 0) * f;
            acc.protein_g += (s.protein_g || 0) * f;
            acc.carbs_g += (s.carbs_g || 0) * f;
            acc.fat_g += (s.fat_g || 0) * f;
        }
    }
    // display regime B: kcal from rounded macros (matches the server exactly)
    const protein_g = acc.protein_g < 10 ? Math.round(acc.protein_g * 10) / 10 : Math.round(acc.protein_g);
    const fat_g = acc.fat_g < 10 ? Math.round(acc.fat_g * 10) / 10 : Math.round(acc.fat_g);
    const carbs_g = acc.carbs_g < 10 ? Math.round(acc.carbs_g * 10) / 10 : Math.round(acc.carbs_g);
    return {
        totals: {
            kcal: Math.round(protein_g * 4 + carbs_g * 4 + fat_g * 9),
            protein_g,
            fat_g,
            carbs_g,
        },
    };
}

export default function Nutrition() {
    const { toast, settings, applySettings } = useStore();
    const [date, setDate] = useState(todayKey());
    const [data, setData] = useState(null); // { date, meals, totals, today }
    const [loadError, setLoadError] = useState(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editingMeal, setEditingMeal] = useState(null);
    const [capabilities, setCapabilities] = useState(null);
    const [confirmMeal, setConfirmMeal] = useState(null); // entry awaiting delete confirmation
    const [deletingMealId, setDeletingMealId] = useState(null); // in-flight delete (prevents double delete)

    const load = useCallback(async function load(d) {
        try {
            setLoadError(null);
            const res = await api.get("/nutrition/meals", { params: { date: d } });
            setData(res.data);
        } catch {
            setLoadError("Could not load meals. Check your connection and try again.");
        }
    }, []);

    useEffect(() => {
        load(date);
    }, [date, load]);

    useEffect(() => {
        api.get("/nutrition/capabilities")
            .then((res) => setCapabilities(res.data.capabilities))
            .catch(() => setCapabilities({ configured: false, search: false, foodDetails: false, barcode: false, photo: false }));
    }, []);

    function shiftDate(n) {
        const d = new Date(date + "T12:00:00");
        d.setDate(d.getDate() + n);
        setDate(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        );
    }

    const byType = useMemo(() => {
        const map = { breakfast: [], lunch: [], dinner: [], snack: [] };
        for (const m of data?.meals || []) {
            if (map[m.mealType]) map[m.mealType].push(m);
        }
        return map;
    }, [data]);

    const totals = data?.totals || { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const target = settings?.nutrition?.dailyCalorieTarget || null;
    const remaining = target != null ? target - totals.kcal : null;
    const pct = target != null ? Math.min(100, Math.round((totals.kcal / target) * 100)) : null;

    async function saveTarget(value) {
        // optimistic + refetch — Settings PATCH validates server-side
        try {
            const res = await api.patch("/settings", { nutrition: { dailyCalorieTarget: value } });
            applySettings(res.data.settings);
        } catch {
            toast("Failed to save calorie target");
        }
    }

    function onSaved(updated) {
        // A correction endpoint returns the updated meal — swap it in
        // locally and recompute; otherwise refetch the day.
        if (updated && updated._id && data) {
            setData((prev) => {
                if (!prev) return prev;
                const meals = prev.meals.map((m) => (m._id === updated._id ? updated : m));
                return { ...prev, meals, ...recalcDay(meals) };
            });
        } else {
            load(date);
        }
    }

    // Delete the confirmed entry via the existing authenticated endpoint,
    // then remove it locally and recompute totals with the server's exact
    // formula. On failure the entry stays and a safe message is shown.
    async function confirmDeleteMeal() {
        const meal = confirmMeal;
        if (!meal || deletingMealId) return; // guard: no duplicate DELETE
        setDeletingMealId(meal._id);
        try {
            await api.delete(`/nutrition/meals/${meal._id}`);
            setConfirmMeal(null);
            setData((prev) => {
                if (!prev) return prev;
                const meals = prev.meals.filter((m) => m._id !== meal._id);
                return { ...prev, meals, ...recalcDay(meals) };
            });
            toast("Entry deleted");
        } catch {
            toast("Couldn't delete this food. Please try again.");
        } finally {
            setDeletingMealId(null);
        }
    }

    if (data === null && !loadError) return <PageSkeleton />;

    return (
        <div className="page-fade nutrition-page">
            <div className="page-head">
                <div>
                    <h1>Nutrition</h1>
                    <p className="sub">Fuel the machine. Track what goes in.</p>
                </div>
                <button className="btn primary" onClick={() => setAddOpen(true)} disabled={!capabilities?.search}>
                    <Plus size={16} /> Add Food
                </button>
            </div>

            {capabilities && !capabilities.configured && (
                <div className="card plain nutrition-notice">
                    The nutrition food corpus isn't loaded on the server yet — search is unavailable until it is.
                    Meals you have already logged still show below, and everything else in ASCEND is unaffected.
                </div>
            )}

            {/* ---- date navigation ---- */}
            <div className="nutrition-datebar">
                <button className="icon-btn nutrition-datebtn" onClick={() => shiftDate(-1)} aria-label="Previous day">
                    <ChevronLeft size={18} />
                </button>
                <button
                    className={`nutrition-datetitle${date === (data?.today || todayKey()) ? " is-today" : ""}`}
                    onClick={() => setDate(todayKey())}
                    title="Jump to today"
                >
                    {date === (data?.today || todayKey()) ? `TODAY — ${formatShort(date).toUpperCase()}` : formatShort(date).toUpperCase()}
                </button>
                <button className="icon-btn nutrition-datebtn" onClick={() => shiftDate(1)} aria-label="Next day">
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* ---- daily summary ---- */}
            <div className="card nutrition-summary">
                <div className="nutrition-kcal">
                    <div>
                        <div className="p-label">CALORIES</div>
                        <div className="nutrition-kcal-big mono-num">{(totals.kcal || 0).toLocaleString()}<span> kcal</span></div>
                    </div>
                    {target != null ? (
                        <div className="nutrition-target">
                            <div className="mono-num nutrition-kcal-goal">{(totals.kcal || 0).toLocaleString()} / {target.toLocaleString()} kcal</div>
                            <div className={remaining < 0 ? "over" : ""}>
                                {remaining >= 0 ? `${remaining.toLocaleString()} kcal remaining` : `${Math.abs(remaining).toLocaleString()} kcal over`}
                            </div>
                            <div className="progress-track thin" style={{ marginTop: 6 }}>
                                <div className="progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                    ) : (
                        <CalorieTargetInline value={settings?.nutrition?.dailyCalorieTarget} onSave={saveTarget} />
                    )}
                </div>
                <div className="nutrition-macros">
                    <Macro icon={<Flame size={13} />} label="Protein" value={totals.protein_g} unit="g" />
                    <Macro icon={<Beef size={13} />} label="Carbs" value={totals.carbs_g} unit="g" />
                    <Macro icon={<Wheat size={13} />} label="Fat" value={totals.fat_g} unit="g" />
                </div>
                <p className="hint nutrition-disclaimer">
                    {target != null
                        ? "Calorie target is your own tracking goal — not medical advice."
                        : "Totals are calculated from your saved meals. Not medical advice."}
                </p>
            </div>

            {loadError && (
                <div className="card plain nutrition-notice" role="alert">
                    {loadError}{" "}
                    <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={() => load(date)}>Retry</button>
                </div>
            )}

            {/* ---- meal sections ---- */}
            {data && data.meals.length === 0 ? (
                <EmptyState
                    icon={<UtensilsCrossed size={34} />}
                    title="No meals logged"
                    message={date === (data?.today || todayKey())
                        ? "Log what you eat — search any food, from chicken biryani to pepperoni pizza."
                        : `Nothing was logged on ${formatShort(date)}.`}
                    action={capabilities?.search && (
                        <button className="btn primary" onClick={() => setAddOpen(true)}>
                            <Plus size={16} /> Add your first food
                        </button>
                    )}
                />
            ) : (
                <div className="grid" style={{ gap: 12 }}>
                    {MEAL_ORDER.map((type) => (
                        <MealSection
                            key={type}
                            type={type}
                            meals={byType[type]}
                            onEdit={setEditingMeal}
                            onAdd={() => setAddOpen(true)}
                            onDelete={setConfirmMeal}
                            deleteBusy={!!deletingMealId}
                        />
                    ))}
                </div>
            )}

            {/* ---- add food modal (search / photo / barcode) ---- */}
            <AddFood
                open={addOpen}
                onClose={() => setAddOpen(false)}
                date={date}
                capabilities={capabilities}
                onSaved={onSaved}
            />

            {/* ---- edit meal modal ---- */}
            {editingMeal && (
                <MealEditor
                    meal={editingMeal}
                    onClose={() => setEditingMeal(null)}
                    onSaved={onSaved}
                />
            )}

            {/* ---- delete entry confirmation ---- */}
            <ConfirmDialog
                open={!!confirmMeal}
                onClose={() => !deletingMealId && setConfirmMeal(null)}
                onConfirm={confirmDeleteMeal}
                title="Delete this food entry?"
                message={confirmMeal
                    ? `${(confirmMeal.ingredients || []).map((r) => r.displayName).join(" + ")}${confirmMeal.totals?.kcal ? ` — ${confirmMeal.totals.kcal.toLocaleString()} kcal` : ""} will be removed from the day's totals. This cannot be undone.`
                    : ""}
                confirmLabel="Delete"
                danger
                busy={!!deletingMealId}
            />
        </div>
    );
}

function Macro({ icon, label, value, unit }) {
    return (
        <div className="nutrition-macro">
            <span className="nutrition-macro-icon">{icon}</span>
            <span className="nutrition-macro-label">{label}</span>
            <span className="mono-num">{Math.round(value || 0)}<span className="nutrition-macro-unit">{unit}</span></span>
        </div>
    );
}

function CalorieTargetInline({ value, onSave }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(value || "");

    if (!editing) {
        return (
            <button className="btn ghost small" onClick={() => setEditing(true)}>
                Set a daily calorie target
            </button>
        );
    }
    return (
        <div className="row" style={{ gap: 8 }}>
            <input
                className="input"
                type="number"
                inputMode="numeric"
                min="800"
                max="10000"
                style={{ width: 110 }}
                placeholder="kcal"
                value={val}
                autoFocus
                onChange={(e) => setVal(e.target.value)}
            />
            <button
                className="btn primary small"
                onClick={() => {
                    const n = Number(val);
                    if (Number.isFinite(n) && n >= 800 && n <= 10000) {
                        onSave(Math.round(n));
                        setEditing(false);
                    }
                }}
            >
                Save
            </button>
        </div>
    );
}

function mealKcal(m) {
    const p = m.portionEatenFraction == null ? 1 : m.portionEatenFraction;
    return Math.round((m.ingredients || []).reduce((s, r) => s + ((r.nutrientSnapshot?.kcal || 0) * r.grams) / 100, 0) * p);
}

function MealSection({ type, meals, onEdit, onAdd, onDelete, deleteBusy }) {
    const kcal = meals.reduce((s, m) => s + mealKcal(m), 0);
    return (
        <div className="card nutrition-meal-section">
            <div className="nutrition-section-head">
                <span className="p-label">{MEAL_LABELS[type].toUpperCase()}</span>
                <span className="row" style={{ gap: 10 }}>
                    {kcal > 0 && <span className="mono-num nutrition-section-kcal">{kcal.toLocaleString()} kcal</span>}
                    <button className="icon-btn" onClick={onAdd} aria-label={`Add food to ${MEAL_LABELS[type]}`}>
                        <Plus size={16} />
                    </button>
                </span>
            </div>

            {meals.length === 0 ? (
                <p className="hint">Nothing logged.</p>
            ) : (
                <div className="grid" style={{ gap: 8 }}>
                    {meals.map((m) => (
                        <div key={m._id} className="nutrition-meal-row-wrap">
                            <button className="nutrition-meal-row" onClick={() => onEdit(m)} aria-label={`Edit ${(m.ingredients || []).map((r) => r.displayName).join(", ")}`}>
                                <div className="nutrition-meal-info">
                                    <span className="nutrition-meal-name">
                                        {(m.ingredients || []).map((r) => r.displayName).join(" + ")}
                                    </span>
                                    <span className="hint">
                                        {(m.ingredients || []).some((r) => r.isEstimate) ? "contains estimates" : MEAL_LABELS[m.mealType]}
                                        {m.portionEatenFraction != null && m.portionEatenFraction < 1 ? ` · ate ${Math.round(m.portionEatenFraction * 100)}%` : ""}
                                        {m.notes ? ` · ${m.notes}` : ""}
                                    </span>
                                </div>
                                <span className="mono-num nutrition-meal-kcal">{mealKcal(m).toLocaleString()}<span> kcal</span></span>
                            </button>
                            <button
                                className="nutrition-meal-delete"
                                onClick={() => onDelete(m)}
                                disabled={deleteBusy}
                                aria-label={`Delete ${(m.ingredients || []).map((r) => r.displayName).join(", ")}`}
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
