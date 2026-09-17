// All dates are handled as local YYYY-MM-DD strings ("date keys").

function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function todayKey() {
    return toDateKey(new Date());
}

// "Today" for a user in a specific timezone.
// offsetMinutes uses the JS convention (Date#getTimezoneOffset):
// minutes to ADD to local time to get UTC (e.g. UTC+2 -> -120, UTC-5 -> 300).
function todayKeyFor(offsetMinutes) {
    const off = Number(offsetMinutes) || 0;
    if (!off) return todayKey();
    const shifted = new Date(Date.now() - off * 60000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(key) {
    if (typeof key !== "string" || !DATE_KEY_RE.test(key)) return false;
    const d = keyToDate(key);
    return !Number.isNaN(d.getTime()) && toDateKey(d) === key;
}

function keyToDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function addDays(key, n) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return toDateKey(d);
}

function diffDays(a, b) {
    return Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
}

function dayOfWeek(key) {
    return keyToDate(key).getDay(); // 0 = Sunday
}

// Monday-based week start
function startOfWeek(key) {
    const dow = dayOfWeek(key);
    const back = dow === 0 ? 6 : dow - 1;
    return addDays(key, -back);
}

function monthKey(key) {
    return key.slice(0, 7);
}

function startOfMonth(key) {
    return key.slice(0, 8) + "01";
}

function endOfMonth(key) {
    const d = keyToDate(key);
    return toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function eachDay(fromKey, toKey) {
    const days = [];
    let cur = fromKey;
    let guard = 0;
    while (cur <= toKey && guard < 3000) {
        days.push(cur);
        cur = addDays(cur, 1);
        guard += 1;
    }
    return days;
}

function lastNDays(n, endKey = todayKey()) {
    return eachDay(addDays(endKey, -(n - 1)), endKey);
}

function formatShort(key) {
    return keyToDate(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLong(key) {
    return keyToDate(key).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric"
    });
}

function weekdayName(key) {
    return keyToDate(key).toLocaleDateString("en-US", { weekday: "long" });
}

function monthName(key) {
    return keyToDate(key).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

module.exports = {
    toDateKey,
    todayKey,
    todayKeyFor,
    isValidDateKey,
    keyToDate,
    addDays,
    diffDays,
    dayOfWeek,
    startOfWeek,
    monthKey,
    startOfMonth,
    endOfMonth,
    eachDay,
    lastNDays,
    formatShort,
    formatLong,
    weekdayName,
    monthName
};
