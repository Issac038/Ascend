// ------------------------------------------------------------
// FIXED 7-DAY GYM TRACKER — API test suite.
// Standalone: node test/gym.test.js  (same harness style as run-tests.js)
// Spawns server.js on a dedicated port against a scratch DB, then verifies:
//   - the canonical plan is served read-only and cannot be modified via the API
//   - per-set weight/reps/duration/completion logging, idempotent & ownership-scoped
//   - bodyweight/duration exercises never require weight
//   - session persistence, weekly repeat with fresh checkboxes + history intact
//   - previous-session reference never overwrites current values
//   - the two prescribed alternatives (default first, persisted per session)
//   - cardio logs (including shorter-than-target runs), rest-day guardrails
//   - invalid input, duplicate submissions, date boundaries, ownership isolation
//   - legacy builder-era workout history survives (read-only) and export/reset cover new data
// ------------------------------------------------------------
process.env.NODE_ENV = "test";
require("dotenv").config();

const { spawn } = require("child_process");
const http = require("http");
const mongoose = require("mongoose");

const PORT = 4595; // dedicated gym-suite port (run-tests uses 4590, v11 4596)
const TEST_DB_SUFFIX = `ascend_gym_test_${Date.now()}`;

// Dates from the canonical anchor (2026-09-21 = Day 1, a Monday).
const D1_PREV = "2026-09-28"; // last week's Day 1
const D1 = "2026-10-05";      // this week's Day 1
const D1_NEXT = "2026-10-12"; // next week's Day 1
const D2 = "2026-10-06";
const D3 = "2026-10-07";      // Pallof Press OR Back Extension
const D4 = "2026-10-08";
const D6 = "2026-10-03";      // cardio day
const D7 = "2026-10-04";      // rest day

function buildTestUri() {
    const explicit = process.env.TEST_MONGO_URI;
    if (explicit) return explicit;
    const base = process.env.MONGO_URI;
    if (!base) return null;
    return base.replace(/\/([^/?]+)(\?|$)/, (m, dbName, q) => {
        if (/^(admin|local|config|production|prod)$/i.test(dbName)) {
            throw new Error(`Refusing to base tests on "${dbName}". Set TEST_MONGO_URI instead.`);
        }
        return `/${TEST_DB_SUFFIX}${q}`;
    });
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

let userAEmail = null;

function findEx(day, name) {
    return (day.exercises || []).find((e) => e.name === name);
}

async function main() {
    console.log("\n=== FIXED GYM API TEST SUITE ===\n");

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

        const userAObj = await register("a");
        const userA = userAObj.cookies;
        userAEmail = userAObj.email;
        const userB = (await register("b")).cookies;
        assert(!!userA && !!userB, "two test users registered");

        // ============ AUTH ============
        console.log("\n-- authentication --");
        for (const [method, path] of [
            ["GET", "/api/gym/plan"],
            ["GET", "/api/gym/today"],
            ["GET", `/api/gym/sessions/${D1}`],
            ["GET", "/api/gym/week"],
            ["GET", "/api/gym/history"],
            ["POST", `/api/gym/sessions/${D1}/set`],
            ["POST", `/api/gym/sessions/${D1}/choice`],
            ["POST", `/api/gym/sessions/${D1}/cardio`]
        ]) {
            const r = await req(method, path, { body: method === "POST" ? {} : undefined });
            assert(r.status === 401, `unauthenticated ${method} ${path} returns 401`);
        }

        // ============ CANONICAL PLAN (spec-exact, read-only) ============
        console.log("\n-- canonical plan --");
        const planRes = await req("GET", "/api/gym/plan", { cookies: userA });
        assert(planRes.status === 200 && planRes.json.plan, "GET /plan returns the plan");
        const P = planRes.json.plan;
        assert(P.anchor === "2026-09-21", "plan exposes its documented anchor");
        assert(P.days.length === 7, "exactly seven days");
        assert(P.days[0].title === "CHEST / BICEPS / ABS" && P.days[6].title === "REST", "day titles match the spec");

        // Exact spec: [name, sets, minReps|null, maxReps|null, repNote|null] per day.
        const expectedSpec = [
            ["CHEST / BICEPS / ABS", [
                ["Incline Dumbbell Press", 3, 8, 12, null],
                ["Flat Dumbbell Press", 3, 8, 12, null],
                ["Incline Dumbbell Curl", 3, 10, 12, null],
                ["Hammer Curl", 2, 10, 15, null],
                ["Cable Crunch", 3, 10, 15, null],
                ["Plank OR Dead Bug", 3, null, null, null]
            ]],
            ["BACK / TRICEPS / DELTS", [
                ["Lat Pulldown", 3, 8, 12, null],
                ["Chest-Supported Row", 3, 8, 12, null],
                ["Cable Pressdown", 3, 10, 15, null],
                ["Overhead Triceps Extension", 2, 10, 15, null],
                ["Lateral Raise", 3, 12, 20, null],
                ["Rear Delt Fly", 2, 12, 20, null]
            ]],
            ["LEGS / CORE", [
                ["Squat", 3, 6, 10, null],
                ["Romanian Deadlift", 3, 8, 12, null],
                ["Hamstring Curl", 3, 10, 15, null],
                ["Calf Raise", 3, 12, 20, null],
                ["Pallof Press OR Back Extension", 3, null, null, null]
            ]],
            ["BACK / CHEST", [
                ["Flat Barbell Bench Press", 3, 6, 10, null],
                ["Seated Cable Row", 3, 8, 12, null],
                ["Machine Chest Press", 2, 10, 15, null],
                ["Neutral-Grip Lat Pulldown", 3, 8, 12, null],
                ["Cable Chest Fly", 2, 12, 15, null]
            ]],
            ["LEGS / CORE", [
                ["Bulgarian Split Squat", 3, 8, 12, "per leg"],
                ["Hip Thrust", 3, 8, 12, null],
                ["Leg Extension", 2, 10, 15, null],
                ["Seated Leg Curl", 2, 10, 15, null],
                ["Reverse Crunch", 3, 10, 15, null],
                ["Pallof Press", 2, 10, 12, "per side"]
            ]],
            ["CARDIO", []],
            ["REST", []]
        ];
        let namesMatch = true;
        let setsMatch = true;
        let repsMatch = true;
        let notesMatch = true;
        expectedSpec.forEach(([title, exSpecs], i) => {
            const d = P.days[i];
            if (d.title !== title) namesMatch = false;
            const got = d.exercises.map((e) => e.name);
            const want = exSpecs.map((x) => x[0]);
            if (JSON.stringify(got) !== JSON.stringify(want)) namesMatch = false;
            if (d.exercises.length !== exSpecs.length) namesMatch = false;
            d.exercises.forEach((e, j) => {
                const [, sets, min, max, note] = exSpecs[j];
                if (e.sets !== sets) setsMatch = false;
                if (min === null) {
                    if (e.repsMin != null || e.repsMax != null) repsMatch = false;
                } else if (e.repsMin !== min || e.repsMax !== max || e.repsMin > e.repsMax) {
                    repsMatch = false;
                }
                if ((e.repNote || null) !== note) notesMatch = false;
            });
        });
        assert(namesMatch, "all seven days: exercise names + order match the spec");
        assert(setsMatch, "every prescribed set count matches the spec exactly");
        assert(repsMatch, "every prescribed rep range matches the spec exactly");
        assert(notesMatch, "per leg / per side labels match the spec");

        const d1 = P.days[0];
        assert(findEx(d1, "Incline Dumbbell Press").sets === 3 && findEx(d1, "Incline Dumbbell Press").repsMin === 8 && findEx(d1, "Incline Dumbbell Press").repsMax === 12, "Day 1 incline press = 3 × 8–12");
        assert(findEx(d1, "Hammer Curl").sets === 2 && findEx(d1, "Hammer Curl").repsMin === 10 && findEx(d1, "Hammer Curl").repsMax === 15, "Day 1 hammer curl = 2 × 10–15");
        assert(d1.cardio.text === "3 km run/walk." && d1.cardio.targetKm === 3, "Day 1 cardio = 3 km run/walk");
        assert(P.days[1].cardio.text === "3 km run/walk." && P.days[3].cardio.text === "3 km run/walk.", "Days 2 & 4 cardio = 3 km run/walk");
        assert(P.days[2].cardio.text === "No running." && P.days[4].cardio.text === "No running.", "Days 3 & 5 = No running");
        assert(P.days[5].guidance.length === 4 && P.days[5].cardio.goalKm === 10, "Day 6 guidance + 10 km long-term goal");
        assert(P.days[5].totalSets === 0, "Day 6 cardio does not count as strength sets");
        assert(P.days[6].rest === true && P.days[6].notes.length === 3 && P.days[6].exercises.length === 0, "Day 7 is a built-in rest day with no exercises");
        assert(Array.isArray(P.progression) && P.progression.length >= 6, "advisory progression rules are served");

        // ============ PLAN IMMUTABILITY THROUGH THE API ============
        console.log("\n-- plan cannot be modified --");
        const putPlan = await req("PUT", "/api/gym/plan", { cookies: userA, body: { days: { mon: null } } });
        assert(putPlan.status === 403 && putPlan.json.code === "PLAN_FIXED", "PUT /plan rejected 403 PLAN_FIXED");
        const createW = await req("POST", "/api/gym/workouts", {
            cookies: userA,
            body: { name: "Sneaky", exercises: [{ name: "Fake", type: "reps", sets: 9, reps: 1 }] }
        });
        assert(createW.status === 403 && createW.json.code === "PLAN_FIXED", "POST /workouts rejected 403");
        const patchW = await req("PATCH", "/api/gym/workouts/0123456789abcdef01234567", { cookies: userA, body: { name: "Renamed" } });
        assert(patchW.status === 403, "PATCH /workouts/:id rejected 403");
        const delW = await req("DELETE", "/api/gym/workouts/0123456789abcdef01234567", { cookies: userA });
        assert(delW.status === 403, "DELETE /workouts/:id rejected 403");
        const toggle = await req("POST", `/api/gym/sessions/${D1}/toggle`, { cookies: userA, body: { key: "x" } });
        assert(toggle.status === 410, "legacy toggle flow returns 410");
        const refresh = await req("POST", `/api/gym/sessions/${D1}/refresh`, { cookies: userA, body: {} });
        assert(refresh.status === 410, "legacy refresh flow returns 410");
        const planRes2 = await req("GET", "/api/gym/plan", { cookies: userA });
        assert(JSON.stringify(planRes2.json.plan) === JSON.stringify(P), "plan byte-identical after every mutation attempt");

        // Crafted payloads inside otherwise-valid endpoints cannot alter the template either.
        const crafted = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_incline_db_press", setNo: 1, completed: true, sets: 99, name: "HACKED", repRange: [1, 999] }
        });
        assert(crafted.status === 200, "set log accepted, extra template fields ignored");
        const planRes3 = await req("GET", "/api/gym/plan", { cookies: userA });
        const hackCheck = findEx(planRes3.json.plan.days[0], "Incline Dumbbell Press");
        assert(hackCheck.sets === 3 && hackCheck.repsMin === 8, "canonical sets/rep range unchanged by crafted payload");

        // ============ DAY VIEW + ANCHOR ============
        console.log("\n-- day view & anchor --");
        const day1View = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        assert(day1View.status === 200 && day1View.json.dayNumber === 1, "2026-10-05 maps to Day 1");
        assert(day1View.json.restDay === false && day1View.json.day.exercises.length === 6, "Day 1 shows its six exercises");
        assert(day1View.json.day.totalSets === 17, "Day 1 prescribes 17 sets");
        assert(day1View.json.day.exercises[0].entries.length === 3, "exactly the prescribed number of set rows render");
        assert(day1View.json.workout && day1View.json.workout.name === "Day 1 — CHEST / BICEPS / ABS", "dashboard-compatible title present");

        const d7View = await req("GET", `/api/gym/sessions/${D7}`, { cookies: userA });
        assert(d7View.json.restDay === true && d7View.json.workout === null, "2026-10-04 is a rest day with no workout");
        assert(d7View.json.progress.total === 0 && d7View.json.day.notes.length === 3, "rest day has no checklist and nothing to complete");

        const restSet = await req("POST", `/api/gym/sessions/${D7}/set`, { cookies: userA, body: { exId: "x", setNo: 1, completed: true } });
        assert(restSet.status === 400 && restSet.json.code === "REST_DAY", "logging a set on rest day rejected");
        const restChoice = await req("POST", `/api/gym/sessions/${D7}/choice`, { cookies: userA, body: { slotId: "d1_core", choiceId: "d1_plank" } });
        assert(restChoice.status === 400, "choosing an alternative on rest day rejected");

        const badDate = await req("GET", "/api/gym/sessions/2026-02-30", { cookies: userA });
        assert(badDate.status === 400, "impossible date (2026-02-30) rejected");
        const badDate2 = await req("GET", "/api/gym/sessions/not-a-date", { cookies: userA });
        assert(badDate2.status === 400, "malformed date rejected");

        const todayRes = await req("GET", "/api/gym/today", { cookies: userA });
        assert(todayRes.status === 200 && todayRes.json.date && todayRes.json.dayNumber >= 1 && todayRes.json.dayNumber <= 7, "GET /today works without an explicit date");

        const weekRes = await req("GET", `/api/gym/week?start=${D1}&today=${D1}`, { cookies: userA });
        assert(weekRes.status === 200 && weekRes.json.days.length === 7, "week overview returns seven days");
        assert(weekRes.json.days.every((d) => d.dayNumber >= 1 && d.dayNumber <= 7 && typeof d.restDay === "boolean"), "every week day carries its fixed plan day");
        assert(weekRes.json.days.find((d) => d.date === D1).isToday, "today flag honors the client's local date");

        // ============ SET LOGGING ============
        console.log("\n-- set logging --");
        // The first crafted request above already logged set 1; verify values landed.
        const afterFirst = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        const ex1 = findEx(afterFirst.json.day, "Incline Dumbbell Press");
        assert(ex1.entries[0].completed === true, "set 1 completed independently");
        assert(ex1.entries[1].completed === false && ex1.entries[1].weightKg === null && ex1.entries[1].reps === null, "remaining sets stay incomplete with empty values");
        assert(afterFirst.json.progress.done === 1 && afterFirst.json.progress.total === 17, "progress counts 1/17 sets (cardio excluded)");

        const log2 = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_incline_db_press", setNo: 2, weightKg: 32.5, reps: 10, completed: true }
        });
        assert(log2.status === 200 && log2.json.progress.done === 2, "second set logs weight + reps + completion");

        // Incomplete set with no numbers at all (empty fields allowed while incomplete).
        const emptySet = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_flat_db_press", setNo: 1, completed: false }
        });
        assert(emptySet.status === 200, "incomplete set accepted without placeholder values");

        // Correcting a completed set preserves the edit in the session.
        const correct = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_incline_db_press", setNo: 1, weightKg: 30, reps: 11, completed: true }
        });
        assert(correct.status === 200 && correct.json.progress.done === 2, "editing a completed set does not change completion");
        const reget = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        const ex1b = findEx(reget.json.day, "Incline Dumbbell Press");
        assert(ex1b.entries[0].weightKg === 30 && ex1b.entries[0].reps === 11, "corrected weight/reps persisted for this session");
        assert(ex1b.entries[0].completed === true && ex1b.entries[1].weightKg === 32.5 && ex1b.entries[1].reps === 10, "each set stores weight/reps/completion independently");

        // Typing a number alone must not complete a set.
        const noAuto = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_flat_db_press", setNo: 2, weightKg: 40, reps: 8 }
        });
        assert(noAuto.json.progress.done === 2, "saving numbers without completed=true does not mark the set done");

        // ============ BODYWEIGHT / DURATION ============
        console.log("\n-- bodyweight & duration exercises --");
        const plank = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_plank", setNo: 1, durationSec: 45, weightKg: 99, completed: true }
        });
        assert(plank.status === 200 && plank.json.progress.done === 3, "plank set completes with duration only");
        const plankView = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        const plankEx = findEx(plankView.json.day, "Plank OR Dead Bug");
        assert(plankEx.bodyweight === true && plankEx.metric === "duration", "plank is flagged bodyweight/duration");
        assert(plankEx.entries[0].durationSec === 45 && plankEx.entries[0].weightKg === null, "plank stores seconds and never a weight");

        // ============ VALIDATION ============
        console.log("\n-- validation --");
        const cases = [
            [{ exId: "d1_incline_db_press", setNo: 4, completed: true }, "setNo beyond prescribed count"],
            [{ exId: "made_up_exercise", setNo: 1, completed: true }, "unknown exercise id"],
            [{ exId: "d1_incline_db_press", setNo: 0, completed: true }, "setNo below 1"],
            [{ exId: "d1_incline_db_press", setNo: 1.5, completed: true }, "non-integer setNo"],
            [{ exId: "d1_incline_db_press", setNo: 1, reps: 0, completed: true }, "reps of 0"],
            [{ exId: "d1_incline_db_press", setNo: 1, reps: 10.5, completed: true }, "non-integer reps"],
            [{ exId: "d1_incline_db_press", setNo: 1, reps: 5000, completed: true }, "absurd reps"],
            [{ exId: "d1_incline_db_press", setNo: 1, weightKg: -5, completed: true }, "negative weight"],
            [{ exId: "d1_incline_db_press", setNo: 1, weightKg: 1e9, completed: true }, "absurd weight"],
            [{ exId: "d1_incline_db_press", setNo: 1, weightKg: "heavy", completed: true }, "non-numeric weight"],
            [{ exId: "d1_incline_db_press", setNo: 1, completed: "yes" }, "non-boolean completed"],
            [{ exId: "d1_plank", setNo: 1, durationSec: 0, completed: true }, "zero plank duration"],
            [{ exId: "d1_plank", setNo: 1, durationSec: 45.5, completed: true }, "non-integer duration"]
        ];
        for (const [body, label] of cases) {
            const r = await req("POST", `/api/gym/sessions/${D1}/set`, { cookies: userA, body });
            assert(r.status === 400, `rejects ${label}`);
        }
        const cardioBad1 = await req("POST", `/api/gym/sessions/${D1}/cardio`, { cookies: userA, body: { distanceKm: -1 } });
        assert(cardioBad1.status === 400, "rejects negative cardio distance");
        const cardioBad2 = await req("POST", `/api/gym/sessions/${D1}/cardio`, { cookies: userA, body: { distanceKm: "far" } });
        assert(cardioBad2.status === 400, "rejects non-numeric cardio distance");
        const cardioBad3 = await req("POST", `/api/gym/sessions/${D1}/cardio`, { cookies: userA, body: { durationMin: 99999 } });
        assert(cardioBad3.status === 400, "rejects absurd cardio duration");

        // ============ DUPLICATE SUBMISSIONS ============
        console.log("\n-- duplicate submissions --");
        const dupBody = { exId: "d1_hammer_curl", setNo: 1, weightKg: 12, reps: 12, completed: true };
        const dup1 = await req("POST", `/api/gym/sessions/${D1}/set`, { cookies: userA, body: dupBody });
        await req("POST", `/api/gym/sessions/${D1}/set`, { cookies: userA, body: dupBody });
        const dup3 = await req("POST", `/api/gym/sessions/${D1}/set`, { cookies: userA, body: dupBody });
        assert(dup1.json.progress.done === dup3.json.progress.done, "rapid repeated saves keep progress stable");

        // ============ ALTERNATIVES ============
        console.log("\n-- prescribed alternatives --");
        const choiceDef = await req("POST", `/api/gym/sessions/${D1}/choice`, {
            cookies: userA, body: { slotId: "d1_core", choiceId: "d1_dead_bug" }
        });
        assert(choiceDef.status === 200, "choosing Dead Bug for the Day 1 slot succeeds");
        const afterChoice = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        assert(afterChoice.json.session.choices.d1_core === "d1_dead_bug", "choice persisted for the session");
        const deadBugEntry = findEx(afterChoice.json.day, "Plank OR Dead Bug");
        assert(!!deadBugEntry && deadBugEntry.sets === 3, "alternative stays visible with the same 3 prescribed sets");
        assert(deadBugEntry.chosenId === "d1_dead_bug" && deadBugEntry.metric === "reps" && deadBugEntry.bodyweight === true, "session now resolves to Dead Bug (reps, bodyweight)");

        // Log a set on the newly chosen option: reps only, no weight (bodyweight).
        const deadBugLog = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userA,
            body: { exId: "d1_dead_bug", setNo: 1, reps: 12, completed: true }
        });
        assert(deadBugLog.status === 200 && deadBugLog.json.progress.done === 4, "Dead Bug logs reps without weight");

        const afterChoice2 = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        assert(afterChoice2.json.progress.done === 4, "progress counts only the chosen option's completed sets (switched-away Plank set no longer counts)");

        const badChoice = await req("POST", `/api/gym/sessions/${D1}/choice`, {
            cookies: userA, body: { slotId: "d1_core", choiceId: "barbell_curl" }
        });
        assert(badChoice.status === 400, "arbitrary exercise cannot be chosen");
        const badSlot = await req("POST", `/api/gym/sessions/${D3}/choice`, {
            cookies: userA, body: { slotId: "d1_core", choiceId: "d1_plank" }
        });
        assert(badSlot.status === 400, "a slot from another day cannot be chosen");

        const d3View = await req("GET", `/api/gym/sessions/${D3}`, { cookies: userA });
        assert(d3View.json.session.choices.d3_core === "d3_pallof_press", "Day 3 alternative defaults to Pallof Press");
        const d3Back = await req("POST", `/api/gym/sessions/${D3}/choice`, {
            cookies: userA, body: { slotId: "d3_core", choiceId: "d3_back_extension" }
        });
        assert(d3Back.json.session.choices.d3_core === "d3_back_extension", "Day 3 alternative switches to Back Extension");
        const backExt = findEx(d3Back.json.day, "Pallof Press OR Back Extension");
        assert(backExt && backExt.sets === 3 && backExt.chosenId === "d3_back_extension" && backExt.bodyweight === true && backExt.metric === "reps", "Back Extension: 3 sets, bodyweight, reps");

        // ============ CARDIO ============
        console.log("\n-- cardio logging --");
        const cardioShort = await req("POST", `/api/gym/sessions/${D2}/cardio`, {
            cookies: userA,
            body: { distanceKm: 1.5, durationMin: 12, notes: "Shins sore, walked the last km.", completed: true }
        });
        assert(cardioShort.status === 200, "shorter-than-target run (1.5 km of 3 km) accepted");
        const d2View = await req("GET", `/api/gym/sessions/${D2}`, { cookies: userA });
        assert(d2View.json.session.cardio.distanceKm === 1.5 && d2View.json.session.cardio.durationMin === 12, "cardio distance + duration stored");
        assert(d2View.json.session.cardio.notes.includes("Shins"), "cardio notes stored");
        assert(d2View.json.progress.total === 16, "cardio distance never counts as a strength set");

        const noRun = await req("POST", `/api/gym/sessions/${D3}/cardio`, { cookies: userA, body: { distanceKm: 3 } });
        assert(noRun.status === 400, "cardio cannot be logged on a 'No running' day");

        const d6Cardio = await req("POST", `/api/gym/sessions/${D6}/cardio`, {
            cookies: userA,
            body: { distanceKm: 4.2, durationMin: 26, notes: "Felt easy, held a conversation.", completed: true }
        });
        assert(d6Cardio.status === 200, "Day 6 endurance session logs distance, duration, notes");
        const d6View = await req("GET", `/api/gym/sessions/${D6}`, { cookies: userA });
        assert(d6View.json.day.totalSets === 0 && d6View.json.progress.pct === 100, "Day 6 progress comes from the cardio log, not sets");
        assert(d6View.json.session.cardio.distanceKm === 4.2, "Day 6 cardio persisted");
        const d6Rest = await req("POST", `/api/gym/sessions/${D6}/set`, { cookies: userA, body: { exId: "d1_plank", setNo: 1, completed: true } });
        assert(d6Rest.status === 400, "no strength sets can be forced onto the cardio day");

        // ============ PERSISTENCE / WEEKLY REPEAT / PREVIOUS REFERENCE ============
        console.log("\n-- persistence, weekly repeat & previous reference --");
        const revisit = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        assert(revisit.json.progress.done === 4, "returning to the same date restores the session's progress");
        const revisitSlot = findEx(revisit.json.day, "Plank OR Dead Bug");
        assert(!!revisitSlot && revisitSlot.entries[1].completed === false, "untouched sets remain unchecked");

        const nextWeek = await req("GET", `/api/gym/sessions/${D1_NEXT}`, { cookies: userA });
        assert(nextWeek.json.dayNumber === 1 && nextWeek.json.progress.done === 0, "next week's same workout starts with unchecked sets");
        assert(nextWeek.json.progress.total === 17, "next week shows the same prescribed 17 sets");
        const allEmpty = nextWeek.json.day.exercises.every((e) => e.entries.every((s) => !s.completed && s.weightKg == null && s.reps == null));
        assert(allEmpty, "next week's session carries no leftover values");
        assert(nextWeek.json.session.choices.d1_core === "d1_dead_bug" || nextWeek.json.session.choices.d1_core === "d1_plank", "next week's choice starts from its own session state");

        const prevRef = nextWeek.json.previous;
        assert(prevRef.sets["d1_incline_db_press#1"] && prevRef.sets["d1_incline_db_press#1"].weightKg === 30, "previous session's weight available as reference");
        assert(prevRef.sets["d1_incline_db_press#1"].reps === 11, "previous session's reps available as reference");
        const prevWeekView = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        const curEx = findEx(prevWeekView.json.day, "Incline Dumbbell Press");
        assert(curEx.entries[0].weightKg === 30, "reference never overwrites current-session values (still 30 kg this week)");

        const prevWeek = await req("GET", `/api/gym/sessions/${D1_PREV}`, { cookies: userA });
        assert(prevWeek.json.progress.done === 0, "last week's session stays independent (nothing logged there)");

        const d6Next = await req("GET", `/api/gym/sessions/2026-10-10`, { cookies: userA });
        assert(d6Next.json.dayNumber === 6 && d6Next.json.session.cardio.distanceKm === null, "next cardio session starts with empty cardio");
        assert(d6Next.json.previous.cardio && d6Next.json.previous.cardio.distanceKm === 4.2, "previous cardio distance available as reference");

        // ============ OWNERSHIP ============
        console.log("\n-- ownership isolation --");
        const bDay1 = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userB });
        assert(bDay1.status === 200 && bDay1.json.progress.done === 0, "user B sees no progress from user A's session");
        const bEmpty = bDay1.json.day.exercises.every((e) => e.entries.every((s) => !s.completed && s.weightKg == null));
        assert(bEmpty, "user B sees none of user A's logged values");
        const bHist = await req("GET", "/api/gym/history", { cookies: userB });
        assert(bHist.status === 200 && bHist.json.sessions.length === 0, "user B's history starts empty");
        const bWrite = await req("POST", `/api/gym/sessions/${D1}/set`, {
            cookies: userB, body: { exId: "d1_incline_db_press", setNo: 1, weightKg: 20, reps: 8, completed: true }
        });
        assert(bWrite.json.progress.done === 1, "user B logs into their own session");
        const aAfter = await req("GET", `/api/gym/sessions/${D1}`, { cookies: userA });
        assert(aAfter.json.progress.done === 4, "user A's session untouched by user B's write");
        const aHist = await req("GET", "/api/gym/history", { cookies: userA });
        const aRow = aHist.json.sessions.find((s) => s.date === D1);
        assert(aRow && aRow.done === 4, "user A's history shows user A's data only");

        // ============ LEGACY HISTORY PRESERVATION ============
        console.log("\n-- legacy history & export --");
        const { WorkoutSession } = require("../models/Gym");
        await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 8000 });
        const legacyUser = await mongoose.connection.collection("users").findOne({ email: userAEmail });
        await WorkoutSession.create({
            userId: legacyUser._id,
            date: "2026-09-14",
            workoutName: "Upper Push",
            exercises: [
                { key: "bench press", name: "Bench Press", detail: "4 × 8", done: true, doneAt: new Date() },
                { key: "ohp", name: "Overhead Press", detail: "3 × 8", done: true, doneAt: new Date() },
                { key: "triceps", name: "Triceps Pushdown", detail: "3 × 12", done: false },
                { key: "plank", name: "Plank", detail: "3 × 60 sec", done: false }
            ],
            completedAt: null
        });

        const histWithLegacy = await req("GET", "/api/gym/history?limit=50", { cookies: userA });
        const legacyRow = histWithLegacy.json.sessions.find((s) => s.date === "2026-09-14");
        assert(!!legacyRow && legacyRow.legacy === true, "legacy workout session still appears in history");
        assert(legacyRow.done === 2 && legacyRow.total === 4 && legacyRow.workoutName === "Upper Push", "legacy session keeps its own completion snapshot");
        const fixedRows = histWithLegacy.json.sessions.filter((s) => !s.legacy);
        assert(fixedRows.some((s) => s.date === D1 && s.workoutName === "Day 1 — CHEST / BICEPS / ABS"), "fixed-plan sessions appear alongside legacy rows");
        const legacyGet = await req("GET", "/api/gym/workouts", { cookies: userA });
        assert(legacyGet.status === 200, "legacy workouts remain readable (no builder)");

        const exp = await req("GET", "/api/export", { cookies: userA });
        const expText = JSON.stringify(exp.json || {});
        assert(expText.includes("gymSessions") && expText.includes("Upper Push"), "export includes legacy gym sessions");
        assert(expText.includes("planSessions") && expText.includes("setLogs"), "export includes fixed-plan sessions + set logs");

        // ============ DOC-LEVEL IDEMPOTENCY (direct DB checks) ============
        console.log("-- duplicate-record guarantees (direct DB) --");
        const { PlanSession, SetLog } = require("../models/Gym");
        const dupCount = await SetLog.countDocuments({ userId: legacyUser._id, date: D1, exId: "d1_hammer_curl", setNo: 1 });
        assert(dupCount === 1, "exactly one set-log document after three identical saves");
        const sessionCount = await PlanSession.countDocuments({ userId: legacyUser._id, date: D1 });
        assert(sessionCount === 1, "exactly one session document per (user, date)");
        const sessionsAll = await PlanSession.countDocuments({ userId: legacyUser._id });
        const writtenDates = new Set([D1, D2, D3, D6]);
        assert(sessionsAll === writtenDates.size, "reads never create session documents (rest days stay empty)", `got ${sessionsAll}`);

        // Visits must not have created docs for untouched dates.
        const untouched = await PlanSession.findOne({ userId: legacyUser._id, date: D7 });
        assert(untouched === null, "rest day has no session document");

        // ============ RESET CLEARS NEW DATA (existing behavior) ============
        console.log("\n-- reset & cleanup --");
        const reset = await req("POST", "/api/reset", { cookies: userA, body: { confirm: "RESET" } });
        assert(reset.status === 200, "reset endpoint still succeeds");
        const histAfterReset = await req("GET", "/api/gym/history", { cookies: userA });
        assert(histAfterReset.json.sessions.length === 0, "reset clears fixed-plan sessions AND legacy sessions");
        const setLogsAfter = await SetLog.countDocuments({ userId: legacyUser._id });
        assert(setLogsAfter === 0, "reset clears set logs");
        await mongoose.disconnect();
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
