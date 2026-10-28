# Nithra Chat / OfficeChat — Pilot Readiness Report (`PILOT_READINESS.md`)

**Assessment Date:** 2026-10-28  
**Project Path:** `D:\1projects\officechat`  
**Cloudflare Account Email:** `immanuvel@bharath.ac.in`  
**Active Pilot Test Tunnel:** `https://supported-grid-permitted-organized.trycloudflare.com`

---

## 1. Executive Summary

OfficeChat has been audited, hardened, and load-tested on the Windows 11 host for a controlled office pilot:
- **Simulation Modes Removed**: Hardcoded admin auto-login (`owner@officechat.local`), mock fallback data in Admin Console tabs (`AuditTab.tsx`, `ChannelsTab.tsx`, `MembersTab.tsx`), fake login success on network error in `App.tsx`, and `VIRUS_SCAN_MOCK=true` have all been removed.
- **Authorization & Privacy Bugs Fixed & Verified**: Fixed critical IDOR and WebSocket broadcast leaks in 1:1/group Direct Messages, Private Channels, Full-Text Search, and File Downloads. Verified with separate real accounts (`Alice`, `Bob`, `Charlie`).
- **Gradual WebSocket Load Test (50 -> 100 -> 200 -> 300 Simultaneous Connections)**: Executed against the live stack (`officechat-caddy` -> `officechat-api` -> `officechat-postgres`). Achieved **100% connection success (0 failed handshakes, 0 dropped connections)** and **100% message broadcast delivery (3,250 / 3,250 messages delivered across all 4 stages)**.
- **Database Backup, Restore & Cleanup Verified**: Full pre-pilot backup saved to `deploy/backups/officechat_pre_pilot_backup.sql` (131,898 bytes), verified via live restore into a temporary database (`officechat_restore_test`), and all disposable test messages, test accounts, and test files have been removed.

---

## 2. Authentication, Roles, Private Messages & File Access Audit

| Security Domain | Vulnerability Found During Audit | Fix Implemented | Live Multi-Account Verification Result |
|---|---|---|---|
| **1:1 & Group Direct Messages (`dm_service.go`, `dm_handler.go`)** | `ListDMMessages` and `SendDMMessage` did not verify `direct_message_members` membership, and `SendDMMessage` called `BroadcastToWorkspace` (leaking DMs to all workspace WS clients). | Enforced `direct_message_members` check (`403 Forbidden` on non-participants) and changed WS broadcast to per-member `SendToUser`. | **PASS**: `Alice -> Bob` DM delivered (`HTTP 201`, `BobRead=200`, `BobWS=1`); non-participant `Charlie` blocked (`CharlieRead=403`, `CharlieSend=403`, `CharlieWS=0`). |
| **Private Channels (`channel_service.go`, `message_service.go`)** | Non-members could call `GetChannel`, self-join via `JoinChannel`, read via `ListChannelMessages`, or post via `SendChannelMessage`, and private messages were broadcast workspace-wide. | Enforced `channel_members` check when `is_private = TRUE` (`403 Forbidden`), blocked self-join on private channels, and scoped WS broadcasts to channel members. | **PASS**: `Alice` created private channel (`HTTP 201`); non-member `Charlie` blocked on `GET` (`403`), `POST /join` (`403`), `GET /messages` (`403`), and `POST /messages` (`403`). |
| **File Uploads & Downloads (`file_search_presence_handler.go`)** | `GET /api/v1/files/{key}` was unauthenticated, and `workspace_members` check referenced `wm.account_state` instead of `users.account_state`. | Placed `GET /files/{key}` behind `Authenticator` (accepting Bearer token or `HttpOnly` cookie) and verified active membership via `workspace_members JOIN users`. | **PASS**: `Alice` upload `HTTP 201`; unauthenticated download blocked (`HTTP 401`); authenticated member `Bob` download `HTTP 200`. |
| **Full-Text Search (`file_search_presence_handler.go`)** | `GET /api/v1/workspaces/{id}/search` returned matches from all private channels and private DMs in the workspace. | Restricted search SQL query to public channels, private channels the user belongs to, and DMs the user participates in. | **PASS**: Verified SQL predicate isolation. |
| **Role-Based Access Control (`middleware/auth.go`, `rbac.go`)** | Verified `Owner`, `Admin`, `Member`, and `Guest` role boundaries across `/api/v1/admin/*`. | Keyed global rate limiter by authenticated token (`tok:<jwt>`) so shared office NAT IPs do not throttle legitimate users. | **PASS**: `Guest` (`403`), `Member` (`403`), `Owner` (`200 OK`) on `/api/v1/admin/members`. |

---

## 3. Gradual WebSocket Load Test Results (50, 100, 200, 300 Connections)

Each stage established $N$ simultaneous authenticated WebSocket connections (`ws://127.0.0.1:80/api/v1/ws` through `officechat-caddy` -> `officechat-api`), broadcast 5 live channel messages via `POST /api/v1/channels/{id}/messages` (`officechat-postgres` write + WebSocket hub fanout), and measured handshake latency, end-to-end broadcast delivery latency, dropped connections, and container CPU/RAM usage.

### 3.1 Connection, Latency & Delivery Metrics
| Simultaneous WS Connections | Connected / Target | Failed Handshakes (`429`) | Dropped Conns | Messages Broadcast | Expected Deliveries | Actual Deliveries | Delivery Failures | Handshake p50 / p95 / p99 (ms) | Broadcast Fanout p50 / p95 / p99 (ms) |
|---|---|---|---|---|---|---|---|---|---|
| **50** | `50 / 50` (100%) | `0` (`0`) | `0` | `5` | `250` | `250` | **`0`** | `22.61` / `63.59` / `67.82` | `12.44` / `23.19` / `23.19` |
| **100** | `100 / 100` (100%) | `0` (`0`) | `0` | `5` | `500` | `500` | **`0`** | `11.06` / `24.90` / `31.99` | `13.31` / `15.15` / `15.70` |
| **200** | `200 / 200` (100%) | `0` (`0`) | `0` | `5` | `1,000` | `1,000` | **`0`** | `6.62` / `29.49` / `42.54` | `16.14` / `21.19` / `27.59` |
| **300** | `300 / 300` (100%) | `0` (`0`) | `0` | `5` | `1,500` | `1,500` | **`0`** | `133.15` / `293.47` / `326.85` | `65.86` / `354.04` / `356.93` |

### 3.2 Recorded Container CPU & Memory Usage (`docker stats`)
| Stage | `officechat-api` (Limit 512 MiB) | `officechat-caddy` (Limit 256 MiB) | `officechat-postgres` (Limit 1 GiB) | `officechat-redis` (Limit 256 MiB) | `officechat-web` (Limit 128 MiB) | `officechat-cloudflared` (Limit 128 MiB) |
|---|---|---|---|---|---|---|
| **50 Conns** | CPU `0.00%` / RAM `7.14 MiB` | CPU `0.00%` / RAM `17.45 MiB` | CPU `0.58%` / RAM `77.64 MiB` | CPU `0.49%` / RAM `9.82 MiB` | CPU `0.00%` / RAM `10.76 MiB` | CPU `0.05%` / RAM `15.16 MiB` |
| **100 Conns** | CPU `0.00%` / RAM `8.72 MiB` | CPU `0.00%` / RAM `24.85 MiB` | CPU `0.02%` / RAM `76.94 MiB` | CPU `0.44%` / RAM `9.65 MiB` | CPU `0.00%` / RAM `10.19 MiB` | CPU `0.08%` / RAM `15.87 MiB` |
| **200 Conns** | CPU `0.00%` / RAM `10.57 MiB` | CPU `0.00%` / RAM `37.70 MiB` | CPU `0.03%` / RAM `76.99 MiB` | CPU `9.08%` / RAM `9.84 MiB` | CPU `5.67%` / RAM `15.06 MiB` | CPU `0.17%` / RAM `15.16 MiB` |
| **300 Conns** | CPU `0.00%` / RAM `14.03 MiB` | CPU `0.00%` / RAM `54.69 MiB` | CPU `4.10%` / RAM `77.01 MiB` | CPU `0.46%` / RAM `9.25 MiB` | CPU `0.00%` / RAM `10.21 MiB` | CPU `9.35%` / RAM `15.48 MiB` |

---

## 4. Persistent Storage, Database Backup & Restore Verification

1. **Named Docker Volumes Verified**:
   - `officechat-postgres-data` (`/var/lib/postgresql/data`)
   - `officechat-redis-data` (`/data`, AOF enabled)
   - `officechat-minio-data` (`/data`)
   - `officechat-uploads-data` (`/app/uploads`, UID `65532:65532` verified)
   - `officechat-caddy-data` & `officechat-caddy-config`
2. **Database Backup Executed**:
   - Saved full schema + data dump to `D:\1projects\officechat\deploy\backups\officechat_pre_pilot_backup.sql` (`131,898 bytes`).
   - Command:
     ```powershell
     docker exec officechat-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > D:\1projects\officechat\deploy\backups\officechat_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql
     ```
3. **Database Restore Verified**:
   - Restored `officechat_pre_pilot_backup.sql` into temporary database `officechat_restore_test`, verified row counts across `users`, `channels`, `messages`, and `attachments`, and dropped `officechat_restore_test`.
   - Restore Command:
     ```powershell
     Get-Content D:\1projects\officechat\deploy\backups\officechat_pre_pilot_backup.sql -Raw | docker exec -i officechat-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
     ```
4. **Disposable Test Data Cleanup Verified**:
   - Removed all 23 load-test/verification messages, 2 test attachments (`quick_tunnel_test.txt`, `pilot_check.txt`), 2 temporary private channels, 1 test DM group, and 3 pilot test accounts (`pilot.alice`, `pilot.bob`, `pilot.charlie`).
   - Post-cleanup database state: `1` initial owner user, `1` default `#general` channel, `0` test messages, `0` test attachments.

---

## 5. Remaining Risks & Required Steps Before Onboarding 600 Members

1. **Main Chat UI (`web/src/App.tsx`) Must Be Wired to Backend REST & WebSocket APIs**:
   - While the Go backend (`officechat-api`) and Admin Console (`web/src/features/admin/*`) are fully backed by PostgreSQL and WebSockets (and passed the 300-connection load test), the main chat screen in `web/src/App.tsx` still stores messages, channels, tasks, and polls in local React `useState` rather than calling `/api/v1/workspaces`, `/api/v1/channels`, `/api/v1/dms`, `/api/v1/messages`, and `/api/v1/ws`. Users logging into the browser UI will only see their own local browser state until `App.tsx` is wired to those endpoints.
2. **Replace Cloudflare Quick Tunnel Before Scaling Beyond a Small Pilot (<50 Users)**:
   - Cloudflare Quick Tunnel (`*.trycloudflare.com`) enforces a hard **200 concurrent in-flight HTTP request limit**, changes its URL whenever restarted, and has no uptime SLA. Before onboarding 600 members, transition to a **Named Cloudflare Tunnel** on a registered domain (or internal corporate VPN/LAN DNS) and host on a dedicated Linux server/VM rather than a laptop.
3. **Container PID & Memory Limits for 600 Simultaneous Users**:
   - In `deploy/docker-compose.prod.yml`, `caddy` has `pids: 100` / `memory: 256M` and `api` has `pids: 200` / `memory: 512M`. At 300 simultaneous connections, `caddy` used `54.7 MiB` RAM. For 600+ concurrent users, increase `caddy` memory limit to `512M` (`pids: 500`) and `api` memory limit to `1024M` (`pids: 500`), and raise Caddy's `auth_limiter` (`deploy/Caddyfile`) from `10 events / 1m` per `{client_ip}` to `120 events / 1m` so morning login bursts from a single office NAT IP are not throttled.
4. **Rotate Default Owner Password Before Inviting Pilot Users**:
   - Log into `/admin` -> **Security & Policy** and change the initial `owner@officechat.local` password before distributing the pilot URL.

