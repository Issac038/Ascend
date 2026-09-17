import { useCallback, useRef, useState } from "react";

let toastId = 0;

export default function useToasts() {
    const [toasts, setToasts] = useState([]);
    const timers = useRef({});

    const dismiss = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        if (timers.current[id]) {
            clearTimeout(timers.current[id]);
            delete timers.current[id];
        }
    }, []);

    const push = useCallback(
        (message, icon = null, ttl = 3200) => {
            const id = ++toastId;
            setToasts((prev) => [...prev.slice(-3), { id, message, icon }]);
            timers.current[id] = setTimeout(() => dismiss(id), ttl);
            return id;
        },
        [dismiss]
    );

    return { toasts, push, dismiss };
}
