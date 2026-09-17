import { useEffect, useRef } from "react";
import { X, AlertTriangle } from "lucide-react";

/* ---------------- Logo ---------------- */
export function Logo({ size = 28 }) {
    return (
        <svg
            className="logo-mark"
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
        >
            <rect x="1" y="1" width="30" height="30" rx="7" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
            <path d="M9 22 L16 8 L23 22" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.2 17.5 H19.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, subtitle, children, actions, large = false }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        const t = setTimeout(() => {
            ref.current?.querySelector("input, textarea, select, button")?.focus();
        }, 60);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            clearTimeout(t);
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className={`modal${large ? " large" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
                <div className="modal-head">
                    <div>
                        <h3>{title}</h3>
                        {subtitle && <p className="sub">{subtitle}</p>}
                    </div>
                    <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
                        <X size={18} />
                    </button>
                </div>
                {children}
                {actions && <div className="modal-actions">{actions}</div>}
            </div>
        </div>
    );
}

/* ---------------- Confirm dialog ---------------- */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger = false, busy = false }) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            actions={
                <>
                    <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} disabled={busy}>
                        {busy ? "Working…" : confirmLabel}
                    </button>
                </>
            }
        >
            <div className="confirm-dialog-body">
                {danger && <AlertTriangle size={22} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />}
                <p className="confirm-dialog-message">{message}</p>
            </div>
        </Modal>
    );
}

/* ---------------- Empty state ---------------- */
export function EmptyState({ icon, title, message, action }) {
    return (
        <div className="empty-state">
            {icon && <div className="empty-icon">{icon}</div>}
            <h3>{title}</h3>
            <p>{message}</p>
            {action}
        </div>
    );
}

/* ---------------- Skeletons ---------------- */
export function Skeleton({ h = 20, w = "100%", style = {} }) {
    return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export function PageSkeleton() {
    return (
        <div className="grid" style={{ gap: 14 }}>
            <Skeleton h={44} w="55%" />
            <div className="grid cols-3">
                <Skeleton h={120} /><Skeleton h={120} /><Skeleton h={120} />
            </div>
            <Skeleton h={200} />
        </div>
    );
}

/* ---------------- Progress ring ---------------- */
export function ProgressRing({ value = 0, size = 168, stroke = 8, label = null, sub = null }) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, value));
    const offset = c - (clamped / 100) * c;

    return (
        <div className="score-ring-wrap" style={{ width: size, height: size }}>
            <svg width={size} height={size}>
                <circle className="ring-bg" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
                <circle
                    className="ring-fill"
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    strokeDasharray={c}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                />
            </svg>
            <div className="score-ring-center">
                <strong className="mono-num">{label ?? `${clamped}%`}</strong>
                {sub && <span>{sub}</span>}
            </div>
        </div>
    );
}

/* ---------------- Progress bar ---------------- */
export function ProgressBar({ value = 0, thin = false }) {
    const clamped = Math.max(0, Math.min(100, value));
    return (
        <div className={`progress-track${thin ? " thin" : ""}`} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${clamped}%` }} />
        </div>
    );
}

/* ---------------- Field ---------------- */
export function Field({ label, children, hint }) {
    return (
        <div className="field">
            {label && <label>{label}</label>}
            {children}
            {hint && <span className="hint">{hint}</span>}
        </div>
    );
}

/* ---------------- Toggle switch ---------------- */
export function Toggle({ checked, onChange, label }) {
    return (
        <label className="switch" aria-label={label}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span className="track" />
        </label>
    );
}

/* ---------------- 1-5 scale ---------------- */
export function Scale({ value, onChange, label }) {
    return (
        <div className="field">
            {label && <label>{label}</label>}
            <div className="scale-row" role="radiogroup" aria-label={label}>
                {[1, 2, 3, 4, 5].map((n) => (
                    <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={value === n}
                        className={`scale-btn${value === n ? " active" : ""}`}
                        onClick={() => onChange(n)}
                    >
                        {n}
                    </button>
                ))}
            </div>
        </div>
    );
}
