import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { ConfirmDialog, Toggle, PageSkeleton } from "../ui/Primitives";

const notifSupported = typeof window !== "undefined" && "Notification" in window;

export default function SettingsPage() {
    const { user, setUser, dash, settings: storeSettings, applySettings, toast } = useStore();
    const navigate = useNavigate();
    const [settings, setSettings] = useState(storeSettings);
    const [confirm, setConfirm] = useState(null); // "reset" | "delete"
    const [busy, setBusy] = useState(false);

    // keep local form in sync when the store loads/changes settings
    useEffect(() => {
        if (storeSettings) setSettings(storeSettings);
    }, [storeSettings]);

    async function update(section, patch) {
        const next = { ...settings, [section]: { ...settings[section], ...patch } };
        setSettings(next);
        applySettings(next); // optimistic for body classes
        try {
            const res = await api.patch("/settings", { [section]: patch });
            setSettings(res.data.settings);
            applySettings(res.data.settings);
        } catch {
            toast("Failed to save setting");
        }
    }

    async function doReset() {
        setBusy(true);
        try {
            await api.post("/reset", { confirm: "RESET" });
            toast("Progress cleared");
            setConfirm(null);
            window.location.reload();
        } catch {
            toast("Reset failed");
            setBusy(false);
        }
    }

    async function doDelete() {
        setBusy(true);
        try {
            await api.post("/delete-account", { confirm: "DELETE" });
            setUser(null);
            navigate("/dashboard");
            window.location.reload();
        } catch {
            toast("Account deletion failed");
            setBusy(false);
        }
    }

    async function exportData() {
        try {
            const res = await api.get("/export", { responseType: "blob" });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ascend-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast("Data exported");
        } catch {
            toast("Export failed");
        }
    }

    if (!settings) return <PageSkeleton />;

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Settings</h1>
                    <p className="sub">Make ASCEND yours.</p>
                </div>
            </div>

            {/* profile */}
            <div className="card settings-group">
                <div className="chart-title" style={{ marginBottom: 4 }}><span>PROFILE</span></div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>{user.name}</h4>
                        <p>{user.email}</p>
                    </div>
                    <button className="btn ghost small" onClick={() => navigate("/profile")}>Edit profile</button>
                </div>
                {dash?.level && (
                    <div className="settings-row">
                        <div className="sr-info">
                            <h4>Current level</h4>
                            <p>Level {dash.level.level} — {dash.level.name} · {dash.level.xp} XP</p>
                        </div>
                    </div>
                )}
            </div>

            {/* notifications */}
            <div className="card settings-group">
                <div className="chart-title" style={{ marginBottom: 4 }}><span>NOTIFICATIONS & REMINDERS</span></div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Daily reminder</h4>
                        <p>
                            A gentle nudge each day at your chosen time.
                            {settings.notifications.dailyReminder && !notifSupported ? " Browser notifications are blocked or unavailable — reminders appear in-app while ASCEND is open." : ""}
                        </p>
                    </div>
                    <div className="row" style={{ gap: 12 }}>
                        {settings.notifications.dailyReminder && (
                            <input
                                className="input"
                                type="time"
                                style={{ width: 110 }}
                                value={settings.notifications.dailyReminderTime}
                                onChange={(e) => update("notifications", { dailyReminderTime: e.target.value })}
                            />
                        )}
                        <Toggle
                            label="Daily reminder"
                            checked={settings.notifications.dailyReminder}
                            onChange={(v) => update("notifications", { dailyReminder: v })}
                        />
                    </div>
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Evening reflection prompt</h4>
                        <p>Remind me to reflect at the end of the day (in-app, while ASCEND is open).</p>
                    </div>
                    <Toggle label="Evening reflection" checked={settings.notifications.eveningReflection} onChange={(v) => update("notifications", { eveningReflection: v })} />
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Weekly review</h4>
                        <p>Nudge me when a new week starts (in-app, while ASCEND is open).</p>
                    </div>
                    <Toggle label="Weekly review" checked={settings.notifications.weeklyReview} onChange={(v) => update("notifications", { weeklyReview: v })} />
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Achievement alerts</h4>
                        <p>Celebrate milestones as they happen.</p>
                    </div>
                    <Toggle label="Achievement alerts" checked={settings.notifications.achievements} onChange={(v) => update("notifications", { achievements: v })} />
                </div>
            </div>

            {/* appearance + accessibility */}
            <div className="card settings-group">
                <div className="chart-title" style={{ marginBottom: 4 }}><span>APPEARANCE & ACCESSIBILITY</span></div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Reduce motion</h4>
                        <p>Minimize animations throughout the app.</p>
                    </div>
                    <Toggle label="Reduce motion" checked={settings.appearance.reduceMotion} onChange={(v) => update("appearance", { reduceMotion: v })} />
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>High contrast</h4>
                        <p>Stronger borders and brighter secondary text.</p>
                    </div>
                    <Toggle label="High contrast" checked={settings.appearance.highContrast} onChange={(v) => update("appearance", { highContrast: v })} />
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Larger text</h4>
                        <p>Increase the base font size.</p>
                    </div>
                    <Toggle label="Larger text" checked={settings.appearance.largerText} onChange={(v) => update("appearance", { largerText: v })} />
                </div>
            </div>

            {/* privacy */}
            <div className="card settings-group">
                <div className="chart-title" style={{ marginBottom: 4 }}><span>PRIVACY</span></div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Show streaks</h4>
                        <p>Display streak counters on your dashboard and habits.</p>
                    </div>
                    <Toggle label="Show streaks" checked={settings.privacy.showStreaks} onChange={(v) => update("privacy", { showStreaks: v })} />
                </div>
            </div>

            {/* data */}
            <div className="card settings-group">
                <div className="chart-title" style={{ marginBottom: 4 }}><span>DATA</span></div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Export data</h4>
                        <p>Download everything as JSON — habits, goals, tasks, journal, history.</p>
                    </div>
                    <button className="btn ghost small" onClick={exportData}>Export</button>
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Reset progress</h4>
                        <p>Delete all habits, goals, tasks and history. Keep your account.</p>
                    </div>
                    <button className="btn danger small" onClick={() => setConfirm("reset")}>Reset</button>
                </div>
                <div className="settings-row">
                    <div className="sr-info">
                        <h4>Delete account</h4>
                        <p>Permanently remove your account and all data. This cannot be undone.</p>
                    </div>
                    <button className="btn danger small" onClick={() => setConfirm("delete")}>Delete</button>
                </div>
            </div>

            {/* about */}
            <div className="card settings-group">
                <div className="chart-title" style={{ marginBottom: 4 }}><span>ABOUT ASCEND</span></div>
                <p style={{ color: "var(--text-2)", fontSize: 13.5, maxWidth: 560 }}>
                    ASCEND is a personal command center for self-improvement.
                    Plan, act, track, reflect, improve — and become better. Every day.
                </p>
                <p className="hint" style={{ marginTop: 10 }}>Version 1.0 · Built with intent.</p>
            </div>

            <ConfirmDialog
                open={confirm === "reset"}
                onClose={() => setConfirm(null)}
                onConfirm={doReset}
                title="Reset all progress?"
                message="Every habit, goal, task, journal entry and achievement will be permanently deleted. Your account stays. This cannot be undone."
                confirmLabel="Delete everything"
                danger
                busy={busy}
            />
            <ConfirmDialog
                open={confirm === "delete"}
                onClose={() => setConfirm(null)}
                onConfirm={doDelete}
                title="Delete your account?"
                message="Your account and all associated data will be permanently removed. This cannot be undone."
                confirmLabel="Delete account forever"
                danger
                busy={busy}
            />
        </div>
    );
}
