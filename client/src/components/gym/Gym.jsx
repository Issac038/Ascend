import { useCallback, useEffect, useRef, useState } from "react";
import {
    Dumbbell, ChevronLeft, ChevronRight, Check, Moon, CalendarDays,
    Info, HeartPulse, FlaskConical
} from "lucide-react";
import api from "../../services/api";
import { useStore } from "../../store/AppStore";
import { PageSkeleton, EmptyState, ProgressBar } from "../ui/Primitives";
import { formatLong, formatShort, todayKey } from "../../utils/format";
import {
    addDaysKey, sanitize, prevSetLabel, prevCardioLabel, topOfRangeHint
} from "../../utils/gymLog";

const fieldKey = (exId, setNo) => `${exId}#${setNo}`;

export default function Gym() {
    const { toast } = useStore();

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [planMeta, setPlanMeta] = useState(null);   // immutable plan + progression rules
    const [dayData, setDayData] = useState(null);     // current day payload from the server
    const [week, setWeek] = useState(null);           // 7-day strip
    const [history, setHistory] = useState([]);
    const [viewDate, setViewDate] = useState(() => todayKey());

    // Local drafts keep typing stable (no remount, no focus loss) until blur commits.
    const [drafts, setDrafts] = useState({});
    const [fieldError, setFieldError] = useState("");   // inline validation message
    const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

    const activeDate = useRef(todayKey());              // date the on-screen payload belongs to
    const inFlight = useRef(new Map());                 // key -> running save (one at a time per key)
    const queued = useRef(new Map());                   // key -> latest waiting save
    const refreshTimer = useRef(null);
    const savedTimer = useRef(null);

    const today = todayKey();

    // Run at most one request per key; a tap that arrives mid-flight replaces
    // the queued one (latest wins) — rapid double-taps can never double-write.
    async function runKeyed(key, fn) {
        if (inFlight.current.has(key)) {
            queued.current.set(key, fn);
            return;
        }
        inFlight.current.set(key, fn);
        try {
            await fn();
        } finally {
            inFlight.current.delete(key);
            const next = queued.current.get(key);
            queued.current.delete(key);
            if (next) runKeyed(key, next);
        }
    }

    // ---------- loading ----------
    const loadDay = useCallback(async (date, { silent = false } = {}) => {
        activeDate.current = date;
        if (!silent) { setLoading(true); setLoadError(""); }
        try {
            const [d, w] = await Promise.all([
                api.get(`/gym/sessions/${date}`),
                api.get("/gym/week", { params: { start: date, today } })
            ]);
            if (activeDate.current !== date) return; // user navigated away mid-load
            setDayData(d.data);
            setWeek(w.data.days);
            setViewDate(date);
            setDrafts({});       // drafts always belong to the day being viewed
            setFieldError("");
            setLoadError("");
        } catch (e) {
            if (!silent) setLoadError(e.response?.data?.message || "Cannot reach ASCEND. Is the server running?");
        } finally {
            if (!silent) setLoading(false);
        }
    }, [today]);

    useEffect(() => {
        api.get("/gym/plan").then((r) => setPlanMeta(r.data.plan)).catch(() => {});
        api.get("/gym/history?limit=30").then((r) => setHistory(r.data.sessions)).catch(() => {});
        loadDay(today);
        return () => {
            clearTimeout(refreshTimer.current);
            clearTimeout(savedTimer.current);
        };
    }, [loadDay, today]);

    // Week + history refresh, debounced so fast set-taps don't hammer the API.
    const scheduleRefresh = useCallback((date) => {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
            api.get("/gym/week", { params: { start: date, today } })
                .then((r) => {
                    if (activeDate.current === date) setWeek(r.data.days);
                }).catch(() => {});
            api.get("/gym/history?limit=30")
                .then((r) => setHistory(r.data.sessions)).catch(() => {});
        }, 700);
    }, [today]);

    const flashSaved = useCallback(() => {
        setSaveState("saved");
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2500);
    }, []);

    const draftOf = (key, serverValue) =>
        (drafts[key] !== undefined ? drafts[key] : serverValue == null ? "" : String(serverValue));

    const setDraft = (key, value) => setDrafts((prev) => ({ ...prev, [key]: value }));

    // ---------- writes ----------
    function saveSet(ex, entry, { completed }) {
        const date = viewDate;
        const key = fieldKey(ex.id, entry.setNo);

        // Build + validate now so bad input gives immediate feedback.
        const payload = { exId: ex.id, setNo: entry.setNo, completed };
        const fields = [];
        if (ex.metric === "duration") fields.push(["durationSec", "duration"]);
        else {
            if (!ex.bodyweight) fields.push(["weightKg", "weight"]);
            fields.push(["reps", "reps"]);
        }
        for (const [field, kind] of fields) {
            const r = sanitize(draftOf(key + field, entry[field]), kind);
            if (r.error) {
                setFieldError(`${ex.name} · set ${entry.setNo}: ${r.error}`);
                toast(r.error);
                return;
            }
            payload[field] = r.value;
        }
        setFieldError("");

        // Nothing changed (e.g. blur after a click already saved) -> skip the round-trip.
        const unchanged =
            completed === entry.completed &&
            fields.every(([field]) => (payload[field] ?? null) === (entry[field] ?? null));
        if (unchanged) return;

        runKeyed(key, async () => {
            setSaveState("saving");
            try {
                const res = await api.post(`/gym/sessions/${date}/set`, payload);
                if (activeDate.current !== date) return; // day switched while saving
                const savedSet = res.data.set;
                setDayData((prev) => {
                    if (!prev || !prev.day) return prev;
                    return {
                        ...prev,
                        progress: res.data.progress,
                        session: res.data.session,
                        day: {
                            ...prev.day,
                            exercises: prev.day.exercises.map((e) =>
                                e.id !== ex.id
                                    ? e
                                    : {
                                        ...e,
                                        entries: e.entries.map((s) =>
                                            s.setNo === savedSet.setNo
                                                ? {
                                                    setNo: savedSet.setNo,
                                                    weightKg: savedSet.weightKg,
                                                    reps: savedSet.reps,
                                                    durationSec: savedSet.durationSec,
                                                    completed: savedSet.completed
                                                }
                                                : s
                                        )
                                    }
                            )
                        }
                    };
                });
                // Sync drafts to the saved values so stale text can't resurface later.
                setDrafts((prev) => {
                    const next = { ...prev };
                    for (const [field] of fields) {
                        next[key + field] = savedSet[field] == null ? "" : String(savedSet[field]);
                    }
                    return next;
                });
                flashSaved();
                scheduleRefresh(date);
            } catch (e) {
                setSaveState("error");
                toast(e.response?.data?.message || "Couldn't save that set. Your entry is still here — tap the field away again to retry.");
            }
        });
    }

    function saveChoice(slotId, choiceId) {
        const date = viewDate;
        runKeyed(`choice:${slotId}`, async () => {
            setSaveState("saving");
            try {
                const res = await api.post(`/gym/sessions/${date}/choice`, { slotId, choiceId });
                if (activeDate.current !== date) return;
                setDayData((prev) => ({ ...prev, ...res.data }));
                setDrafts({});
                flashSaved();
                scheduleRefresh(date);
            } catch (e) {
                setSaveState("error");
                toast(e.response?.data?.message || "Couldn't save that choice.");
            }
        });
    }

    function saveCardio(field, rawValue, kind) {
        const date = viewDate;
        let body;
        if (field === "notes") {
            body = { notes: String(rawValue ?? "").slice(0, 500) };
        } else {
            const r = sanitize(rawValue, kind);
            if (r.error) { setFieldError(r.error); toast(r.error); return; }
            setFieldError("");
            body = { [field]: r.value };
        }
        runKeyed(`cardio:${field}`, async () => {
            setSaveState("saving");
            try {
                const res = await api.post(`/gym/sessions/${date}/cardio`, body);
                if (activeDate.current !== date) return;
                setDayData((prev) => ({ ...prev, progress: res.data.progress, session: res.data.session }));
                flashSaved();
                scheduleRefresh(date);
            } catch (e) {
                setSaveState("error");
                toast(e.response?.data?.message || "Couldn't save your cardio log.");
            }
        });
    }

    function toggleCardioDone() {
        const date = viewDate;
        const done = !dayData?.session?.cardio?.completed;
        runKeyed("cardio:completed", async () => {
            setSaveState("saving");
            try {
                const res = await api.post(`/gym/sessions/${date}/cardio`, { completed: done });
                if (activeDate.current !== date) return;
                setDayData((prev) => ({ ...prev, progress: res.data.progress, session: res.data.session }));
                flashSaved();
                scheduleRefresh(date);
            } catch (e) {
                setSaveState("error");
                toast(e.response?.data?.message || "Couldn't save that.");
            }
        });
    }

    // ---------- render ----------
    if (loading) return <PageSkeleton />;
    if (loadError) {
        return (
            <div className="page-fade">
                <div className="section-title"><h1>Gym</h1></div>
                <EmptyState
                    icon={<Dumbbell size={30} />}
                    title="ASCEND CAN'T REACH THE SERVER"
                    message={loadError}
                    action={<button className="btn primary" onClick={() => loadDay(viewDate)}>Try again</button>}
                />
            </div>
        );
    }
    if (!dayData) return <PageSkeleton />;

    const day = dayData.day;
    const progress = dayData.progress;
    const session = dayData.session;
    const isToday = viewDate === today;
    const cardio = session?.cardio || { distanceKm: null, durationMin: null, notes: "", completed: false };

    return (
        <div className="page-fade">
            <div className="section-title gym-head">
                <h1>Gym</h1>
                <span className="gym-save-status" data-state={saveState} aria-live="polite">
                    {saveState === "saving" && "Saving…"}
                    {saveState === "saved" && "Saved ✓"}
                    {saveState === "error" && "Save failed — retry by tapping the field again"}
                </span>
            </div>

            {/* ---------- date navigation ---------- */}
            <div className="section">
                <div className="gym-daynav">
                    <button className="icon-btn" aria-label="Previous day" onClick={() => loadDay(addDaysKey(viewDate, -1))}>
                        <ChevronLeft size={18} />
                    </button>
                    <div className="gym-daynav-label">
                        <span className="hint">DAY {dayData.dayNumber} OF THE FIXED WEEK</span>
                        <strong>{formatLong(viewDate)}</strong>
                    </div>
                    <button className="icon-btn" aria-label="Next day" onClick={() => loadDay(addDaysKey(viewDate, 1))}>
                        <ChevronRight size={18} />
                    </button>
                </div>
                {!isToday && (
                    <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => loadDay(today)}>
                        <CalendarDays size={14} /> Back to today
                    </button>
                )}
            </div>

            {/* ---------- viewed workout ---------- */}
            <div className="section">
                {day.rest ? (
                    <>
                        <div className="card gym-rest-card">
                            <Moon size={26} style={{ color: "var(--text-3)" }} />
                            <div>
                                <h2 style={{ margin: 0 }}>REST DAY</h2>
                                <p className="hint" style={{ margin: "4px 0 0" }}>
                                    Day {day.day} of the fixed week. Nothing to log today.
                                </p>
                            </div>
                        </div>
                        {day.notes.length > 0 && (
                            <div className="card gym-guidance">
                                <ul>{day.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="card gym-today-card">
                        <div className="row between" style={{ alignItems: "flex-start" }}>
                            <div style={{ minWidth: 0 }}>
                                <p className="hint" style={{ margin: 0 }}>
                                    {isToday ? "TODAY" : "VIEWING"} · DAY {day.day}
                                </p>
                                <h2 style={{ margin: "2px 0 0", overflowWrap: "anywhere" }}>{day.title}</h2>
                            </div>
                            {session?.completed && <Check size={26} style={{ color: "var(--ok)", flexShrink: 0 }} />}
                        </div>

                        {/* progress: prescribed sets only — cardio never counts */}
                        <div style={{ margin: "14px 0 6px" }}>
                            <ProgressBar value={progress.pct} />
                            <div className="row between hint" style={{ marginTop: 6 }}>
                                <span>
                                    {progress.total > 0
                                        ? `${progress.done} / ${progress.total} sets completed`
                                        : day.cardio?.loggable ? "Cardio session — no strength sets" : "Nothing to complete"}
                                </span>
                                <span className="mono-num">{progress.pct}%</span>
                            </div>
                        </div>

                        {fieldError && <p className="gym-field-error" role="alert">{fieldError}</p>}

                        {/* exercises */}
                        <div className="gym-ex-list">
                            {day.exercises.map((ex, i) => (
                                <ExerciseBlock
                                    key={ex.id}
                                    ex={ex}
                                    index={i}
                                    previous={dayData.previous}
                                    draftOf={draftOf}
                                    setDraft={setDraft}
                                    onSave={saveSet}
                                    onChoice={saveChoice}
                                />
                            ))}
                        </div>

                        {/* cardio */}
                        {day.cardio && day.cardio.loggable && (
                            <CardioCard
                                day={day}
                                cardio={cardio}
                                previous={dayData.previous}
                                onSave={saveCardio}
                                onInvalid={(msg) => { setFieldError(msg); toast(msg); }}
                                onToggleDone={toggleCardioDone}
                            />
                        )}
                        {day.cardio && !day.cardio.loggable && (
                            <div className="card plain gym-no-running">
                                <span className="gym-ex-name">{day.cardio.text}</span>
                                <span className="hint">Day {day.day} is a lifting day — recovery comes before adding running.</span>
                            </div>
                        )}

                        {session?.completed && (
                            <div className="gym-complete-banner">
                                <Check size={20} />
                                <div>
                                    <strong>{progress.total > 0 ? "WORKOUT COMPLETE" : "SESSION LOGGED"}</strong>
                                    <div className="hint">
                                        {progress.total > 0 ? `${progress.done} / ${progress.total} sets` : "Cardio done — nice work"}
                                    </div>
                                </div>
                            </div>
                        )}

                        {dayData.legacy && (
                            <p className="hint gym-legacy-note">
                                Earlier builder-era log on this date: “{dayData.legacy.workoutName}” ·{" "}
                                {dayData.legacy.done}/{dayData.legacy.total} — kept as history.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* ---------- week strip ---------- */}
            <div className="section">
                <div className="section-title"><h2>This week</h2></div>
                <div className="card">
                    <div className="gym-week-grid">
                        {(week || []).map((d) => (
                            <button
                                type="button"
                                key={d.date}
                                className={`gym-week-day${d.date === viewDate ? " today" : ""}${d.isToday && d.date !== viewDate ? " is-today" : ""}`}
                                onClick={() => loadDay(d.date)}
                                aria-label={`${formatShort(d.date)}: ${d.workoutName}`}
                                aria-current={d.date === viewDate ? "date" : undefined}
                            >
                                <div className="gym-week-dow">{d.weekdayKey.slice(0, 3).toUpperCase()}</div>
                                <div className="gym-week-daynum mono-num">D{d.dayNumber}</div>
                                <div className="gym-week-main">
                                    {d.restDay ? (
                                        <span className="gym-week-rest">Rest</span>
                                    ) : (
                                        <span className="gym-week-name">{d.title}</span>
                                    )}
                                    {!d.restDay && d.total > 0 && (
                                        <span className={`gym-week-status${d.completed ? " ok" : ""}`}>
                                            {d.completed ? "✓" : `${d.done}/${d.total}`}
                                        </span>
                                    )}
                                    {d.cardioDone && <span className="gym-week-status ok">run ✓</span>}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ---------- history ---------- */}
            <div className="section">
                <div className="section-title"><h2>History</h2></div>
                {history.length === 0 ? (
                    <p className="hint">Your logged sessions will appear here — weight, reps and cardio are kept per date.</p>
                ) : (
                    <div className="gym-history">
                        {history.map((s, i) => (
                            <button
                                type="button"
                                className="gym-history-row"
                                key={`${s.date}-${i}`}
                                onClick={() => loadDay(s.date)}
                            >
                                <div className="gym-history-date">{formatLong(s.date)}</div>
                                <div className="gym-history-body">
                                    <span className="gym-history-name">
                                        {s.completed ? "✓ " : ""}{s.workoutName}
                                        {s.legacy && <span className="gym-legacy-badge">legacy</span>}
                                    </span>
                                    <span className="hint">
                                        {s.restDay
                                            ? "Rest day"
                                            : s.total > 0
                                                ? `${s.done}/${s.total} sets`
                                                : "Cardio"}
                                        {s.cardio && s.cardio.distanceKm != null ? ` · ${s.cardio.distanceKm} km` : ""}
                                    </span>
                                </div>
                                <div className="gym-history-pct mono-num">
                                    {s.total > 0 || s.cardio ? `${s.pct}%` : ""}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ---------- progression rules (advisory) ---------- */}
            {planMeta?.progression?.length > 0 && (
                <div className="section">
                    <details className="gym-progression">
                        <summary>
                            <Info size={14} /> Progression guidelines{" "}
                            <span className="hint">(advisory — the plan itself never changes)</span>
                        </summary>
                        <ul>
                            {planMeta.progression.map((r) => <li key={r}>{r}</li>)}
                        </ul>
                    </details>
                </div>
            )}
        </div>
    );
}

// ============================================================
// One prescribed exercise: header + alternative chips + set rows.
// ============================================================
function ExerciseBlock({ ex, index, previous, draftOf, setDraft, onSave, onChoice }) {
    const hint = topOfRangeHint(ex, ex.entries);
    return (
        <div className="card plain gym-ex">
            <div className="gym-ex-head">
                <span className="gym-ex-ordinal mono-num">{index + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <span className="gym-ex-name">{ex.name}</span>
                    <span className="gym-ex-label">{ex.label}</span>
                </div>
            </div>

            {ex.slotOptions && (
                <div className="gym-chips" role="group" aria-label={`${ex.name} variation`}>
                    {ex.slotOptions.map((o) => (
                        <button
                            type="button"
                            key={o.id}
                            className={`gym-chip${o.selected ? " active" : ""}`}
                            aria-pressed={o.selected}
                            onClick={() => !o.selected && onChoice(ex.slotId, o.id)}
                        >
                            {o.name}
                        </button>
                    ))}
                    <span className="hint gym-chip-note">choice applies to this session only</span>
                </div>
            )}

            <div className="gym-sets">
                {ex.entries.map((s) => {
                    const key = fieldKey(ex.id, s.setNo);
                    const prev = previous?.sets?.[`${ex.id}#${s.setNo}`];
                    const prevLabel = prevSetLabel(prev);
                    return (
                        <div className={`gym-set-row${s.completed ? " done" : ""}`} key={key}>
                            <span className="gym-set-no">SET {s.setNo}</span>

                            {!ex.bodyweight && (
                                <input
                                    className="gym-set-input"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="kg"
                                    aria-label={`${ex.name} set ${s.setNo} weight in kg`}
                                    value={draftOf(key + "weightKg", s.weightKg)}
                                    onChange={(e) => setDraft(key + "weightKg", e.target.value)}
                                    onBlur={() => onSave(ex, s, { completed: s.completed })}
                                />
                            )}

                            {ex.metric === "duration" ? (
                                <input
                                    className="gym-set-input wide"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="sec"
                                    aria-label={`${ex.name} set ${s.setNo} duration in seconds`}
                                    value={draftOf(key + "durationSec", s.durationSec)}
                                    onChange={(e) => setDraft(key + "durationSec", e.target.value)}
                                    onBlur={() => onSave(ex, s, { completed: s.completed })}
                                />
                            ) : (
                                <input
                                    className="gym-set-input wide"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder={ex.repNote === "per leg" ? "reps/leg" : ex.repNote === "per side" ? "reps/side" : "reps"}
                                    aria-label={`${ex.name} set ${s.setNo} actual reps${ex.repNote ? ` ${ex.repNote}` : ""}`}
                                    value={draftOf(key + "reps", s.reps)}
                                    onChange={(e) => setDraft(key + "reps", e.target.value)}
                                    onBlur={() => onSave(ex, s, { completed: s.completed })}
                                />
                            )}

                            <button
                                type="button"
                                className={`gym-set-check${s.completed ? " on" : ""}`}
                                aria-pressed={s.completed}
                                aria-label={`Mark ${ex.name} set ${s.setNo} ${s.completed ? "incomplete" : "complete"}`}
                                onClick={() => onSave(ex, s, { completed: !s.completed })}
                            >
                                <Check size={20} />
                            </button>

                            {prevLabel && <span className="gym-prev">{prevLabel}</span>}
                        </div>
                    );
                })}
            </div>

            {hint && (
                <p className="gym-hint-row">
                    <FlaskConical size={13} /> {hint}
                </p>
            )}
        </div>
    );
}

// ============================================================
// Cardio card (Days 1/2/4 run-walk, Day 6 main endurance session).
// Inputs commit on blur; the Done checkbox marks the session complete.
// ============================================================
function CardioCard({ day, cardio, previous, onSave, onInvalid, onToggleDone }) {
    const prevLabel = prevCardioLabel(previous?.cardio);
    return (
        <div className={`card plain gym-cardio${cardio.completed ? " done" : ""}`}>
            <div className="gym-ex-head">
                <HeartPulse size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                    <span className="gym-ex-name">Cardio</span>
                    <span className="gym-ex-label">{day.cardio.text}</span>
                </div>
                <label className="gym-cardio-toggle">
                    <input
                        type="checkbox"
                        checked={!!cardio.completed}
                        onChange={onToggleDone}
                        aria-label="Mark cardio session done"
                    />
                    <span>Done</span>
                </label>
            </div>

            {day.cardio.mode === "endurance" && (
                <ul className="gym-guidance-list">
                    {day.guidance.map((g) => <li key={g}>{g}</li>)}
                </ul>
            )}

            <div className="gym-cardio-fields">
                <label className="gym-cardio-field">
                    <span>Distance (km)</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        placeholder={day.cardio.targetKm ? `e.g. ${day.cardio.targetKm}` : "km"}
                        aria-label="Actual distance in kilometres — shorter than target is fine"
                        defaultValue={cardio.distanceKm ?? ""}
                        key={`dist-${viewKey(cardio.distanceKm)}`}
                        onBlur={(e) => {
                            const r = sanitize(e.target.value, "distance");
                            if (r.error) { onInvalid(r.error); return; }
                            if ((r.value ?? null) !== (cardio.distanceKm ?? null)) onSave("distanceKm", e.target.value, "distance");
                        }}
                    />
                </label>
                <label className="gym-cardio-field">
                    <span>Duration (min)</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        placeholder="min"
                        aria-label="Actual duration in minutes"
                        defaultValue={cardio.durationMin ?? ""}
                        key={`dur-${viewKey(cardio.durationMin)}`}
                        onBlur={(e) => {
                            const r = sanitize(e.target.value, "minutes");
                            if (r.error) { onInvalid(r.error); return; }
                            if ((r.value ?? null) !== (cardio.durationMin ?? null)) onSave("durationMin", e.target.value, "minutes");
                        }}
                    />
                </label>
            </div>

            <label className="gym-cardio-notes">
                <span>Notes (optional)</span>
                <textarea
                    rows={2}
                    maxLength={500}
                    placeholder="How did it feel?"
                    aria-label="Cardio notes"
                    defaultValue={cardio.notes || ""}
                    key={`notes-${cardio.notes || "empty"}`}
                    onBlur={(e) => {
                        if (e.target.value !== (cardio.notes || "")) onSave("notes", e.target.value, "notes");
                    }}
                />
            </label>

            <p className="hint" style={{ marginTop: 6 }}>
                Record what you actually did — a shorter run still counts.
                {prevLabel ? ` · ${prevLabel}` : ""}
            </p>
        </div>
    );
}

// Remount key for blur-committed cardio inputs (value only changes after a save).
function viewKey(v) {
    return v == null ? "empty" : String(v);
}
