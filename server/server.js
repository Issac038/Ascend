const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

require("dotenv").config();

const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");
const insightRoutes = require("./routes/insights");
const nutritionRoutes = require("./routes/nutrition");
const gymRoutes = require("./routes/gym");

const app = express();

app.set("trust proxy", 1); // correct client IPs behind reverse proxies (Render/Heroku/nginx)

// ------------------------------------------------------------
// CORS — strict allowlist, no wildcard with credentials.
// CLIENT_URL is a comma-separated list of allowed frontend origins.
// ------------------------------------------------------------
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
const allowAllInDev = process.env.NODE_ENV !== "production";

app.use(cors({
    origin(origin, callback) {
        // Non-browser tools (curl, health checks) send no Origin header — allow.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (allowAllInDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }
        return callback(null, false); // deny silently; no CORS headers -> browser blocks
    },
    credentials: true
}));

// ------------------------------------------------------------
// Security headers
// ------------------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ------------------------------------------------------------
// Rate limiting (per IP)
// ------------------------------------------------------------
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Try again in a few minutes." }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Slow down." }
});

// Rate limiting for the nutrition analysis/search routes. Search now runs
// locally against the bundled USDA corpus (no external API), but these stay
// tighter than the general API limit because they fan out into multi-query
// resolution and gram-engine work.
const nutritionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many nutrition lookups. Slow down a little." }
});

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/nutrition/search", nutritionLimiter);
app.use("/api/nutrition/food", nutritionLimiter);
app.use("/api/nutrition/analyze-photo", nutritionLimiter);
app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/nutrition", nutritionRoutes);
app.use("/api/gym", gymRoutes);
app.use("/api", insightRoutes);

// Health check: safe, no config exposure, DB ping included (no credentials).
app.get("/api/health", async (req, res) => {
    const out = { success: true, message: "ASCEND backend is alive." };
    try {
        await mongoose.connection.db.admin().ping();
        out.database = "connected";
    } catch {
        out.database = mongoose.connection.readyState === 1 ? "connected" : "unavailable";
    }
    res.json(out);
});

// 404 for unknown API routes
app.use("/api", (req, res) => {
    res.status(404).json({ success: false, message: "Not found" });
});

// ------------------------------------------------------------
// Static SPA serving (single-origin deployment).
//
// If client/dist exists, serve the built frontend from this process.
// First-party cookies (no cross-site cookie issues), no CORS complexity,
// and SPA fallback so /dashboard etc. never 404 on refresh.
// To run API-only behind a separate static host instead, delete client/dist
// or set SERVE_STATIC=false. Everything stays env-driven.
// ------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const distDir = path.join(__dirname, "..", "client", "dist");

if (fs.existsSync(distDir) && process.env.SERVE_STATIC !== "false") {
    app.use(express.static(distDir, {
        index: false,
        setHeaders(res, filePath) {
            if (filePath.endsWith("index.html")) {
                res.setHeader("Cache-Control", "no-cache");
            } else if (filePath.endsWith("manifest.webmanifest")) {
                res.setHeader("Content-Type", "application/manifest+json");
            } else if (filePath.endsWith("sw.js") || filePath.endsWith("registerSW.js") ||
                       filePath.endsWith("_redirects")) {
                res.setHeader("Cache-Control", "no-cache");
            } else if (/\.(png|svg|woff2)$/.test(filePath) || /assets\//.test(filePath)) {
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            }
        }
    }));

    // SPA fallback: non-API GETs without a file extension serve index.html
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
        if (path.extname(req.path)) return next();
        res.sendFile(path.join(distDir, "index.html"));
    });
}

// Central error handler — never leak stack traces to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
        console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
        if (process.env.NODE_ENV !== "production") console.error(err.stack);
    }
    res.status(status).json({
        success: false,
        message: status >= 500 && process.env.NODE_ENV === "production"
            ? "Server error"
            : err.message || "Server error"
    });
});

const PORT = Number(process.env.PORT) || 5000;

async function startServer() {
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not set. Copy server/.env.example to server/.env and configure it.");
        }
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        });
        console.log("MongoDB connected");

        app.listen(PORT, () => {
            console.log(`ASCEND server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Startup error:", error.message);
        process.exit(1);
    }
}

startServer();
