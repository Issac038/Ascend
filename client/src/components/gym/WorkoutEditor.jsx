import { useMemo, useState } from "react";
import api from "../../services/api";
import { Modal, Field } from "../ui/Primitives";
import { Plus, Trash2, ChevronUp, ChevronDown, Search } from "lucide-react";
import { EXERCISE_LIBRARY } from "../../data/exerciseLibrary";

const emptyEx = () => ({ name: "", type: "reps", sets: 4, reps: 8, durationMin: 20, restSec: "", weightKg: "", notes: "" });

function exKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function libraryMeta(item) {
    return item.type === "duration"
        ? (item.durationSec >= 60 ? `${Math.round(item.durationSec / 60)} min` : `${item.durationSec} sec`)
        : `${item.sets} × ${item.reps}`;
}

// Create/edit a reusable workout. Exercises support two structures:
// sets × reps, or sets × duration (Plank 3 × 60 sec, Treadmill 20 min).
// Weight/rest/notes are always optional.
//
// Exercise selection is MULTI-SELECT: the picker holds a Set of chosen
// names, the user confirms once, and every selected exercise is added to
// the workout in library order. One POST carries the whole exercises array
// — no per-exercise API calls.
export default function WorkoutEditor({ open, onClose, onSaved, workout = null }) {
    const editing = !!workout;
    const [name, setName] = useState(workout?.name || "");
    const [notes, setNotes] = useState(workout?.notes || "");
    const [exercises, setExercises] = useState(
        (workout?.exercises || []).map((ex) => ({
            name: ex.name,
            type: ex.type || "reps",
            sets: ex.sets || 1,
            reps: ex.reps ?? "",
            durationMin: ex.durationSec ? Math.round(ex.durationSec / 60) : "",
            durationSecRaw: ex.durationSec != null && ex.durationSec < 60 ? ex.durationSec : "",
            restSec: ex.restSec ?? "",
            weightKg: ex.weightKg ?? "",
            notes: ex.notes || ""
        }))
    );
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [picker, setPicker] = useState(false);
    const [search, setSearch] = useState("");
    // Names chosen in the picker but not yet confirmed. A Set guarantees a
    // library exercise can only ever be added once (no duplicates).
    const [pending, setPending] = useState(() => new Set());

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase();
        return EXERCISE_LIBRARY
            .map((g) => ({ ...g, items: g.items.filter((i) => !q || i.name.toLowerCase().includes(q)) }))
            .filter((g) => g.items.length > 0);
    }, [search]);

    const existingKeys = useMemo(() => new Set(exercises.map((e) => exKey(e.name))), [exercises]);

    function togglePending(itemName) {
        setPending((prev) => {
            const next = new Set(prev);
            if (next.has(itemName)) next.delete(itemName);
            else next.add(itemName);
            return next;
        });
    }

    // Confirm once: all selected exercises are added in library order.
    // Already-present exercises are skipped (duplicate prevention); the
    // picker also disables them so this is a belt-and-braces check.
    function confirmSelection() {
        setExercises((prev) => {
            const have = new Set(prev.map((e) => exKey(e.name)));
            const additions = [];
            for (const g of EXERCISE_LIBRARY) {
                for (const item of g.items) {
                    if (!pending.has(item.name) || have.has(exKey(item.name))) continue;
                    have.add(exKey(item.name));
                    additions.push({
                        ...emptyEx(),
                        ...item,
                        durationMin: item.durationSec ? Math.round(item.durationSec / 60) : "",
                        durationSecRaw: ""
                    });
                }
            }
            return additions.length ? [...prev, ...additions] : prev;
        });
        setPending(new Set());
        setSearch("");
        setPicker(false);
    }

    function updateEx(i, patch) {
        setExercises((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    }
    function move(i, dir) {
        setExercises((prev) => {
            const j = i + dir;
            if (j < 0 || j >= prev.length) return prev;
            const next = [...prev];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    }

    function serialize() {
        return exercises
            .filter((e) => e.name.trim())
            .map((e) => {
                const out = { name: e.name.trim(), type: e.type, sets: Number(e.sets) || 1 };
                if (e.type === "duration") {
                    const min = Number(e.durationMin) || 0;
                    const sec = min > 0 ? min * 60 : Number(e.durationSecRaw) || 0;
                    out.durationSec = sec;
                } else {
                    out.reps = Number(e.reps);
                }
                if (e.restSec !== "" && e.restSec !== null && e.restSec !== undefined) out.restSec = Number(e.restSec);
                if (e.weightKg !== "" && e.weightKg !== null && e.weightKg !== undefined) out.weightKg = Number(e.weightKg);
                if (e.notes.trim()) out.notes = e.notes.trim();
                return out;
            });
    }

    async function save() {
        setError("");
        if (!name.trim()) { setError("Workout name is required."); return; }
        if (!serialize().length) { setError("Add at least one exercise."); return; }
        setSaving(true);
        try {
            const body = { name: name.trim(), notes, exercises: serialize() };
            const res = editing
                ? await api.patch(`/gym/workouts/${workout._id}`, body)
                : await api.post("/gym/workouts", body);
            onSaved(res.data.workout);
        } catch (e) {
            setError(e.response?.data?.message || "Could not save the workout.");
        } finally {
            setSaving(false);
        }
    }

    function closePicker() {
        setPicker(false);
        setPending(new Set());
        setSearch("");
    }

    const pendingCount = pending.size;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={editing ? "Edit workout" : "New workout"}
            subtitle="Reusable — assign it to any day of the week."
            large
            actions={
                <>
                    <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn primary" onClick={save} disabled={saving}>
                        {saving ? "Saving…" : editing ? "Save changes" : "Create workout"}
                    </button>
                </>
            }
        >
            <Field label="Workout name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Push" maxLength={60} />
            </Field>
            <Field label="Notes (optional)">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="Focus, warm-up, anything…" />
            </Field>

            <div className="row between" style={{ marginTop: 8 }}>
                <label style={{ fontWeight: 700, fontSize: 13 }}>Exercises</label>
                <button type="button" className="btn ghost small" onClick={() => setPicker((v) => !v)}>
                    <Plus size={14} /> Select exercises
                </button>
            </div>

            {picker && (
                <div className="gym-ms">
                    <div className="gym-ms-search">
                        <Search size={15} aria-hidden="true" />
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search exercises…"
                            aria-label="Search exercises"
                            autoComplete="off"
                        />
                    </div>

                    <div className="gym-ms-list" role="group" aria-label="Exercise library">
                        {groups.length === 0 && <p className="hint" style={{ padding: "10px 4px" }}>No exercises match “{search}”.</p>}
                        {groups.map((g) => (
                            <div key={g.group} className="gym-ms-group">
                                <div className="gym-ms-title">{g.group}</div>
                                {g.items.map((item) => {
                                    const chosen = pending.has(item.name);
                                    const already = existingKeys.has(exKey(item.name));
                                    return (
                                        <button
                                            key={item.name}
                                            type="button"
                                            className={`gym-ms-item${chosen ? " selected" : ""}${already ? " added" : ""}`}
                                            onClick={() => !already && togglePending(item.name)}
                                            disabled={already}
                                            aria-pressed={chosen}
                                            title={already ? "Already in this workout" : undefined}
                                        >
                                            <span className="gym-ms-check" aria-hidden="true">{chosen ? "✓" : ""}</span>
                                            <span className="gym-ms-name">{item.name}</span>
                                            <span className="gym-ms-meta">{libraryMeta(item)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <div className="gym-ms-bar">
                        <span className="gym-ms-count" aria-live="polite">
                            {pendingCount === 0 ? "Select exercises" : `Selected: ${pendingCount} exercise${pendingCount === 1 ? "" : "s"}`}
                        </span>
                        <button type="button" className="btn ghost small" onClick={closePicker}>Cancel</button>
                        <button
                            type="button"
                            className="btn primary small"
                            onClick={confirmSelection}
                            disabled={pendingCount === 0}
                        >
                            {pendingCount === 0 ? "Add selected" : `Add ${pendingCount} exercise${pendingCount === 1 ? "" : "s"}`}
                        </button>
                    </div>
                </div>
            )}

            {/* Custom exercise stays available for anything not in the library. */}
            {!picker && (
                <div style={{ marginTop: 8 }}>
                    <button type="button" className="btn ghost small" onClick={() => setExercises((prev) => [...prev, emptyEx()])}>
                        + Custom exercise
                    </button>
                </div>
            )}

            {exercises.length === 0 && (
                <p className="hint" style={{ marginTop: 10 }}>No exercises yet — select from the library or add a custom one.</p>
            )}

            {exercises.map((ex, i) => (
                <div className="gym-ex-row card plain" key={i}>
                    <div className="row" style={{ gap: 8 }}>
                        <span className="gym-ex-ordinal mono-num">{i + 1}</span>
                        <input
                            className="gym-ex-name"
                            value={ex.name}
                            onChange={(e) => updateEx(i, { name: e.target.value })}
                            placeholder="Exercise name"
                            maxLength={80}
                            aria-label={`Exercise ${i + 1} name`}
                        />
                        <div className="gym-ex-actions">
                            <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp size={16} /></button>
                            <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === exercises.length - 1} aria-label="Move down"><ChevronDown size={16} /></button>
                            <button type="button" className="icon-btn" onClick={() => setExercises((prev) => prev.filter((_, idx) => idx !== i))} aria-label={`Remove ${ex.name || "exercise"}`}><Trash2 size={15} /></button>
                        </div>
                    </div>
                    <div className="gym-ex-grid">
                        <Field label="Type">
                            <select value={ex.type} onChange={(e) => updateEx(i, { type: e.target.value })}>
                                <option value="reps">Sets × reps</option>
                                <option value="duration">Sets × duration</option>
                            </select>
                        </Field>
                        <Field label="Sets">
                            <input type="number" min={1} max={30} value={ex.sets} onChange={(e) => updateEx(i, { sets: e.target.value })} />
                        </Field>
                        {ex.type === "reps" ? (
                            <Field label="Reps">
                                <input type="number" min={1} max={1000} value={ex.reps} onChange={(e) => updateEx(i, { reps: e.target.value })} />
                            </Field>
                        ) : (
                            <Field label="Minutes">
                                <input type="number" min={0} max={240} value={ex.durationMin} onChange={(e) => updateEx(i, { durationMin: e.target.value, durationSecRaw: "" })} placeholder="20" />
                            </Field>
                        )}
                        <Field label="Weight kg (opt.)">
                            <input type="number" min={0} max={1000} step="0.5" value={ex.weightKg} onChange={(e) => updateEx(i, { weightKg: e.target.value })} placeholder="—" />
                        </Field>
                        <Field label="Rest sec (opt.)">
                            <input type="number" min={0} max={1200} value={ex.restSec} onChange={(e) => updateEx(i, { restSec: e.target.value })} placeholder="—" />
                        </Field>
                        <Field label="Notes (opt.)">
                            <input value={ex.notes} onChange={(e) => updateEx(i, { notes: e.target.value })} maxLength={200} placeholder="—" />
                        </Field>
                    </div>
                </div>
            ))}

            {error && <p className="form-error" role="alert">{error}</p>}
        </Modal>
    );
}
