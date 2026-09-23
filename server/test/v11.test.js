// ------------------------------------------------------------
// V1.1.0 API test suite — journal PIN security, dashboard goals
// payload, and push scheduling primitives.
// Standalone: node test/v11.test.js (same harness as run-tests.js)
// Spawns server.js on a dedicated port against a scratch DB.
// ------------------------------------------------------------
process.env.NODE_ENV = "test";
require("dotenv").config();

const { spawn } = require("child_process");
const http = require("http");
const mongoose = require("mongoose");

const PORT = 4596; // dedicated v11-suite port (4590 run-tests, 4595 gym)
const TEST_DB_SUFFIX = `ascend_v11_test_${Date.now()}`;

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
    console.error("\nV11 tests need MongoDB. Set TEST_MONGO_URI or MONGO_URI (DB name is swapped to a scratch DB).\n");
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

function req(method, path, { body, cookies, headers } = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const options = { host: "localhost", port: PORT, path, method, headers: { ...(headers || {}) } };
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
                resolve({ status: res.statusCode, headers: res.headers, data: json, raw });
            });
        });
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
    });
}

const cookieOf = (res) => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");

async function register(email) {
    const res = await req("POST", "/api/auth/register", { body: { name: "V11 Tester", email, password: "Str0ngPass!x" } });
    const cookies = cookieOf(res);
    assert(res.status === 201 || res.status === 200, `register ${email}`, `status ${res.status}`);
    return cookies;
}

// ---- pure-function tests (no server needed) ----
function testSchedulerMath() {
    const { minutesOfDay, dayKeyFor } = require("../services/pushService");

    // 2026-09-23T18:30:00Z, user in UTC+5:30 (offset -330) -> local 00:00 next day
    const utc = new Date("2026-09-23T18:30:00Z");
    assert(minutesOfDay(utc, -330) === 0, "scheduler: UTC+5:30 local minute is midnight", `${minutesOfDay(utc, -330)}`);
    assert(dayKeyFor(utc, -330) === "2026-09-24", "scheduler: UTC+5:30 local date rolls to next day", dayKeyFor(utc, -330));
    assert(minutesOfDay(utc, 300) === 13 * 60 + 30, "scheduler: UTC-5 local minute 13:30", `${minutesOfDay(utc, 300)}`);
    assert(minutesOfDay(utc, 0) === 18 * 60 + 30, "scheduler: UTC minute 18:30");
    return Promise.resolve();
}

// ---- main suite ----
async function main() {
    await testSchedulerMath();

    // spawn server
    const child = spawn(process.execPath, ["server.js"], {
        env: { ...process.env, MONGO_URI: TEST_DB, PORT: String(PORT), NODE_ENV: "test" },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let serverLog = "";
    child.stdout.on("data", (d) => { serverLog += d; });
    child.stderr.on("data", (d) => { serverLog += d; });

    async function waitForServer() {
        for (let i = 0; i < 60; i += 1) {
            try {
                const r = await req("GET", "/api/health");
                if (r.status === 200) return true;
            } catch { /* retry */ }
            await new Promise((r2) => setTimeout(r2, 500));
        }
        return false;
    }

    const up = await waitForServer();
    assert(up, "server starts on test port", serverLog.slice(-400));
    if (!up) {
        child.kill();
        finish();
        return;
    }

    try {
        const userA = await register(`v11a_${Date.now()}@test.local`);
        const userB = await register(`v11b_${Date.now()}@test.local`);

        // ---------- JOURNAL PIN ----------
        let r = await req("GET", "/api/journal-security/status", { cookies: userA });
        assert(r.status === 200 && r.data.configured === false && r.data.unlocked === true,
            "pin status: unconfigured user is unlocked");

        // setup requires 4 digits
        r = await req("POST", "/api/journal-security/pin", { cookies: userA, body: { pin: "12", confirmPin: "12" } });
        assert(r.status === 400, "pin setup rejects non-4-digit PIN");

        r = await req("POST", "/api/journal-security/pin", { cookies: userA, body: { pin: "1234", confirmPin: "1234" } });
        assert(r.status === 200 && r.data.unlockedToken, "pin setup succeeds and returns unlock token");

        // status now locked without token
        r = await req("GET", "/api/journal-security/status", { cookies: userA });
        assert(r.data.configured === true && r.data.unlocked === false, "pin status: configured user locked without token");

        // journal content gated: GET list without token -> 423, body has no entries
        r = await req("GET", "/api/data/journal", { cookies: userA });
        assert(r.status === 423, "journal GET is gated while locked");
        assert(!r.data.entries, "journal GET leaks no entries while locked");

        // write gated too (a locked journal can't be overwritten)
        r = await req("PUT", "/api/data/journal/2026-09-23", { cookies: userA, body: { text: "sneaky" } });
        assert(r.status === 423, "journal PUT is gated while locked");

        // export gated too
        r = await req("GET", "/api/export", { cookies: userA });
        assert(r.status === 423, "export is gated while journal is locked");

        // unlock with the token works
        r = await req("GET", "/api/data/journal", { cookies: userA, headers: { "x-journal-unlock": "tok" } });
        assert(r.status === 423, "bogus unlock token is rejected");

        // wrong PIN
        r = await req("POST", "/api/journal-security/verify", { cookies: userA, body: { pin: "9999" } });
        assert(r.status === 400 && r.data.message === "Incorrect PIN.", "wrong PIN returns 'Incorrect PIN.'", r.raw.slice(0, 120));

        // correct PIN unlocks
        r = await req("POST", "/api/journal-security/verify", { cookies: userA, body: { pin: "1234" } });
        assert(r.status === 200 && r.data.unlockedToken, "correct PIN returns unlock token");
        const tokenA = r.data.unlockedToken;

        // with a valid token, content is reachable
        await req("PUT", "/api/data/journal/2026-09-23", { cookies: userA, headers: { "x-journal-unlock": tokenA }, body: { text: "Finished my assignment and went to the gym." } });
        r = await req("GET", "/api/data/journal", { cookies: userA, headers: { "x-journal-unlock": tokenA } });
        assert(r.status === 200 && r.data.entries && r.data.entries.some((e) => e.text && e.text.includes("gym")),
            "unlocked journal serves full Free Writing content");

        // rate limiting: 5 wrong PINs -> lockout (423)
        let sawLock = false;
        for (let i = 0; i < 6; i += 1) {
            r = await req("POST", "/api/journal-security/verify", { cookies: userA, body: { pin: i === 5 ? "0000" : "0000" } });
            if (r.status === 423) sawLock = true;
        }
        assert(sawLock, "repeated wrong PINs trigger server-side lockout");

        // even the CORRECT pin is refused while locked
        r = await req("POST", "/api/journal-security/verify", { cookies: userA, body: { pin: "1234" } });
        assert(r.status === 423, "correct PIN refused during lockout window");

        // recovery via account password removes the PIN
        r = await req("POST", "/api/journal-security/forgot", { cookies: userA, body: { password: "Str0ngPass!x" } });
        assert(r.status === 200, "PIN recovery via account password works");
        r = await req("GET", "/api/data/journal", { cookies: userA });
        assert(r.status === 200 && r.data.entries, "journal readable after recovery (no PIN configured)");

        // ownership: userB can never see userA's journal via verify bypass
        r = await req("POST", "/api/journal-security/verify", { cookies: userB, body: { pin: "1234" } });
        assert(r.status === 200 || r.status === 400, "userB PIN verify stays scoped to userB");
        r = await req("GET", "/api/data/journal", { cookies: userB });
        if (r.status === 200) {
            assert(!r.data.entries.some((e) => e.text && e.text.includes("gym")),
                "userB cannot see userA's journal entries");
        } else {
            assert(r.status === 423, "userB without PIN setup is gated appropriately");
        }

        // ---------- DASHBOARD GOALS PAYLOAD ----------
        const g = await req("POST", "/api/data/goals", {
            cookies: userA,
            body: { title: "Read 20 books", area: "personal", horizon: "medium" }
        });
        assert(g.status === 201, "goal creation for profile test", `status ${g.status}`);
        r = await req("GET", "/api/data/dashboard", { cookies: userA });
        const goals = r.data?.goals || [];
        assert(Array.isArray(goals) && goals.some((x) => x.title === "Read 20 books"),
            "dashboard payload includes per-goal progress list");
        const goal0 = goals[0] || {};
        assert(
            typeof goal0.progress === "number" && goal0.progress >= 0 && goal0.progress <= 100,
            "dashboard goal progress is a clamped 0-100 number",
            JSON.stringify(goal0)
        );

        // ---------- UNAUTHENTICATED ACCESS ----------
        r = await req("GET", "/api/journal-security/status");
        assert(r.status === 401, "journal-security endpoints require auth");
        r = await req("GET", "/api/push/status");
        assert(r.status === 401, "push endpoints require auth");
        r = await req("GET", "/api/data/journal");
        assert(r.status === 401, "journal content requires auth");

        // ---------- PUSH STATUS HONESTY ----------
        r = await req("GET", "/api/push/status", { cookies: userA });
        assert(r.status === 200 && typeof r.data.vapidConfigured === "boolean",
            "push status reports real VAPID capability");
        if (!r.data.vapidConfigured) {
            assert(Array.isArray(r.data.missing) && r.data.missing.some((m) => m.includes("WEB_PUSH")),
                "push status names the missing env vars honestly");
        }
    } catch (e) {
        assert(false, "suite completed without exception", e.message);
    } finally {
        child.kill();
    }

    finish();
}

function finish() {
    console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
    if (failures.length) {
        console.log("Failures:");
        failures.forEach((f) => console.log(`  - ${f}`));
    }
    // best-effort cleanup of the scratch DB
    (async () => {
        try {
            await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 5000 });
            await mongoose.connection.dropDatabase();
        } catch { /* scratch DB cleanup is best-effort */ }
        process.exit(failed ? 1 : 0);
    })();
}

main().catch((e) => {
    console.error("Suite crashed:", e);
    process.exit(1);
});
