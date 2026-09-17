import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
    const [user, setUser] = useState(null);
    const [checkingAuth, setCheckingAuth] = useState(true);
    const [dash, setDash] = useState(null);
    const [dashError, setDashError] = useState(null);
    const [settings, setSettings] = useState(null);
    const [toasts, setToasts] = useState([]);

    // ---- auth bootstrap ----
    useEffect(() => {
        let cancelled = false;
        api.get("/auth/me")
            .then((res) => {
                if (!cancelled) setUser(res.data.user);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setCheckingAuth(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // ---- dashboard ----
    const loadDashboard = useCallback(async () => {
        try {
            setDashError(null);
            const res = await api.get("/data/dashboard");
            setDash(res.data);
            // NOTE: intentionally NOT calling setUser here — a new user object
            // each fetch would re-trigger the effect below (infinite refetch).
        } catch (e) {
            setDashError(
                e.response?.data?.message ||
                "Cannot reach ASCEND. Is the server running?"
            );
        }
    }, []);

    useEffect(() => {
        if (user) loadDashboard();
        else setDash(null);
    }, [user, loadDashboard]);

    // ---- toasts ----
    const toast = useCallback((message) => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev.slice(-3), { id, message }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3200);
    }, []);

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    // ---- auth actions ----
    const logout = useCallback(async () => {
        try {
            await api.post("/auth/logout");
        } finally {
            setUser(null);
            setDash(null);
        }
    }, []);

    // ---- settings (appearance etc.) ----
    useEffect(() => {
        if (!user) {
            setSettings(null);
            return;
        }
        api.get("/settings")
            .then((res) => setSettings(res.data.settings))
            .catch(() => {});
    }, [user]);

    const applySettings = useCallback((next) => {
        setSettings(next);
    }, []);

    // ---- settings body classes ----
    useEffect(() => {
        const s = settings;
        const body = document.body;
        body.classList.toggle("reduce-motion", !!s?.appearance?.reduceMotion);
        body.classList.toggle("high-contrast", !!s?.appearance?.highContrast);
        body.classList.toggle("larger-text", !!s?.appearance?.largerText);
    }, [settings]);

    const value = useMemo(
        () => ({
            user,
            setUser,
            checkingAuth,
            dash,
            setDash,
            dashError,
            reloadDashboard: loadDashboard,
            settings,
            applySettings,
            toasts,
            toast,
            dismissToast,
            logout
        }),
        [user, checkingAuth, dash, dashError, loadDashboard, settings, applySettings, toasts, toast, dismissToast, logout]
    );

    return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
    const ctx = useContext(StoreContext);
    if (!ctx) throw new Error("useStore must be used inside StoreProvider");
    return ctx;
}
