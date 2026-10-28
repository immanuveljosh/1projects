# Cloudflare Quick Tunnel Setup & Verification (`CLOUDFLARE_SETUP.md`)

**Project:** Nithra Chat (`D:\1projects\officechat`)  
**Cloudflare Account Email:** `immanuvel@bharath.ac.in`  
**Tunnel Mode:** Free Cloudflare Quick Tunnel (`https://*.trycloudflare.com` — no domain purchase, static IP, or paid hosting required)  
**Last Verified:** 2026-10-28

---

## 1. Active Quick Tunnel URL & Named Tunnel Status

- **Verified Public HTTPS URL (Free Quick Tunnel):** `https://creations-nvidia-reno-released.trycloudflare.com`
- **Admin Console URL:** `https://creations-nvidia-reno-released.trycloudflare.com/admin`
- **Permanent Auto-Discovery Feed:** `https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h`
- **Static Redirect Page (for `nithra-chat.pntr.dev`):** [redirect-page/index.html](file:///D:/1projects/officechat/redirect-page/index.html)
- **Local Origin Service:** `http://caddy:80` (inside `officechat-edge` Docker network) / `http://127.0.0.1:80` (on Windows 11 host)
- **Quick Tunnel Connector Container:** `officechat-cloudflared` (`cloudflare/cloudflared:latest`, QUIC protocol)
- **Named Tunnel Connector Container (Dashboard):** `officechat-cloudflared-named`
  - **Tunnel Name:** `Nithra chats`
  - **Tunnel ID:** `dfe11faa-fe39-41a6-9531-0bcbcd91114c`
  - **Dashboard Status:** `Healthy` (1 active replica, connected to `maa01`, `maa05`, `bom08`, `bom11`)
  - **Route Target (if adding a custom domain route in Dashboard):** `http://caddy:80`

> **Important Note:** Because Cloudflare Quick Tunnel is a free, domain-less service, `officechat-cloudflared` provides your immediate `https://*.trycloudflare.com` URL without requiring a purchased domain, while `officechat-cloudflared-named` connects your **Nithra chats** tunnel in the Cloudflare Dashboard (`Networking → Tunnels`). Whenever the Quick Tunnel URL changes, `officechat-api` automatically detects and publishes the new URL so open website tabs reconnect automatically (see [WEBSITE_AUTO_URL_UPDATE.md](file:///D:/1projects/officechat/WEBSITE_AUTO_URL_UPDATE.md)).

---

## 2. Architecture & Port Security

```text
Internet Browsers (HTTPS / WSS)
        │
        ▼  TLS 1.3 (Cloudflare Edge — Free Quick Tunnel)
https://supported-grid-permitted-organized.trycloudflare.com
        │
        ▼  Outbound-Only QUIC Tunnel (No router port forwarding)
officechat-cloudflared (Docker `officechat-edge` network)
        │
        ▼  http://caddy:80
officechat-caddy (127.0.0.1:80 / 127.0.0.1:443 on Windows host)
   ├── /                   ──► officechat-web:8080   (React SPA via Nginx unprivileged)
   ├── /api/v1/ws, /ws     ──► officechat-api:8080   (Go WebSocket Hub)
   ├── /api/*              ──► officechat-api:8080   (Go REST API + Authenticated File Sharing)
   └── /storage/*          ──► officechat-minio:9000 (Isolated `officechat-internal` network)
```

### Verified Port Isolation (`docker ps`)
| Container | Status | Host Port Binding | Public Internet / LAN Exposure |
|---|---|---|---|
| `officechat-cloudflared` | `Up (healthy)` | *None* | Outbound-only tunnel to Cloudflare Edge |
| `officechat-caddy` | `Up (healthy)` | `127.0.0.1:80`, `127.0.0.1:443` | Loopback only (`127.0.0.1`); inaccessible from LAN/WAN |
| `officechat-web` | `Up (healthy)` | *None* (`8080/tcp` internal) | Protected behind Caddy |
| `officechat-api` | `Up (healthy)` | *None* (`8080/tcp` internal) | Protected behind Caddy |
| `officechat-postgres` | `Up (healthy)` | *None* (`5432/tcp` internal) | Strictly isolated (`officechat-internal` network) |
| `officechat-redis` | `Up (healthy)` | *None* (`6379/tcp` internal) | Strictly isolated (`officechat-internal` network) |
| `officechat-minio` | `Up (healthy)` | *None* (`9000/tcp` internal) | Strictly isolated (`officechat-internal` network) |

---

## 3. Configuration Files Inspected & Updated

1. **[deploy/docker-compose.prod.yml](file:///D:/1projects/officechat/deploy/docker-compose.prod.yml)**:
   - Configures `officechat-cloudflared` with `command: tunnel --no-autoupdate --metrics 0.0.0.0:2000 --url http://caddy:80` and `restart: unless-stopped`.
   - Allows `https://*.trycloudflare.com` in `CORS_ALLOWED_ORIGINS`.
   - Binds Caddy strictly to `127.0.0.1`.
2. **[deploy/Caddyfile](file:///D:/1projects/officechat/deploy/Caddyfile)**:
   - Serves `http://:80` with `auto_https disable_redirects` so `*.trycloudflare.com` requests from `cloudflared` do not loop on HTTP->HTTPS redirects while still applying HSTS, CSP, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.
   - Forwards `CF-Connecting-IP` and `X-Forwarded-Proto` to the Go backend.
3. **[deploy/scripts/start-quick-tunnel.ps1](file:///D:/1projects/officechat/deploy/scripts/start-quick-tunnel.ps1)**:
   - PowerShell automation script to start, stop, restart, inspect the active URL from tunnel logs, and verify local + public endpoints.
4. **[.gitignore](file:///D:/1projects/officechat/.gitignore)**:
   - Excludes all `.env` files, database backups (`deploy/backups/`), and tunnel credentials from Git.

---

## 4. PowerShell Commands (Start, Stop, Verify & Troubleshoot)

```powershell
# 1. Check current tunnel status and display the active https://*.trycloudflare.com URL from logs
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action status

# 2. Verify local Caddy gateway AND public Quick Tunnel HTTPS endpoints
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action verify

# 3. Start the Quick Tunnel (if stopped)
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action start

# 4. Stop the Quick Tunnel cleanly (preserves all application containers and data)
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action stop

# 5. Restart the Quick Tunnel and generate a new *.trycloudflare.com URL
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\start-quick-tunnel.ps1 -Action restart

# 6. View live tunnel or proxy logs for troubleshooting
docker logs -f officechat-cloudflared
docker logs -f officechat-caddy
```

---

## 5. Live Verification Results (`https://supported-grid-permitted-organized.trycloudflare.com`)

- **Local Caddy Healthcheck (`http://127.0.0.1:80/healthz`)**: `HTTP 200 OK` (`ok`)
- **Public Tunnel Healthcheck (`https://supported-grid-permitted-organized.trycloudflare.com/healthz`)**: `HTTP 200 OK` (`ok`)
- **Public React Frontend (`https://supported-grid-permitted-organized.trycloudflare.com/`)**: `HTTP 200 OK`
- **Public Authentication (`POST /api/v1/auth/login`)**: `HTTP 200 OK` (JWT + `HttpOnly; Secure; SameSite=Lax` cookies issued)
- **Public WebSocket Upgrade (`wss://.../api/v1/ws?token=<jwt>`)**: `HTTP 101 Switching Protocols`
- **Public Authenticated File Upload & Download**: `HTTP 201 Created` / `HTTP 200 OK` (`401 Unauthorized` when unauthenticated)

