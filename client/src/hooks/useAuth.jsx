import { useEffect, useState } from "react";
import api from "../services/api";

function useAuth() {
    const [loggedIn, setLoggedIn] = useState(false);
    const [checkingAuth, setCheckingAuth] = useState(true);

    useEffect(() => {
        async function checkAuth() {
            try {
                await api.get("/auth/me");
                setLoggedIn(true);
            } catch {
                setLoggedIn(false);
            } finally {
                setCheckingAuth(false);
            }
        }

        checkAuth();
    }, []);

    return {
        loggedIn,
        setLoggedIn,
        checkingAuth
    };
}

export default useAuth;