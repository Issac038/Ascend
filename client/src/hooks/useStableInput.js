import { useEffect, useRef, useState } from "react";

/**
 * Stable controlled input hook.
 *
 * Keeps a local draft state so React's controlled-input round-trip never
 * drops or reorders keystrokes (the mobile-keyboard-closes bug), while
 * notifying the parent on every change. The draft re-syncs only when the
 * external value changes from OUTSIDE the input (e.g. a row was replaced),
 * never from the user's own typing.
 */
export function useStableInput(value, onChange, { commitOn = "change" } = {}) {
    const [draft, setDraft] = useState(value == null ? "" : String(value));
    const lastExternal = useRef(value);

    useEffect(() => {
        if (value !== lastExternal.current) {
            lastExternal.current = value;
            setDraft(value == null ? "" : String(value));
        }
    }, [value]);

    const handleChange = (e) => {
        const next = e && e.target ? e.target.value : e;
        setDraft(next);
        if (commitOn === "change" && onChange) onChange(next);
    };

    const commit = () => {
        if (commitOn === "blur" && onChange) onChange(draft);
    };

    return { value: draft, onChange: handleChange, onBlur: commit };
}

/**
 * Request guard for debounced async searches: only the latest call's
 * results are applied. Returns { schedule, isStale }.
 */
export function useLatestRequest() {
    const latest = useRef(0);
    return {
        schedule(fn, delay = 0) {
            const id = ++latest.current;
            return (...args) => {
                setTimeout(() => {
                    if (latest.current === id) fn(...args);
                }, delay);
            };
        },
        isStale(id) {
            return latest.current !== id;
        },
    };
}
