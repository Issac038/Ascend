import { useEffect, useState } from "react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { PageSkeleton, EmptyState, ProgressBar } from "../ui/Primitives";
import { LineChart, BarChart } from "../charts/Charts";
import { formatShort } from "../../utils/format";

const RANGES = [
    { key: "7", label: "7D" },
    { key: "30", label: "30D" },
    { key: "90", label: "90D" },
    { key: "365", label: "1Y" },
    { key: "all", label: "ALL" }
];

export default function Analytics() {
    const { toast } = useStore();
    const [range, setRange] = useState("30");
    const [data, setData] = useState(null);

    useEffect(() => {
        setData(null);
        api.get(`/analytics?range=${range}`)
            .then((res) => setData(res.data))
            .catch(() => toast("Failed to load analytics"));
    }, [range, toast]);

    if (!data) return <PageSkeleton />;

    const hasData = data.activeDays > 0;

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Analytics</h1>
                    <p className="sub">Progress you can see. Patterns you can act on.</p>
                </div>
                <div className="segmented" role="tablist" aria-label="Date range">
                    {RANGES.map((r) => (
                        <button
                            key={r.key}
                            role="tab"
                            aria-selected={range === r.key}
                            className={range === r.key ? "active" : ""}
                            onClick={() => setRange(r.key)}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {!hasData ? (
                <EmptyState
                    title="No data in this range yet"
                    message="Complete habits and tasks for a few days — your charts will build themselves."
                />
            ) : (
                <>
                    {/* summary */}
                    <div className="grid cols-4 section">
                        <div className="card stat-card">
                            <span className="stat-label">Average score</span>
                            <span className="stat-value mono-num">{data.avgScore ?? "—"}{data.avgScore !== null && "%"}</span>
                            <span className="stat-sub">{data.activeDays} active days</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Total actions</span>
                            <span className="stat-value mono-num">{data.totalActions}</span>
                            <span className="stat-sub">habits + tasks completed</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Perfect days</span>
                            <span className="stat-value mono-num">{data.perfectDays}</span>
                            <span className="stat-sub">100% completion</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Best day</span>
                            <span className="stat-value mono-num">{data.bestDay?.score ?? "—"}{data.bestDay && "%"}</span>
                            <span className="stat-sub">{data.bestDay ? formatShort(data.bestDay.date) : "—"}</span>
                        </div>
                    </div>

                    {/* score trend */}
                    <div className="card chart-card section">
                        <div className="chart-title"><span>SCORE TREND</span><span className="hint">{RANGES.find((r) => r.key === range)?.label}</span></div>
                        <LineChart data={data.series} />
                    </div>

                    <div className="grid cols-2 section">
                        {/* areas */}
                        <div className="card">
                            <div className="chart-title"><span>AREA CONSISTENCY</span></div>
                            {data.areaStats.map((a) => (
                                <div className="area-row" key={a.key}>
                                    <span className="area-name">{a.name}</span>
                                    <ProgressBar value={a.consistency ?? 0} thin />
                                    <span className="area-pct mono-num">{a.consistency === null ? "—" : `${a.consistency}%`}</span>
                                </div>
                            ))}
                            {data.areaStats.every((a) => a.consistency === null) && (
                                <p className="hint">No scheduled habits in this range yet.</p>
                            )}
                        </div>

                        {/* habits leaderboard */}
                        <div className="card">
                            <div className="chart-title"><span>HABIT CONSISTENCY</span></div>
                            {data.habitStats.length === 0 ? (
                                <p className="hint">No habits tracked in this range.</p>
                            ) : (
                                data.habitStats.map((h) => (
                                    <div className="area-row" key={h.id}>
                                        <span className="area-name" style={{ width: 150 }}>{h.name}</span>
                                        <ProgressBar value={h.rate ?? 0} thin />
                                        <span className="area-pct mono-num">{h.rate === null ? "—" : `${h.rate}%`}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* reflections */}
                    {data.reflectionTrend.length > 0 && (
                        <div className="card chart-card section">
                            <div className="chart-title"><span>REFLECTION TRENDS — MOOD / ENERGY / STRESS / CONFIDENCE (1–5)</span></div>
                            <BarChart
                                data={data.reflectionTrend.map((r) => ({ label: formatShort(r.date), value: r.mood ?? 0 }))}
                                suffix="/5"
                            />
                            <div className="grid cols-4" style={{ marginTop: 10 }}>
                                {[
                                    { k: "mood", label: "Mood" },
                                    { k: "energy", label: "Energy" },
                                    { k: "stress", label: "Stress" },
                                    { k: "confidence", label: "Confidence" }
                                ].map(({ k, label }) => {
                                    const vals = data.reflectionTrend.map((r) => r[k]).filter((v) => v);
                                    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—";
                                    return (
                                        <div key={k}>
                                            <p className="hint">{label.toUpperCase()} AVG</p>
                                            <p className="mono-num" style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{avg}{avg !== "—" && "/5"}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* goal progress */}
                    {data.goalProgress.length > 0 && (
                        <div className="card section">
                            <div className="chart-title"><span>ACTIVE GOAL PROGRESS</span></div>
                            {data.goalProgress.map((g) => (
                                <div className="area-row" key={g.id}>
                                    <span className="area-name" style={{ width: 220 }}>{g.title}</span>
                                    <ProgressBar value={g.progress} thin />
                                    <span className="area-pct mono-num">{g.progress}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
