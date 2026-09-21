import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode, Search, ChevronRight, ImageOff } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field } from "../ui/Primitives";
import ServingSelector from "./ServingSelector";

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
    const [selected, setSelected] = useState(null); // food detail for serving selection
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

    // debounced search — avoids hammering the (rate-limited) FatSecret route
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
                setSearchError(
                    e.response?.status === 429
                        ? "Nutrition search is temporarily rate-limited. Please try again shortly."
                        : e.response?.status === 403
                            ? "The nutrition provider rejected this server's IP address."
                            : e.response?.status === 501
                                ? "This nutrition feature is not available on the current FatSecret plan."
                                : e.response?.status === 503
                                    ? "Nutrition provider is temporarily unavailable. Please try again."
                                    : "Search failed. Check your connection and try again."
                );
            } finally {
                if (latestQuery.current === q) setSearching(false);
            }
        }, 350);
        return () => clearTimeout(debounceRef.current);
    }, [query, open, tab]);

    async function pickFood(food) {
        setDetailLoading(true);
        try {
            const res = await api.get(`/nutrition/food/${food.id}`);
            setSelected(res.data.food);
        } catch {
            toast("Could not load food details. Try another result.");
        } finally {
            setDetailLoading(false);
        }
    }

    async function saveMeal(foods, source) {
        setSaving(true);
        try {
            await api.post("/nutrition/meals", { date, mealType, source, foods });
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
            <ServingSelector
                open={open}
                food={selected}
                mealType={mealType}
                setMealType={setMealType}
                saving={saving}
                onClose={() => setSelected(null)}
                onConfirm={(foods) => saveMeal(foods, tab === "barcode" ? "barcode" : "search")}
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
            {tab === "photo" && <PhotoTab enabled={!!capabilities?.photo} />}
            {tab === "barcode" && (
                <BarcodeTab
                    enabled={!!capabilities?.barcode}
                    onFound={(food) => setSelected(food)}
                    date={date}
                    mealType={mealType}
                    onManualSaved={onSaved && (() => { onClose(); onSaved(); })}
                />
            )}
        </Modal>
    );
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
                <p>Nutrition search is temporarily unavailable.</p>
                <p className="hint">{capabilities?.providerError === "auth"
                    ? "The server's FatSecret authentication failed — check the server configuration."
                    : capabilities?.providerError === "rate_limited"
                        ? "The provider is rate limited right now — try again in a moment."
                        : "The food data provider could not be reached — check the server's connection."}
                </p>
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

            {!searching && !searchError && results && results.foods.length === 0 && (
                <p className="nutrition-status">No foods found. Try another name.</p>
            )}

            <div className="nutrition-results">
                {!searching && results && results.foods.map((f) => (
                    <button key={f.id} className="nutrition-result" onClick={() => onPick(f)} disabled={detailLoading}>
                        <div className="nutrition-result-info">
                            <span className="nutrition-result-name">{f.name}</span>
                            <span className="hint">
                                {f.brand ? `${f.brand} · ` : ""}
                                {f.servingDescription || "per serving"}
                            </span>
                        </div>
                        {/* null nutrition = provider gave nothing for this hit:
                            shown as "—", never silently rendered as 0 */}
                        <span className="nutrition-result-kcal mono-num">
                            {f.calories == null ? "—" : Math.round(f.calories)}
                            <span>{f.calories == null ? "" : " kcal"}</span>
                        </span>
                        <ChevronRight size={15} className="nutrition-result-chevron" />
                    </button>
                ))}
            </div>
        </div>
    );
}

// ---------------- Photo tab ----------------
function PhotoTab({ enabled }) {
    const fileRef = useRef(null);
    const [error, setError] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);

    // Validate on the client too (server enforces the same rules):
    // MIME type + 5 MB cap. Large iPhone photos are downscaled via canvas
    // before upload so we never ship a 12 MP original.
    function handleFile(file) {
        setError(null);
        const okTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!okTypes.includes(file.type)) {
            setError("Unsupported image format. Use JPEG, PNG or WebP (iPhone photos can be shared as JPEG).");
            return;
        }
        setAnalyzing(true);
        downscaleImage(file, 1280)
            .then(async (blob) => {
                if (blob.size > 5 * 1024 * 1024) {
                    setError("Image is too large after compression. Try a smaller photo.");
                    return;
                }
                const form = new FormData();
                form.append("image", new File([blob], "meal.jpg", { type: blob.type || "image/jpeg" }));
                const res = await api.post("/nutrition/analyze-photo", form);
                if (res.data?.items?.length) {
                    // A real provider response would land here — see
                    // server/services/imageRecognitionService.js
                }
            })
            .catch((e) => {
                if (e.response?.status === 501) {
                    setError("Photo analysis isn't available with the current nutrition provider configuration.");
                } else {
                    setError("Photo analysis failed. Please try again or use Search.");
                }
            })
            .finally(() => setAnalyzing(false));
    }

    return (
        <div className="nutrition-unavailable nutrition-photo-tab">
            {enabled ? (
                <>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    />
                    {analyzing ? (
                        <p className="nutrition-status">Analyzing your meal…</p>
                    ) : (
                        <>
                            <div className="nutrition-photo-actions">
                                <button className="btn primary" onClick={() => fileRef.current?.click()}>Take Photo</button>
                                <button className="btn ghost" onClick={() => fileRef.current?.click()}>Choose From Library</button>
                            </div>
                            {error && <p className="nutrition-status" role="alert">{error}</p>}
                            <p className="hint">Results are estimates — you confirm portions before anything is saved. Photos are processed in memory and never stored.</p>
                        </>
                    )}
                </>
            ) : (
                <>
                    <Camera size={22} />
                    <p>Photo analysis isn't available with the current nutrition provider configuration.</p>
                    <p className="hint">Food image recognition requires a FatSecret Premier plan (or a vision provider wired into the server). Search works great in the meantime.</p>
                </>
            )}
        </div>
    );
}

// ---------------- Barcode tab ----------------
function BarcodeTab({ enabled, onFound, date, mealType, onManualSaved }) {
    const [code, setCode] = useState("");
    const [looking, setLooking] = useState(false);
    const [error, setError] = useState(null);

    async function lookup() {
        setError(null);
        setLooking(true);
        try {
            const res = await api.get(`/nutrition/barcode/${encodeURIComponent(code)}`);
            if (res.data?.food) onFound(res.data.food);
        } catch (e) {
            if (e.response?.status === 501) {
                setError("Barcode lookup requires a FatSecret Premier plan. Type the product name in Search, or enter the nutrition facts manually.");
            } else if (e.response?.status === 400) {
                setError("That doesn't look like a valid barcode number.");
            } else {
                setError("Barcode lookup failed. Try again or use Search.");
            }
        } finally {
            setLooking(false);
        }
    }

    return (
        <div className="nutrition-barcode-tab">
            {!enabled && (
                <div className="nutrition-unavailable" style={{ marginBottom: 14 }}>
                    <ScanBarcode size={22} />
                    <p>Camera barcode scanning isn't available with the current nutrition provider configuration.</p>
                    <p className="hint">Barcode lookup needs a FatSecret Premier plan. You can still enter a product's nutrition facts manually below.</p>
                </div>
            )}
            <Field label="Barcode number" hint="Found under the product's barcode (8–14 digits).">
                <div className="row" style={{ gap: 8 }}>
                    <input
                        className="input"
                        inputMode="numeric"
                        placeholder="e.g. 8901058000214"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 14))}
                    />
                    <button className="btn primary" onClick={lookup} disabled={looking || code.length < 6}>
                        {looking ? "Looking up…" : "Look up"}
                    </button>
                </div>
            </Field>
            {error && <p className="nutrition-status" role="alert">{error}</p>}
            <ManualEntry date={date} mealType={mealType} onSaved={onManualSaved} />
        </div>
    );
}

// Manual entry fallback — always available, keeps the Barcode tab useful
// even without a Premier plan. Values are per serving, entered from the
// product label; the server recomputes meal totals.
function ManualEntry({ date, mealType, onSaved }) {
    const { toast } = useStore();
    const [f, setF] = useState({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    const [saving, setSaving] = useState(false);

    const valid = f.name.trim() && Number(f.calories) >= 0;

    async function save() {
        setSaving(true);
        try {
            await api.post("/nutrition/meals", {
                date,
                mealType,
                source: "manual",
                foods: [{
                    provider: "manual",
                    name: f.name.trim(),
                    servingDescription: "per label",
                    quantity: 1,
                    calories: Number(f.calories) || 0,
                    protein: Number(f.protein) || 0,
                    carbs: Number(f.carbs) || 0,
                    fat: Number(f.fat) || 0,
                    estimated: false
                }]
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
                <input className="input" placeholder="Food name (required)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={200} />
            </Field>
            <div className="nutrition-manual-grid">
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="kcal" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Protein g" value={f.protein} onChange={(e) => setF({ ...f, protein: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Carbs g" value={f.carbs} onChange={(e) => setF({ ...f, carbs: e.target.value })} />
                <input className="input" type="number" inputMode="decimal" min="0" placeholder="Fat g" value={f.fat} onChange={(e) => setF({ ...f, fat: e.target.value })} />
            </div>
            <button className="btn primary" style={{ marginTop: 10, width: "100%", minHeight: 44 }} onClick={save} disabled={saving || !valid}>
                {saving ? "Saving…" : "Save meal"}
            </button>
        </div>
    );
}

// Downscale + compress an image File via canvas (no dependencies).
// Returns a JPEG Blob. Exposed for reuse and testing.
export function downscaleImage(file, maxEdge = 1280) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
                "image/jpeg",
                0.82
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read image"));
        };
        img.src = url;
    });
}
