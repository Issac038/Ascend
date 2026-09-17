import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { ProgressRing, ProgressBar, PageSkeleton, EmptyState } from "../ui/Primitives";import { MiniBars } from "../charts/Charts";
import { formatShort, greeting } from "../../utils/format";

export default function Dashboard() {
    const { user, dash, dashError, reloadDashboard, toast } = useStore();
    const [busyHabit, setBusyHabit] = useState(null);
    const [review, setReview] = useState(null);

    useEffect(() => {
        api.get("/review/weekly").then((r) => setReview(r.data)).catch(() => {});
    }, []);

    if (dashError) {
        return (
            <EmptyState
                title="ASCEND can't reach the server"
                message={dashError}
            />
        );
    }

    if (!dash) return <PageSkeleton />;

    const snap = dash.snapshot;
    const score = snap?.score ?? 0;
    const remaining = dash.tasks.filter((t) => !t.completed && !t.skipped).length
        + dash.habits.length - dash.habits.filter((h) => {
            const c = dash.habitCompletions[h._id];
            return h.type === "numeric" ? (c?.value || 0) >= h.target : c?.completed;
        }).length;

    const trendValues = dash.trend.map((t) => t.score);

    async function toggleHabit(habit) {
        setBusyHabit(habit._id);
        try {
            const c = dash.habitCompletions[habit._id];
            if (habit.type === "numeric") {
                const value = c?.value || 0;
                const done = value >= habit.target;
                await api.post(`/data/habits/${habit._id}/toggle`, { delta: done ? -habit.target : habit.target });
            } else {
                await api.post(`/data/habits/${habit._id}/toggle`, {});
            }
            await reloadDashboard();
        } catch {
            toast("Failed to update habit");
        } finally {
            setBusyHabit(null);
        }
    }

    const isNumericDone = (h) => {
        const c = dash.habitCompletions[h._id];
        return h.type === "numeric" ? (c?.value || 0) >= h.target : c?.completed;
    };

    const recovery = dash?.user?.recovery || user?.recovery;

    return (
        <div className="page-fade">
            <div className="dash-hero">
                <div>
                    <h1>{greeting()}, {user.name.split(" ")[0]}.</h1>
                    <p className="hero-sub">
                        {recovery?.active
                            ? "Today is still yours."
                            : snap?.score >= 80 ? "Strong day. Keep ascending."
                            : snap?.score >= 40 ? "Let's make today count."
                            : "Start with one action. The rest follows."}
                    </p>
                </div>
                <ProgressRing value={score} sub="ASCEND SCORE" />
            </div>

            {recovery?.active && (
                <div className="recovery-banner">
                    <h3>You missed {recovery.missedDays} days.</h3>
                    <p>
                        That's not the story. One action today puts you back on the path —
                        consistency beats perfection, and today is still yours.
                    </p>
                    <Link to="/today" className="btn primary small" style={{ marginTop: 12, display: "inline-flex" }}>
                        Return today
                    </Link>
                </div>
            )}

            {/* stats */}
            <div className="grid cols-4 section">
                <div className="card stat-card">
                    <span className="stat-label">Current streak</span>
                    <span className="stat-value mono-num">{dash.streak}<span style={{ fontSize: 14, color: "var(--text-3)" }}> {dash.streak === 1 ? "day" : "days"}</span></span>
                    <span className="stat-sub">Best: {dash.bestStreak} days</span>
                </div>
                <div className="card stat-card">
                    <span className="stat-label">Level</span>
                    <span className="stat-value mono-num">{dash.level.level}</span>
                    <span className="stat-sub">“{dash.level.name}” · {dash.level.xp} XP</span>
                    <ProgressBar value={dash.level.progressToNext} thin />
                </div>
                <div className="card stat-card">
                    <span className="stat-label">Habits today</span>
                    <span className="stat-value mono-num">
                        {dash.habits.filter(isNumericDone).length}<span style={{ fontSize: 14, color: "var(--text-3)" }}>/{dash.habits.length}</span>
                    </span>
                    <span className="stat-sub">{snap?.habitsScheduled ? `${snap.habitsDone} counted toward score` : "None scheduled yet"}</span>
                </div>
                <div className="card stat-card">
                    <span className="stat-label">Tasks today</span>
                    <span className="stat-value mono-num">
                        {snap?.tasksDone ?? 0}<span style={{ fontSize: 14, color: "var(--text-3)" }}>/{snap?.tasksTotal ?? 0}</span>
                    </span>
                    <span className="stat-sub">{remaining > 0 ? `${remaining} actions remaining` : "All clear for today"}</span>
                </div>
            </div>

            <div className="grid cols-2 section">
                {/* trend */}
                <div className="card chart-card">
                    <div className="chart-title">
                        <span>LAST 14 DAYS</span>
                        <span className="mono-num" style={{ color: "var(--text)" }}>{snap?.score ?? "—"}%</span>
                    </div>
                    <MiniBars values={trendValues} />
                    <div className="row between" style={{ marginTop: 8 }}>
                        <span className="hint">{formatShort(dash.trend[0]?.date)}</span>
                        <span className="hint">Today</span>
                    </div>
                </div>

                {/* areas */}
                <div className="card">
                    <div className="chart-title"><span>AREAS IN PROGRESS</span><Link to="/areas" className="hint" style={{ fontWeight: 600 }}>View all →</Link></div>
                    {dash.areas.filter((a) => a.goalProgress !== null).slice(0, 5).map((a) => (
                        <div className="area-row" key={a.key}>
                            <span className="area-name">{a.name}</span>
                            <ProgressBar value={a.goalProgress} thin />
                            <span className="area-pct mono-num">{a.goalProgress}%</span>
                        </div>
                    ))}
                    {dash.areas.every((a) => a.goalProgress === null) && (
                        <p className="hint">Goals will show their progress per area here.</p>
                    )}
                </div>
            </div>

            {/* today's habits */}
            <div className="section">
                <div className="section-title">
                    <h2>Today's habits</h2>
                    <Link to="/habits" className="hint" style={{ fontWeight: 600 }}>Manage →</Link>
                </div>
                {dash.habits.length === 0 ? (
                    <EmptyState
                        title="No habits yet"
                        message="Habits are the engine of progress. Start with one."
                        action={<Link to="/habits" className="btn primary">Create your first habit</Link>}
                    />
                ) : (
                    <div className="grid cols-2">
                        {dash.habits.map((h) => {
                            const done = isNumericDone(h);
                            const c = dash.habitCompletions[h._id];
                            return (
                                <button
                                    key={h._id}
                                    className={`quick-habit${done ? " done" : ""}`}
                                    onClick={() => toggleHabit(h)}
                                    disabled={busyHabit === h._id}
                                >
                                    <span className="qh-check">✓</span>
                                    <span className="qh-name">
                                        {h.name}
                                        {h.type === "numeric" && (
                                            <span className="qh-meta" style={{ display: "block", fontWeight: 500 }}>
                                                {c?.value || 0} / {h.target} {h.unit}
                                            </span>
                                        )}
                                    </span>
                                    <span className="qh-meta">{h.area}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* goals + weekly review */}
            <div className="grid cols-2 section">
                <div>
                    <div className="section-title">
                        <h2>Active goals</h2>
                        <Link to="/goals" className="hint" style={{ fontWeight: 600 }}>All goals →</Link>
                    </div>
                    {dash.areas.every((a) => a.goalProgress === null) ? (
                        <EmptyState
                            title="No goals yet"
                            message="You haven't decided where you're going yet."
                            action={<Link to="/goals" className="btn primary">Create your first goal</Link>}
                        />
                    ) : (
                        <div className="grid" style={{ gap: 10 }}>
                            {dash.areas.filter((a) => a.goalProgress !== null).slice(0, 4).map((a) => (
                                <div className="card plain" key={a.key} style={{ padding: "14px 18px" }}>
                                    <div className="row between" style={{ marginBottom: 8 }}>
                                        <span style={{ fontWeight: 700, color: "var(--text)", fontSize: 13.5 }}>{a.name} goals</span>
                                        <span className="mono-num" style={{ fontWeight: 800 }}>{a.goalProgress}%</span>
                                    </div>
                                    <ProgressBar value={a.goalProgress} thin />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div>
                    <div className="section-title">
                        <h2>This week</h2>
                        <Link to="/analytics" className="hint" style={{ fontWeight: 600 }}>Analytics →</Link>
                    </div>
                    {review && (
                        <div className="card">
                            <div className="grid cols-2" style={{ gap: 18 }}>
                                <div>
                                    <p className="hint">AVG SCORE</p>
                                    <p className="mono-num" style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}>{review.avgScore ?? "—"}{review.avgScore !== null && "%"}</p>
                                </div>
                                <div>
                                    <p className="hint">HABIT CONSISTENCY</p>
                                    <p className="mono-num" style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}>{review.habitConsistency ?? "—"}{review.habitConsistency !== null && "%"}</p>
                                </div>
                            </div>
                            <p style={{ marginTop: 16, color: "var(--text-2)", fontSize: 13.5 }}>
                                {review.avgScore >= 70
                                    ? "Strong week. Protect the routine."
                                    : review.avgScore >= 40
                                    ? "Decent week. One more anchor habit would lift it."
                                    : "Rough week. Today is a fresh start — one action."}
                            </p>
                            <p className="hint" style={{ marginTop: 10 }}>
                                {review.completedActions} actions · {review.reflections} reflections · strongest: {review.strongestArea?.name ?? "—"}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
