import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode, Search, ChevronRight, ImageOff } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field } from "../ui/Primitives";
import PortionEditor from "./PortionEditor";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function guessMealType() {
    const h = new Date().getHours();
    if (h < 11) return "breakfast";
    if (h < 15) return "lunch";
    if (h < 21) return "dinner";
    return "snack";
}

export default function AddFood({ open, onClose, date, capabilities, onSaved }) {
    const { toast } = useStore();
    const [tab, setTab] = useState("search"); // search | photo | barcode
    const [query, setQuery] = useState("");
    const [results, setResults] = useState(null); // null = not searched yet
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(null);
    const [selected, setSelected] = useState(null); // food detail for portion editing
    const [detailLoading, setDetailLoading] = useState(false);
    const [mealType, setMealType] = useState(guessMealType());
    const [saving, setSaving] = useState(false);
    const debounceRef = useRef(null);
    const latestQuery = useRef("");

    // reset transient state whenever the modal opens
    useEffect(() => {
        if (open) {
            setTab("search");
            setQuery("");
            setResults(null);
            setSearchError(null);
            setSelected(null);
            setMealType(guessMealType());
        }
    }, [open]);

    // debounced search — avoids hammering the rate-limited route; stale
    // responses are discarded by comparing against the latest query
    useEffect(() => {
        if (!open || tab !== "search") return undefined;
        const q = query.trim();
        latestQuery.current = q;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (q.length < 2) {
            setResults(null);
            setSearching(false);
            setSearchError(null);
            return undefined;
        }
        setSearching(true);
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await api.get("/nutrition/search", { params: { q } });
                if (latestQuery.current !== q) return; // stale response
                setResults(res.data);
                setSearchError(null);
            } catch (e) {
                if (latestQuery.current !== q) return;
                setResults(null);
                setSearchError(searchErrorMessage(e));
            } finally {
                if (latestQuery.current === q) setSearching(false);
            }
        }, 350);
        return () => clearTimeout(debounceRef.current);
    }, [query, open, tab]);

    async function pickFood(food) {
        setDetailLoading(true);
        try {
            const res = await api.get(`/nutrition/food/${encodeURIComponent(food.foodId)}`);
            setSelected(res.data.food);
        } catch {
            toast("Could not load food details. Try another result.");
        } finally {
            setDetailLoading(false);
        }
    }

    async function saveMeal(ingredients, source) {
        setSaving(true);
        try {
            await api.post("/nutrition/meals", { date, mealType, source, ingredients });
            toast("Meal saved");
            setSelected(null);
            onClose();
            onSaved();
        } catch (e) {
            toast(e.response?.data?.message || "Failed to save meal");
        } finally {
            setSaving(false);
        }
    }

    if (selected) {
        return (
            <PortionEditor
                open={open}
                food={selected}
                mealType={mealType}
                setMealType={setMealType}
                saving={saving}
                onClose={() => setSelected(null)}
                onConfirm={(ingredients) => saveMeal(ingredients, "db_search")}
            />
        );
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Add food"
            subtitle={mealLabel(mealType, date)}
            large
        >
            {/* meal type selector */}
            <div className="nutrition-mealtype-row" role="radiogroup" aria-label="Meal type">
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

            {/* tab bar */}
            <div className="nutrition-tabs" role="tablist">
                <button role="tab" aria-selected={tab === "search"} className={`nutrition-tab${tab === "search" ? " active" : ""}`} onClick={() => setTab("search")}>
                    <Search size={15} /> Search
                </button>
                <button role="tab" aria-selected={tab === "photo"} className={`nutrition-tab${tab === "photo" ? " active" : ""}`} onClick={() => setTab("photo")}>
                    <Camera size={15} /> Photo
                </button>
                <button role="tab" aria-selected={tab === "barcode"} className={`nutrition-tab${tab === "barcode" ? " active" : ""}`} onClick={() => setTab("barcode")}>
                    <ScanBarcode size={15} /> Barcode
                </button>
            </div>

            {tab === "search" && (
                <SearchTab
                    query={query}
                    setQuery={setQuery}
                    results={results}
                    searching={searching}
                    searchError={searchError}
                    capabilities={capabilities}
                    detailLoading={detailLoading}
                    onPick={pickFood}
                />
            )}
            {tab === "photo" && <PhotoTab />}
            {tab === "barcode" && (
                <BarcodeTab
                    capabilities={capabilities}
                    onPick={pickFood}
                    date={date}
                    mealType={mealType}
                    onManualSaved={onSaved && (() => { onClose(); onSaved(); })}
                />
            )}
        </Modal>
    );
}

export function searchErrorMessage(e) {
    const status = e?.response?.status;
    if (status === 503) return "Nutrition data isn't loaded on the server yet — ask the administrator to run the corpus load.";
    if (status === 500 || status === 502) return "Search failed. Check your connection and try again.";
    return "Search failed. Check your connection and try again.";
}

function mealLabel(type, date) {
    const d = date === new Date().toISOString().slice(0, 10) ? "today" : date;
    return `Logging to ${type} · ${d}`;
}

// ---------------- Search tab ----------------
function SearchTab({ query, setQuery, results, searching, searchError, capabilities, detailLoading, onPick }) {
    if (!capabilities?.search) {
        return (
            <div className="nutrition-unavailable">
                <ImageOff size={22} />
                <p>Nutrition search is unavailable — the food corpus isn't loaded on the server.</p>
                <p className="hint">You can still log foods manually below once search is restored.</p>
            </div>
        );
    }
    return (
        <div>
            <Field>
                <input
                    className="input"
                    type="search"
                    placeholder='Search for a food... e.g. "masala dosa", "chicken biryani", "pasta"'
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    enterKeyHint="search"
                />
            </Field>

            {searching && <p className="nutrition-status">Searching foods…</p>}

            {!searching && searchError && (
                <div className="nutrition-unavailable" role="alert">
                    <p>{searchError}</p>
                </div>
            )}

            {!searching && !searchError && results && results.results && results.results.length === 0 && (
                <p className="nutrition-status">No foods found. Try another name.</p>
            )}

            <div className="nutrition-results">
                {!searching && results && (results.results || []).map((f) => (
                    <button key={f.foodId} className="nutrition-result" onClick={() => onPick(f)} disabled={detailLoading}>
                        <div className="nutrition-result-info">
                            <span className="nutrition-result-name">{f.brand ? `${f.brand} ` : ""}{f.name}</span>
                            <span className="hint">
                                {f.category || "food"}
                                {f.servingSizeG ? ` · ~${Math.round(f.servingSizeG)} g per serving` : ""}
                            </span>
                        </div>
                        {/* kcal shown is per 100 g (the corpus basis) — the
                            portion editor scales it to the chosen amount */}
                        <span className="nutrition-result-kcal mono-num">
                            {f.energyKcal == null ? "—" : Math.round(f.energyKcal)}
                            <span>{f.energyKcal == null ? "" : " kcal/100g"}</span>
                        </span>
                        <ChevronRight size={15} className="nutrition-result-chevron" />
                    </button>
                ))}
            </div>
            {!searching && results && (results.results || []).length > 0 && (
                <p className="hint" style={{ marginTop: 8 }}>Values shown per 100 g — you'll pick the portion next.</p>
            )}
        </div>
    );
}

// ---------------- Photo tab ----------------
function PhotoTab() {
    // No vision provider is configured on the server (the engine follows Nut
    // AI's architecture and is ready for one), so this tab is honestly
    // disabled. It NEVER fabricates results.
    return (
        <div className="nutrition-unavailable nutrition-photo-tab">
            <Camera size={22} />
            <p>Photo analysis isn't available yet — no vision provider is configured on the server.</p>
            <p className="hint">
                The analysis engine is built and waiting for a provider: when connected, photos will be
                broken into food components with estimated portions and an honest uncertainty range —
                never a single made-up calorie number. Search works great in the meantime.
            </p>
        </div>
    );
}

// ---------------- Barcode tab ----------------
function BarcodeTab({ capabilities, onPick, date, mealType, onManualSaved }) {
    const [code, setCode] = useState("");
    const [looking, setLooking] = useState(false);
    const [error, setError] = useState(null);
    const [found, setFound] = useState(null);

    async function lookup() {
        setError(null);
        setLooking(true);
        setFound(null);
        try {
            // Deterministic corpus lookup by digits: FDC ids are numeric, so we
            // search the id directly via the food detail endpoint.
            const res = await api.get(`/nutrition/food/${encodeURIComponent(code)}`);
            setFound(res.data.food);
        } catch (e) {
            if (e.response?.status === 404) {
                setError("No product with that number in the food corpus. Type the product name in Search, or enter the nutrition facts manually.");
            } else if (e.response?.status === 400) {
                setError("That doesn't look like a valid product number.");
            } else {
                setError("Lookup failed. Try again or use Search.");
            }
        } finally {
            setLooking(false);
        }
    }

    return (
        <div className="nutrition-barcode-tab">
            <div className="nutrition-unavailable" style={{ marginBottom: 14 }}>
                <ScanBarcode size={22} />
                <p>Camera barcode scanning isn't available in the web app.</p>
                <p className="hint">If the package prints a product/food code, enter it below to look it up — or use manual entry.</p>
            </div>
            <Field label="Product number" hint="8–14 digits.">
                <div className="row" style={{ gap: 8 }}>
                    <input
                        className="input"
                        inputMode="numeric"
                        placeholder="e.g. 173944"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 14))}
                    />
                    <button className="btn primary" onClick={lookup} disabled={looking || code.length < 4 || !capabilities?.search}>
                        {looking ? "Looking up…" : "Look up"}
                    </button>
                </div>
            </Field>
            {error && <p className="nutrition-status" role="alert">{error}</p>}
            {found && (
                <button className="nutrition-result" style={{ width: "100%", marginTop: 10 }} onClick={() => onPick(found)}>
                    <div className="nutrition-result-info">
                        <span className="nutrition-result-name">{found.name}</span>
                        <span className="hint">per 100 g</span>
                    </div>
                    <span className="nutrition-result-kcal mono-num">
                        {found.per100g?.kcal == null ? "—" : Math.round(found.per100g.kcal)}
                        <span>{found.per100g?.kcal == null ? "" : " kcal"}</span>
                    </span>
                </button>
            )}
            <ManualEntry date={date} mealType={mealType} onSaved={onManualSaved} />
        </div>
    );
}

// Manual entry — always available, requires no provider. Values are per
// 100 g OR per serving as entered; the server clamps and stores them with
// the explicit manual_custom origin.
function ManualEntry({ date, mealType, onSaved }) {
    const { toast } = useStore();
    const [f, setF] = useState({ name: "", grams: "", kcal: "", protein: "", carbs: "", fat: "" });
    const [saving, setSaving] = useState(false);

    const valid = f.name.trim() && Number(f.kcal) >= 0;

    async function save() {
        setSaving(true);
        try {
            await api.post("/nutrition/meals", {
                date,
                mealType,
                source: "manual",
                ingredients: [{
                    origin: "manual_custom",
                    displayName: f.name.trim(),
                    grams: Number(f.grams) > 0 ? Number(f.grams) : 100,
                    nutrientSnapshot: {
                        kcal: Number(f.kcal) || 0,
                        protein_g: Number(f.protein) || 0,
                        fat_g: Number(f.fat) || 0,
                        carbs_g: Number(f.carbs) || 0,
                    },
                }],
            });
            toast("Meal saved");
            onSaved();
        } catch (e) {
            toast(e.response?.data?.message || "Failed to save meal");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line-soft)" }}>
            <p className="p-label" style={{ marginBottom: 10 }}>MANUAL ENTRY</p>
            <Field>
                <input className="input" placeholder="Food name (required)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={160} />
            </Field>
            <div className="nutrition-manual-grid">
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Grams" value={f.grams} onChange={(e) => setF({ ...f, grams: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="kcal/100g" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Protein g" value={f.protein} onChange={(e) => setF({ ...f, protein: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Fat g" value={f.fat} onChange={(e) => setF({ ...f, fat: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Carbs g" value={f.carbs} onChange={(e) => setF({ ...f, carbs: e.target.value })} />
            </div>
            <button className="btn primary" style={{ marginTop: 10, width: "100%", minHeight: 44 }} onClick={save} disabled={saving || !valid}>
                {saving ? "Saving…" : "Save meal"}
            </button>
        </div>
    );
}
