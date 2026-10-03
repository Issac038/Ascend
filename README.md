# ASCEND — Become better. Every day.

A personal command center for self-improvement: plan → act → track → reflect → improve → ascend.

ASCEND is a full-stack application (React + Vite frontend, Express + MongoDB backend) for goals, habits, tasks, journaling, analytics, achievements and progression — designed around a strict black/grey/white design system.

## Project layout

```
server/          Express API (Node.js, CommonJS)
  routes/        auth.js · data.js · insights.js · nutrition.js
  models/        Mongoose schemas (User, Habit, Goal, Task, Meal, JournalEntry, …)
  services/      FatSecret nutrition provider + image-recognition abstraction
  utils/         scoring engine, XP/levels, achievements, goal progress, date helpers, mailer
  test/          self-contained API test suite
client/          React 19 + Vite frontend (ESM)
  src/components page modules (dashboard, today, habits, goals, journal, …)
  src/store      global app store (auth, dashboard cache, settings)
.freebuff/       preview/run tooling
```

## Development setup

**Prerequisites:** Node.js 20+, a MongoDB database (local or hosted — e.g. MongoDB Atlas).

```bash
# 1. Backend
cd server
npm install
cp .env.example .env          # then fill in MONGO_URI + JWT_SECRET (see .env.example)
npm run dev                   # API on http://localhost:5000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev                   # http://localhost:5173 (proxies /api -> :5000)
```

Optional (development only): `POST /api/data/seed-demo` generates 45 days of
realistic demo data for the logged-in user. This endpoint does not exist in
production (`NODE_ENV=production`).

## Testing

```bash
cd server
npm test
```

`npm test` runs four suites:

1. **Scoring unit tests** (`test/scoring.test.js`) — pure functions, **no
   database needed**. Covers the day-score matrix (boolean/numeric habits,
   the `habitsDone <= habitsScheduled` invariant, weekly-target evaluation,
   XP tiers, level boundaries).
2. **Nutrition service tests** (`test/nutrition.test.js`) — FatSecret OAuth2
   + search/details against a **mocked HTTP layer** (no network, no live API).
   Covers token caching, request shapes, response normalization, error
   mapping (429 → RATE_LIMITED, auth failure → PROVIDER_AUTH), and the
   honest Premier-required states for photo/barcode.
3. **API test suite** (`test/run-tests.js`) — spawns a throwaway backend on
   port 4590 against a **dedicated test database**, drives the real HTTP API
   (auth, ownership isolation, XP idempotency, recurrence dedup, validation,
   destructive-op gates), then drops the scratch DB.
4. **Nutrition API tests** (`test/nutrition-api.test.js`) — meal CRUD,
   ownership isolation, server-side totals recalculation (client-sent totals
   are ignored), validation, and safe provider-failure states, on its own
   scratch DB (port 4591).

### Test database configuration (never production)

The API suite refuses to run without an explicit test database:

```bash
# Option A — dedicated test DB (recommended):
TEST_MONGO_URI=mongodb://localhost:27017/ascend_test npm test

# Option B — reuse a dev/qa cluster; tests swap the database NAME to
# ascend_test_<timestamp> so the database in MONGO_URI is never touched:
MONGO_URI=mongodb+srv://devuser:***@dev-cluster.example.net/devdb npm test
```

Guard rails: URIs whose database is `admin`/`local`/`config`/`production`/
`prod` are refused outright, and the resolved test URI is additionally
checked against a production-name pattern before anything starts.

CI note: the suite needs a reachable MongoDB. Local dev can use the Docker
image (`docker run -d -p 27017:27017 mongo:7`); hosted CI can use a service
container exposing `MONGO_URI`/`TEST_MONGO_URI`.

## Deployment

### 1. Backend

Build/run from source — no build step needed for the API:

```bash
cd server
npm ci --omit=dev
NODE_ENV=production npm start
```

Required environment variables (see `server/.env.example`):

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection string (use a hosted cluster + strong credentials) |
| `JWT_SECRET` | Long random string signing session JWTs (≥ 48 random bytes) |
| `CLIENT_URL` | Comma-separated CORS allowlist of frontend origins, e.g. `https://ascend.example.com` |
| `NODE_ENV` | `production` — enables Secure/SameSite=None cookies, strict CORS, safe error messages |
| `PORT` | Port the API listens on |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Optional. Password-reset emails. **Without SMTP, password reset is disabled** (codes are logged server-side only, never returned to clients) |
| `INVITE_CODE` | Optional. If set, registration is invite-only — the signup form requires this code. Recommended for private personal deployments |
| `SERVE_STATIC` | Optional. Set to `false` to force API-only mode even when `client/dist` exists |
| `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET` | FatSecret Platform API credentials — power the Nutrition food search. Server-side only; never exposed to the frontend |
| `NUTRITION_PHOTO_ENABLED` / `NUTRITION_BARCODE_ENABLED` | Optional. Set to `true` ONLY if your FatSecret key is **Premier** (Image Recognition & Barcode Scanning are Premier-exclusive) or a vision provider is wired into `server/services/imageRecognitionService.js`. Leave unset for honest "unavailable" states |

## Nutrition feature

Powered by the [FatSecret Platform API](https://platform.fatsecret.com/docs) (server-side only).

**To configure:** register at platform.fatsecret.com, create an app, copy the Client ID + Secret into `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET`, and (for production) allowlist your server's outbound IP in the FatSecret app settings — OAuth 2.0 tokens can only be requested from IPs you register there.

| Capability | Status with a free/basic key | Notes |
| --- | --- | --- |
| Food search (`foods.search`) | ✅ IMPLEMENTED | Covers generic, brand, restaurant and packaged foods — Indian, continental, international |
| Food details + servings (`food.get.v4`) | ✅ IMPLEMENTED | Every serving listed; quantity + grams selection; live nutrition preview |
| Meal CRUD + daily totals | ✅ IMPLEMENTED | Totals recalculated server-side; date navigation; per-meal editing |
| Calorie target | ✅ IMPLEMENTED | Optional, user-defined (Settings → Nutrition). Not auto-prescribed, not medical advice |
| Photo meal scanner | ⚠️ SUPPORTED BUT REQUIRES PROVIDER ACCESS | FatSecret Image Recognition is **Premier-exclusive**. UI shows an honest unavailable state; a provider plugs into `services/imageRecognitionService.js` without UI changes |
| Barcode lookup | ⚠️ SUPPORTED BUT REQUIRES PROVIDER ACCESS | FatSecret Barcode Scanning is **Premier-exclusive**. Manual nutrition-facts entry is the always-available fallback |

Note on data retention: FatSecret's terms allow caching food **IDs** indefinitely but other data at most 24 h — ASCEND therefore fetches nutrient data live at meal-selection time and stores only what you log in your own meal records.

Security behavior driven by `NODE_ENV`:

- Cookies: `httpOnly`, `Secure`, `SameSite=None` in production (works for
  split-domain deployments; use `SameSite=Lax` if you serve the frontend from
  the same domain and prefer it).
- CORS: explicit allowlist from `CLIENT_URL` — no wildcard with credentials.
- Rate limiting: strict limits on login/register/forgot/reset, general limit
  on `/api`.
- Security headers via Helmet; CSP enabled in production.
- Dev-only demo-data endpoint is not registered in production.

### 2. Frontend

```bash
cd client
npm ci
VITE_API_URL=https://api.example.com/api npm run build   # or set it in client/.env.production
```

- Deploy the `client/dist` folder to any static host / CDN.
- `VITE_API_URL` **must** point at the real API origin — there is no hardcoded
  localhost fallback in the bundle. (If you host the frontend on the same
  origin as the API behind one reverse proxy, you may leave `VITE_API_URL`
  empty so the client calls the relative `/api` path.)
- Everything prefixed `VITE_` is public; never put secrets in client env files.

### 3. SPA fallback (client-side routing)

ASCEND uses React Router with `BrowserRouter`, so the static host must serve
`index.html` for every non-asset route (`/dashboard`, `/analytics`, …).
Configuration for the common options is included:

- **Netlify / Cloudflare Pages / others reading `_redirects`:**
  `client/public/_redirects` is copied into `dist/` by the build —
  `/*  /index.html  200`.
- **Vercel:** `client/vercel.json` rewrites all non-asset paths to
  `/index.html`.
- **nginx:** `try_files $uri $uri/ /index.html;` inside your site block.
- **Express serving the built frontend (single-origin — built in):** the backend
  automatically serves `client/dist` when the folder exists, with an SPA
  fallback and correct cache/MIME headers (`manifest.webmanifest` gets the
  right content type; `sw.js` is never cached). One process, one origin,
  first-party cookies — the simplest private deployment. Set `SERVE_STATIC=false`
  to disable.

Refreshing `https://example.com/dashboard` must never 404.

### 3. Reverse proxy notes

- Terminate TLS at the proxy; forward `X-Forwarded-For` (the backend sets
  `trust proxy = 1` so rate limiting sees real client IPs).
- If the frontend and API are on different subdomains, CORS allowlist +
  `SameSite=None; Secure` cookies are required (already the production
  defaults).

## iPhone / PWA

Ascend is an installable PWA tuned for iPhone (Dynamic Island / safe areas,
bottom-sheet modals, 44px touch targets, no iOS input zoom):

1. Build the frontend (`npm run build` in `client/`) — the service worker and
   `manifest.webmanifest` are generated automatically (`vite-plugin-pwa`).
2. Serve it over **HTTPS** (required for install + service worker).
3. On iPhone Safari: **Share → Add to Home Screen** → "Ascend". Launching from
   the icon runs standalone (no browser UI) with safe-area-aware layout.

Icon set lives in `client/public/icons/` + `client/public/apple-touch-icon.png`,
regenerated via `node scripts/generate-icons.mjs` (no dependencies needed).

Offline behavior: the app shell (HTML/JS/CSS/icons) is precached; **API
responses are never cached** (`/api/` is excluded from the service worker), so
private data always comes fresh from the network. Offline, the installed app
opens to its shell instead of a blank page.

## Security notes

- Passwords: bcrypt (cost 12). Password reset: 6-digit code generated with
  `crypto.randomInt`, stored as SHA-256 hash, single-use, 15-minute expiry,
  delivered by email only.
- All user-scoped queries include `userId` — cross-user access is impossible
  at the route level (covered by tests).
- Reset/confirm endpoints require explicit confirmation payloads.
- `.env` files are git-ignored; `.env.example` documents variable names only.
  **If any real secret was ever committed or shared, rotate it** (JWT_SECRET,
  MongoDB credentials, SMTP credentials).

## Scripts

| Location | Command | Purpose |
| --- | --- | --- |
| `server/` | `npm run dev` | Start API (development) |
| `server/` | `npm start` | Start API (production) |
| `server/` | `npm test` | Scoring unit tests + API suite (dedicated test DB, port 4590) |
| `server/` | `npm run test:scoring` | Scoring unit tests only (no DB required) |
| `server/` | `npm run test:api` | API suite only (requires `TEST_MONGO_URI` or dev `MONGO_URI`) |
| `client/` | `npm run dev` | Vite dev server with /api proxy |
| `client/` | `npm run build` | Production frontend build |
| `client/` | `npm run lint` | ESLint |


# Test Account 

Email - sam123@example.com

Password - password123
