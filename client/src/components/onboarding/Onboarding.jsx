import { useMemo, useState } from "react";
import api from "../../services/api";
import { Logo, Field } from "../ui/Primitives";
import { useStore } from "../../store/AppStore";

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

const STEPS = 6;

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

    const toggle = (list, setList, value) => {
        setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    };

    const customAreaName = customArea.trim();
    const setupAreas = useMemo(() => {
        const chosen = AREAS.filter((a) => focusAreas.includes(a.key));
        return [...chosen, ...(customAreaName ? [{ key: "custom", name: customAreaName }] : [])];
    }, [focusAreas, customAreaName]);

    const habitIntensity = Math.min(100, Math.max(25, Math.round((selectedHabits.length / 6) * 100)));
    const goalIntensity = goalTitle.trim() ? 55 : 20;
    const discipline = Math.min(95, 30 + Math.round(Number(availability) / 4));
    const learning = focusAreas.includes("learning") || focusAreas.includes("skills") ? 70 : 40;
    const productivity = focusAreas.includes("productivity") ? 75 : 50;

    async function finish() {
        setBusy(true);
        setError("");
        try {
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
            setError(e.response?.data?.message || "Something went wrong. Try again.");
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

                {/* STEP 5 — VISION + FINISH */}
                {step === 5 && (
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

                        <div style={{ margin: "28px 0 6px", padding: 20, border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg-2)" }}>
                            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: "var(--text-3)", marginBottom: 16 }}>YOUR STARTING POINT</p>
                            {[
                                { label: setupAreas[0]?.name?.toUpperCase() || "FOCUS", v: habitIntensity },
                                { label: "DISCIPLINE", v: discipline },
                                { label: "LEARNING", v: learning },
                                { label: "PRODUCTIVITY", v: productivity },
                                { label: "GOAL DRIVE", v: goalIntensity }
                            ].map((b) => (
                                <div className="area-block" key={b.label}>
                                    <div className="ab-label"><strong>{b.label}</strong><span>{b.v}%</span></div>
                                    <div className="progress-track"><div className="progress-fill" style={{ width: `${b.v}%` }} /></div>
                                </div>
                            ))}
                        </div>

                        {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}

                        <div className="row" style={{ marginTop: 22 }}>
                            <button className="btn ghost" onClick={() => setStep(4)} disabled={busy}>Back</button>
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
