import { useCallback, useEffect, useState } from "react";
import { BookOpen, Trash2, Pencil, CloudRain } from "lucide-react";
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

export default function Journal() {
    const { toast, reloadDashboard } = useStore();
    const [entries, setEntries] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingDate, setEditingDate] = useState(null);
    const [deleteEntry, setDeleteEntry] = useState(null);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const load = useCallback(async function load() {
        const res = await api.get("/data/journal");
        setEntries(res.data.entries);
    }, []);

    useEffect(() => {
        load().catch(() => toast("Failed to load journal"));
    }, [load, toast]);

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

    async function save(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await api.put(`/data/journal/${editingDate}`, form);
            setModalOpen(false);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to save entry");
        } finally {
            setBusy(false);
        }
    }

    async function confirmDelete() {
        setBusy(true);
        try {
            await api.delete(`/data/journal/${deleteEntry.date}`);
            setDeleteEntry(null);
            load();
            reloadDashboard();
        } catch {
            toast("Failed to delete entry");
        } finally {
            setBusy(false);
        }
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
                <button className="btn primary" onClick={() => openNew()}>
                    <BookOpen size={16} /> {todayEntry ? "Edit today's entry" : "Write today's entry"}
                </button>
            </div>

            {todayEntry && (
                <div className="card plain" style={{ marginBottom: 28, padding: "16px 20px", borderLeft: "2px solid #e8e8e8" }}>
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

                                {e.text && <p className="j-text">{e.text}</p>}

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
        </div>
    );
}
