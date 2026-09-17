export function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function formatShort(key) {
    if (!key) return "";
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatLong(key) {
    if (!key) return "";
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric"
    });
}

export function weekdayInitial(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "narrow" });
}

export function greeting() {
    const h = new Date().getHours();
    if (h < 5) return "Up late";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
}

export function relativeDays(dateKey) {
    const today = todayKey();
    const [ty, tm, td] = today.split("-").map(Number);
    const [y, m, d] = dateKey.split("-").map(Number);
    const diff = Math.round(
        (new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000
    );
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff < 0) return `${Math.abs(diff)} days ago`;
    return `in ${diff} days`;
}

export function monthsUntil(dateKey) {
    if (!dateKey) return null;
    const [y, m, d] = dateKey.split("-").map(Number);
    const now = new Date();
    const months = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + (d < now.getDate() ? -0.5 : 0.5);
    return Math.max(0, Math.round(months));
}
