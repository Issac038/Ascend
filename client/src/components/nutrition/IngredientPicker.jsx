import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChefHat, AlertTriangle } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field } from "../ui/Primitives";

const MATCH_LABELS = {
    exact: { text: "Exact match", cls: "match-exact" },
    approximate: { text: "Approximate", cls: "match-approx" },
    branded: { text: "Branded", cls: "match-branded" },
};

function searchErrorMessage(e) {
    const status = e?.response?.status;
    if (status === 503) return "Nutrition data isn't loaded on the server yet — search is unavailable until it is.";
    return "Search failed. Check your connection and try again.";
}

/**
 * Ingredient picker — the shared search surface used by the meal builder
 * (and reusable elsewhere). Picks a food with its per-100g snapshot.
 * Custom foods created by the user appear alongside corpus results.
 */
export default function IngredientPicker({ open, capabilities, onPick, onClose }) {
    const { toast } = useStore();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState(null);
    const [customResults, setCustomResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState(null);
    const [loadingId, setLoadingId] = useState(null);
    const debounceRef = useRef(null);
    const latestQuery = useRef("");

    useEffect(() => {
        if (open) {
            setQuery("");
            setResults(null);
            setCustomResults([]);
            setError(null);
        }
    }, [open]);

    // debounced search; stale responses discarded by query comparison
    useEffect(() => {
        if (!open) return undefined;
        const q = query.trim();
        latestQuery.current = q;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (q.length < 2) {
            setResults(null);
            setCustomResults([]);
            setSearching(false);
            setError(null);
            return undefined;
        }
        setSearching(true);
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await api.get("/nutrition/library/search", { params: { q } });
                if (latestQuery.current !== q) return; // stale
                setResults(res.data.results || []);
                setCustomResults(res.data.customResults || []);
                setError(null);
            } catch (e) {
                if (latestQuery.current !== q) return;
                setResults(null);
                setCustomResults([]);
                setError(searchErrorMessage(e));
            } finally {
                if (latestQuery.current === q) setSearching(false);
            }
        }, 350);
        return () => clearTimeout(debounceRef.current);
    }, [query, open]);

    // Corpus rows carry only the search projection — fetch the full
    // per-100g snapshot (macros, portion anchors) before adding.
    async function pickCorpus(row) {
        setLoadingId(row.foodId);
        try {
            const res = await api.get(`/nutrition/food/${encodeURIComponent(row.foodId)}`);
            const f = res.data.food;
            onPick({
                foodKind: "corpus",
                foodId: f.foodId,
                name: f.brand ? `${f.brand} ${f.name}` : f.name,
                brand: f.brand,
                per100g: f.per100g,
                portionPerUnitG: f.portionPerUnitG,
                servingSizeG: f.servingSizeG,
                unit: "g",
                grams: 100,
            });
        } catch {
            toast("Could not load food details. Try another result.");
        } finally {
            setLoadingId(null);
        }
    }

    function pickCustom(cf) {
        onPick({
            foodKind: "custom",
            foodId: cf.customFoodId,
            name: cf.brand ? `${cf.brand} ${cf.name}` : cf.name,
            brand: cf.brand,
            per100g: cf.per100g,
            servingSizeG: cf.servingSizeG,
            unit: "g",
            grams: 100,
        });
    }

    if (!open) return null;

    const noResults = !searching && !error && results !== null && results.length === 0 && customResults.length === 0;

    return (
        <Modal open={open} onClose={onClose} title="Find an ingredient" subtitle="Search the food database and your own saved foods" large>
            <Field>
                <input
                    className="input"
                    type="search"
                    placeholder='e.g. "puttu", "kadala curry", "chicken momos", "peanut butter"'
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    enterKeyHint="search"
                    autoFocus
                />
            </Field>

            {searching && <p className="nutrition-status">Searching foods…</p>}

            {!searching && error && (
                <div className="nutrition-unavailable" role="alert">
                    <p>{error}</p>
                </div>
            )}

            {noResults && (
                <div className="nutrition-unavailable" role="status">
                    <AlertTriangle size={20} />
                    <p>Nothing in the food database matches “{query.trim()}”.</p>
                    <p className="hint">Close this and use “Create a custom food” instead — don't log a different food pretending it's this one.</p>
                </div>
            )}

            {!capabilities?.search && (
                <div className="nutrition-unavailable" role="status">
                    <p>Nutrition search is unavailable — the food corpus isn't loaded on the server.</p>
                </div>
            )}

            {customResults.length > 0 && (
                <>
                    <p className="p-label" style={{ margin: "14px 0 8px" }}>MY FOODS</p>
                    <div className="nutrition-results">
                        {customResults.map((cf) => (
                            <button key={cf.customFoodId} className="nutrition-result" onClick={() => pickCustom(cf)} disabled={!!loadingId}>
                                <span className="nutrition-result-kind"><ChefHat size={14} /></span>
                                <div className="nutrition-result-info">
                                    <span className="nutrition-result-name">{cf.brand ? `${cf.brand} ` : ""}{cf.name}</span>
                                    <span className="hint">your custom food · per 100 g</span>
                                </div>
                                <span className="nutrition-result-kcal mono-num">
                                    {cf.per100g?.kcal == null ? "—" : Math.round(cf.per100g.kcal)}
                                    <span>{cf.per100g?.kcal == null ? "" : " kcal"}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}

            {results && results.length > 0 && (
                <>
                    <p className="p-label" style={{ margin: "14px 0 8px" }}>FOOD DATABASE</p>
                    <div className="nutrition-results">
                        {results.map((f) => {
                            const m = MATCH_LABELS[f.matchType] || MATCH_LABELS.approximate;
                            return (
                                <button key={f.foodId} className="nutrition-result" onClick={() => pickCorpus(f)} disabled={!!loadingId}>
                                    <span className={`nutrition-match ${m.cls}`} title={m.text}>{m.text}</span>
                                    <div className="nutrition-result-info">
                                        <span className="nutrition-result-name">{f.brand ? `${f.brand} ` : ""}{f.name}</span>
                                        <span className="hint">
                                            {f.category || "food"}
                                            {f.servingSizeG ? ` · ~${Math.round(f.servingSizeG)} g per serving` : ""}
                                        </span>
                                    </div>
                                    <span className="nutrition-result-kcal mono-num">
                                        {f.energyKcal == null ? "—" : Math.round(f.energyKcal)}
                                        <span>{f.energyKcal == null ? "" : " kcal/100g"}</span>
                                    </span>
                                    <ChevronRight size={15} className="nutrition-result-chevron" />
                                </button>
                            );
                        })}
                    </div>
                    <p className="hint" style={{ marginTop: 8 }}>Values shown per 100 g — pick a quantity after adding.</p>
                </>
            )}
        </Modal>
    );
}
