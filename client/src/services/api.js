import axios from "axios";

// API base URL:
// - production: set VITE_API_URL at build time (e.g. https://api.example.com/api)
// - development: leave it empty — "/api" is proxied to the backend by Vite
//   (see vite.config.js). There is NO hardcoded localhost fallback here.
const rawBaseUrl = import.meta.env.VITE_API_URL || "/api";

const api = axios.create({
    baseURL: rawBaseUrl.replace(/\/$/, ""),
    withCredentials: true
});

export default api;
