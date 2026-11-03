import { useEffect, useState } from "react";
import api from "../../services/api";
import { Logo, Field } from "../ui/Primitives";
import { useStore } from "../../store/AppStore";
import {
    BASELINE_SLIDER_KEYS,
    areSliderAnswersValid,
    baselineMatchesAnswers,
    isValidSliderAnswer,
    mergeAnswers,
    parseStoredSliderAnswer,
    sliderRatingPercentage,
    scoreOf
} from "../../utils/baseline";

const AREAS = [
    { key: "body", name: "Body" },
    { key: "mind", name: "Mind" },
    { key: "discipline", name: "Discipline" },
    { key: "learning", name: "Learning" },
    { key: "productivity", name: "Productivity" },
    { key: "relationships", name: "Relationships" },
    { key: "finances", name: "Finances" },
    { key: "skills", name: "Skills" },
    { key: "personal", name: "Personal" }
];

const HABIT_LIBRARY = [
    { name: "Drink 3L water", area: "body" },
    { name: "Workout 30 minutes", area: "body" },
    { name: "Read 20 pages", area: "learning" },
    { name: "Meditate 10 minutes", area: "mind" },
    { name: "Deep work block", area: "productivity" },
    { name: "No phone before bed", area: "discipline" },
    { name: "Sleep before 11pm", area: "body" },
    { name: "Write in journal", area: "mind" },
    { name: "Practice a skill", area: "skills" },
    { name: "Plan tomorrow", area: "productivity" },
    { name: "Reach out to someone", area: "relationships" },
    { name: "Track spending", area: "finances" }
];

// Four locally scored slider questions and plain-text Goal Drive motivation.
const BASELINE_CATEGORIES = [
    {
        key: "body",
        label: "BODY",
        prompt: "How often do you work out or participate in physical activity?",
        low: "Very rarely",
        middle: "Sometimes",
        high: "Every day or almost every day"
    },
    {
        key: "discipline",
        label: "DISCIPLINE",
        prompt: "How consistently do you follow through on commitments you make to yourself?",
        low: "Almost never",
        middle: "Sometimes",
        high: "Almost always"
    },
    {
        key: "learning",
        label: "LEARNING",
        prompt: "How regularly do you study, learn, or develop a new skill?",
        low: "Very rarely",
        middle: "Sometimes",
        high: "Every day or almost every day"
    },
    {
        key: "productivity",
        label: "PRODUCTIVITY",
        prompt: "How consistently do you complete the important tasks and responsibilities you intend to finish?",
        low: "Almost never",
        middle: "Sometimes",
        high: "Almost always"
    },
    {
        key: "goalDrive",
        label: "GOAL DRIVE",
        prompt: "What goals are you working towards, and how consistently are you taking action on them?",
        example: "I have big ambitions but haven't established a clear plan or taken consistent action yet."
    }
];

// Mirrors MAX_GOAL_DRIVE_CHARS in server/services/baselineValidation.js
const MAX_ANSWER_CHARS = 600;

const STEPS = 7;

// ------------------------------------------------------------
// Results panel — renders ONLY validated scores. Categories without a
// score show "Not enough information yet" and never a fabricated bar.
// ------------------------------------------------------------
function BaselinePanel({ baseline, compact = false }) {
    return (
        <div style={{ margin: "20px 0 6px", padding: 20, border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg-2)" }}>
            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: "var(--text-3)", marginBottom: 6 }}>
                SELF-REPORTED STARTING BASELINE
            </p>
            {!compact && (
                <p className="hint" style={{ margin: "0 0 16px" }}>
                    Body, Discipline, Learning and Productivity use your selected ratings. Goal Drive is saved as personal motivation and is not scored. These are self-reported starting estimates, not objective measurements. Progress from habits, tasks and workouts is tracked separately.
                </p>
            )}
            <div style={{ marginTop: compact ? 4 : 16 }}>
                {BASELINE_CATEGORIES.map((c) => {
                    const a = baseline?.assessments?.[c.key];
                    const score = scoreOf(baseline?.assessments, c.key);
                    const rating = BASELINE_SLIDER_KEYS.includes(c.key)
                        ? parseStoredSliderAnswer(baseline?.answers?.[c.key])
                        : null;
                    const displayScore = rating === null ? score : sliderRatingPercentage(rating);
                    return (
                        <div className="area-block" key={c.key}>
                            <div className="ab-label">
                                <strong>{c.label}</strong>
                                {c.key === "goalDrive" ? (
                                    <span>Personal motivation</span>
                                ) : rating !== null ? (
                                    <span>{rating}/10</span>
                                ) : (
                                    <span>{score !== null ? `${score}%` : "—"}</span>
                                )}
                            </div>
                            {c.key === "goalDrive" ? (
                                <p className="hint" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                                    {baseline?.answers?.goalDrive?.trim() || "No personal motivation added."}
                                </p>
                            ) : displayScore !== null ? (
                                <>
                                    <div className="progress-track">
                                        <div className="progress-fill" style={{ width: `${displayScore}%` }} />
                                    </div>
                                    {!compact && a?.explanation && (
                                        <p className="hint" style={{ margin: "8px 0 0" }}>
                                            {a.explanation}
                                            {a.confidence ? ` (confidence: ${a.confidence})` : ""}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="hint" style={{ margin: "6px 0 0" }}>
                                    Not enough information yet.
                                    {a?.followUpQuestion ? ` ${a.followUpQuestion}` : ""}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function Onboarding() {
    const { setUser } = useStore();
    const [step, setStep] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const [name, setName] = useState("");
    const [focusAreas, setFocusAreas] = useState([]);
    const [customArea, setCustomArea] = useState("");
    const [selectedHabits, setSelectedHabits] = useState([]);
    const [habitName, setHabitName] = useState("");
    const [goalTitle, setGoalTitle] = useState("");
    const [goalArea, setGoalArea] = useState("personal");
    const [availability, setAvailability] = useState("45");
    const [struggles, setStruggles] = useState("");
    const [motto, setMotto] = useState("");
    const [futureVision, setFutureVision] = useState("");

    // Slider values start at 5 but must be reviewed and explicitly confirmed.
    const [answers, setAnswers] = useState({
        body: 5,
        discipline: 5,
        learning: 5,
        productivity: 5,
        goalDrive: ""
    });
    const [sliderConfirmed, setSliderConfirmed] = useState({
        body: false,
        discipline: false,
        learning: false,
        productivity: false
    });
    const [baseline, setBaseline] = useState(null);
    const [assessing, setAssessing] = useState(false);
    const [assessError, setAssessError] = useState("");

    // Restore any saved baseline (draft or confirmed) when onboarding is
    // revisited — ratings and motivation are never silently discarded.
    useEffect(() => {
        let alive = true;
        api.get("/baseline")
            .then((res) => {
                const b = res.data?.baseline;
                if (!alive || !b) return;
                setBaseline(b);
                setAnswers((prev) => mergeAnswers(prev, b.answers));
                setSliderConfirmed(Object.fromEntries(
                    BASELINE_SLIDER_KEYS.map((key) => [key, parseStoredSliderAnswer(b.answers?.[key]) !== null])
                ));
            })
            .catch(() => { /* onboarding works without it */ });
        return () => { alive = false; };
    }, []);

    const toggle = (list, setList, value) => {
        setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    };

    const customAreaName = customArea.trim();

    const setAnswer = (key, value) => {
        setAnswers((prev) => ({ ...prev, [key]: value }));
        setAssessError("");
    };
    const sliderAnswersReady = areSliderAnswersValid(answers, sliderConfirmed);
    const sliderRequirementsMet = sliderAnswersReady || baseline?.status === "confirmed";
    const canProceedToReview = baseline?.status === "confirmed" || (
        sliderAnswersReady &&
        (baselineMatchesAnswers(baseline, answers) || (!baseline && Boolean(assessError)))
    );

    function setSliderAnswer(key, value) {
        setAnswer(key, value);
        setSliderConfirmed((prev) => ({ ...prev, [key]: true }));
    }

    function setSliderAnswerConfirmed(key, confirmed) {
        setSliderConfirmed((prev) => ({ ...prev, [key]: confirmed }));
        setAssessError("");
    }

    async function assess() {
        if (!sliderAnswersReady) {
            setAssessError("Review and confirm a rating from 1 to 10 for each slider.");
            return;
        }
        setAssessing(true);
        setAssessError("");
        try {
            const res = await api.post("/baseline/assess", { answers });
            setBaseline(res.data.baseline);
        } catch (e) {
            const data = e.response?.data;
            if (data?.code === "BASELINE_CONFIRMED" && data.baseline) {
                // Already-confirmed baseline is preserved server-side.
                setBaseline(data.baseline);
            } else {
                // Answers stay in state — a failure never loses input.
                setAssessError(
                    data?.message ||
                    (e.request && !e.response
                        ? "Network problem — your answers are kept here. Check your connection and retry."
                        : "Baseline could not be saved. Your answers are kept here — try again.")
                );
            }
        } finally {
            setAssessing(false);
        }
    }

    async function finish() {
        setBusy(true);
        setError("");
        try {
            // Lock in the reviewed baseline (idempotent on the server).
            if (baseline) {
                await api.post("/baseline/confirm");
            }
            const payload = {
                focusAreas,
                focusAreaNames: customAreaName ? [customAreaName] : [],
                desiredHabits: selectedHabits.map((n) => {
                    const lib = HABIT_LIBRARY.find((h) => h.name === n);
                    return { name: n, area: lib ? lib.area : "personal" };
                }),
                currentHabits: habitName.trim() ? [{ name: habitName.trim(), area: "personal" }] : [],
                goals: goalTitle.trim() ? [{ title: goalTitle.trim(), area: goalArea, horizon: "medium" }] : [],
                dailyAvailability: availability,
                struggles,
                motto,
                futureVision,
                priorities: focusAreas,
                timezoneOffset: new Date().getTimezoneOffset()
            };
            await api.post("/auth/onboarding", payload);
            const me = await api.get("/auth/me");
            setUser(me.data.user);
        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Something went wrong. Your answers are still here — try again."
            );
            setBusy(false);
        }
    }

    return (
        <div className="onboarding-shell">
            <div className="onboarding-card page-fade">
                <div className="row" style={{ gap: 14, marginBottom: 8 }}>
                    <Logo size={34} />
                    <span style={{ fontWeight: 900, letterSpacing: "0.3em", fontSize: 17, color: "var(--text)" }}>ASCEND</span>
                </div>

                {step > 0 && (
                    <div className="onboarding-progress" aria-hidden="true">
                        {Array.from({ length: STEPS }).map((_, i) => (
                            <span key={i} className={i < step ? "done" : ""} />
                        ))}
                    </div>
                )}

                {/* STEP 0 — PHILOSOPHY */}
                {step === 0 && (
                    <>
                        <h1 style={{ fontSize: "clamp(30px, 6vw, 44px)", lineHeight: 1.05, letterSpacing: "-0.03em" }}>
                            You don't need to become perfect.
                        </h1>
                        <h1 style={{ fontSize: "clamp(30px, 6vw, 44px)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "var(--text-3)" }}>
                            You just need to keep ascending.
                        </h1>
                        <p style={{ color: "var(--text-3)", margin: "22px 0 30px", fontSize: 15, maxWidth: 460 }}>
                            Ascend turns self-improvement into a daily practice —
                            clear actions, honest tracking, visible progress.
                            Five quick questions to build your starting point.
                        </p>
                        <button className="btn primary" onClick={() => setStep(1)}>Begin setup</button>
                    </>
                )}

                {/* STEP 1 — NAME + AREAS */}
                {step === 1 && (
                    <>
                        <h2 style={{ fontSize: 24 }}>Who is climbing?</h2>
                        <p className="hint" style={{ margin: "8px 0 22px" }}>Your name and the areas of life you want to improve.</p>
                        <div className="grid" style={{ gap: 18 }}>
                            <Field label="Your name">
                                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
                            </Field>
                            <Field label="Which areas do you want to improve?">
                                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                                    {AREAS.map((a) => (
                                        <button
                                            key={a.key}
                                            type="button"
                                            className={`ob-choice${focusAreas.includes(a.key) ? " selected" : ""}`}
                                            onClick={() => toggle(focusAreas, setFocusAreas, a.key)}
                                        >
                                            {a.name}
                                            <span className="check-ind">✓</span>
                                        </button>
                                    ))}
                                </div>
                            </Field>
                            <Field label="Custom area (optional)">
                                <input className="input" value={customArea} onChange={(e) => setCustomArea(e.target.value)} placeholder="e.g. Music, Public speaking…" />
                            </Field>
                        </div>
                        <div className="row" style={{ marginTop: 26 }}>
                            <button className="btn ghost" onClick={() => setStep(0)}>Back</button>
                            <div className="spacer" />
                            <button className="btn primary" onClick={() => setStep(2)} disabled={!name.trim() || focusAreas.length === 0}>Continue</button>
                        </div>
                    </>
                )}

                {/* STEP 2 — HABITS */}
                {step === 2 && (
                    <>
                        <h2 style={{ fontSize: 24 }}>What do you want to do daily?</h2>
                        <p className="hint" style={{ margin: "8px 0 22px" }}>
                            Pick a few. You can add, edit or remove anything later.
                            Small and consistent beats big and sporadic.
                        </p>
                        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                            {HABIT_LIBRARY.map((h) => (
                                <button
                                    key={h.name}
                                    type="button"
                                    className={`ob-choice${selectedHabits.includes(h.name) ? " selected" : ""}`}
                                    onClick={() => toggle(selectedHabits, setSelectedHabits, h.name)}
                                >
                                    {h.name}
                                    <span className="check-ind">✓</span>
                                </button>
                            ))}
                        </div>
                        <Field label="Add your own (optional)" >
                            <input
                                className="input"
                                style={{ marginTop: 14 }}
                                value={habitName}
                                onChange={(e) => setHabitName(e.target.value)}
                                placeholder="e.g. Practice guitar 15 minutes"
                            />
                        </Field>
                        <div className="row" style={{ marginTop: 26 }}>
                            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
                            <div className="spacer" />
                            <button className="btn primary" onClick={() => setStep(3)} disabled={selectedHabits.length === 0 && !habitName.trim()}>Continue</button>
                        </div>
                    </>
                )}

                {/* STEP 3 — GOAL */}
                {step === 3 && (
                    <>
                        <h2 style={{ fontSize: 24 }}>Where are you headed?</h2>
                        <p className="hint" style={{ margin: "8px 0 22px" }}>One meaningful goal for now. Goals tell you where you're going — habits determine whether you get there.</p>
                        <div className="grid" style={{ gap: 16 }}>
                            <Field label="Your goal">
                                <input className="input" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="e.g. RUN A HALF MARATHON" style={{ textTransform: "uppercase", fontWeight: 700 }} />
                            </Field>
                            <Field label="Area">
                                <select className="select" value={goalArea} onChange={(e) => setGoalArea(e.target.value)}>
                                    {AREAS.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
                                </select>
                            </Field>
                        </div>
                        <div className="row" style={{ marginTop: 26 }}>
                            <button className="btn ghost" onClick={() => setStep(2)}>Back</button>
                            <div className="spacer" />
                            <button className="btn primary" onClick={() => setStep(4)}>Continue</button>
                        </div>
                    </>
                )}

                {/* STEP 4 — AVAILABILITY + STRUGGLES */}
                {step === 4 && (
                    <>
                        <h2 style={{ fontSize: 24 }}>Be honest with yourself.</h2>
                        <p className="hint" style={{ margin: "8px 0 22px" }}>This calibrates your starting load. You can adjust any time.</p>
                        <div className="grid" style={{ gap: 20 }}>
                            <Field label="Daily time you can commit">
                                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                                    {["15", "30", "45", "60", "90", "120"].map((m) => (
                                        <button key={m} type="button" className={`ob-choice${availability === m ? " selected" : ""}`} onClick={() => setAvailability(m)}>
                                            {m} min
                                        </button>
                                    ))}
                                </div>
                            </Field>
                            <Field label="What do you struggle with most?">
                                <textarea className="textarea" value={struggles} onChange={(e) => setStruggles(e.target.value)} placeholder="e.g. Staying consistent, phone addiction, procrastination…" />
                            </Field>
                        </div>
                        <div className="row" style={{ marginTop: 26 }}>
                            <button className="btn ghost" onClick={() => setStep(3)}>Back</button>
                            <div className="spacer" />
                            <button className="btn primary" onClick={() => setStep(5)}>Continue</button>
                        </div>
                    </>
                )}

                {/* STEP 5 — SELF-REPORTED SLIDERS + GOAL DRIVE MOTIVATION */}
                {step === 5 && (
                    <>
                        <h2 style={{ fontSize: 24 }}>Your starting point.</h2>
                        <p className="hint" style={{ margin: "8px 0 18px" }}>
                            Rate Body, Discipline, Learning and Productivity from 1 to 10. Those scores are calculated directly from your choices.
                            Goal Drive is saved as plain-text motivation and is not scored. The sliders start at 5; review and confirm each rating, or change it.
                        </p>
                        <div className="grid" style={{ gap: 18 }}>
                            {BASELINE_CATEGORIES.map((c) => (
                                <Field key={c.key} label={c.label}>
                                    <p className="hint" style={{ margin: "0 0 6px" }}>{c.prompt}</p>
                                    {BASELINE_SLIDER_KEYS.includes(c.key) ? (
                                        <div className="baseline-slider">
                                            <div className="baseline-slider-value" aria-live="polite">
                                                <span>{sliderConfirmed[c.key] ? "Selected rating" : "Suggested rating — review and confirm"}</span>
                                                <strong>{isValidSliderAnswer(answers[c.key]) ? answers[c.key] : "—"}</strong>
                                            </div>
                                            <input
                                                className="baseline-slider-input"
                                                type="range"
                                                min="1"
                                                max="10"
                                                step="1"
                                                value={answers[c.key] ?? 5}
                                                aria-label={`${c.label} rating`}
                                                aria-valuetext={`${answers[c.key] ?? 5} out of 10`}
                                                onChange={(e) => setSliderAnswer(c.key, Number(e.target.value))}
                                            />
                                            <div className="baseline-slider-labels" aria-hidden="true">
                                                <span><strong>1</strong> — {c.low}</span>
                                                <span><strong>5</strong> — {c.middle}</span>
                                                <span><strong>10</strong> — {c.high}</span>
                                            </div>
                                            <label className="baseline-slider-confirm">
                                                <input
                                                    type="checkbox"
                                                    checked={sliderConfirmed[c.key]}
                                                    onChange={(e) => setSliderAnswerConfirmed(c.key, e.target.checked)}
                                                />
                                                I reviewed and confirm this rating.
                                            </label>
                                        </div>
                                    ) : (
                                        <textarea
                                            className="textarea"
                                            value={answers[c.key]}
                                            maxLength={MAX_ANSWER_CHARS}
                                            rows={3}
                                            onChange={(e) => setAnswer(c.key, e.target.value)}
                                            placeholder={`e.g. ${c.example}`}
                                        />
                                    )}
                                </Field>
                            ))}
                        </div>

                        <div className="row" style={{ marginTop: 24 }}>
                            <button className="btn ghost" onClick={() => setStep(4)} disabled={assessing}>Back</button>
                            <div className="spacer" />
                            <button className="btn primary" onClick={assess} disabled={assessing || !sliderAnswersReady}>
                                {assessing ? "Saving baseline…" : baseline ? "Update baseline" : "Save my baseline"}
                            </button>
                        </div>

                        {assessing && (
                            <p className="hint" style={{ marginTop: 16 }}>
                                Calculating your ratings locally and saving your baseline…
                            </p>
                        )}

                        {assessError && (
                            <div style={{ marginTop: 16 }}>
                                <p className="form-error">{assessError}</p>
                                <p className="hint" style={{ margin: "6px 0 10px" }}>
                                    Your answers are still here. The four ratings are calculated locally and Goal Drive is stored only as text. You can retry saving.
                                </p>
                                <div className="row">
                                    <button className="btn ghost" onClick={assess} disabled={assessing || !sliderAnswersReady}>Retry saving</button>
                                </div>
                            </div>
                        )}

                        {baseline && <BaselinePanel baseline={baseline} />}

                        <div className="row" style={{ marginTop: 22 }}>
                            <div className="spacer" />
                            <button
                                className="btn primary"
                                onClick={() => setStep(6)}
                                disabled={!sliderRequirementsMet || !canProceedToReview}
                            >
                                Continue
                            </button>
                        </div>
                        {(!sliderRequirementsMet || !canProceedToReview) && (
                            <p className="hint" style={{ marginTop: 10, textAlign: "right" }}>
                                {!sliderRequirementsMet
                                    ? "Review and confirm all four slider ratings to continue."
                                    : baseline && baseline.status !== "confirmed"
                                    ? "Re-assess your changed answers before continuing."
                                    : "Save your baseline to continue."}
                            </p>
                        )}
                    </>
                )}

                {/* STEP 6 — VISION + FINISH */}
                {step === 6 && (
                    <>
                        <h2 style={{ fontSize: 24 }}>Your future self.</h2>
                        <p className="hint" style={{ margin: "8px 0 22px" }}>Optional, but powerful. What does the future you look like?</p>
                        <div className="grid" style={{ gap: 16 }}>
                            <Field label="Personal motto">
                                <input className="input" value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="Become better. Every day." />
                            </Field>
                            <Field label="Describe your future self">
                                <textarea className="textarea" value={futureVision} onChange={(e) => setFutureVision(e.target.value)} placeholder="Strong, focused, disciplined. Someone who keeps their word to themselves." />
                            </Field>
                        </div>

                        {baseline ? (
                            <>
                                <BaselinePanel baseline={baseline} compact />
                                <button
                                    className="btn ghost"
                                    style={{ marginTop: 4 }}
                                    onClick={() => setStep(5)}
                                    disabled={busy}
                                >
                                    Edit ratings &amp; motivation
                                </button>
                            </>
                        ) : (
                            <div style={{ margin: "20px 0 6px", padding: 20, border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg-2)" }}>
                                <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: "var(--text-3)", marginBottom: 8 }}>
                                    STARTING BASELINE
                                </p>
                                <p className="hint" style={{ margin: 0 }}>
                                    Not assessed yet — all categories are unassessed.
                                    Go back to generate your baseline.
                                </p>
                                <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setStep(5)} disabled={busy}>
                                    Back to baseline ratings
                                </button>
                            </div>
                        )}

                        {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}

                        <div className="row" style={{ marginTop: 22 }}>
                            <button className="btn ghost" onClick={() => setStep(5)} disabled={busy}>Back</button>
                            <div className="spacer" />
                            <button className="btn primary" onClick={finish} disabled={busy}>
                                {busy ? "Building your setup…" : "Start ascending"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
