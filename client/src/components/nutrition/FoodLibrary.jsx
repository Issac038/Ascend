import { useCallback, useEffect, useMemo, useState } from "react";
import { Star, Clock, ChefHat, Pencil, Trash2, History } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, ConfirmDialog, EmptyState } from "../ui/Primitives";
import { fmt } from "../../utils/nutritionMath";
import CustomFoodEditor from "./CustomFoodEditor";
import MealBuilder from "./MealBuilder";
import LogMealDialog from "./LogMealDialog";

const TABS = [
    { key: "recent", label: "Recent", icon: Clock },
    { key: "favorites", label: "Favorites", icon: Star },
    { key: "foods", label: "My Foods", icon: ChefHat },
    { key: "meals", label: "My Meals", icon: History },
];

/**
 * "My Foods / My Meals" (Part 1C): recents, favorites, custom foods and
 * saved recipes in one panel, with search, edit and delete (confirmed).
 */
export default function FoodLibrary({ open, onClose, date, capabilities, onLogged }) {
    const { toast } = useStore();
    const [tab, setTab] = useState("recent");
    const [query, setQuery] = useState("");
    const [library, setLibrary] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null); // { type, id, name }
    const [editFood, setEditFood] = useState(null);
    const [editRecipe, setEditRecipe] = useState(null);
    const [logRecipe, setLogRecipe] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get("/nutrition/library");
            setLibrary(res.data);
        } catch {
            toast("Couldn't load your saved foods");
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    // filter by query across names (client-side over the user's own data)
    const filtered = useMemo(() => {
        if (!library) return null;
        const q = query.trim().toLowerCase();
        const match = (s) => !q || String(s || "").toLowerCase().includes(q);
        return {
            recents: (library.recents || []).filter((r) => match(r.name)),
            favorites: (library.favorites || []).filter((r) => match(r.name)),
            foods: (library.customFoods || []).filter((f) => match(f.name) || match(f.brand)),
            meals: (library.recipes || []).filter((r) => match(r.name)),
        };
    }, [library, query]);

    async function toggleFavorite(ref) {
        setBusyId(ref._id);
        try {
            await api.patch(`/nutrition/library/refs/${ref._id}`, { favorite: !ref.favorite });
            setLibrary((prev) => prev && ({
                ...prev,
                favorites: !ref.favorite ? [...prev.favorites, { ...ref, favorite: true }] : prev.favorites.filter((r) => r._id !== ref._id),
                recents: prev.recents.map((r) => (r._id === ref._id ? { ...r, favorite: !ref.favorite } : r)),
            }));
        } catch {
            toast("Failed to update favorite");
        } finally {
            setBusyId(null);
        }
    }

    async function doDelete() {
        const { type, id } = confirmDelete;
        setBusyId(id);
        try {
            if (type === "food") await api.delete(`/nutrition/library/foods/${id}`);
            else if (type === "recipe") await api.delete(`/nutrition/library/recipes/${id}`);
            else await api.delete(`/nutrition/library/refs/${id}`);
            toast(type === "recipe" ? "Meal deleted" : type === "food" ? "Food deleted" : "Removed");
            setConfirmDelete(null);
            await load();
        } catch (e) {
            toast(e.response?.data?.message || "Delete failed");
        } finally {
            setBusyId(null);
        }
    }

    if (!open) return null;

    return (
        <Modal open={open} onClose={onClose} title="My foods & meals" subtitle="Reuse what you log often" large>
            <div className="nutrition-tabs" role="tablist">
                {TABS.map(({ key, label, icon: Icon }) => (
                    <button key={key} role="tab" aria-selected={tab === key} className={`nutrition-tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
                        <Icon size={14} /> {label}
                    </button>
                ))}
            </div>

            <Field>
                <input
                    className="input"
                    type="search"
                    placeholder="Search your saved items…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                />
            </Field>

            {loading && !library && <p className="nutrition-status">Loading…</p>}

            {library && filtered && (
                <div className="nutrition-results" style={{ marginTop: 10 }}>
                    {/* ---- recent + favorites (FoodRefs) ---- */}
                    {(tab === "recent" || tab === "favorites") && (filtered[tab] || []).map((ref) => (
                        <div key={ref._id} className="nutrition-result">
                            <div className="nutrition-result-info">
                                <span className="nutrition-result-name">{ref.brand ? `${ref.brand} ` : ""}{ref.name}</span>
                                <span className="hint">{ref.kind === "custom" ? "your food" : "food database"}{ref.logCount ? ` · logged ${ref.logCount}×` : ""}</span>
                            </div>
                            <button className="icon-btn" onClick={() => toggleFavorite(ref)} disabled={busyId === ref._id} aria-label={ref.favorite ? "Remove from favorites" : "Add to favorites"}>
                                <Star size={15} style={{ color: ref.favorite ? "var(--text)" : "var(--text-4)", fill: ref.favorite ? "var(--text)" : "none" }} />
                            </button>
                            <button className="icon-btn" onClick={() => setConfirmDelete({ type: "ref", id: ref._id, name: ref.name })} disabled={busyId === ref._id} aria-label="Remove from list">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}

                    {/* ---- custom foods ---- */}
                    {tab === "foods" && filtered.foods.map((f) => (
                        <div key={f._id} className="nutrition-result">
                            <div className="nutrition-result-info">
                                <span className="nutrition-result-name">{f.brand ? `${f.brand} ` : ""}{f.name}</span>
                                <span className="hint">
                                    user-provided values · {f.basis === "per_serving" ? `per ${Math.round(f.servingSizeG)} g serving` : "per 100 g"}
                                    {f.kcal != null ? ` · ${Math.round(f.kcal)} kcal` : ""}
                                </span>
                            </div>
                            <button className="icon-btn" onClick={() => setEditFood(f)} aria-label={`Edit ${f.name}`}><Pencil size={14} /></button>
                            <button className="icon-btn" onClick={() => setConfirmDelete({ type: "food", id: f._id, name: f.name })} aria-label={`Delete ${f.name}`}>
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    {tab === "foods" && filtered.foods.length === 0 && (
                        <EmptyState icon={<ChefHat size={30} />} title="No custom foods yet" message="Create foods the database doesn't have — homemade dishes, local brands, anything." />
                    )}

                    {/* ---- saved meals (recipes) ---- */}
                    {tab === "meals" && filtered.meals.map((r) => (
                        <div key={r._id} className="nutrition-result">
                            <div className="nutrition-result-info">
                                <span className="nutrition-result-name">{r.name}</span>
                                <span className="hint">
                                    {(r.ingredients || []).length} ingredients · {fmt(r.totalsPerPortion?.kcal)} kcal per portion
                                    {r.logCount ? ` · logged ${r.logCount}×` : ""}
                                </span>
                            </div>
                            <button className="btn primary small" onClick={() => setLogRecipe(r)} disabled={!capabilities?.search}>Log</button>
                            <button className="icon-btn" onClick={() => setEditRecipe(r)} aria-label={`Edit ${r.name}`}><Pencil size={14} /></button>
                            <button className="icon-btn" onClick={() => setConfirmDelete({ type: "recipe", id: r._id, name: r.name })} aria-label={`Delete ${r.name}`}>
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    {tab === "meals" && filtered.meals.length === 0 && (
                        <EmptyState icon={<History size={30} />} title="No saved meals yet" message="Build a meal from ingredients and save it — log it again any day in one tap." />
                    )}
                </div>
            )}

            {/* ---- sub-dialogs ---- */}
            {editFood !== null && (
                <CustomFoodEditor
                    open
                    food={editFood}
                    onClose={() => setEditFood(null)}
                    onSaved={() => load()}
                />
            )}
            {editRecipe !== null && (
                <MealBuilder
                    open
                    capabilities={capabilities}
                    editingRecipe={editRecipe}
                    onClose={() => setEditRecipe(null)}
                    onSaved={() => load()}
                />
            )}
            {logRecipe !== null && (
                <LogMealDialog
                    open
                    recipe={logRecipe}
                    date={date}
                    onClose={() => setLogRecipe(null)}
                    onSaved={(meal) => { onLogged && onLogged(meal); }}
                />
            )}

            <ConfirmDialog
                open={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={doDelete}
                title={confirmDelete?.type === "recipe" ? "Delete this saved meal?" : confirmDelete?.type === "food" ? "Delete this custom food?" : "Remove this item?"}
                message={
                    confirmDelete
                        ? confirmDelete.type === "recipe"
                            ? `“${confirmDelete.name}” will be removed from My Meals. Meals you already logged are NOT affected.`
                            : confirmDelete.type === "food"
                                ? `“${confirmDelete.name}” will be permanently deleted. Meals already logged are NOT affected.`
                                : `“${confirmDelete.name}” will be removed from this list. This cannot be undone.`
                        : ""
                }
                confirmLabel="Delete"
                danger
                busy={!!busyId}
            />
        </Modal>
    );
}
