import { useEffect, useState } from "react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, PageSkeleton, ProgressBar } from "../ui/Primitives";

export default function Profile() {
    const { user, setUser, dash, toast } = useStore();
    const [editOpen, setEditOpen] = useState(false);
    const [achievements, setAchievements] = useState(null);
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.get("/achievements").then((r) => setAchievements(r.data)).catch(() => {});
    }, []);

    useEffect(() => {
        if (user) {
            setForm({
                name: user.name || "",
                avatarInitials: user.avatarInitials || "",
                motto: user.motto || "",
                futureVision: user.futureVision || "",
                bio: user.bio || ""
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?._id, user?.name, user?.motto, user?.avatarInitials, user?.futureVision]);

    async function save(e) {
        e.preventDefault();
        setBusy(true);
        try {
            const res = await api.patch("/auth/profile", form);
            setUser(res.data.user);
            setEditOpen(false);
            toast("Profile updated");
        } catch {
            toast("Failed to update profile");
        } finally {
            setBusy(false);
        }
    }

    if (!user) return <PageSkeleton />;

    const initials = (user.avatarInitials || user.name || "?")
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    const strongest = dash?.areas
        ?.filter((a) => a.goalProgress !== null)
        .sort((a, b) => b.goalProgress - a.goalProgress)[0];

    return (
        <div className="page-fade">
            <div className="profile-hero">
                <div className="avatar">{initials}</div>
                <div style={{ flex: 1 }}>
                    <h1 style={{ fontSize: 28 }}>{user.name}</h1>
                    <p className="hint">
                        Ascending since {new Date(user.createdAt || user.ascendDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                        {user.motto ? ` — “${user.motto}”` : ""}
                    </p>
                    {user.futureVision && (
                        <p style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 8, maxWidth: 520 }}>{user.futureVision}</p>
                    )}
                </div>
                <button className="btn ghost" onClick={() => setEditOpen(true)}>Edit profile</button>
            </div>

            {dash && (
                <>
                    <div className="grid cols-4 section">
                        <div className="card stat-card">
                            <span className="stat-label">Level</span>
                            <span className="stat-value mono-num">{dash.level.level}</span>
                            <span className="stat-sub">“{dash.level.name}”</span>
                            <ProgressBar value={dash.level.progressToNext} thin />
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Today's score</span>
                            <span className="stat-value mono-num">{dash.snapshot?.score ?? 0}%</span>
                            <span className="stat-sub">XP {dash.level.xp}</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Streak</span>
                            <span className="stat-value mono-num">{dash.streak}</span>
                            <span className="stat-sub">best {dash.bestStreak} days</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Strongest area</span>
                            <span className="stat-value" style={{ fontSize: 20 }}>{strongest?.name ?? "—"}</span>
                            <span className="stat-sub">{strongest ? `${strongest.goalProgress}% goal progress` : "Set a goal to find out"}</span>
                        </div>
                    </div>

                    <div className="grid cols-3 section">
                        <div className="card stat-card">
                            <span className="stat-label">Achievements</span>
                            <span className="stat-value mono-num">{achievements ? `${achievements.earnedCount}/${achievements.totalCount}` : "—"}</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Total actions</span>
                            <span className="stat-value mono-num">{dash.snapshot ? dash.snapshot.habitsDone + dash.snapshot.tasksDone : 0}</span>
                            <span className="stat-sub">today</span>
                        </div>
                        <div className="card stat-card">
                            <span className="stat-label">Personal bio</span>
                            <span className="stat-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{user.bio || "—"}</span>
                        </div>
                    </div>
                </>
            )}

            {dash?.goals?.length > 0 && (
                <div className="section">
                    <div className="section-title">
                        <h2>My goals</h2>
                        <span className="hint">{dash.goals.length} active</span>
                    </div>
                    <div className="grid" style={{ gap: 10 }}>
                        {dash.goals.map((g) => (
                            <div className="card plain profile-goal-row" key={g._id}>
                                <div className="row between" style={{ gap: 10, marginBottom: 6 }}>
                                    <span className="profile-goal-title">{g.title}</span>
                                    <span className="mono-num" style={{ fontWeight: 800, flexShrink: 0 }}>
                                        {g.progress ?? 0}%
                                    </span>
                                </div>
                                <ProgressBar value={g.progress ?? 0} thin />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <Modal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                title="Edit profile"
                actions={
                    <>
                        <button className="btn ghost" onClick={() => setEditOpen(false)}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={busy || !form.name?.trim()}>Save</button>
                    </>
                }
            >
                <div className="grid" style={{ gap: 16 }}>
                    <Field label="Name">
                        <input className="input" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label="Avatar initials" hint="Up to 2 characters shown on your profile">
                        <input className="input" value={form.avatarInitials || ""} maxLength={2} onChange={(e) => setForm({ ...form, avatarInitials: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="Personal motto">
                        <input className="input" value={form.motto || ""} onChange={(e) => setForm({ ...form, motto: e.target.value })} placeholder="Become better. Every day." />
                    </Field>
                    <Field label="Your future self">
                        <textarea className="textarea" value={form.futureVision || ""} onChange={(e) => setForm({ ...form, futureVision: e.target.value })} />
                    </Field>
                </div>
            </Modal>
        </div>
    );
}
