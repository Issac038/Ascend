const fs = require('fs');
const path = require('path');

const baselinePath = path.join(__dirname, 'routes', 'baseline.js');
let s = fs.readFileSync(baselinePath, 'utf8');

// Express 5 router mounted at /api/baseline: inner routes must carry the full
// /api prefix to match the incoming /api/baseline/* path.
s = s.replace(/router\.get\("\/"\s*,\s*auth/, 'router.get("/api", auth');
s = s.replace(/router\.post\("\/assess"/, 'router.post("/api/assess"');
s = s.replace(/router\.post\("\/confirm"/, 'router.post("/api/confirm"');

fs.writeFileSync(baselinePath, s);
console.log('patched routes/baseline.js');
