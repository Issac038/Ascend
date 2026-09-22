import { useCallback, useEffect, useState } from "react";
import { Dumbbell, CalendarDays, Moon, CheckCircle2 } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { PageSkeleton, EmptyState, ProgressBar, ConfirmDialog } from "../ui/Primitives";
import { formatLong } from "../../utils/format";
import WorkoutEditor from "./WorkoutEditor";
import WeeklyPlanner from "./WeeklyPlanner";

const WEEKDAY_LABELS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export default function Gym() {
    const { toast } = useStore();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [today, setToday] = useState(null);
    const [week, setWeek] = useState(null);
    const [plan, setPlan] = useState(null);
    const [workouts, setWorkouts] = useState([]);
    const [history, setHistory] = useState([]);
    const [viewDate, setViewDate] = useState(null); // set when inspecting a non-today day

    const [showPlanner, setShowPlanner] = useState(false);
    const [editor, setEditor] = useState(null); // null = closed | {} = new | workout = edit
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [toggling, setToggling] = useState(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [t, w, p, h] = await Promise.all([
                api.get("/gym/today"),
                api.get("/gym/week"),
                api.get("/gym/plan"),
                api.get("/gym/history?limit=30")
            ]);
            setToday(t.data);
            setWeek(w.data);
            setPlan(p.data.plan);
            setWorkouts(p.data.workouts);
            setHistory(h.data.sessions);
            setViewDate(null);
        } catch (e) {
            setError(e.response?.data?.message || "Cannot reach ASCEND. Is the server running?");
        } finally {
            setViewDate(null);
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    async function viewDay(date) {
        try {
            const res = await api.get(`/gym/sessions/${date}`);
            setViewDate(date);
            setToday((prev) => ({ ...res.data, date: res.data.date, isOtherDay: date !== prev.date }));
        } catch (e) {
            toast(e.response?.data?.message || "Couldn't load that day.");
        }
    }

    // Optimistic toggle: update UI immediately, reconcile with the server.
    async function toggleExercise(key) {
        if (toggling || !today?.workout) return;
        setToggling(key);
        setToday((prev) => {
            if (!prev || !prev.workout) return prev;
            const exercises = prev.session
                ? prev.session.exercises.map((x) => (x.key === key ? { ...x, done: !x.done } : x))
                : (prev.workout.exercises || []).map((x) => ({ key: x.name.toLowerCase(), name: x.name, detail: x.detail, done: x.name.toLowerCase() === key }));
            const done = exercises.filter((x) => x.done).length;
            const total = exercises.length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return {
                ...prev,
                session: {
                    ...(prev.session || { workoutName: prev.workout.name }),
                    exercises, done, total, pct,
                    completed: total > 0 && done === total
                },
                progress: { done, total, pct }
            };
        });
        try {
            const res = await api.post(`/gym/sessions/${today.date}/toggle`, { key });
            setToday((prev) => ({
                ...prev,
                session: res.data.session,
                progress: { done: res.data.session.done, total: res.data.session.total, pct: res.data.session.pct }
            }));
            api.get("/gym/week").then((r) => setWeek(r.data)).catch(() => {});
            api.get("/gym/history?limit=30").then((r) => setHistory(r.data.sessions)).catch(() => {});
        } catch (e) {
            toast(e.response?.data?.message || "Couldn't save that. Check your connection and try again.");
            loadAll(); // resync from truth
        } finally {
            setToggling(null);
        }
    }

    async function savePlan(draft) {
        const days = {};
        for (const [k, v] of Object.entries(draft)) days[k] = v || null;
        await api.put("/gym/plan", { days });
        const p = await api.get("/gym/plan");
        setPlan(p.data.plan);
        setWorkouts(p.data.workouts);
        setViewDate(null);
        const t = await api.get("/gym/today");
        setToday(t.data);
        api.get("/gym/week").then((r) => setWeek(r.data)).catch(() => {});
    }

    async function handleWorkoutSaved() {
        setEditor(null);
        const p = await api.get("/gym/plan");
        setPlan(p.data.plan);
        setWorkouts(p.data.workouts);
        setViewDate(null);
        const t = await api.get("/gym/today");
        setToday(t.data);
        api.get("/gym/week").then((r) => setWeek(r.data)).catch(() => {});
        api.get("/gym/history?limit=30").then((r) => setHistory(r.data.sessions)).catch(() => {});
    }

    async function handleDeleteWorkout(w) {
        try {
            await api.delete(`/gym/workouts/${w._id}`);
            toast(`Deleted "${w.name}". Past history is kept.`);
            const p = await api.get("/gym/plan");
            setPlan(p.data.plan);
            setWorkouts(p.data.workouts);
            setViewDate(null);
            const t = await api.get("/gym/today");
            setToday(t.data);
            api.get("/gym/week").then((r) => setWeek(r.data)).catch(() => {});
        } catch (e) {
            toast(e.response?.data?.message || "Couldn't delete that workout.");
        }
    }

    async function refreshSession() {
        try {
            const res = await api.post(`/gym/sessions/${today.date}/refresh`, {});
            setToday((prev) => ({
                ...prev,
                session: res.data.session,
                progress: { done: res.data.session.done, total: res.data.session.total, pct: res.data.session.pct }
            }));
            toast("Workout synced with your latest edits.");
        } catch (e) {
            toast(e.response?.data?.message || "Couldn't sync this workout.");
        }
    }

    if (loading) return <PageSkeleton />;
    if (error) return <EmptyState title="ASCEND can't reach the server" message={error} />;

    const hasPlan = workouts.length > 0 || Object.values(plan?.days || {}).some(Boolean);

    // ---------- empty state ----------
    if (!hasPlan) {
        return (
            <div className="page-fade">
                <div className="section-title"><h1>Gym</h1></div>
                <EmptyState
                    icon={<Dumbbell size={30} />}
                    title="NO WORKOUT PLAN YET"
                    message="Create your weekly gym routine and ASCEND will show you today's workout automatically."
                    action={<button className="btn primary" onClick={() => setShowPlanner(true)}>Create weekly plan</button>}
                />
                <WeeklyPlanner
                    open={showPlanner}
                    onClose={() => setShowPlanner(false)}
                    plan={plan}
                    workouts={workouts}
                    onPlanSaved={savePlan}
                    onEditWorkout={(w) => setEditor(w)}
                    onCreateWorkout={() => setEditor({})}
                    onDeleteWorkout={handleDeleteWorkout}
                />
                {editor !== null && (
                    <WorkoutEditor
                        open
                        workout={editor && editor._id ? editor : null}
                        onClose={() => setEditor(null)}
                        onSaved={handleWorkoutSaved}
                    />
                )}
            </div>
        );
    }

    // ---------- main view ----------
    const t = today || {};
    const isTodayView = !viewDate;
    const sessionExercises = t.session
        ? t.session.exercises
        : (t.workout?.exercises || []).map((x) => ({ key: x.name.toLowerCase(), name: x.name, detail: x.detail, done: false }));
    const prog = t.session
        ? t.progress
        : { done: 0, total: (t.workout?.exercises || []).length, pct: 0 };

    const defKeys = new Set((t.workout?.exercises || []).map((e) => e.name.toLowerCase()));
    const stale = t.session && t.workout && (
        t.session.workoutName !== t.workout.name ||
        t.session.exercises.length !== (t.workout.exercises || []).length ||
        !t.session.exercises.every((x) => defKeys.has(x.key))
    );

    return (
        <div className="page-fade">
            <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1>Gym</h1>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn ghost small" onClick={() => setShowPlanner(true)}><CalendarDays size={14} /> Weekly plan</button>
                    <button className="btn ghost small" onClick={() => setEditor({})}><Dumbbell size={14} /> New workout</button>
                </div>
            </div>

            {/* ---------- TODAY / VIEWED DAY ---------- */}
            <div className="section">
                {!t.restDay && (t.workout || t.session) ? (
                    <div className="card gym-today-card">
                        <div className="row between" style={{ alignItems: "flex-start" }}>
                            <div>
                                <p className="hint">{isTodayView ? "TODAY" : "THAT DAY"} · {WEEKDAY_LABELS[t.weekdayKey] || t.weekdayKey}</p>
                                <h2 style={{ margin: "2px 0 0" }}>{t.session?.workoutName || t.workout?.name}</h2>
                            </div>
                            {t.session?.completed && <CheckCircle2 size={26} style={{ color: "var(--ok)" }} />}
                        </div>
                        <div style={{ margin: "14px 0 6px" }}>
                            <ProgressBar value={prog.pct} />
                            <div className="row between hint" style={{ marginTop: 6 }}>
                                <span>{prog.done} / {prog.total} exercises</span>
                                <span className="mono-num">{prog.pct}%</span>
                            </div>
                        </div>

                        <div className="gym-checklist">
                            {sessionExercises.map((ex) => (
                                <button
                                    key={ex.key}
                                    className={`gym-check-row${ex.done ? " done" : ""}`}
                                    onClick={() => toggleExercise(ex.key)}
                                    disabled={toggling === ex.key}
                                    aria-pressed={ex.done}
                                >
                                    <span className="gym-check-box" aria-hidden="true">{ex.done ? "✓" : ""}</span>
                                    <span className="gym-check-info">
                                        <span className="gym-check-name">{ex.name}</span>
                                        <span className="gym-check-detail">{ex.detail}</span>
                                    </span>
                                </button>
                            ))}
                        </div>

                        {t.session?.completed && (
                            <div className="gym-complete-banner">
                                <CheckCircle2 size={20} />
                                <div>
                                    <strong>WORKOUT COMPLETE</strong>
                                    <div className="hint">{prog.done} / {prog.total} exercises · 100%</div>
                                </div>
                            </div>
                        )}

                        {stale && isTodayView && (
                            <div className="gym-stale-banner">
                                <p className="hint" style={{ margin: 0 }}>
                                    You edited this workout after starting it. Sync to update the exercise list — already-checked exercises stay checked.
                                </p>
                                <button className="btn ghost small" onClick={refreshSession}>Sync now</button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="card gym-rest-card">
                        <Moon size={26} style={{ color: "var(--text-3)" }} />
                        <div>
                            <h2 style={{ margin: 0 }}>REST DAY</h2>
                            <p className="hint" style={{ margin: "4px 0 0" }}>
                                No workout scheduled{isTodayView ? " today" : ""}. Recovery is part of the plan.
                            </p>
                        </div>
                    </div>
                )}
                {!isTodayView && (
                    <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => loadAll()}>← Back to today</button>
                )}
            </div>

            {/* ---------- WEEK ---------- */}
            <div className="section">
                <div className="section-title"><h2>This week</h2></div>
                <div className="card">
                    <div className="gym-week-grid">
                        {(week?.days || []).map((d) => (
                            <button
                                type="button"
                                className={`gym-week-day${d.isToday ? " today" : ""}`}
                                key={d.date}
                                onClick={() => viewDay(d.date)}
                                aria-label={`${d.weekdayKey}: ${d.restDay ? "rest day" : d.workoutName || "workout"}`}
                            >
                                <div className="gym-week-dow">{d.weekdayKey.slice(0, 3).toUpperCase()}</div>
                                <div className="gym-week-main">
                                    {d.restDay
                                        ? <span className="gym-week-rest">Rest</span>
                                        : <span className="gym-week-name">{d.workoutName || "—"}</span>}
                                    {!d.restDay && d.pct !== null && (
                                        <span className={`gym-week-status${d.completed ? " ok" : ""}`}>
                                            {d.completed ? "✓" : `${d.done}/${d.total}`}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ---------- HISTORY ---------- */}
            <div className="section">
                <div className="section-title"><h2>History</h2></div>
                {history.length === 0 ? (
                    <p className="hint">Completed workouts will appear here once you check off your first exercise.</p>
                ) : (
                    <div className="gym-history">
                        {history.map((s, i) => (
                            <div className="gym-history-row" key={`${s.date}-${i}`}>
                                <div className="gym-history-date">{formatLong(s.date)}</div>
                                <div className="gym-history-body">
                                    <span className="gym-history-name">{s.completed ? "✓ " : ""}{s.workoutName}</span>
                                    <span className="hint">{s.done}/{s.total} exercises</span>
                                </div>
                                <div className="gym-history-pct mono-num">{s.pct}%</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ---------- modals ---------- */}
            <WeeklyPlanner
                open={showPlanner}
                onClose={() => setShowPlanner(false)}
                plan={plan}
                workouts={workouts}
                onPlanSaved={savePlan}
                onEditWorkout={(w) => setEditor(w)}
                onCreateWorkout={() => setEditor({})}
                onDeleteWorkout={handleDeleteWorkout}
            />
            {editor !== null && (
                <WorkoutEditor
                    open
                    workout={editor && editor._id ? editor : null}
                    onClose={() => setEditor(null)}
                    onSaved={handleWorkoutSaved}
                />
            )}
            <ConfirmDialog
                open={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={async () => { const w = confirmDelete; setConfirmDelete(null); await handleDeleteWorkout(w); }}
                title="Delete workout?"
                message={`"${confirmDelete?.name}" will be removed from every day it's assigned to. Past workout history is kept.`}
                confirmLabel="Delete"
                danger
            />
        </div>
    );
}
