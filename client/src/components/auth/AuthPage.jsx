import { useState } from "react";
import { ArrowRight } from "lucide-react";
import api from "../../services/api";
import { Logo, Field } from "../ui/Primitives";
import { useStore } from "../../store/AppStore";

export default function AuthPage() {
    const { setUser } = useStore();
    const [mode, setMode] = useState("login");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [inviteCode, setInviteCode] = useState(
        import.meta.env.VITE_INVITE_CODE || ""
    );
    const [showInvite, setShowInvite] = useState(
        Boolean(import.meta.env.VITE_INVITE_CODE)
    );

    const [resetStage, setResetStage] = useState(null); // null | "request" | "confirm"
    const [resetCode, setResetCode] = useState("");
    const [resetMessage, setResetMessage] = useState("");

    async function submit(e) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            if (mode === "login") {
                const res = await api.post("/auth/login", { email, password });
                setUser(res.data.user);
            } else {
                const res = await api.post("/auth/register", { name, email, password, inviteCode });
                setUser({ ...res.data.user, onboarded: false });
                // session cookie set; reload full user
                const me = await api.get("/auth/me");
                setUser(me.data.user);
            }
        } catch (err) {
            const d = err.response?.data;
            if (d?.codeRequired) setShowInvite(true);
            setError(d?.message || "Cannot reach ASCEND. Is the server running?");
        } finally {
            setBusy(false);
        }
    }

    async function requestReset(e) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            const res = await api.post("/auth/forgot-password", { email });
            setResetMessage(res.data.devCode ? `Your reset code: ${res.data.devCode}` : res.data.message);
            setResetStage("confirm");
        } catch (err) {
            setError(err.response?.data?.message || "Something went wrong");
        } finally {
            setBusy(false);
        }
    }

    async function confirmReset(e) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            await api.post("/auth/reset-password", { email, code: resetCode, password });
            setResetStage(null);
            setMode("login");
            setResetMessage("");
        } catch (err) {
            setError(err.response?.data?.message || "Invalid code");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="auth-shell">
            <div className="auth-card page-fade">
                <div className="auth-brand">
                    <Logo size={40} />
                    <span className="word">ASCEND</span>
                </div>

                {resetStage === null && (
                    <>
                        <h1>{mode === "login" ? "Welcome back." : "Begin the climb."}</h1>
                        <p className="auth-sub">
                            {mode === "login"
                                ? "Your progress is waiting."
                                : "Create your account and start ascending."}
                        </p>

                        <form onSubmit={submit}>
                            {mode === "register" && (
                                <Field label="Name">
                                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Issac" autoComplete="name" required />
                                </Field>
                            )}
                            <Field label="Email">
                                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
                            </Field>
                            <Field label="Password">
                                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6} />
                            </Field>
                            {mode === "register" && showInvite && (
                                <Field label="Invite code">
                                    <input className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Required for this private deployment" autoComplete="off" required />
                                </Field>
                            )}
                            {error && <p className="form-error">{error}</p>}
                            <button className="btn primary wide" disabled={busy}>
                                {busy ? "…" : mode === "login" ? "Enter Ascend" : "Create Account"}
                                <ArrowRight size={15} />
                            </button>
                        </form>

                        <div className="auth-foot">
                            {mode === "login" ? (
                                <>
                                    New here? <button onClick={() => { setMode("register"); setError(""); }}>Create an account</button>
                                    <div style={{ marginTop: 10 }}>
                                        <button style={{ color: "var(--text-3)", fontWeight: 500 }} onClick={() => { setResetStage("request"); setError(""); }}>Forgot password?</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    Already ascending? <button onClick={() => { setMode("login"); setError(""); }}>Log in</button>
                                </>
                            )}
                        </div>
                    </>
                )}

                {resetStage === "request" && (
                    <>
                        <h1>Reset password</h1>
                        <p className="auth-sub">Enter your account email to generate a reset code.</p>
                        <form onSubmit={requestReset}>
                            <Field label="Email">
                                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                            </Field>
                            {error && <p className="form-error">{error}</p>}
                            <button className="btn primary wide" disabled={busy}>Generate reset code</button>
                            <button type="button" className="btn ghost wide" onClick={() => setResetStage(null)}>Back to login</button>
                        </form>
                    </>
                )}

                {resetStage === "confirm" && (
                    <>
                        <h1>Enter code</h1>
                        <p className="auth-sub">{resetMessage}</p>
                        <form onSubmit={confirmReset}>
                            <Field label="Reset code">
                                <input className="input" value={resetCode} onChange={(e) => setResetCode(e.target.value)} inputMode="numeric" required />
                            </Field>
                            <Field label="New password">
                                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
                            </Field>
                            {error && <p className="form-error">{error}</p>}
                            <button className="btn primary wide" disabled={busy}>Set new password</button>
                            <button type="button" className="btn ghost wide" onClick={() => { setResetStage(null); setResetMessage(""); }}>Back to login</button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
