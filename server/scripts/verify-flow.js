/* eslint-disable no-console */
// End-to-end verification: register → onboarding → habit toggle → task toggle
// → journal → dashboard score. Run: node scripts/verify-flow.js
const BASE = "http://localhost:5000";
let cookie = "";

async function api(method, path, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

(async () => {
    const email = `flow${Date.now()}@ascend.app`;

    // 1. Register
    const reg = await api("POST", "/api/auth/register", {
        name: "Flow", email, password: "password123"
    });
    console.log("register:", reg.status, reg.json.success);

    // 2. Onboarding
    const onb = await api("POST", "/api/auth/onboarding", {
        name: "Flow",
        focusAreas: ["body", "learning"],
        desiredHabits: [
            { name: "Read 20 pages", area: "learning" },
            { name: "Workout", area: "body" }
        ],
        dailyAvailability: "60",
        motto: "Keep ascending"
    });
    console.log("onboarding:", onb.status, onb.json.success);

    // 3. Habits exist?
    const habits = await api("GET", "/api/data/habits");
    console.log("habits:", habits.json.habits.length, habits.json.habits.map(h => h.name));

    // 4. Toggle first habit
    const h = habits.json.habits[0];
    const t = await api("POST", `/api/data/habits/${h._id}/toggle`, {});
    console.log("toggle habit:", t.status, t.json.success);

    // 5. Create + complete a task
    const task = await api("POST", "/api/data/tasks", { title: "Test task", timeBlock: "morning" });
    console.log("create task:", task.status, task.json.success);
    const tasks = await api("GET", "/api/data/tasks");
    const tid = tasks.json.tasks[0]._id;
    const tt = await api("PATCH", `/api/data/tasks/${tid}`, { completed: true });
    console.log("toggle task:", tt.status, tt.json.success);

    // 6. Journal entry (daily reflection)
    const jr = await api("PUT", "/api/data/journal/" + new Date().toISOString().slice(0, 10), {
        date: new Date().toISOString().slice(0, 10),
        mood: 4,
        energy: 4,
        stress: 2,
        confidence: 4,
        wentWell: "Verified the app",
        improve: "Nothing today",
        proudOf: "Score works"
    });
    console.log("journal:", jr.status, jr.json.success);

    // 7. Dashboard — the critical check
    const dash = await api("GET", "/api/data/dashboard");
    const d = dash.json;
    console.log("dashboard score:", d.snapshot ? d.snapshot.score : "NO SNAPSHOT");
    console.log("  habitsDone:", d.snapshot && d.snapshot.habitsDone,
        "of", d.snapshot && d.snapshot.habitsScheduled);
    console.log("  tasksDone:", d.snapshot && d.snapshot.tasksDone,
        "of", d.snapshot && d.snapshot.tasksTotal);
    console.log("  streak:", d.streak, " level:", d.level && d.level.name, "xp:", d.level && d.level.xp);

    // Expected: habits 1/2 = 50% → 30 pts; tasks 1/4 = 25% → 10 pts;
    // journal bonus +5 → 45 total.
    const expected = 45;
    if (!d.snapshot || d.snapshot.score !== expected) {
        console.log(`FAILED — score should be ${expected}`);
        process.exit(1);
    }
    console.log("ALL GOOD ✅ score =", d.snapshot.score);
})();
