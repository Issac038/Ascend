
# ASCEND

ASCEND is a project I'm building to keep my day-to-day goals and progress in one place. I wanted something where I could manage habits, plan tasks, track nutrition, write journal entries and see how I'm doing without jumping between different apps.

It's built using React, Vite, Node.js, Express and MongoDB. The UI uses a black, grey and white colour scheme.

## Live Demo

You can check out the deployed version of ASCEND here:

[https://ascend-41lf.onrender.com/dashboard](https://ascend-41lf.onrender.com/dashboard)

## Project Structure

```text
server/          Express API (Node.js, CommonJS)
  routes/        auth.js · data.js · insights.js · nutrition.js
  models/        Mongoose schemas (User, Habit, Goal, Task, Meal, JournalEntry, …)
  services/      FatSecret nutrition provider + image-recognition abstraction
  utils/         scoring engine, XP/levels, achievements, goal progress, date helpers, mailer
  test/          API test suite
client/          React 19 + Vite frontend (ESM)
  src/components page modules (dashboard, today, habits, goals, journal, …)
  src/store      global app store (auth, dashboard cache, settings)
```

## Running the Project Locally

You'll need Node.js 20 or later and a MongoDB database. A local database works, or you can use MongoDB Atlas.

To get the app running, start the backend first and then the frontend in a separate terminal.

```bash
# Backend
cd server
npm install
cp .env.example .env
npm run dev

# Frontend (open a second terminal)
cd client
npm install
npm run dev
```

The backend runs on `http://localhost:5000` and the frontend on `http://localhost:5173`. The frontend proxies API requests to the backend.

If you want some sample data while developing, there's also a `POST /api/data/seed-demo` endpoint. It adds 45 days of demo data to the account you're logged into. It's only available in development and is disabled in production.

## Tests

```bash
cd server
npm test
```

From the `server` folder, run `npm test`. It runs four test suites:

1. **Scoring unit tests** (`test/scoring.test.js`) — pure functions, no database needed. Covers the day-score matrix (boolean/numeric habits, the `habitsDone <= habitsScheduled` invariant, weekly-target evaluation, XP tiers and level boundaries).

2. **Nutrition service tests** (`test/nutrition.test.js`) — FatSecret OAuth2 search/details against a mocked HTTP layer. No network or live API is needed. Covers token caching, request shapes, response normalization, error mapping and the expected Premier-only states for photo/barcode.

3. **API test suite** (`test/run-tests.js`) — starts a temporary backend on port 4590 against a dedicated test database. Tests authentication, ownership isolation, XP idempotency, recurrence deduplication, validation and destructive-operation checks before dropping the test database.

4. **Nutrition API tests** (`test/nutrition-api.test.js`) — tests meal CRUD, ownership isolation, server-side total calculations, validation and provider-failure states using its own test database on port 4591.

There's also `npm run test:baseline` if you want to run the baseline validation, scoring, schema and route tests separately. The route tests use in-memory persistence, so they don't need a live MongoDB connection.

### Test Database

The API tests use a separate database so they don't interfere with your normal data. You need to configure a test database before running them; the tests won't start without one.

```bash
# Option A — dedicated test DB (recommended)
TEST_MONGO_URI=mongodb://localhost:27017/ascend_test npm test

# Option B — reuse a dev/qa cluster; tests create a separate
# ascend_test_<timestamp> database instead of touching your dev database
MONGO_URI=mongodb+srv://devuser:***@dev-cluster.example.net/devdb npm test
```

There are a few safety checks too: database names like `admin`, `local`, `config`, `production` and `prod` are blocked. The final test URI is checked before the tests start.

The tests need to be able to connect to MongoDB. If you're running them locally, you can start MongoDB with Docker:

```bash
docker run -d -p 27017:27017 mongo:7
```

For CI, provide a MongoDB service and set `MONGO_URI` or `TEST_MONGO_URI`.

## Deployment

### Backend

The backend can run directly with Node.js, so there's no separate build command. For a production deployment, install only the production dependencies and start it like this:

```bash
cd server
npm ci --omit=dev
NODE_ENV=production npm start
```

Required environment variables (see `server/.env.example`):

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string. Use a hosted cluster with strong credentials. |
| `JWT_SECRET` | Long random string used to sign session JWTs (at least 48 random bytes). |
| `CLIENT_URL` | Comma-separated list of allowed frontend origins for CORS. |
| `NODE_ENV` | Set to `production` to enable production cookie settings, strict CORS and safer error messages. |
| `PORT` | Port the API listens on. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Optional email settings for password resets. Without SMTP, password reset is disabled. |
| `INVITE_CODE` | Optional. If set, users need the invite code to register. |
| `SERVE_STATIC` | Optional. Set to `false` to run the API without serving the frontend build. |
| `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET` | FatSecret API credentials used for food search. These stay on the backend. |
| `NUTRITION_PHOTO_ENABLED` / `NUTRITION_BARCODE_ENABLED` | Optional. Enable only if you have the required FatSecret Premier access or a vision provider configured. |

#### Starting Baseline

The baseline section has five areas: Body, Discipline, Learning, Productivity and Goal Drive. Body, Discipline, Learning and Productivity are rated from 1 to 10, and the app calculates their scores locally. Goal Drive is just saved as text, so it doesn't affect the score. No external AI service or API key is needed for this.

## Nutrition Tracking

The nutrition section uses the [FatSecret Platform API](https://platform.fatsecret.com/docs) to search for food and get nutrition details. The API credentials are kept on the backend, not in the frontend.

To connect FatSecret, create an app on its platform and add the Client ID and Secret to `FATSECRET_CLIENT_ID` and `FATSECRET_CLIENT_SECRET`. If you're deploying the backend, you'll also need to add its outbound IP to the FatSecret allowlist. Token requests are only accepted from registered IPs.

| Capability | Status with a free/basic key | Notes |
|---|---|---|
| Food search (`foods.search`) | Available | Covers generic, brand, restaurant and packaged foods, including Indian and international options. |
| Food details + servings (`food.get.v4`) | Available | Shows available servings, quantity and grams selection, and a nutrition preview. |
| Meal CRUD + daily totals | Available | Totals are recalculated on the server. Includes date navigation and meal editing. |
| Calorie target | Available | Optional and user-defined under Settings → Nutrition. |
| Photo meal scanner | Needs provider access | FatSecret Image Recognition is Premier-exclusive. |
| Barcode lookup | Needs provider access | FatSecret Barcode Scanning is Premier-exclusive. Manual nutrition-facts entry is available as a fallback. |

**A note about food data:** FatSecret allows food IDs to be stored, but other food information can only be cached for up to 24 hours. Because of that, ASCEND fetches the nutrition details when you select a food and saves the meal details you log.

Some security settings change depending on whether `NODE_ENV` is set to development or production:

- Cookies: `httpOnly`, `Secure`, `SameSite=None` in production.
- CORS: Uses an explicit allowlist from `CLIENT_URL`.
- Rate limiting: Applied to login, registration, password reset and general API requests.
- Security headers: Helmet and Content Security Policy are enabled in production.
- The demo-data endpoint is not registered in production.

### Frontend

```bash
cd client
npm ci
VITE_API_URL=https://api.example.com/api npm run build
```

- Deploy the `client/dist` folder to a static host or CDN.
- `VITE_API_URL` must point to the actual API URL. There is no hardcoded localhost fallback in the production build.
- If the frontend and backend share the same domain, `VITE_API_URL` can be left empty and the client can use the relative `/api` path.
- Variables starting with `VITE_` are exposed to the frontend, so don't put secrets in them.

### Client-Side Routing

ASCEND uses React Router's `BrowserRouter`. This means the hosting provider needs to send `index.html` when a user opens or refreshes a page like `/dashboard` or `/analytics`. Otherwise, those routes can return a 404.

The project already includes configuration for these common hosts:

- **Netlify / Cloudflare Pages:** Uses `client/public/_redirects`.
- **Vercel:** Uses `client/vercel.json`.
- **nginx:** Use `try_files $uri $uri/ /index.html;` inside your site configuration.
- **Express:** The backend can serve the built frontend from `client/dist`, including the SPA fallback.

Once deployed, try opening and refreshing a route like `https://example.com/dashboard` directly. It should take you back into the app, not show a 404 page.

### Reverse Proxy

- Terminate TLS at the proxy and forward `X-Forwarded-For`.
- If the frontend and API are on different subdomains, configure the CORS allowlist and use `SameSite=None; Secure` cookies.

## Using ASCEND on an iPhone

ASCEND can be installed on an iPhone too, like a normal app, using its PWA support. I've included safe-area spacing, bottom-sheet modals and larger touch targets to make the mobile layout easier to use.

1. Build the frontend using `npm run build` inside `client/`.
2. Serve it over HTTPS. This is required for PWA installation and service workers.
3. Open the site in iPhone Safari, tap **Share → Add to Home Screen**, and choose "Ascend".

The app icons are in `client/public/icons/` and `client/public/apple-touch-icon.png`. They can be regenerated using:

```bash
node scripts/generate-icons.mjs
```

The service worker saves the app files (HTML, JavaScript, CSS and icons) so the app shell can still open when you're offline. It doesn't cache `/api/` responses, though, so anything that needs your account data still needs an internet connection.

## Security

- Passwords are hashed using bcrypt (cost 12).
- Password reset codes are generated using `crypto.randomInt`, stored as SHA-256 hashes and expire after 15 minutes. They can only be used once.
- All user-specific database queries include `userId`.
- Reset and confirmation endpoints require explicit confirmation.
- `.env` files are git-ignored. `.env.example` only contains variable names and example values.
- If a real secret was ever committed or shared, rotate it. This includes `JWT_SECRET`, MongoDB credentials and SMTP credentials.

## Scripts

| Location | Command | Purpose |
|---|---|---|
| `server/` | `npm run dev` | Start API in development. |
| `server/` | `npm start` | Start API in production. |
| `server/` | `npm test` | Run scoring tests and API tests. |
| `server/` | `npm run test:scoring` | Run scoring unit tests only. |
| `server/` | `npm run test:api` | Run API tests only. |
| `client/` | `npm run dev` | Start the Vite development server. |
| `client/` | `npm run build` | Build the frontend for production. |
| `client/` | `npm run lint` | Run ESLint. |

## Demo Login

Email: sam123@example.com

Password: `password123`
