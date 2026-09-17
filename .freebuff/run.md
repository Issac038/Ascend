# Run doc — ASCEND preview

This workspace IS the main checkout (`C:\Users\isaac\OneDrive\Desktop\Kalvium\ascend`), so no env copying between checkouts is needed.

## Reproduce artifacts

1. Copy `server/.env` if missing (already present here; contains PORT, MONGO_URI — Atlas, CLIENT_URL). Never commit or paste its values.
2. Install dependencies if missing:
   - `cd server && npm install`
   - `cd client && npm install`
3. MongoDB: no local instance required — `MONGO_URI` in `server/.env` points at a hosted Atlas cluster.

## Run the servers

1. **Backend (API, port 5000)** — start only if nothing is already listening on :5000 (`netstat -ano | grep ":5000" | grep LISTENING`):
   ```
   powershell -NoProfile -Command "(Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory 'C:\Users\isaac\OneDrive\Desktop\Kalvium\ascend\server' -RedirectStandardOutput '.freebuff\backend.log' -RedirectStandardError '.freebuff\backend.log.err' -WindowStyle Hidden -PassThru).Id"
   ```
   Health check: `curl http://localhost:5000/api/health` → `{"success":true,...}`

2. **Client (Vite, port 5173, strictPort)**:
   ```
   powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--port','5173','--strictPort' -WorkingDirectory 'C:\Users\isaac\OneDrive\Desktop\Kalvium\ascend\client' -RedirectStandardOutput '.freebuff\preview.log' -RedirectStandardError '.freebuff\preview.log.err' -WindowStyle Hidden -PassThru).Id"
   ```
   Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` returns 200 (Vite needs ~6s cold start), then register the preview with the printed pid.

Notes:
- stdout and stderr must go to DIFFERENT files (PowerShell `Start-Process` requirement).
- If :5173 is taken, pick a free port and pass it via `--port` (keep `--strictPort`); the client's API base points at `:5000` regardless.
- Check survival a few seconds later: `powershell -NoProfile -Command "Get-Process -Id <pid>"`.
