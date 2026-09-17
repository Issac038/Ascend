import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, PageSkeleton, EmptyState, ProgressBar } from "../ui/Primitives";

export default function Areas() {
    const { toast } = useStore();
    const [areas, setAreas] = useState(null);
    const [analytics, setAnalytics] = useState(null);
    const [goals, setGoals] = useState([]);
    const [habits, setHabits] = useState([]);
    const [addOpen, setAddOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async function load() {
        const [a, an, g, h] = await Promise.all([
            api.get("/data/areas"),
            api.get("/analytics?range=90"),
            api.get("/data/goals"),
            api.get("/data/habits")
        ]);
        setAreas(a.data.areas.filter((x) => !x.archived));
        setAnalytics(an.data);
        setGoals(g.data.goals);
        setHabits(h.data.habits);
    }, []);

    useEffect(() => {
        load().catch(() => toast("Failed to load areas"));
    }, [load, toast]);

    async function addArea(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await api.post("/data/areas", { name: newName });
            setAddOpen(false);
            setNewName("");
            load();
        } catch {
            toast("Failed to create area");
        } finally {
            setBusy(false);
        }
    }

    async function removeArea(area) {
        try {
            await api.delete(`/data/areas/${area._id}`);
            load();
        } catch {
            toast("Failed to remove area");
        }
    }

    if (!areas || !analytics) return <PageSkeleton />;

    const areaStats = {};
    for (const s of analytics.areaStats) areaStats[s.key] = s.consistency;

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Areas</h1>
                    <p className="sub">A life well-built, one area at a time.</p>
                </div>
                <button className="btn ghost" onClick={() => setAddOpen(true)}><Plus size={16} /> Custom area</button>
            </div>

            {areas.length === 0 ? (
                <EmptyState title="No areas" message="Areas organize your goals and habits." />
            ) : (
                <div className="grid cols-2">
                    {areas.map((a) => {
                        const consistency = areaStats[a.key];
                        const areaGoals = goals.filter((g) => g.area === a.key && g.status === "active");
                        const areaHabits = habits.filter((h) => h.area === a.key && !h.archived);
                        const focus = a.focus;

                        return (
                            <div className="card" key={a._id}>
                                <div className="row between" style={{ marginBottom: 14 }}>
                                    <div className="row">
                                        <h3 style={{ fontSize: 16 }}>{a.name}</h3>
                                        {focus && <span className="badge solid">Focus</span>}
                                    </div>
                                    {!["body", "mind", "discipline", "learning", "productivity", "relationships", "finances", "skills", "personal"].includes(a.key) && (
                                        <button className="icon-btn" title="Remove area" onClick={() => removeArea(a)}><Trash2 size={15} /></button>
                                    )}
                                </div>

                                <div className="grid cols-2" style={{ gap: 14, marginBottom: 16 }}>
                                    <div>
                                        <p className="hint" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em" }}>CONSISTENCY (90D)</p>
                                        <p className="mono-num" style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>
                                            {consistency === null || consistency === undefined ? "—" : `${consistency}%`}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="hint" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em" }}>ACTIVE GOALS</p>
                                        <p className="mono-num" style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{areaGoals.length}</p>
                                    </div>
                                </div>

                                <ProgressBar value={consistency ?? 0} thin />

                                {areaGoals.length > 0 && (
                                    <div style={{ marginTop: 16 }}>
                                        <p className="hint" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", marginBottom: 8 }}>GOALS</p>
                                        {areaGoals.map((g) => (
                                            <div className="area-row" key={g._id} style={{ padding: "7px 0" }}>
                                                <span className="area-name" style={{ width: "auto", flex: 1, fontSize: 12.5 }}>{g.title}</span>
                                                <span className="area-pct mono-num" style={{ width: 36 }}>{g.progress ?? 0}%</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {areaHabits.length > 0 && (
                                    <div style={{ marginTop: 12 }}>
                                        <p className="hint" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", marginBottom: 8 }}>HABITS</p>
                                        <div className="row wrap" style={{ gap: 6 }}>
                                            {areaHabits.map((h) => <span className="badge" key={h._id}>{h.name}</span>)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Modal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                title="New area"
                actions={
                    <>
                        <button className="btn ghost" onClick={() => setAddOpen(false)}>Cancel</button>
                        <button className="btn primary" onClick={addArea} disabled={busy || !newName.trim()}>Create area</button>
                    </>
                }
            >
                <Field label="Area name">
                    <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Music, Public speaking…" autoFocus />
                </Field>
            </Modal>
        </div>
    );
}
