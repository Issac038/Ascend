import { useCallback, useEffect, useState } from "react";
import { Plus, Target, Trash2, Pencil, CalendarDays, Flag } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, PageSkeleton, EmptyState, ConfirmDialog, ProgressBar } from "../ui/Primitives";
import { formatShort, monthsUntil } from "../../utils/format";

const AREAS = ["body", "mind", "discipline", "learning", "productivity", "relationships", "finances", "skills", "personal"];

export default function Goals() {
    const { toast, reloadDashboard } = useStore();
    const [goals, setGoals] = useState(null);
    const [habits, setHabits] = useState([]);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleteGoal, setDeleteGoal] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);

    // form
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [area, setArea] = useState("personal");
    const [horizon, setHorizon] = useState("medium");
    const [deadline, setDeadline] = useState("");
    const [milestones, setMilestones] = useState([]);
    const [linkedHabitIds, setLinkedHabitIds] = useState([]);
    const [notes, setNotes] = useState("");

    const load = useCallback(async function load() {
        const [g, h] = await Promise.all([api.get("/data/goals"), api.get("/data/habits")]);
        setGoals(g.data.goals);
        setHabits(h.data.habits);
    }, []);

    useEffect(() => {
        load().catch(() => toast("Failed to load goals"));
    }, [load, toast]);

    function openAdd() {
        setEditing(null);
        setTitle(""); setDescription(""); setArea("personal"); setHorizon("medium");
        setDeadline(""); setMilestones([]); setLinkedHabitIds([]); setNotes("");
        setModalOpen(true);
    }

    function openEdit(g) {
        setEditing(g);
        setTitle(g.title); setDescription(g.description || ""); setArea(g.area);
        setHorizon(g.horizon); setDeadline(g.deadline || "");
        setMilestones(g.milestones || []);
        setLinkedHabitIds(g.habitIds || []);
        setNotes(g.notes || "");
        setModalOpen(true);
    }

    async function save(e) {
        e.preventDefault();
        setBusy(true);
        try {
            const payload = {
                title, description, area, horizon,
                deadline: deadline || null,
                milestones: milestones.filter((m) => m.title.trim()),
                habitIds: linkedHabitIds,
                notes
            };
            if (editing) {
                await api.patch(`/data/goals/${editing._id}`, payload);
            } else {
                await api.post("/data/goals", payload);
            }
            setModalOpen(false);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to save goal");
        } finally {
            setBusy(false);
        }
    }

    async function toggleMilestone(goal, idx) {
        const updated = goal.milestones.map((m, i) => (i === idx ? { ...m, done: !m.done } : m));
        setGoals((prev) => prev.map((g) => (g._id === goal._id ? { ...g, milestones: updated } : g)));
        try {
            await api.patch(`/data/goals/${goal._id}`, { milestones: updated });
            reloadDashboard();
        } catch {
            toast("Failed to update milestone");
            load();
        }
    }

    async function completeGoal(goal) {
        const status = goal.status === "completed" ? "active" : "completed";
        try {
            await api.patch(`/data/goals/${goal._id}`, { status });
            load();
            reloadDashboard();
            if (status === "completed") toast("Goal completed. Onward.");
        } catch {
            toast("Failed to update goal");
        }
    }

    async function confirmDelete() {
        setBusy(true);
        try {
            await api.delete(`/data/goals/${deleteGoal._id}`);
            setDeleteGoal(null);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to delete goal");
        } finally {
            setBusy(false);
        }
    }

    if (!goals) return <PageSkeleton />;

    const active = goals.filter((g) => g.status === "active");
    const completed = goals.filter((g) => g.status === "completed");
    const visible = showCompleted ? [...active, ...completed] : active;

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Goals</h1>
                    <p className="sub">Goals tell you where you're going. Habits determine whether you get there.</p>
                </div>
                <button className="btn primary" onClick={openAdd}><Plus size={16} /> New goal</button>
            </div>

            {active.length === 0 && completed.length === 0 ? (
                <EmptyState
                    icon={<Target size={34} />}
                    title="No goals yet"
                    message="You haven't decided where you're going yet. Set one meaningful goal — the daily actions will follow."
                    action={<button className="btn primary" onClick={openAdd}>Create your first goal</button>}
                />
            ) : (
                <>
                    <div className="row between" style={{ marginBottom: 16 }}>
                        <p className="hint">{active.length} active · {completed.length} completed</p>
                        {completed.length > 0 && (
                            <button className="btn ghost small" onClick={() => setShowCompleted((v) => !v)}>
                                {showCompleted ? "Hide completed" : "Show completed"}
                            </button>
                        )}
                    </div>

                    <div className="grid cols-2">
                        {visible.map((g) => {
                            const pct = g.progress ?? 0;
                            const months = g.deadline ? monthsUntil(g.deadline) : null;
                            return (
                                <div className="card goal-card" key={g._id} style={{ opacity: g.status === "completed" ? 0.6 : 1 }}>
                                    <div className="goal-top">
                                        <div style={{ flex: 1 }}>
                                            <div className="goal-title">{g.title}</div>
                                            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                                <span className="badge">{g.area}</span>
                                                <span className="badge">{g.horizon}</span>
                                                {g.habitIds?.length > 0 && <span className="badge">{g.habitIds.length} habit{s => s}</span>}
                                            </div>
                                        </div>
                                        <div className="row" style={{ gap: 2 }}>
                                            <button className="icon-btn" title="Edit" onClick={() => openEdit(g)}><Pencil size={15} /></button>
                                            <button className="icon-btn" title="Delete" onClick={() => setDeleteGoal(g)}><Trash2 size={15} /></button>
                                        </div>
                                    </div>

                                    {g.description && <p className="hint" style={{ fontSize: 13 }}>{g.description}</p>}

                                    <div className="goal-progress-row">
                                        <ProgressBar value={pct} />
                                        <span className="pct mono-num">{pct}%</span>
                                    </div>

                                    {g.deadline && (
                                        <div className="goal-deadline">
                                            <CalendarDays size={13} />
                                            {formatShort(g.deadline)}
                                            {months !== null && <span style={{ color: "var(--text-4)" }}> · {months} month{months !== 1 ? "s" : ""} left</span>}
                                        </div>
                                    )}

                                    {g.milestones?.length > 0 && (
                                        <div className="milestone-list">
                                            {g.milestones.map((m, i) => (
                                                <button key={i} className={`milestone-item${m.done ? " done" : ""}`} onClick={() => toggleMilestone(g, i)}>
                                                    <span className="ms-box">✓</span>
                                                    {m.title}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    <div className="row between">
                                        <button
                                            className={`btn small ${g.status === "completed" ? "ghost" : "primary"}`}
                                            onClick={() => completeGoal(g)}
                                        >
                                            <Flag size={13} />
                                            {g.status === "completed" ? "Reopen" : "Mark complete"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* create/edit modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? "Edit goal" : "New goal"}
                large
                actions={
                    <>
                        <button className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={busy || !title.trim()}>
                            {editing ? "Save changes" : "Create goal"}
                        </button>
                    </>
                }
            >
                <div className="grid" style={{ gap: 16 }}>
                    <Field label="Goal title">
                        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="BUILD A STRONGER PHYSIQUE" style={{ textTransform: "uppercase", fontWeight: 700 }} autoFocus />
                    </Field>
                    <Field label="Why does this matter? (optional)">
                        <textarea className="textarea" style={{ minHeight: 70 }} value={description} onChange={(e) => setDescription(e.target.value)} />
                    </Field>
                    <div className="field-row">
                        <Field label="Area">
                            <select className="select" value={area} onChange={(e) => setArea(e.target.value)}>
                                {AREAS.map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
                            </select>
                        </Field>
                        <Field label="Horizon">
                            <select className="select" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                                <option value="short">Short-term</option>
                                <option value="medium">Medium-term</option>
                                <option value="long">Long-term</option>
                            </select>
                        </Field>
                    </div>
                    <Field label="Deadline (optional)">
                        <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                    </Field>

                    <Field label="Milestones">
                        <div className="grid" style={{ gap: 8 }}>
                            {milestones.map((m, i) => (
                                <div className="row" key={i}>
                                    <input
                                        className="input"
                                        value={m.title}
                                        onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                                        placeholder="Milestone"
                                    />
                                    <button type="button" className="icon-btn" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}>
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            ))}
                            {milestones.length < 12 && (
                                <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setMilestones([...milestones, { title: "", done: false }])}>
                                    <Plus size={14} /> Add milestone
                                </button>
                            )}
                        </div>
                    </Field>

                    <Field label="Connected habits (progress feeds from these)">
                        {habits.length === 0 ? (
                            <p className="hint">No habits yet — create habits to link them here.</p>
                        ) : (
                            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                {habits.map((h) => (
                                    <button
                                        type="button"
                                        key={h._id}
                                        className={`ob-choice${linkedHabitIds.includes(h._id) ? " selected" : ""}`}
                                        onClick={() => setLinkedHabitIds(linkedHabitIds.includes(h._id) ? linkedHabitIds.filter((x) => x !== h._id) : [...linkedHabitIds, h._id])}
                                    >
                                        {h.name}
                                        <span className="check-ind">✓</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </Field>

                    <Field label="Notes (optional)">
                        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Strategy, reminders, references…" />
                    </Field>
                </div>
            </Modal>

            <ConfirmDialog
                open={!!deleteGoal}
                onClose={() => setDeleteGoal(null)}
                onConfirm={confirmDelete}
                title="Delete goal?"
                message={`"${deleteGoal?.title}" will be permanently removed.`}
                confirmLabel="Delete"
                danger
                busy={busy}
            />
        </div>
    );
}
