# OfficeChat Website — Automatic Cloudflare Quick Tunnel URL Updates

**Project Path:** `D:\1projects\officechat`  
**Scope:** Web Frontend (`web/`) & Go Backend (`backend/`) only — Mobile & Desktop EXE code untouched  
**Current Active Quick Tunnel URL:** `https://creations-nvidia-reno-released.trycloudflare.com`  
**Permanent Free Discovery Endpoint:** `https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h`  
**Static Redirect Page (`nithra-chat.pntr.dev`):** [redirect-page/index.html](file:///D:/1projects/officechat/redirect-page/index.html)

---

## 1. Architecture Overview

Cloudflare Free Quick Tunnels (`https://*.trycloudflare.com`) generate a new random subdomain every time the `officechat-cloudflared` container restarts. To prevent open OfficeChat browser tabs from permanently losing connectivity when the tunnel URL rotates, OfficeChat implements an automated 4-stage pipeline:

1. **Automatic URL Detection (`backend/internal/tunnel/watcher.go`)**
   - Inside the isolated `officechat-edge` Docker network, `officechat-api` polls `http://cloudflared:2000/metrics` every **5 seconds**.
   - It parses the Prometheus metric `cloudflared_tunnel_user_hostnames_counts{userHostname="https://*.trycloudflare.com"}` to identify the active Quick Tunnel URL immediately upon startup or tunnel restart.

2. **Change Detection & Permanent Publishing (`backend/internal/tunnel/watcher.go`)**
   - Whenever the active Quick Tunnel URL changes (or every 30 minutes to keep the cache warm), the backend publishes a signed-free public configuration payload (`server_url`, `ws_url`, `discovery_url`, `status`, `updated_at`) to:
     - **Primary Zero-Setup Permanent Endpoint (`ntfy.sh`)**: `https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h` (100% free, requires no account or secret token, supports browser CORS `Access-Control-Allow-Origin: *`, and caches messages for 12 hours).
     - **Optional GitHub Gist Endpoint**: If `GITHUB_GIST_ID` and `GITHUB_GIST_TOKEN` are configured in `deploy/.env`, the watcher also updates `tunnel-config.json` inside that GitHub Gist via `PATCH https://api.github.com/gists/<GITHUB_GIST_ID>`.
     - **Local/Tunnel API Endpoint**: `GET /api/v1/tunnel-config` and WebSocket broadcast event `tunnel.url_updated`.

3. **Dynamic Cross-Origin Allowance (`backend/cmd/api/main.go`)**
   - The Go API CORS middleware dynamically permits any `https://*.trycloudflare.com` origin (`AllowOriginFunc`).
   - This allows an already-open browser tab loaded from an **old** `https://old-subdomain.trycloudflare.com` URL to seamlessly issue `fetch()` REST requests and open `wss://new-subdomain.trycloudflare.com/api/v1/ws` WebSocket connections to the **new** Quick Tunnel URL without CORS errors or requiring a page reinstall.

4. **Website Auto-Discovery, Token Refresh & Reconnection (`web/src/features/chat/chatApi.ts` & `web/src/App.tsx`)**
   - If any REST API request (`chatApi.ts` or `adminApi.ts`) encounters a network error or Cloudflare dead-tunnel status (`502`, `503`, `530`), the client automatically queries the permanent discovery endpoint (`https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h`), updates the active server base URL in `localStorage` (`officechat_active_server_url`), and retries the request transparently.
   - When the WebSocket connection (`/api/v1/ws`) drops, `App.tsx` automatically queries the permanent discovery endpoint for the new `*.trycloudflare.com` URL, refreshes the user's 15-minute JWT access token if needed (`chatApi.getMe()`), and reconnects `wss://` to the new tunnel URL automatically.
   - The top header displays a live **Connected / Updating Tunnel URL... / Reconnecting... / Offline • Retry** badge, and a status banner with a **Retry Now** button appears in the chat stream whenever the connection is recovering.

---

## 2. Optional GitHub Gist Setup (If Desired)

The default `ntfy.sh` permanent discovery endpoint works automatically with **zero configuration or tokens**. If you also want the backend to publish the tunnel URL to a personal GitHub Gist:

1. Sign in to GitHub and create a **Public Gist** at `https://gist.github.com` containing a file named `tunnel-config.json` with `{}`.
2. Copy the **Gist ID** from the Gist URL (`https://gist.github.com/<username>/<GIST_ID>`).
3. In GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**, generate a token with **Gists (Read and Write)** permission only.
4. Add the following two lines to `D:\1projects\officechat\deploy\.env` (never commit `.env` to Git):
   ```env
   GITHUB_GIST_ID=your_gist_id_here
   GITHUB_GIST_TOKEN=your_github_pat_here
   ```
5. Optionally set `VITE_TUNNEL_GIST_RAW_URL=https://gist.githubusercontent.com/<username>/<GIST_ID>/raw/tunnel-config.json` in `web/.env.production` if you want the frontend to check the Gist before `ntfy.sh`.

---

## 3. Live Tunnel Rotation Verification Results

Verified on **2026-10-28** using automated end-to-end tunnel rotation test (`test_tunnel_auto_update.mjs`):

| Test Step | Observed Result | Status |
| :--- | :--- | :---: |
| **1. Initial Quick Tunnel Detection (`URL_1`)** | Backend detected `https://managing-commentary-sense-trainer.trycloudflare.com` from `http://cloudflared:2000/metrics` and published to permanent endpoint | **PASS** |
| **2. Initial User Login on `URL_1`** | `POST /api/v1/auth/login` succeeded over `URL_1` | **PASS** |
| **3. Force Quick Tunnel URL Rotation** | Recreated `officechat-cloudflared`; Cloudflare assigned new URL `https://clothes-rapids-ceramic-requirements.trycloudflare.com` (`URL_2`) | **PASS** |
| **4. Automatic Change Detection & Publish** | Backend watcher detected `URL_2` and published to `https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h` in **10.4 seconds** | **PASS** |
| **5. Website Client Failover (`URL_1` → `URL_2`)** | Client with `Origin: https://managing-commentary-sense-trainer.trycloudflare.com` discovered `URL_2` from permanent endpoint and called `GET URL_2/api/v1/auth/me` (`HTTP 200`, CORS `Access-Control-Allow-Origin` verified) | **PASS** |
| **6. WebSocket Auto-Reconnection (`URL_2`)** | Client connected WebSocket to `wss://clothes-rapids-ceramic-requirements.trycloudflare.com/api/v1/ws` without page reload or reinstall | **PASS** |

---

## 4. Operational Commands

Check current tunnel status and auto-discovery payload:
```powershell
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action status
```

Verify both local Caddy and public Quick Tunnel endpoints:
```powershell
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action verify
```

Query the permanent configuration endpoint directly from any device:
```powershell
curl.exe -s "https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h"
```

---

## 5. Known Limitations of Cloudflare Quick Tunnels

1. **Already-Open Browser Tabs vs. Fresh Bookmarks**:
   - **Already-open tabs** (or tabs loaded locally) automatically fetch the new `https://*.trycloudflare.com` URL from the permanent discovery endpoint (`ntfy.sh`) and reconnect all API and WebSocket traffic in the background without losing session state.
   - However, if a user **closes their browser completely** and later clicks an **old bookmark** (`https://old-dead-url.trycloudflare.com`) after the tunnel has changed, the browser's initial HTML navigation goes directly to Cloudflare's unregistered subdomain error page (`Error 1033 / 530`) before any JavaScript can run.
   - **Workaround without a paid domain**: Share the permanent discovery link or host a free static redirect page (e.g. GitHub Pages / Cloudflare Pages free tier) that fetches `https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h` and redirects `window.location.href` to `server_url`.
2. **Cloudflare Quick Tunnel Rate Limits**:
   - Free Quick Tunnels (`trycloudflare.com`) are intended for development and controlled pilots (~50 concurrent users) and have no uptime SLA from Cloudflare.

