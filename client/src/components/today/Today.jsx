import { useCallback, useEffect, useState } from "react";
import { Plus, Check, SkipForward, Pencil, Trash2, CalendarClock } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, PageSkeleton, EmptyState, ConfirmDialog } from "../ui/Primitives";
import { ProgressBar } from "../ui/Primitives";
import { formatLong, todayKey } from "../../utils/format";

const BLOCKS = [
    { key: "morning", label: "MORNING" },
    { key: "afternoon", label: "AFTERNOON" },
    { key: "evening", label: "EVENING" },
    { key: "anytime", label: "ANYTIME" }
];

function addDaysKey(dateKey, n) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function Today() {
    const { toast, reloadDashboard } = useStore();
    const [date] = useState(todayKey());
    const [tasks, setTasks] = useState(null);
    const [habits, setHabits] = useState(null);
    const [completions, setCompletions] = useState({});
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleteTask, setDeleteTask] = useState(null);
    const [busy, setBusy] = useState(false);

    // form
    const [title, setTitle] = useState("");
    const [timeBlock, setTimeBlock] = useState("morning");
    const [priority, setPriority] = useState("normal");
    const [recurrence, setRecurrence] = useState("none");

    const load = useCallback(async function load() {
        const [t, h] = await Promise.all([
            api.get(`/data/tasks?date=${date}`),
            api.get("/data/habits")
        ]);
        setTasks(t.data.tasks);
        setHabits(h.data.habits);

        const comps = await Promise.all(
            h.data.habits.map((hab) => api.get(`/data/habits/${hab._id}/history`))
        );
        const map = {};
        comps.forEach((res, i) => {
            const c = res.data.completions[date];
            map[h.data.habits[i]._id] = h.data.habits[i].type === "numeric" ? { value: c || 0 } : { completed: c === true };
        });
        setCompletions(map);
    }, [date]);

    useEffect(() => {
        load().catch(() => toast("Failed to load today"));
    }, [load, toast]);

    async function toggleTask(task) {
        setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, completed: !t.completed } : t)));
        try {
            await api.patch(`/data/tasks/${task._id}`, { completed: !task.completed });
            reloadDashboard();
        } catch {
            setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, completed: task.completed } : t)));
            toast("Failed to update task");
        }
    }

    async function skipTask(task) {
        try {
            await api.patch(`/data/tasks/${task._id}`, { skipped: !task.skipped });
            load();
            reloadDashboard();
        } catch {
            toast("Failed to skip task");
        }
    }

    async function reschedule(task, dir) {
        try {
            await api.patch(`/data/tasks/${task._id}`, { date: addDaysKey(task.date, dir) });
            toast(dir > 0 ? "Moved to tomorrow" : "Moved to yesterday");
            if (dir !== 0) load();
            reloadDashboard();
        } catch {
            toast("Failed to reschedule");
        }
    }

    async function toggleHabit(habit) {
        const c = completions[habit._id];
        try {
            if (habit.type === "numeric") {
                const done = (c?.value || 0) >= habit.target;
                await api.post(`/data/habits/${habit._id}/toggle`, { date, delta: done ? -habit.target : habit.target });
            } else {
                await api.post(`/data/habits/${habit._id}/toggle`, { date });
            }
            load();
            reloadDashboard();
        } catch {
            toast("Failed to update habit");
        }
    }

    function openAdd(block = "morning") {
        setEditing(null);
        setTitle("");
        setTimeBlock(block);
        setPriority("normal");
        setRecurrence("none");
        setModalOpen(true);
    }

    function openEdit(task) {
        setEditing(task);
        setTitle(task.title);
        setTimeBlock(task.timeBlock);
        setPriority(task.priority);
        setRecurrence(task.recurrence);
        setModalOpen(true);
    }

    async function saveTask(e) {
        e.preventDefault();
        setBusy(true);
        try {
            if (editing) {
                await api.patch(`/data/tasks/${editing._id}`, { title, timeBlock, priority, recurrence });
            } else {
                await api.post("/data/tasks", { title, timeBlock, priority, recurrence, date });
            }
            setModalOpen(false);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to save task");
        } finally {
            setBusy(false);
        }
    }

    async function confirmDelete() {
        setBusy(true);
        try {
            await api.delete(`/data/tasks/${deleteTask._id}`);
            setDeleteTask(null);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to delete task");
        } finally {
            setBusy(false);
        }
    }

    if (!tasks || !habits) return <PageSkeleton />;

    const doneCount = tasks.filter((t) => t.completed).length;

    // Day progress mirrors the server score: habits 60% / tasks 40%.
    const habitDone = habits.filter((h) => {
        const c = completions[h._id];
        return h.type === "numeric" && h.target > 0
            ? (c?.value || 0) >= h.target
            : c?.completed === true;
    }).length;
    const habitPart = habits.length ? habitDone / habits.length : null;
    const taskPart = tasks.length ? doneCount / tasks.length : null;
    let dayProgress;
    if (habitPart !== null && taskPart !== null) {
        dayProgress = Math.round(habitPart * 60 + taskPart * 40);
    } else if (habitPart !== null) {
        dayProgress = Math.round(habitPart * 100);
    } else {
        dayProgress = Math.round((taskPart || 0) * 100);
    }

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Today</h1>
                    <p className="sub">{formatLong(date)}</p>
                </div>
                <button className="btn primary" onClick={() => openAdd("morning")}>
                    <Plus size={16} /> Add task
                </button>
            </div>

            <div className="card plain" style={{ marginBottom: 30 }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>DAY PROGRESS</span>
                    <span className="mono-num" style={{ fontWeight: 800 }}>{dayProgress}%</span>
                </div>
                <ProgressBar value={dayProgress} />
            </div>

            {/* habits today */}
            <div className="section">
                <div className="section-title"><h2>Habits</h2></div>
                {habits.length === 0 ? (
                    <p className="hint">No habits created yet.</p>
                ) : (
                    <div className="grid cols-2">
                        {habits.map((h) => {
                            const c = completions[h._id] || {};
                            const done = h.type === "numeric" ? (c.value || 0) >= h.target : c.completed;
                            return (
                                <button key={h._id} className={`quick-habit${done ? " done" : ""}`} onClick={() => toggleHabit(h)}>
                                    <span className="qh-check">✓</span>
                                    <span className="qh-name">
                                        {h.name}
                                        {h.type === "numeric" && <span className="qh-meta" style={{ display: "block", fontWeight: 500 }}>{c.value || 0} / {h.target} {h.unit}</span>}
                                    </span>
                                    <span className="qh-meta">{h.area}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* tasks by block */}
            <div className="section">
                <div className="section-title"><h2>Timeline</h2></div>
                {tasks.length === 0 ? (
                    <EmptyState
                        icon={<CalendarClock size={34} />}
                        title="Nothing planned for today"
                        message="Decide what today is for. Add your first task."
                        action={<button className="btn primary" onClick={() => openAdd("morning")}>Add a task</button>}
                    />
                ) : (
                    BLOCKS.map(({ key, label }) => {
                        const blockTasks = tasks.filter((t) => t.timeBlock === key);
                        if (blockTasks.length === 0) return null;
                        return (
                            <div key={key}>
                                <div className="time-block-label">{label}</div>
                                <div className="grid" style={{ gap: 8 }}>
                                    {blockTasks.map((t) => (
                                        <div key={t._id} className={`task-item${t.completed ? " done" : ""}${t.skipped ? " skipped" : ""}`}>
                                            <button
                                                className="checkbox"
                                                role="checkbox"
                                                aria-checked={t.completed}
                                                aria-label={`Complete ${t.title}`}
                                                style={{ appearance: "none" }}
                                                onClick={() => toggleTask(t)}
                                            >
                                                {t.completed && <Check size={14} />}
                                            </button>
                                            <span className="priority-dot {t.priority}" style={{ backgroundColor: t.priority === "high" ? "#eaeaea" : t.priority === "normal" ? "#6a6a6a" : "#3d3d3d" }} />
                                            <span className="task-title">{t.title}</span>
                                            <span className="task-meta">
                                                {t.recurrence !== "none" && <span className="badge">{t.recurrence}</span>}
                                                {t.skipped && <span className="badge">skipped</span>}
                                            </span>
                                            <div className="task-actions">
                                                <button className="icon-btn" title="Reschedule to tomorrow" onClick={() => reschedule(t, 1)}><CalendarClock size={15} /></button>
                                                <button className="icon-btn" title="Skip" onClick={() => skipTask(t)}><SkipForward size={15} /></button>
                                                <button className="icon-btn" title="Edit" onClick={() => openEdit(t)}><Pencil size={15} /></button>
                                                <button className="icon-btn" title="Delete" onClick={() => setDeleteTask(t)}><Trash2 size={15} /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* add/edit modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? "Edit task" : "Add task"}
                actions={
                    <>
                        <button className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
                        <button className="btn primary" onClick={saveTask} disabled={busy || !title.trim()}>
                            {editing ? "Save changes" : "Add task"}
                        </button>
                    </>
                }
            >
                <div className="grid" style={{ gap: 16 }}>
                    <Field label="What needs to happen?">
                        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Study 2 hours" autoFocus />
                    </Field>
                    <div className="field-row">
                        <Field label="Time block">
                            <select className="select" value={timeBlock} onChange={(e) => setTimeBlock(e.target.value)}>
                                {BLOCKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                            </select>
                        </Field>
                        <Field label="Priority">
                            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                                <option value="high">High</option>
                                <option value="normal">Normal</option>
                                <option value="low">Low</option>
                            </select>
                        </Field>
                    </div>
                    <Field label="Repeat">
                        <select className="select" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                            <option value="none">Once</option>
                            <option value="daily">Every day</option>
                            <option value="weekdays">Weekdays</option>
                            <option value="weekly">Weekly</option>
                        </select>
                    </Field>
                </div>
            </Modal>

            <ConfirmDialog
                open={!!deleteTask}
                onClose={() => setDeleteTask(null)}
                onConfirm={confirmDelete}
                title="Delete task?"
                message={`"${deleteTask?.title}" will be removed from ${formatLong(deleteTask?.date || date)}.`}
                confirmLabel="Delete"
                danger
                busy={busy}
            />
        </div>
    );
}
