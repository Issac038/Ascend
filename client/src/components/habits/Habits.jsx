import { useEffect, useState } from "react";
import { Plus, Flame, MoreHorizontal, Trash2, Archive } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, PageSkeleton, EmptyState, ConfirmDialog } from "../ui/Primitives";
import { todayKey, weekdayInitial } from "../../utils/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function lastNDaysKeys(n) {
    const keys = [];
    const [ty, tm, td] = todayKey().split("-").map(Number);
    const end = new Date(ty, tm - 1, td);
    for (let i = n - 1; i >= 0; i -= 1) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return keys;
}

// The CURRENT CALENDAR WEEK, Sunday → Saturday (SMTWTFS). The previous card
// dots showed a rolling last-7-days window ending today, which read as e.g.
// "T F S S M T" on a Tuesday. A fixed week always starts on Sunday.
function calendarWeekKeys() {
    const [ty, tm, td] = todayKey().split("-").map(Number);
    const now = new Date(ty, tm - 1, td);
    const sunday = new Date(now);
    sunday.setDate(sunday.getDate() - now.getDay()); // back to Sunday
    const keys = [];
    for (let i = 0; i < 7; i += 1) {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return keys;
}

export default function Habits() {
    const { toast, reloadDashboard } = useStore();
    const [habits, setHabits] = useState(null);
    const [histories, setHistories] = useState({});
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [detailHabit, setDetailHabit] = useState(null);
    const [deleteHabit, setDeleteHabit] = useState(null);
    const [busy, setBusy] = useState(false);

    // form
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [area, setArea] = useState("personal");
    const [type, setType] = useState("boolean");
    const [frequency, setFrequency] = useState("daily");
    const [specificDays, setSpecificDays] = useState([1, 2, 3, 4, 5]);
    const [target, setTarget] = useState("");
    const [unit, setUnit] = useState("");
    const [difficulty, setDifficulty] = useState("medium");
    const [reminderTime, setReminderTime] = useState("");

    async function load() {
        const res = await api.get("/data/habits");
        const active = res.data.habits;
        setHabits(active);
        const hists = await Promise.all(active.map((h) => api.get(`/data/habits/${h._id}/history`)));
        const map = {};
        active.forEach((h, i) => { map[h._id] = hists[i].data; });
        setHistories(map);
    }

    // Fetch history for a single habit and merge it (targeted refresh —
    // toggling/saving one habit must not refetch every habit's history).
    async function refreshOneHabit(id) {
        try {
            const h = await api.get(`/data/habits/${id}/history`);
            setHistories((prev) => ({ ...prev, [id]: h.data }));
        } catch { /* next full load recovers */ }
    }

    useEffect(() => {
        load().catch(() => toast("Failed to load habits"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function openAdd() {
        setEditing(null);
        setName(""); setDescription(""); setType("boolean"); setFrequency("daily");
        setSpecificDays([1, 2, 3, 4, 5]); setTarget(""); setUnit("");
        setDifficulty("medium"); setReminderTime("");
        setModalOpen(true);
    }

    function openEdit(h) {
        setEditing(h);
        setName(h.name); setDescription(h.description || ""); setType(h.type);
        setFrequency(h.frequency); setSpecificDays(h.specificDays?.length ? h.specificDays : [1, 2, 3, 4, 5]);
        setTarget(h.type === "numeric" ? String(h.target) : ""); setUnit(h.unit || "");
        setDifficulty(h.difficulty || "medium"); setReminderTime(h.reminderTime || "");
        setModalOpen(true);
    }

    async function save(e) {
        e.preventDefault();
        setBusy(true);
        try {
            const payload = {
                name, description, area, type, frequency, difficulty,
                specificDays: frequency === "specific_days" ? specificDays : [],
                target: type === "numeric" ? Number(target) || 1 : 1,
                unit: type === "numeric" ? unit : "",
                reminderTime: reminderTime || null
            };
            if (editing) {
                const res = await api.patch(`/data/habits/${editing._id}`, payload);
                // Targeted update: swap the edited habit in place, refetch only
                // its history. No full-page reload per save.
                setHabits((prev) => prev.map((h) => (h._id === editing._id ? res.data.habit : h)));
                refreshOneHabit(editing._id);
            } else {
                const res = await api.post("/data/habits", payload);
                setHabits((prev) => [...prev, res.data.habit]);
                refreshOneHabit(res.data.habit._id);
            }
            setModalOpen(false);
            reloadDashboard();
        } catch {
            toast("Failed to save habit");
        } finally {
            setBusy(false);
        }
    }

    async function toggleHabit(h) {
        // Optimistic: flip immediately, reconcile with the server, roll back
        // to the previous value on failure.
        const before = histories[h._id];
        const day = todayKey();
        const cur = before?.completions[day];
        const nextVal = h.type === "numeric"
            ? Math.max(0, (cur || 0) >= h.target ? (cur || 0) - h.target : (cur || 0) + h.target) // mirrors server delta arithmetic
            : !(cur === true);
        setHistories((prev) => ({
            ...prev,
            [h._id]: {
                ...before,
                completions: { ...(before?.completions || {}), [day]: h.type === "numeric" ? nextVal : nextVal }
            }
        }));
        try {
            if (h.type === "numeric") {
                const done = (cur || 0) >= h.target;
                await api.post(`/data/habits/${h._id}/toggle`, { delta: done ? -h.target : h.target });
            } else {
                await api.post(`/data/habits/${h._id}/toggle`, {});
            }
            reloadDashboard();
        } catch {
            setHistories((prev) => ({ ...prev, [h._id]: before }));
            toast("Failed to update habit");
        } finally {
            refreshOneHabit(h._id); // authoritative stats (streaks/percentages)
        }
    }

    async function confirmDelete() {
        const target = deleteHabit;
        if (!target) return;
        setBusy(true);
        const prevHabits = habits;
        const prevHist = histories[target._id];
        // Optimistic removal — the server-side snapshot recompute can take a
        // moment; the row disappears instantly and is restored on failure.
        setHabits((prev) => prev.filter((h) => h._id !== target._id));
        setDeleteHabit(null);
        try {
            await api.delete(`/data/habits/${target._id}`);
            reloadDashboard();
        } catch {
            setHabits(prevHabits);
            setHistories((prev) => ({ ...prev, [target._id]: prevHist }));
            toast("Failed to delete habit");
        } finally {
            setBusy(false);
        }
    }

    async function toggleArchive(h) {
        try {
            const res = await api.patch(`/data/habits/${h._id}`, { archived: !h.archived });
            setHabits((prev) => prev.map((x) => (x._id === h._id ? res.data.habit : x)));
            reloadDashboard();
        } catch {
            toast("Failed to archive habit");
        }
    }

    if (!habits) return <PageSkeleton />;

    const active = habits.filter((h) => !h.archived);
    const archived = habits.filter((h) => h.archived);

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Habits</h1>
                    <p className="sub">Consistency &gt; perfection. Miss a day, not two.</p>
                </div>
                <button className="btn primary" onClick={openAdd}><Plus size={16} /> New habit</button>
            </div>

            {active.length === 0 ? (
                <EmptyState
                    icon={<Flame size={34} />}
                    title="No habits yet"
                    message="Decide who you want to become, then add the daily actions that person performs."
                    action={<button className="btn primary" onClick={openAdd}>Create your first habit</button>}
                />
            ) : (
                <div className="grid cols-2">
                    {active.map((h) => {
                        const hist = histories[h._id];
                        const todayVal = hist?.completions[todayKey()];
                        const done = h.type === "numeric" ? (todayVal || 0) >= h.target : todayVal === true;
                        const sched = { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
                        if (h.frequency === "daily") { for (let i = 0; i < 7; i++) sched[i] = true; }
                        if (h.frequency === "specific_days") { h.specificDays?.forEach((d) => { sched[d] = true; }); }
                        if (h.frequency === "times_per_week") { for (let i = 0; i < 7; i++) sched[i] = true; }

                        return (
                            <div className="card habit-card" key={h._id}>
                                <div className="habit-top">
                                    <div style={{ flex: 1 }}>
                                        <div className="habit-name">{h.name}</div>
                                        {h.description && <div className="habit-desc">{h.description}</div>}
                                        <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                                            <span className="badge">{h.area}</span>
                                            <span className="badge">
                                                {h.type === "numeric" ? `${h.target} ${h.unit} · ` : ""}
                                                {h.frequency === "daily" ? "Daily" : h.frequency === "specific_days" ? [...(h.specificDays || [])].sort((a, b) => a - b).map((d) => DAYS[d].slice(0, 2)).join(" ") : `${h.target}× / week`}
                                            </span>
                                            {h.difficulty === "hard" && <span className="badge">Hard</span>}
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                                        <button
                                            className={`quick-habit${done ? " done" : ""}`}
                                            style={{ width: "auto", padding: "10px 16px" }}
                                            onClick={() => toggleHabit(h)}
                                        >
                                            <span className="qh-check">✓</span>
                                            {h.type === "numeric" ? `${todayVal || 0}/${h.target}` : done ? "Done" : "Mark"}
                                        </button>
                                        <div className="row" style={{ gap: 2 }}>
                                            <button className="icon-btn" title="Edit" onClick={() => openEdit(h)}><MoreHorizontal size={16} /></button>
                                            <button className="icon-btn" title="Archive" onClick={() => toggleArchive(h)}><Archive size={15} /></button>
                                            <button className="icon-btn" title="Delete" onClick={() => setDeleteHabit(h)}><Trash2 size={15} /></button>
                                        </div>
                                    </div>
                                </div>

                                {/* current calendar week — always Sunday → Saturday */}
                                <div className="week-dots">
                                    {calendarWeekKeys().map((k) => {
                                        const dow = new Date(k + "T00:00:00").getDay();
                                        const isSched = sched[dow];
                                        const v = hist?.completions[k];
                                        const isDone = h.type === "numeric" ? (v || 0) >= h.target : v === true;
                                        const isFuture = k > todayKey();
                                        const cls = isDone ? "done" : isFuture ? "future" : isSched ? "scheduled" : "";
                                        return <div key={k} className={`dot ${cls}`} title={k}>{weekdayInitial(k)}</div>;
                                    })}
                                </div>

                                {/* stats */}
                                <div className="habit-stats">
                                    <div className="hs"><strong className="mono-num">{hist?.stats?.completionRate ?? "—"}{hist?.stats?.completionRate !== null && "%"}</strong><span>Completion</span></div>
                                    <div className="hs"><strong className="mono-num">{hist?.weeks?.[3]?.pct ?? "—"}{hist?.weeks?.[3]?.pct !== null && "%"}</strong><span>This week</span></div>
                                    <div className="hs"><strong className="mono-num">{hist?.stats?.totalCompletions ?? 0}</strong><span>Total</span></div>
                                </div>

                                {/* heatmap */}
                                {hist && (
                                    <div>
                                        <p className="hint" style={{ marginBottom: 8, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em" }}>LAST 12 WEEKS</p>
                                        <Heatmap habit={h} completions={hist.completions} />
                                    </div>
                                )}

                                <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setDetailHabit(h)}>
                                    View history
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {archived.length > 0 && (
                <div className="section" style={{ marginTop: 34 }}>
                    <div className="section-title"><h2>Archived</h2></div>
                    <div className="grid cols-3">
                        {archived.map((h) => (
                            <div className="card plain" key={h._id} style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ color: "var(--text-2)", fontWeight: 600, fontSize: 13.5 }}>{h.name}</span>
                                <button className="btn ghost small" onClick={() => toggleArchive(h)}>Restore</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* create/edit modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? "Edit habit" : "New habit"}
                large
                actions={
                    <>
                        <button className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
                            {editing ? "Save changes" : "Create habit"}
                        </button>
                    </>
                }
            >
                <div className="grid" style={{ gap: 16 }}>
                    <Field label="Habit name">
                        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Read 20 pages" autoFocus />
                    </Field>
                    <Field label="Description (optional)">
                        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why does this matter?" />
                    </Field>
                    <div className="field-row">
                        <Field label="Area">
                            <select className="select" value={area} onChange={(e) => setArea(e.target.value)}>
                                {["body", "mind", "discipline", "learning", "productivity", "relationships", "finances", "skills", "personal"].map((a) => (
                                    <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Difficulty">
                            <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                            </select>
                        </Field>
                    </div>
                    <div className="field-row">
                        <Field label="Type">
                            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
                                <option value="boolean">Yes / No habit</option>
                                <option value="numeric">Numeric habit</option>
                            </select>
                        </Field>
                        {type === "numeric" && (
                            <>
                                <Field label="Daily target">
                                    <input className="input" type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="20" />
                                </Field>
                            </>
                        )}
                    </div>
                    {type === "numeric" && (
                        <Field label="Unit">
                            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pages, minutes, liters…" />
                        </Field>
                    )}
                    <Field label="Frequency">
                        <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                            <option value="daily">Every day</option>
                            <option value="specific_days">Specific days</option>
                            <option value="times_per_week">X times per week</option>
                        </select>
                    </Field>
                    {frequency === "specific_days" && (
                        <Field label="Days">
                            <div className="row" style={{ gap: 6 }}>
                                {DAYS.map((d, i) => (
                                    <button
                                        key={d}
                                        type="button"
                                        className={`scale-btn${specificDays.includes(i) ? " active" : ""}`}
                                        style={{ flex: "none", width: 46 }}
                                        onClick={() => setSpecificDays(specificDays.includes(i) ? specificDays.filter((x) => x !== i) : [...specificDays, i])}
                                    >
                                        {d.slice(0, 2)}
                                    </button>
                                ))}
                            </div>
                        </Field>
                    )}
                    {frequency === "times_per_week" && type === "boolean" && (
                        <Field label="Target per week">
                            <input className="input" type="number" min="1" max="7" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="4" />
                        </Field>
                    )}
                    <Field label="Reminder time (optional)">
                        <input className="input" type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} />
                    </Field>
                </div>
            </Modal>

            {/* detail modal */}
            <Modal open={!!detailHabit} onClose={() => setDetailHabit(null)} title={detailHabit?.name} subtitle="Completion history" large>
                {detailHabit && histories[detailHabit._id] && (
                    <div className="grid" style={{ gap: 20 }}>
                        <div className="grid cols-3">
                            <div className="card plain stat-card">
                                <span className="stat-label">Completion rate</span>
                                <span className="stat-value mono-num">{histories[detailHabit._id].stats.completionRate ?? 0}%</span>
                            </div>
                            <div className="card plain stat-card">
                                <span className="stat-label">Total completions</span>
                                <span className="stat-value mono-num">{histories[detailHabit._id].stats.totalCompletions}</span>
                            </div>
                            <div className="card plain stat-card">
                                <span className="stat-label">This week</span>
                                <span className="stat-value mono-num">{histories[detailHabit._id].weeks?.[3]?.pct ?? 0}%</span>
                            </div>
                        </div>
                        <div>
                            <p className="hint" style={{ marginBottom: 8, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em" }}>LAST 12 WEEKS</p>
                            <Heatmap habit={detailHabit} completions={histories[detailHabit._id].completions} large />
                        </div>
                    </div>
                )}
            </Modal>

            <ConfirmDialog
                open={!!deleteHabit}
                onClose={() => setDeleteHabit(null)}
                onConfirm={confirmDelete}
                title="Delete habit?"
                message={`"${deleteHabit?.name}" and its entire history will be permanently removed.`}
                confirmLabel="Delete forever"
                danger
                busy={busy}
            />
        </div>
    );
}

function Heatmap({ habit, completions, large = false }) {
    const nWeeks = large ? 26 : 12;
    const days = lastNDaysKeys(nWeeks * 7);

    // align grid so current week is complete (pad future days)
    const today = todayKey();
    const cells = days.map((k) => {
        const v = completions[k];
        const isDone = habit.type === "numeric" ? (v || 0) >= habit.target : v === true;
        const isFuture = k > today;
        const isRest = habit.frequency === "specific_days" && !habit.specificDays.includes(new Date(k + "T00:00:00").getDay());
        let level = 0;
        if (isFuture) return { k, cls: "future" };
        if (isDone) {
            if (habit.type === "numeric") {
                const ratio = (v || 0) / habit.target;
                level = ratio >= 1 ? 4 : ratio >= 0.75 ? 3 : ratio >= 0.5 ? 2 : 1;
            } else {
                level = 4;
            }
        } else if (!isRest && k < today) {
            level = 1; // missed (soft)
        }
        return { k, cls: level ? `l${level}` : "" };
    });

    return (
        <div className="heatmap" role="img" aria-label="Habit completion heatmap">
            {cells.map((c) => <div key={c.k} className={`cell ${c.cls}`} title={c.k} />)}
        </div>
    );
}
