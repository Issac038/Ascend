import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import {
    LayoutDashboard, Sun, Repeat, Target, BookOpen, BarChart3,
    Award, User, Settings as SettingsIcon, LogOut, Layers, MoreHorizontal, Apple, Dumbbell
} from "lucide-react";

import { StoreProvider, useStore } from "./store/AppStore";
import useReminders from "./hooks/useReminders";
import usePushSubscription from "./hooks/usePushSubscription";
import { Logo, PageSkeleton } from "./components/ui/Primitives";
import AuthPage from "./components/auth/AuthPage";
import Onboarding from "./components/onboarding/Onboarding";

const Dashboard = lazy(() => import("./components/dashboard/Dashboard"));
const Today = lazy(() => import("./components/today/Today"));
const Habits = lazy(() => import("./components/habits/Habits"));
const Goals = lazy(() => import("./components/goals/Goals"));
const Journal = lazy(() => import("./components/journal/Journal"));
const Analytics = lazy(() => import("./components/analytics/Analytics"));
const Achievements = lazy(() => import("./components/achievements/Achievements"));
const Profile = lazy(() => import("./components/profile/Profile"));
const SettingsPage = lazy(() => import("./components/settings/SettingsPage"));
const Areas = lazy(() => import("./components/areas/Areas"));
const Nutrition = lazy(() => import("./components/nutrition/Nutrition"));
const Gym = lazy(() => import("./components/gym/Gym"));

const NAV = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
    { to: "/today", label: "Today", icon: Sun, mobile: true },
    { to: "/habits", label: "Habits", icon: Repeat, mobile: true },
    { to: "/nutrition", label: "Nutrition", icon: Apple, mobile: true },
    { to: "/gym", label: "Gym", icon: Dumbbell, mobile: false },
    { to: "/goals", label: "Goals", icon: Target, mobile: true },
    { to: "/journal", label: "Journal", icon: BookOpen, mobile: false },
    { to: "/analytics", label: "Analytics", icon: BarChart3, mobile: false },
    { to: "/achievements", label: "Achievements", icon: Award, mobile: false },
    { to: "/areas", label: "Areas", icon: null, mobile: false },
    { to: "/profile", label: "Profile", icon: User, mobile: false },
    { to: "/settings", label: "Settings", icon: SettingsIcon, mobile: false }
];

const MOBILE_NAV = NAV.filter((n) => n.mobile);
const MORE_NAV = NAV.filter((n) => !n.mobile);

function MoreMenu() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        function onDocClick(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        function onKey(e) {
            if (e.key === "Escape") setOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div className={`more-wrap${open ? " open" : ""}`} ref={ref}>
            <button
                className="icon-btn"
                aria-label="More pages"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <MoreHorizontal size={18} />
            </button>
            {open && (
                <div className="more-menu" role="menu">
                    {MORE_NAV.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} role="menuitem" className={({ isActive }) => `more-menu-link${isActive ? " active" : ""}`} onClick={() => setOpen(false)}>
                            {Icon ? <Icon size={16} /> : <Layers size={16} />} {label}
                        </NavLink>
                    ))}
                </div>
            )}
        </div>
    );
}

function Shell() {
    const { user, dash, logout, toasts, dismissToast, settings, toast } = useStore();
    useReminders(settings, toast, user);
    usePushSubscription({ settings, user });

    if (!user) return null;

    return (
        <div className="app-shell">
            {/* sidebar (desktop) */}
            <aside className="app-sidebar">
                <div className="sidebar-brand">
                    <Logo size={30} />
                    <div>
                        <div style={{ fontWeight: 900, letterSpacing: "0.28em", fontSize: 15, color: "var(--text)" }}>ASCEND</div>
                        <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--text-4)", textTransform: "uppercase", fontWeight: 700 }}>
                            Become better. Every day.
                        </div>
                    </div>
                </div>

                <nav className="sidebar-nav" aria-label="Primary">
                    {NAV.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
                            {Icon ? <Icon size={17} /> : <span style={{ width: 17 }} />}
                            {label}
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    {dash?.level && (
                        <>
                            <div className="sidebar-level">
                                <span>Level {dash.level.level}</span>
                                <strong>{dash.level.name}</strong>
                            </div>
                            <div className="progress-track thin">
                                <div className="progress-fill" style={{ width: `${dash.level.progressToNext}%` }} />
                            </div>
                        </>
                    )}
                    <button className="sidebar-link" style={{ width: "100%" }} onClick={logout}>
                        <LogOut size={16} /> Log out
                    </button>
                </div>
            </aside>

            <div style={{ flex: 1, minWidth: 0 }}>
                {/* topbar (mobile) */}
                <header className="mobile-topbar">
                    <div className="row">
                        <Logo size={24} />
                        <span style={{ fontWeight: 900, letterSpacing: "0.26em", fontSize: 14, color: "var(--text)" }}>ASCEND</span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                        <MoreMenu />
                        <button className="icon-btn" aria-label="Log out" onClick={logout}>
                            <LogOut size={18} />
                        </button>
                    </div>
                </header>

                <main className="app-main">
                    <Suspense fallback={<PageSkeleton />}>
                        <Routes>
                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/today" element={<Today />} />
                            <Route path="/habits" element={<Habits />} />
                            <Route path="/goals" element={<Goals />} />
                            <Route path="/nutrition" element={<Nutrition />} />
                            <Route path="/gym" element={<Gym />} />
                            <Route path="/journal" element={<Journal />} />
                            <Route path="/analytics" element={<Analytics />} />
                            <Route path="/achievements" element={<Achievements />} />
                            <Route path="/areas" element={<Areas />} />
                            <Route path="/profile" element={<Profile />} />
                            <Route path="/settings" element={<SettingsPage />} />
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                        </Routes>
                    </Suspense>
                </main>

                {/* bottom nav (mobile) */}
                <nav className="bottom-nav" aria-label="Primary mobile">
                    <div className="bottom-nav-inner">
                        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
                            <NavLink key={to} to={to} className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
                                <Icon size={20} />
                                {label}
                            </NavLink>
                        ))}
                    </div>
                </nav>
            </div>

            {/* toasts */}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className="toast" onClick={() => dismissToast(t.id)}>
                        {t.message}
                    </div>
                ))}
            </div>
        </div>
    );
}

function Authed() {
    const { user, checkingAuth } = useStore();

    if (checkingAuth) {
        return (
            <div className="auth-shell">
                <div className="auth-card" style={{ textAlign: "center" }}>
                    <div style={{ display: "grid", placeItems: "center", gap: 18 }}>
                        <Logo size={44} />
                        <div style={{ fontWeight: 900, letterSpacing: "0.34em", fontSize: 20, color: "var(--text)" }}>ASCEND</div>
                        <div className="progress-track" style={{ width: 90 }}><div className="progress-fill" style={{ width: "60%" }} /></div>
                    </div>
                </div>
            </div>
        );
    }

    if (!user) return <AuthPage />;
    if (!user.onboarded) return <Onboarding />;
    return <Shell />;
}

export default function App() {
    useEffect(() => {
        document.title = "ASCEND — Become better. Every day.";
    }, []);

    return (
        <StoreProvider>
            <BrowserRouter>
                <Authed />
            </BrowserRouter>
        </StoreProvider>
    );
}
