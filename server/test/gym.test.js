// ------------------------------------------------------------
// GYM / WORKOUT PLANNER — API test suite.
// Standalone: node test/gym.test.js  (same harness style as run-tests.js)
// Spawns server.js on a dedicated port against a scratch DB, then exercises
// the full gym flow: workouts CRUD, weekly plan, today, per-date completion
// persistence, week overview, history, ownership, and destructive cleanup.
// ------------------------------------------------------------
process.env.NODE_ENV = "test";
require("dotenv").config();

const { spawn } = require("child_process");
const http = require("http");
const mongoose = require("mongoose");

const PORT = 4595; // dedicated gym-suite port (run-tests uses 4590)
const TEST_DB_SUFFIX = `ascend_gym_test_${Date.now()}`;

function buildTestUri() {
    const explicit = process.env.TEST_MONGO_URI;
    if (explicit) return explicit;
    const base = process.env.MONGO_URI;
    if (!base) return null;
    const swapped = base.replace(/\/([^/?]+)(\?|$)/, (m, dbName, q) => {
        if (/^(admin|local|config|production|prod)$/i.test(dbName)) {
            throw new Error(`Refusing to base tests on "${dbName}". Set TEST_MONGO_URI instead.`);
        }
        return `/${TEST_DB_SUFFIX}${q}`;
    });
    return swapped;
}

const TEST_DB = buildTestUri();
if (!TEST_DB) {
    console.error("\nGYM tests need MongoDB. Set TEST_MONGO_URI or MONGO_URI (DB name is swapped to a scratch DB).\n");
    process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, extra) {
    if (cond) {
        passed += 1;
        console.log(`  ok - ${name}`);
    } else {
        failed += 1;
        failures.push(name + (extra ? ` (${extra})` : ""));
        console.log(`  FAIL - ${name}${extra ? ` (${extra})` : ""}`);
    }
}

function req(method, path, { body, cookies } = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const options = { host: "localhost", port: PORT, path, method, headers: {} };
        if (data) {
            options.headers["Content-Type"] = "application/json";
            options.headers["Content-Length"] = Buffer.byteLength(data);
        }
        if (cookies) options.headers.Cookie = cookies;
        const r = http.request(options, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c; });
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(raw); } catch { /* non-JSON */ }
                resolve({ status: res.statusCode, json, raw, headers: res.headers });
            });
        });
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
    });
}

function getCookie(res, name) {
    const set = res.headers["set-cookie"];
    if (!set) return null;
    for (const c of set) {
        if (c.startsWith(`${name}=`)) return c.split(";")[0];
    }
    return null;
}

async function waitUntilReady(tries = 40) {
    for (let i = 0; i < tries; i += 1) {
        try {
            await new Promise((r) => setTimeout(r, 500));
            const res = await req("GET", "/api/health");
            if (res.status === 200) return true;
        } catch { /* not up yet */ }
    }
    return false;
}

async function register(suffix) {
    const email = `gym${Date.now()}_${Math.floor(Math.random() * 1e6)}_${suffix}@test.local`;
    const res = await req("POST", "/api/auth/register", {
        body: { name: "Gym Tester", email, password: "password123" }
    });
    return { cookies: getCookie(res, "token"), email };
}

// Build the date key for the next occurrence of a weekday (1=Mon..7=Sun) after today.
function nextWeekdayDate(targetDow) {
    const d = new Date();
    const add = (targetDow - d.getDay() + 7) % 7 || 7; // always in the future
    d.setDate(d.getDate() + add);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

async function main() {
    console.log("\n=== GYM API TEST SUITE ===\n");

    const serverProcess = spawn(process.execPath, ["server.js"], {
        cwd: `${__dirname}/..`,
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(PORT),
            MONGO_URI: TEST_DB,
            JWT_SECRET: process.env.JWT_SECRET || "test-secret-for-ci-only"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let serverLogs = "";
    serverProcess.stdout.on("data", (c) => { serverLogs += c; });
    serverProcess.stderr.on("data", (c) => { serverLogs += c; });

    try {
        const ready = await waitUntilReady();
        assert(ready, "test backend starts and answers /api/health");
        if (!ready) throw new Error("test server never became ready:\n" + serverLogs);

        const userA = (await register("a")).cookies;
        const userB = (await register("b")).cookies;
        assert(!!userA && !!userB, "two test users registered");

        // ============ WORKOUT CRUD ============
        console.log("\n-- workout CRUD --");

        const noAuth = await req("GET", "/api/gym/workouts");
        assert(noAuth.status === 401, "unauthenticated gym access returns 401");

        const badBody = await req("POST", "/api/gym/workouts", { cookies: userA, body: { name: "", exercises: [] } });
        assert(badBody.status === 400, "workout without name rejected");

        const badEx = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: { name: "Bad", exercises: [{ name: "Squat", type: "reps", sets: 3, reps: 0 }] }
        });
        assert(badEx.status === 400, "exercise with invalid reps rejected");

        const badDur = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: { name: "Bad", exercises: [{ name: "Plank", type: "duration", sets: 3, durationSec: 0 }] }
        });
        assert(badDur.status === 400, "duration exercise with invalid duration rejected");

        const push = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: {
                name: "Push",
                exercises: [
                    { name: "Bench Press", type: "reps", sets: 4, reps: 8 },
                    { name: "Incline Dumbbell Press", type: "reps", sets: 3, reps: 10 },
                    { name: "Shoulder Press", type: "reps", sets: 3, reps: 10 },
                    { name: "Tricep Pushdown", type: "reps", sets: 3, reps: 12 }
                ]
            }
        });
        assert(push.status === 201 && push.json.workout._id, "workout created");
        assert(push.json.workout.exercises.length === 4 && push.json.workout.exercises[0].detail === "4 × 8", "exercise detail renders sets × reps");

        const pushId = push.json.workout._id;

        const cardio = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: {
                name: "Cardio",
                exercises: [
                    { name: "Treadmill", type: "duration", sets: 1, durationSec: 1200 },
                    { name: "Plank", type: "duration", sets: 3, durationSec: 60 }
                ]
            }
        });
        assert(cardio.status === 201 && cardio.json.workout.exercises[0].detail === "20 min", "duration exercise renders minutes");

        const legs = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: { name: "Legs", exercises: [{ name: "Squat", type: "reps", sets: 4, reps: 8 }] }
        });
        const legsId = legs.json.workout._id;

        const list = await req("GET", "/api/gym/workouts", { cookies: userA });
        assert(list.status === 200 && list.json.workouts.length === 3, "workouts listed");

        const patched = await req("PATCH", `/api/gym/workouts/${pushId}`, {
            cookies: userA,
            body: { name: "Push Day", exercises: push.json.workout.exercises.slice(0, 2) }
        });
        assert(patched.status === 200 && patched.json.workout.name === "Push Day" && patched.json.workout.exercises.length === 2, "workout renamed + exercises replaced");

        // restore full definition for the plan tests
        await req("PATCH", `/api/gym/workouts/${pushId}`, {
            cookies: userA,
            body: {
                exercises: [
                    { name: "Bench Press", type: "reps", sets: 4, reps: 8 },
                    { name: "Incline Dumbbell Press", type: "reps", sets: 3, reps: 10 },
                    { name: "Shoulder Press", type: "reps", sets: 3, reps: 10 },
                    { name: "Tricep Pushdown", type: "reps", sets: 3, reps: 12 }
                ]
            }
        });

        // ============ WEEKLY PLAN ============
        console.log("\n-- weekly plan --");

        const badDay = await req("PUT", "/api/gym/plan", {
            cookies: userA,
            body: { days: { monday: pushId } }
        });
        assert(badDay.status === 400, "invalid weekday key rejected");

        const notOwned = await req("POST", "/api/gym/workouts", {
            cookies: userB,
            body: { name: "B Workout", exercises: [{ name: "X", type: "reps", sets: 1, reps: 5 }] }
        });
        const otherPlan = await req("PUT", "/api/gym/plan", {
            cookies: userA,
            body: { days: { mon: notOwned.json.workout._id } }
        });
        assert(otherPlan.status === 404, "plan cannot reference another user's workout");

        const monday = nextWeekdayDate(1);
        const tuesday = nextWeekdayDate(2);
        const sunday = nextWeekdayDate(7);

        const planRes = await req("PUT", "/api/gym/plan", {
            cookies: userA,
            body: {
                days: {
                    mon: pushId, tue: legsId, wed: null, thu: pushId, fri: null, sat: cardio.json.workout._id, sun: null
                }
            }
        });
        assert(planRes.status === 200, "weekly plan saved");

        const planGet = await req("GET", "/api/gym/plan", { cookies: userA });
        assert(planGet.json.plan.days.mon && planGet.json.plan.days.mon.workoutId === pushId, "plan read-back assigns Monday");
        assert(planGet.json.plan.days.wed && planGet.json.plan.days.wed.workoutId === null, "rest days stored as null");

        // user B sees no plan leakage
        const planB = await req("GET", "/api/gym/plan", { cookies: userB });
        const bHasWorkout = Object.values(planB.json.plan.days || {}).some((d) => d && d.workoutId);
        assert(!bHasWorkout, "user B's plan is empty (no leakage from user A)");

        // ============ TODAY ============
        console.log("\n-- today --");

        const todayRes = await req("GET", "/api/gym/today", { cookies: userA });
        assert(todayRes.status === 200 && todayRes.json.date, "today endpoint returns a date");
        const todayDow = new Date(todayRes.json.date + "T12:00:00").getDay();
        const expectedKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][todayDow];
        assert(todayRes.json.weekdayKey === expectedKey, "weekday key matches the date", `${todayRes.json.weekdayKey} vs ${expectedKey}`);

        if (!todayRes.json.restDay) {
            const sched = todayRes.json.workout;
            const expectedPlanDay = planGet.json.plan.days[expectedKey];
            const expectedId = expectedPlanDay ? expectedPlanDay.workoutId : null;
            assert(
                (expectedId === null && sched === null) || (sched && sched._id === expectedId),
                "today's workout matches the weekly plan"
            );
            assert(todayRes.json.session === null && todayRes.json.progress.total === sched.exercises.length,
                "visiting today does not create a session; progress starts at 0", JSON.stringify(todayRes.json.progress));

            // no session doc created just by visiting
            const hist0 = await req("GET", "/api/gym/history", { cookies: userA });
            assert(hist0.json.sessions.length === 0, "no history entries before first check-in");
        } else {
            assert(todayRes.json.workout === null, "rest day: no workout returned");
        }

        // ============ COMPLETION PERSISTENCE (on a known scheduled date) ============
        console.log("\n-- completion --");

        // Use Monday's date (Push, 4 exercises) even if it's not today.
        const ex0 = await req("GET", `/api/gym/sessions/${monday}`, { cookies: userA });
        assert(ex0.status === 200 && !ex0.json.restDay && ex0.json.workout.exercises.length === 4, "Monday session view shows Push with 4 exercises");

        const toggleBad = await req("POST", `/api/gym/sessions/${monday}/toggle`, {
            cookies: userA, body: { key: "nonexistent exercise" }
        });
        assert(toggleBad.status === 404, "toggling an unknown exercise returns 404");

        const tog1 = await req("POST", `/api/gym/sessions/${monday}/toggle`, {
            cookies: userA, body: { key: "bench press" }
        });
        assert(tog1.status === 200 && tog1.json.session.done === 1 && tog1.json.session.total === 4, "first exercise checked (1/4)");
        assert(tog1.json.session.exercises[0].done === true, "checked exercise persisted in response");

        // persistence: a fresh GET must show the same state
        const reget = await req("GET", `/api/gym/sessions/${monday}`, { cookies: userA });
        assert(reget.json.session && reget.json.session.done === 1, "completion persists across requests");

        const tog2 = await req("POST", `/api/gym/sessions/${monday}/toggle`, {
            cookies: userA, body: { key: "incline dumbbell press" }
        });
        assert(tog2.json.session.done === 2 && tog2.json.session.pct === 50, "second exercise -> 2/4 = 50%");

        // uncheck
        const untog = await req("POST", `/api/gym/sessions/${monday}/toggle`, {
            cookies: userA, body: { key: "bench press" }
        });
        assert(untog.json.session.done === 1 && untog.json.session.pct === 25, "unchecking decreases progress");

        // complete all 4
        await req("POST", `/api/gym/sessions/${monday}/toggle`, { cookies: userA, body: { key: "bench press" } });
        await req("POST", `/api/gym/sessions/${monday}/toggle`, { cookies: userA, body: { key: "shoulder press" } });
        const last = await req("POST", `/api/gym/sessions/${monday}/toggle`, { cookies: userA, body: { key: "tricep pushdown" } });
        assert(last.json.session.done === 4 && last.json.session.completed === true && last.json.session.pct === 100,
            "checking all exercises completes the workout (100%)");
        assert(!!last.json.session.completedAt, "completedAt timestamp set");

        // reopen
        const reopen = await req("POST", `/api/gym/sessions/${monday}/toggle`, { cookies: userA, body: { key: "tricep pushdown" } });
        assert(reopen.json.session.completed === false && reopen.json.session.done === 3, "workout can be reopened (not locked)");

        // cross-date isolation: a different scheduled date starts fresh
        const thu = nextWeekdayDate(4);
        const thuRes = await req("GET", `/api/gym/sessions/${thu}`, { cookies: userA });
        assert(thuRes.json.session === null || thuRes.json.session.done === 0, "different date has independent completion state");

        // rest day: Sunday cannot be toggled
        const sunToggle = await req("POST", `/api/gym/sessions/${sunday}/toggle`, {
            cookies: userA, body: { key: "bench press" }
        });
        assert(sunToggle.status === 400 && sunToggle.json.code === "REST_DAY", "rest day toggle rejected");

        // invalid date
        const badDate = await req("GET", "/api/gym/sessions/not-a-date", { cookies: userA });
        assert(badDate.status === 400, "invalid date rejected");

        // ============ EDIT-FRIENDLINESS (snapshot semantics) ============
        console.log("\n-- history stability --");

        const hist1 = await req("GET", "/api/gym/history", { cookies: userA });
        const mondayEntry = hist1.json.sessions.find((s) => s.date === monday);
        assert(!!mondayEntry && mondayEntry.done === 3, "history shows Monday's session");

        // rename the workout; snapshot keeps the name from FIRST CHECK-IN
        // (which was "Push Day" — set by the earlier CRUD-section rename)
        await req("PATCH", `/api/gym/workouts/${pushId}`, { cookies: userA, body: { name: "Upper Push" } });
        const hist2 = await req("GET", "/api/gym/history", { cookies: userA });
        const mondayAfter = hist2.json.sessions.find((s) => s.date === monday);
        assert(mondayAfter.workoutName === "Push Day", "history keeps the snapshot name from first check-in, not later renames", `got "${mondayAfter.workoutName}"`);

        // future view uses the new name
        const thuAfter = await req("GET", `/api/gym/sessions/${thu}`, { cookies: userA });
        assert(thuAfter.json.workout && thuAfter.json.workout.name === "Upper Push", "future occurrences use the updated name");

        // ============ WEEK OVERVIEW ============
        console.log("\n-- week overview --");

        const week = await req("GET", "/api/gym/week", { cookies: userA });
        assert(week.status === 200 && week.json.days.length === 7, "week overview returns 7 days");
        const wed = week.json.days.find((d) => d.weekdayKey === "wed");
        assert(wed.restDay === true && wed.scheduled === false, "Wednesday is a rest day in the overview");
        const mon = week.json.days.find((d) => d.weekdayKey === "mon");
        assert(mon.scheduled === true && mon.workoutName === "Upper Push", "Monday shows the scheduled workout");
        if (mon.date === monday) {
            assert(mon.done === 3 && mon.total === 4 && mon.pct === 75, "Monday progress in week overview matches session");
        }
        const todayIdx = week.json.days.findIndex((d) => d.isToday);
        assert(todayIdx >= 0, "week marks today");

        // ============ OWNERSHIP ============
        console.log("\n-- ownership --");

        const crossToggle = await req("POST", `/api/gym/sessions/${monday}/toggle`, {
            cookies: userB, body: { key: "bench press" }
        });
        assert(crossToggle.status === 400 || crossToggle.status === 404,
            "user B cannot check user A's exercises", `status ${crossToggle.status}`);

        const crossPatch = await req("PATCH", `/api/gym/workouts/${pushId}`, {
            cookies: userB, body: { name: "Hacked" }
        });
        assert(crossPatch.status === 404, "user B cannot modify user A's workout");

        const crossRead = await req("GET", "/api/gym/workouts", { cookies: userB });
        assert(!crossRead.json.workouts.some((w) => w._id === pushId), "user B cannot list user A's workouts");

        const invalidId = await req("PATCH", "/api/gym/workouts/invalid-id", { cookies: userA, body: { name: "x" } });
        assert(invalidId.status === 400, "invalid id rejected cleanly");

        // ============ DELETE ============
        console.log("\n-- deletion --");

        const del = await req("DELETE", `/api/gym/workouts/${legsId}`, { cookies: userA });
        assert(del.status === 200, "workout deleted");

        const planAfterDel = await req("GET", "/api/gym/plan", { cookies: userA });
        assert(planAfterDel.json.plan.days.tue.workoutId === null, "deleted workout removed from plan (day becomes rest)");

        const thuAfterDel = await req("GET", `/api/gym/sessions/${thu}`, { cookies: userA });
        assert(thuAfterDel.json.workout && thuAfterDel.json.workout._id === pushId, "other days unaffected by the delete");

        const histAfterDel = await req("GET", "/api/gym/history", { cookies: userA });
        assert(histAfterDel.json.sessions.some((s) => s.date === monday), "history survives workout deletion (snapshot)");

        // ============ DUPLICATE / ORDER INTEGRITY ============
        console.log("\n-- duplicate & order integrity --");

        const dup = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: {
                name: "Dup Order",
                exercises: [
                    { name: "Bench Press", type: "reps", sets: 4, reps: 8 },
                    { name: "Squat", type: "reps", sets: 3, reps: 5 },
                    { name: "bench   press", type: "reps", sets: 1, reps: 1 }, // case/whitespace duplicate
                    { name: "Bench Press", type: "reps", sets: 2, reps: 20 }, // exact duplicate
                    { name: "Calf Raise", type: "reps", sets: 4, reps: 15 }
                ]
            }
        });
        assert(dup.status === 201, "workout with duplicate names created");
        const dupNames = dup.json.workout.exercises.map((e) => e.name);
        assert(dupNames.length === 3, "duplicate exercise names deduped", `got ${dupNames.length}: ${dupNames.join(", ")}`);
        assert(
            dupNames[0] === "Bench Press" && dupNames[1] === "Squat" && dupNames[2] === "Calf Raise",
            "exercise order preserved (first occurrence wins)"
        );
        const dupDel = await req("DELETE", `/api/gym/workouts/${dup.json.workout._id}`, { cookies: userA });
        assert(dupDel.status === 200, "dup-order workout cleaned up");

        // ============ RESET / DELETE-ACCOUNT INTEGRATION ============
        console.log("\n-- reset & export --");

        const exp = await req("GET", "/api/export", { cookies: userA });
        const expText = JSON.stringify(exp.json || {});
        assert(expText.includes("gymSessions") && expText.includes("Upper Push"), "export includes gym sessions");
        assert(expText.includes("gymPlan"), "export includes the weekly plan");

        const reset = await req("POST", "/api/reset", { cookies: userA, body: { confirm: "RESET" } });
        assert(reset.status === 200, "reset succeeds");
        const histAfterReset = await req("GET", "/api/gym/history", { cookies: userA });
        assert(histAfterReset.json.sessions.length === 0, "reset clears workout sessions");
        const planAfterReset = await req("GET", "/api/gym/plan", { cookies: userA });
        const anyAfter = Object.values(planAfterReset.json.plan.days || {}).some((d) => d && d.workoutId);
        assert(!anyAfter, "reset clears the weekly plan");
    } catch (err) {
        failed += 1;
        failures.push(`SUITE ERROR: ${err.message}`);
        console.error(err);
    } finally {
        try {
            const c = new mongoose.Mongoose();
            await c.connect(TEST_DB, { serverSelectionTimeoutMS: 8000 });
            await c.connection.dropDatabase();
            await c.disconnect();
            console.log("\nscratch DB dropped");
        } catch (e) {
            console.error("could not drop scratch DB:", e.message);
        }
        serverProcess.kill();
    }

    console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
    if (failures.length) {
        console.log("Failures:");
        for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
