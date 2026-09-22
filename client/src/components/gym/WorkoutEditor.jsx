import { useState } from "react";
import api from "../../services/api";
import { Modal, Field } from "../ui/Primitives";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { EXERCISE_LIBRARY } from "../../data/exerciseLibrary";

const emptyEx = () => ({ name: "", type: "reps", sets: 4, reps: 8, durationMin: 20, restSec: "", weightKg: "", notes: "" });

// Create/edit a reusable workout. Exercises support two structures:
// sets × reps, or sets × duration (Plank 3 × 60 sec, Treadmill 20 min).
// Weight/rest/notes are always optional.
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
                    <Plus size={14} /> Library
                </button>
            </div>

            {picker && (
                <div className="gym-picker">
                    {EXERCISE_LIBRARY.map((g) => (
                        <div key={g.group} className="gym-picker-group">
                            <div className="gym-picker-title">{g.group}</div>
                            {g.items.map((item) => (
                                <button
                                    key={item.name}
                                    type="button"
                                    className="gym-picker-item"
                                    onClick={() => setExercises((prev) => [...prev, { ...emptyEx(), ...item, durationMin: item.durationSec ? Math.round(item.durationSec / 60) : "", durationSecRaw: "" }])}
                                >
                                    {item.name}
                                    <span className="gym-picker-meta">
                                        {item.type === "duration" ? `${Math.round(item.durationSec / 60)} min` : `${item.sets} × ${item.reps}`}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ))}
                    <div className="gym-picker-group">
                        <div className="gym-picker-title">Custom</div>
                        <button type="button" className="gym-picker-item" onClick={() => setExercises((prev) => [...prev, emptyEx()])}>
                            + Custom exercise
                        </button>
                    </div>
                </div>
            )}

            {exercises.length === 0 && (
                <p className="hint" style={{ marginTop: 10 }}>No exercises yet — pick from the library or add a custom one.</p>
            )}

            {exercises.map((ex, i) => (
                <div className="gym-ex-row card plain" key={i}>
                    <div className="row" style={{ gap: 8 }}>
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
