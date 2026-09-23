import { useCallback, useEffect, useState } from "react";
import { BookOpen, Trash2, Pencil, CloudRain, Lock, ShieldCheck } from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { Modal, Field, PageSkeleton, EmptyState, ConfirmDialog, Scale } from "../ui/Primitives";
import { formatLong, formatShort, todayKey } from "../../utils/format";

const PROMPTS = [
    { key: "wentWell", label: "What went well today?" },
    { key: "couldImprove", label: "What could have gone better?" },
    { key: "learned", label: "What did I learn?" },
    { key: "proudOf", label: "What am I proud of?" },
    { key: "tomorrow", label: "What will I do differently tomorrow?" }
];

const EMPTY_FORM = {
    text: "",
    prompts: { wentWell: "", couldImprove: "", learned: "", proudOf: "", tomorrow: "" },
    mood: null,
    energy: null,
    stress: null,
    confidence: null
};

// Journal unlock token: issued by the server after a correct PIN, HMAC-signed
// and time-limited server-side. Session-scoped client-side storage only —
// it is a capability ticket, not a secret.
const UNLOCK_KEY = "ascend_journal_unlock";
function readUnlockToken() {
    try { return sessionStorage.getItem(UNLOCK_KEY) || ""; } catch { return ""; }
}
function storeUnlockToken(t) {
    try { t ? sessionStorage.setItem(UNLOCK_KEY, t) : sessionStorage.removeItem(UNLOCK_KEY); } catch { /* private mode */ }
}

export default function Journal() {
    const { toast, reloadDashboard } = useStore();
    const [entries, setEntries] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingDate, setEditingDate] = useState(null);
    const [deleteEntry, setDeleteEntry] = useState(null);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    // ---- journal PIN security ----
    const [sec, setSec] = useState(null); // { configured, locked, unlocked, lockSecondsRemaining }
    const [unlockToken, setUnlockToken] = useState(readUnlockToken());
    const [pin, setPin] = useState("");
    const [pinConfirm, setPinConfirm] = useState("");
    const [forgotPassword, setForgotPassword] = useState("");
    const [pinBusy, setPinBusy] = useState(false);
    const [pinError, setPinError] = useState("");
    const [pinModal, setPinModal] = useState(null); // null | "setup" | "forgot"

    const unlockCfg = useCallback(
        () => (unlockToken ? { headers: { "x-journal-unlock": unlockToken } } : {}),
        [unlockToken]
    );

    useEffect(() => {
        api.get("/journal-security/status")
            .then((r) => setSec(r.data))
            .catch(() => setSec(null));
    }, []);

    const load = useCallback(async function load() {
        const res = await api.get("/data/journal", unlockCfg());
        setEntries(res.data.entries);
    }, [unlockCfg]);

    useEffect(() => {
        if (sec && sec.configured && !sec.unlocked) return; // locked: don't fetch
        load()
            .catch((e) => {
                if (e?.response?.status === 423) {
                    setSec((s) => ({ ...(s || {}), configured: true, unlocked: false }));
                    storeUnlockToken("");
                    setUnlockToken("");
                } else {
                    toast("Failed to load journal");
                }
            });
    }, [load, toast, sec]);

    function openNew(date = todayKey()) {
        setEditingDate(date);
        setForm(EMPTY_FORM);
        setModalOpen(true);
    }

    function openEdit(entry) {
        setEditingDate(entry.date);
        setForm({
            text: entry.text || "",
            prompts: {
                wentWell: entry.prompts?.wentWell || "",
                couldImprove: entry.prompts?.couldImprove || "",
                learned: entry.prompts?.learned || "",
                proudOf: entry.prompts?.proudOf || "",
                tomorrow: entry.prompts?.tomorrow || ""
            },
            mood: entry.mood,
            energy: entry.energy,
            stress: entry.stress,
            confidence: entry.confidence
        });
        setModalOpen(true);
    }

    async function confirmDelete() {
        setBusy(true);
        try {
            await api.delete(`/data/journal/${deleteEntry.date}`, unlockCfg());
            setDeleteEntry(null);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to delete entry");
        } finally {
            setBusy(false);
        }
    }

    async function save(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await api.put(`/data/journal/${editingDate}`, form, unlockCfg());
            setModalOpen(false);
            load();
            reloadDashboard();
        } catch (err) {
            if (err?.response?.status === 423) {
                setModalOpen(false);
                storeUnlockToken("");
                setUnlockToken("");
                setSec((s) => ({ ...(s || {}), configured: true, unlocked: false }));
                toast("Journal locked — unlock to save.");
            } else {
                toast("Failed to save entry");
            }
        } finally {
            setBusy(false);
        }
    }

    // ---- PIN actions ----
    async function submitUnlock(e) {
        e?.preventDefault();
        setPinBusy(true);
        setPinError("");
        try {
            const r = await api.post("/journal-security/verify", { pin });
            storeUnlockToken(r.data.unlockedToken);
            setUnlockToken(r.data.unlockedToken);
            setPin("");
            setSec((s) => ({ ...(s || {}), configured: true, locked: false, unlocked: true }));
        } catch (err) {
            setPinError(err.response?.data?.message || "Incorrect PIN.");
            setPin("");
        } finally {
            setPinBusy(false);
        }
    }

    async function submitSetup(e) {
        e.preventDefault();
        setPinBusy(true);
        setPinError("");
        try {
            const r = await api.post("/journal-security/pin", { pin, confirmPin: pinConfirm });
            storeUnlockToken(r.data.unlockedToken);
            setUnlockToken(r.data.unlockedToken);
            setPin(""); setPinConfirm("");
            setPinModal(null);
            setSec((s) => ({ ...(s || {}), configured: true, locked: false, unlocked: true }));
            toast("Journal PIN enabled");
        } catch (err) {
            setPinError(err.response?.data?.message || "Could not set the PIN.");
        } finally {
            setPinBusy(false);
        }
    }

    async function submitForgot(e) {
        e.preventDefault();
        setPinBusy(true);
        setPinError("");
        try {
            await api.post("/journal-security/forgot", { password: forgotPassword });
            storeUnlockToken("");
            setUnlockToken("");
            setForgotPassword("");
            setPinModal(null);
            setSec((s) => ({ ...(s || {}), configured: false, locked: false, unlocked: true }));
            setEntries(null);
            toast("PIN removed — set a new one any time");
        } catch (err) {
            setPinError(err.response?.data?.message || "Could not reset the PIN.");
        } finally {
            setPinBusy(false);
        }
    }

    async function removePin() {
        setPinBusy(true);
        setPinError("");
        try {
            await api.delete("/journal-security/pin", { data: { pin }, headers: unlockCfg().headers });
            storeUnlockToken("");
            setUnlockToken("");
            setPin(""); setPinConfirm("");
            setPinModal(null);
            setSec((s) => ({ ...(s || {}), configured: false, unlocked: true }));
            toast("Journal PIN removed");
        } catch (err) {
            setPinError(err.response?.data?.message || "Could not remove the PIN.");
        } finally {
            setPinBusy(false);
        }
 }

    const journalLocked = !!sec?.configured && !sec?.unlocked;

    // ---------------- LOCK SCREEN (no journal content rendered) ----------------
    if (sec && journalLocked) {
        const lockMsg = sec.locked
            ? `Too many incorrect attempts. Try again in ${Math.max(1, Math.ceil((sec.lockSecondsRemaining || 60) / 60))} min.`
            : "Enter your 4-digit PIN to open your journal.";
        return (
            <div className="page-fade">
                <div className="page-head">
                    <div>
                        <h1>Journal</h1>
                        <p className="sub">Reflection turns experience into progress.</p>
                    </div>
                </div>
                <div className="card journal-lock" style={{ maxWidth: 380, margin: "40px auto", textAlign: "center" }}>
                    <div className="journal-lock-icon" aria-hidden="true"><Lock size={26} /></div>
                    <h2 style={{ margin: "12px 0 2px", fontSize: 18 }}>Journal locked</h2>
                    <p className="hint" style={{ margin: "0 0 16px" }}>{lockMsg}</p>
                    {!sec.locked && (
                        <form onSubmit={submitUnlock}>
                            <input
                                className="input journal-pin-input"
                                type="password"
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={4}
                                value={pin}
                                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                aria-label="Journal PIN"
                                autoFocus
                            />
                            {pinError && <p className="form-error" role="alert" style={{ marginTop: 8 }}>{pinError}</p>}
                            <button className="btn primary" type="submit" disabled={pinBusy || pin.length !== 4} style={{ marginTop: 12, width: "100%" }}>
                                {pinBusy ? "Checking…" : "Unlock"}
                            </button>
                        </form>
                    )}
                    <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => { setPinModal("forgot"); setPinError(""); }}>
                        Forgot PIN?
                    </button>
                </div>

                <Modal
                    open={pinModal === "forgot"}
                    onClose={() => { setPinModal(null); setPinError(""); }}
                    title="Reset journal PIN"
                    subtitle="Confirm your account password to remove the PIN."
                    actions={
                        <>
                            <button className="btn ghost" onClick={() => { setPinModal(null); setPinError(""); }} disabled={pinBusy}>Cancel</button>
                            <button className="btn primary" onClick={submitForgot} disabled={pinBusy || !forgotPassword}>{pinBusy ? "Checking…" : "Remove PIN"}</button>
                        </>
                    }
                >
                    <Field label="Account password">
                        <input
                            className="input"
                            type="password"
                            value={forgotPassword}
                            onChange={(e) => setForgotPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </Field>
                    {pinError && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{pinError}</p>}
                </Modal>
            </div>
        );
    }

    if (!entries) return <PageSkeleton />;

    const todayEntry = entries.find((e) => e.date === todayKey());

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Journal</h1>
                    <p className="sub">Reflection turns experience into progress.</p>
                </div>
                <div className="row" style={{ gap: 8 }}>
                    <button
                        className="btn ghost"
                        onClick={() => { setPinModal("setup"); setPinError(""); }}
                        title={sec?.configured ? "Journal PIN is enabled" : "Add a PIN lock"}
                    >
                        {sec?.configured ? <ShieldCheck size={16} /> : <Lock size={16} />}
                        {sec?.configured ? "PIN on" : "Add PIN"}
                    </button>
                    <button className="btn primary" onClick={() => openNew()}>
                        <BookOpen size={16} /> {todayEntry ? "Edit today's entry" : "Write today's entry"}
                    </button>
                </div>
            </div>

            {todayEntry && (
                <div className="card plain" style={{ marginBottom: 28, padding: "16px 20px", borderLeft: "2px solid var(--line)" }}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>TODAY'S REFLECTION IS LOGGED</p>
                    <p className="hint" style={{ marginTop: 4 }}>
                        Mood {todayEntry.mood ?? "—"}/5 · Energy {todayEntry.energy ?? "—"}/5
                    </p>
                </div>
            )}

            {entries.length === 0 ? (
                <EmptyState
                    icon={<CloudRain size={34} />}
                    title="No entries yet"
                    message="Two minutes each evening is enough. What went well? What will you do differently tomorrow?"
                    action={<button className="btn primary" onClick={() => openNew()}>Write your first entry</button>}
                />
            ) : (
                <div className="grid" style={{ gap: 12 }}>
                    {entries.map((e) => {
                        const hasPrompts = e.prompts && Object.values(e.prompts).some((v) => v && v.trim());
                        return (
                            <div className="card journal-card" key={e._id}>
                                <div className="j-date">
                                    <span>{formatLong(e.date)}</span>
                                    <span className="row" style={{ gap: 2 }}>
                                        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => openEdit(e)} aria-label="Edit entry"><Pencil size={13} /></button>
                                        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setDeleteEntry(e)} aria-label="Delete entry"><Trash2 size={13} /></button>
                                    </span>
                                </div>

                                {e.text && <p className="j-text journal-note">{e.text}</p>}

                                {hasPrompts && (
                                    <div>
                                        {PROMPTS.map(({ key, label }) =>
                                            e.prompts[key] ? (
                                                <div className="j-prompt" key={key}>
                                                    <p className="p-label">{label}</p>
                                                    <p>{e.prompts[key]}</p>
                                                </div>
                                            ) : null
                                        )}
                                    </div>
                                )}

                                {(e.mood || e.energy || e.stress || e.confidence) && (
                                    <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
                                        {e.mood && <span className="badge">Mood {e.mood}/5</span>}
                                        {e.energy && <span className="badge">Energy {e.energy}/5</span>}
                                        {e.stress && <span className="badge">Stress {e.stress}/5</span>}
                                        {e.confidence && <span className="badge">Confidence {e.confidence}/5</span>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* editor modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editingDate === todayKey() ? "Today's reflection" : `Reflection — ${formatShort(editingDate)}`}
                subtitle="Keep it honest. Keep it short."
                large
                actions={
                    <>
                        <button className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
                        <button className="btn primary" onClick={save} disabled={busy || (!form.text.trim() && !Object.values(form.prompts).some((v) => v.trim()))}>
                            Save entry
                        </button>
                    </>
                }
            >
                <div className="journal-editor grid" style={{ gap: 18 }}>
                    <Field label="Free writing">
                        <textarea className="textarea" value={form.text} onChange={(ev) => setForm({ ...form, text: ev.target.value })} placeholder="How was your day, really?" style={{ minHeight: 90 }} />
                    </Field>

                    {PROMPTS.map(({ key, label }) => (
                        <Field key={key} label={label}>
                            <textarea className="textarea" style={{ minHeight: 54 }} value={form.prompts[key]} onChange={(ev) => setForm({ ...form, prompts: { ...form.prompts, [key]: ev.target.value } })} />
                        </Field>
                    ))}

                    <div className="field-row">
                        <Scale label="Mood" value={form.mood} onChange={(v) => setForm({ ...form, mood: v })} />
                        <Scale label="Energy" value={form.energy} onChange={(v) => setForm({ ...form, energy: v })} />
                    </div>
                    <div className="field-row">
                        <Scale label="Stress" value={form.stress} onChange={(v) => setForm({ ...form, stress: v })} />
                        <Scale label="Confidence" value={form.confidence} onChange={(v) => setForm({ ...form, confidence: v })} />
                    </div>
                </div>
            </Modal>

            <ConfirmDialog
                open={!!deleteEntry}
                onClose={() => setDeleteEntry(null)}
                onConfirm={confirmDelete}
                title="Delete entry?"
                message={`The reflection from ${formatLong(deleteEntry?.date)} will be permanently removed.`}
                confirmLabel="Delete"
                danger
                busy={busy}
            />

            {/* PIN setup / manage modal */}
            <Modal
                open={pinModal === "setup"}
                onClose={() => { setPinModal(null); setPinError(""); }}
                title={sec?.configured ? "Journal PIN" : "Add journal PIN"}
                subtitle={sec?.configured ? "Change or remove your journal PIN." : "A 4-digit PIN locks your journal on this account."}
                actions={
                    sec?.configured ? (
                        <>
                            <button className="btn ghost" onClick={() => { setPinModal(null); setPinError(""); }} disabled={pinBusy}>Close</button>
                            <button className="btn danger" onClick={removePin} disabled={pinBusy || pin.length !== 4}>{pinBusy ? "Working…" : "Remove PIN"}</button>
                            <button className="btn primary" onClick={submitSetup} disabled={pinBusy || pin.length !== 4}>{pinBusy ? "Saving…" : "Change PIN"}</button>
                        </>
                    ) : (
                        <>
                            <button className="btn ghost" onClick={() => { setPinModal(null); setPinError(""); }} disabled={pinBusy}>Cancel</button>
                            <button className="btn primary" onClick={submitSetup} disabled={pinBusy || pin.length !== 4}>{pinBusy ? "Saving…" : "Enable PIN"}</button>
                        </>
                    )
                }
            >
                <div className="grid" style={{ gap: 14 }}>
                    <Field label="4-digit PIN" hint={sec?.configured ? "Enter a new PIN." : "Only digits. You'll enter this to open your journal."}>
                        <input
                            className="input journal-pin-input"
                            type="password"
                            inputMode="numeric"
                            autoComplete="new-password"
                            maxLength={4}
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            aria-label="New journal PIN"
                        />
                    </Field>
                    {!sec?.configured && (
                        <Field label="Confirm PIN">
                            <input
                                className="input journal-pin-input"
                                type="password"
                                inputMode="numeric"
                                autoComplete="new-password"
                                maxLength={4}
                                value={pinConfirm}
                                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                aria-label="Confirm journal PIN"
                            />
                        </Field>
                    )}
                    <p className="hint">
                        A PIN keeps your journal private on shared devices. It is not account security —
                        you can always recover access with your account password.
                    </p>
                    {pinError && <p className="form-error" role="alert">{pinError}</p>}
                </div>
            </Modal>
        </div>
    );
}
