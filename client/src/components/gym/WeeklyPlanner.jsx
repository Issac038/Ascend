import { useState } from "react";
import { Modal, ConfirmDialog, EmptyState } from "../ui/Primitives";
import { Dumbbell } from "lucide-react";

const DAY_LABELS = [
    ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
    ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]
];

// Weekly plan editor: assign a workout (or rest) to each weekday, and
// create/edit workouts inline. Reuses the shared Modal/Confirm primitives.
function planToDraft(p) {
    const d = {};
    for (const [key] of DAY_LABELS) d[key] = (p?.days?.[key] && p.days[key].workoutId) || "";
    return d;
}

export default function WeeklyPlanner({ open, onClose, plan, workouts, onPlanSaved, onEditWorkout, onCreateWorkout, onDeleteWorkout }) {
    const [draft, setDraft] = useState(() => planToDraft(plan));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(null); // workout being deleted

    async function save() {
        setSaving(true);
        setError("");
        try {
            await onPlanSaved(draft);
            onClose();
        } catch (e) {
            setError(e?.message || "Could not save the plan.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <Modal
                open={open}
                onClose={onClose}
                title="Weekly plan"
                subtitle="Assign a workout to each day — or make it a rest day."
                large
                actions={
                    <>
                        <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={saving}>
                            {saving ? "Saving…" : "Save plan"}
                        </button>
                    </>
                }
            >
                {workouts.length === 0 && (
                    <div style={{ marginBottom: 14 }}>
                        <EmptyState
                            title="No workouts yet"
                            message="Create your first workout, then assign it to the days you train."
                            action={<button className="btn primary" onClick={onCreateWorkout}>Create workout</button>}
                        />
                    </div>
                )}

                {DAY_LABELS.map(([key, label]) => {
                    const w = draft[key] ? workouts.find((x) => x._id === draft[key]) : null;
                    return (
                        <div className="gym-plan-day" key={key}>
                            <div className="gym-plan-day-head">
                                <span className="gym-plan-day-name">{label}</span>
                                {w ? (
                                    <span className="gym-plan-day-meta">
                                        {w.exercises.length} exercise{w.exercises.length === 1 ? "" : "s"}
                                        <button className="btn ghost small" onClick={() => onEditWorkout(w)}>Edit</button>
                                    </span>
                                ) : draft[key] === "" ? null : (
                                    <span className="hint">missing workout</span>
                                )}
                            </div>
                            <div className="gym-plan-day-body">
                                <select
                                    value={draft[key]}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                                    aria-label={`${label} workout`}
                                >
                                    <option value="">Rest day</option>
                                    {workouts.map((wo) => <option key={wo._id} value={wo._id}>{wo.name}</option>)}
                                </select>
                                {w && (
                                    <span className="gym-plan-ex-preview">
                                        {w.exercises.slice(0, 3).map((e) => e.name).join(" · ")}
                                        {w.exercises.length > 3 ? ` +${w.exercises.length - 3}` : ""}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}

                <div className="row between" style={{ marginTop: 16, flexWrap: "wrap", gap: 8 }}>
                    <button className="btn ghost small" onClick={onCreateWorkout}><Dumbbell size={14} /> New workout</button>
                </div>

                <div style={{ marginTop: 18 }}>
                    <div className="section-title" style={{ marginBottom: 8 }}><h3 style={{ fontSize: 14 }}>Workouts</h3></div>
                    {workouts.length === 0 ? (
                        <p className="hint">Workouts you create appear here.</p>
                    ) : (
                        workouts.map((w) => (
                            <div className="gym-wlib-row" key={w._id}>
                                <div>
                                    <div style={{ fontWeight: 700 }}>{w.name}</div>
                                    <div className="hint">{w.exercises.length} exercises · {w.exercises.slice(0, 3).map((e) => e.name).join(", ")}{w.exercises.length > 3 ? "…" : ""}</div>
                                </div>
                                <div className="row" style={{ gap: 6 }}>
                                    <button className="btn ghost small" onClick={() => onEditWorkout(w)}>Edit</button>
                                    <button className="btn ghost small danger-text" onClick={() => setConfirmDelete(w)}>Delete</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}
            </Modal>

            <ConfirmDialog
                open={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={async () => {
                    const w = confirmDelete;
                    setConfirmDelete(null);
                    try { await onDeleteWorkout(w); } catch { /* handled by caller toast */ }
                }}
                title="Delete workout?"
                message={`"${confirmDelete?.name}" will be removed from every day it's assigned to. Past workout history is kept.`}
                confirmLabel="Delete"
                danger
            />
        </>
    );
}
