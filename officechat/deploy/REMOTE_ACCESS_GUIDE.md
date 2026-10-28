# OfficeChat Secure Remote Access Runbook (Cloudflare Tunnel + Caddy + Docker)

This guide explains how OfficeChat is securely exposed from a Windows 11 host to multiple remote office locations using **Cloudflare Tunnel (Free Plan)**, **Caddy 2**, and **Docker Compose**.

---

## 1. Architecture & Port Security Overview

```text
Remote Office Browsers (HTTPS + WSS)
        │
        ▼  (TLS 1.3 / Universal SSL + DDoS Protection)
Cloudflare Edge Network (https://chat.<your-domain>)
        │
        ▼  (Outbound-only Encrypted Tunnel — No Router Port Forwarding)
officechat-cloudflared (Docker `officechat-edge` network)
        │
        ▼  http://caddy:80 (Internal Docker Bridge)
officechat-caddy (Single Reverse Proxy Entry Point)
   ├── /                   ──► officechat-web:8080   (Nginx Unprivileged SPA)
   ├── /api/v1/ws, /ws     ──► officechat-api:8080   (Go WebSocket Hub)
   ├── /api/*              ──► officechat-api:8080   (Go REST API + File Upload/Download)
   └── /storage/*          ──► officechat-minio:9000 (Internal Network Only)
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        officechat-postgres   officechat-redis    officechat-minio
         (:5432 internal)     (:6379 internal)    (:9000 internal)
```

### Why This Keeps Internal Services Protected
- **Zero Public Ports**: PostgreSQL (`5432`), Redis (`6379`), MinIO (`9000`/`9001`), and the Go API (`8080`) have **no host port mappings** in `deploy/docker-compose.prod.yml` and reside on the `officechat-internal` network (`internal: true`).
- **Loopback-Only Host Binding**: Caddy binds to `127.0.0.1:80` and `127.0.0.1:443` (`CADDY_BIND_IP=127.0.0.1`), preventing direct LAN or public IP connections bypassing Cloudflare Tunnel.
- **Single Origin Target**: `cloudflared` forwards traffic exclusively to `http://caddy:80` inside the `officechat-edge` Docker network.

---

## 2. Prerequisite: Registered Domain Name & Cloudflare Account

A **stable published HTTPS hostname** on Cloudflare Tunnel (e.g., `https://chat.yourcompany.com`) **requires a registered domain name** managed by Cloudflare DNS (Cloudflare's temporary `*.trycloudflare.com` Quick Tunnels generate random URLs that change on every restart and have no SLA).

### Step 2.1 — If You Do Not Own a Domain Yet
1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. You can register a domain at wholesale cost directly in **Cloudflare Registrar** (*Domain Registration -> Register Domains*, typically ~$9–$12/year for `.com`, `.net`, or `.org`), or use an existing domain from any registrar (Namecheap, Porkbun, GoDaddy, etc.).
   - *Free subdomain alternative (if eligible)*: Services such as **eu.org** or **GitHub Student Developer Pack** (Namecheap/Name.com free 1-year domain) support custom Cloudflare nameservers. Note that dynamic DNS providers like DuckDNS do **not** allow delegating apex nameservers to Cloudflare.

### Step 2.2 — Connect Your Domain to Cloudflare (Free Plan)
1. In the Cloudflare Dashboard, click **Add a domain**, enter your domain (e.g., `yourcompany.com`), and select the **Free ($0/month)** plan.
2. Cloudflare will display two assigned nameservers (e.g., `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`).
3. Log in to your domain registrar and replace the domain's existing nameservers with the two Cloudflare nameservers (跳过 this step if registered directly through Cloudflare Registrar).
4. In Cloudflare Dashboard -> **SSL/TLS -> Overview**, set encryption mode to **Full**.
5. In **Network**, verify that **WebSockets** is toggled **ON** (enabled by default on the Free plan).

---

## 3. Create the Cloudflare Tunnel & Route the Hostname

1. Open the **Cloudflare Zero Trust Dashboard**: https://one.dash.cloudflare.com/
   - If prompted to choose a plan, select the **Free Zero Trust Plan ($0/month for up to 50 users)**.
2. Navigate to **Networks -> Tunnels** and click **Create a tunnel**.
3. Select **Cloudflared** as the connector type and click **Next**.
4. Name the tunnel `officechat-laptop` and click **Save tunnel**.
5. Copy the **Tunnel Token** (the long `eyJhIjoi...` string shown in the install command). **Never commit this token to Git.**
6. Click **Next** to configure the **Public Hostname**:
   - **Subdomain**: `chat`
   - **Domain**: Select your domain (e.g., `yourcompany.com`) -> results in `https://chat.yourcompany.com`
   - **Path**: *(leave blank so all paths `/`, `/api/*`, `/api/v1/ws`, `/storage/*` are routed)*
   - **Service Type**: `HTTP`
   - **URL**: `caddy:80`
7. Expand **Additional application settings -> HTTP Settings**:
   - Leave **Disable Chunked Encoding** off (WebSockets and 25 MB file uploads work natively).
8. Click **Save tunnel**.

---

## 4. Configure `deploy/.env` on Your Windows 11 Laptop

Open `D:\1projects\officechat\deploy\.env` and set your domain and tunnel token:

```dotenv
DOMAIN=chat.yourcompany.com
ADMIN_DOMAIN=admin.yourcompany.com
TLS_MODE=internal
CADDY_BIND_IP=127.0.0.1
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...paste_your_token_here...
```

---

## 5. PowerShell Commands for Setup, Startup, Stopping & Troubleshooting

Run all commands from an elevated or standard **Windows PowerShell** window:

```powershell
# 1. Initialize deploy/.env (if not already present)
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action init-env

# 2. Build and start the entire hardened production stack + Cloudflare Tunnel
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action start

# 3. Check container health and verify no internal ports are exposed publicly
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action status

# 4. Run automated health, security header, and public HTTPS checks
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action verify -Domain "chat.yourcompany.com"

# 5. View live logs from Caddy, Go API, and Cloudflare Tunnel
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action logs

# 6. Stop the stack cleanly
powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action stop
```

---

## 6. Automatic Reconnection & Laptop Restart Recovery

1. **Docker Desktop Auto-Start on Windows 11**:
   - Open **Docker Desktop -> Settings -> General** and enable **"Start Docker Desktop when you sign in to your computer"**.
2. **Prevent Windows 11 Sleep While Hosting**:
   ```powershell
   # Prevent laptop from sleeping when plugged into AC power
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```
3. **Container Auto-Restart**:
   - Every service in `deploy/docker-compose.prod.yml` (`caddy`, `web`, `api`, `postgres`, `redis`, `minio`, and `cloudflared`) is configured with `restart: unless-stopped`.
   - When the Windows 11 laptop reboots or Wi-Fi/ISP connectivity drops and recovers, `officechat-cloudflared` automatically re-establishes 4 redundant QUIC/HTTP2 connections to the nearest Cloudflare edge data centers without manual intervention.
4. **Manual Recovery Command (if Docker Desktop was stopped)**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\1projects\officechat\deploy\scripts\manage-remote-access.ps1 -Action restart
   ```
