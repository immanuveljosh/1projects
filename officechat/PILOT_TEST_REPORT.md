# OfficeChat (Nithra Chat) — 50-User Controlled Pilot Simulation Report

**Date**: 2026-10-28  
**Project Path**: `D:\1projects\officechat`  
**Environment**: Docker Compose Production Stack (`7` containers on Windows 11 host) + Cloudflare Quick Tunnel (`https://supported-grid-permitted-organized.trycloudflare.com`)  
**Target Scale Tested**: `50` Simultaneous Authenticated Pilot Users (`2` Admins, `46` Members, `2` Guests across `5` departments)

---

## 1. Executive Summary & PASS/FAIL Matrix

A full 50-user pilot simulation was executed against the live OfficeChat stack, testing simultaneous logins, 50 concurrent WebSocket connections, public and private channel messaging, 25 simultaneous 1:1 DM pairs, threaded discussions, real-time scoped typing indicators, concurrent file uploads/downloads, RBAC/IDOR privacy boundaries, and full WebSocket disconnect/reconnect persistence.

During the initial run, log monitoring identified a PostgreSQL type-cast bug in `audit_logs` (`SQLSTATE 42804` on `target_id`) and database lock/pool bottlenecks under 50-user burst writes. All confirmed issues were fixed, `officechat-api` was rebuilt, and the full 50-user simulation was re-run with **0 database errors, 0 HTTP 5xx errors, and 0 unexpected WebSocket disconnects**.

| Test Category | Scenario Executed | Target / Assertion | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1. Account Provisioning** | Provision 50 distinct users (`2` Admins, `46` Members, `2` Guests) via `POST /api/v1/admin/members` | `50/50` created + `50/50` `member.create` audit logs persisted | `50/50` accounts created (`avg: 307.87 ms`), `50/50` audit logs recorded | **PASS** |
| **2. Simultaneous Logins** | 50 users fire `POST /api/v1/auth/login` concurrently (`Promise.all`) | `50/50` HTTP `200 OK` with valid JWT + `HttpOnly` cookies | `50/50` succeeded in `1591.31 ms` wall-clock (`p50: 1556.27 ms`, `p95: 1583.10 ms`) | **PASS** |
| **3. Simultaneous WebSockets** | 50 users connect concurrently to `/api/v1/ws` | `50/50` upgraded (`101 Switching Protocols`), `0` unexpected drops | `50/50` connected (`p50: 69.37 ms`, `p95: 282.46 ms`), `0` unexpected disconnects | **PASS** |
| **4. Public Channel Messaging** | All 50 users post concurrently in `#general` | `50/50` HTTP `201 Created`; `50 × 50 = 2,500` WS broadcasts delivered | `50/50` REST `201`; `2,500/2,500` WebSocket events delivered (`100%`) | **PASS** |
| **5. Private Channel Isolation** | Admin creates `#leadership-pilot` (`is_private=true`) and posts confidential message | `0` WS events leaked to 49 non-members; `403 Forbidden` on non-member REST read/write | `0` leaked WS events across 49 non-members; `403 Forbidden` enforced (`avg: 12.84 ms`) | **PASS** |
| **6. Direct Messages (25 Pairs)** | 25 concurrent 1:1 DM groups (`50` users); bidirectional DM burst (`50` messages) | `100/100` participant WS deliveries; `0/2,400` cross-user WS leaks | `100/100` authorized WS deliveries (`avg: 303.65 ms` send); `0/2,400` cross-DM leaks | **PASS** |
| **7. Message Threads** | Concurrent replies (`parent_id`) + `GET /api/v1/messages/{id}/thread` | Chronological replies returned (`26.82 ms`); `403 Forbidden` for non-participant | `3/3` replies returned in order; non-participant blocked with `403 Forbidden` | **PASS** |
| **8. Scoped Typing Indicators** | Burst of `typing.start` frames over `/api/v1/ws` + unauthorized sender attempt | Rate-limited to `1` event per window, auto-expires with `typing.stop` after `4s`, `0` outsider leaks | `1` rate-limited `typing.start` delivered to partner, `typing.stop` after `4s`, `0` leaks to 48 outsiders | **PASS** |
| **9. Concurrent File Sharing** | 10 users concurrently upload files (`POST .../files/upload`), attach to messages, and download | `10/10` uploaded (`avg: 46.31 ms`), attached, and byte-verified on download (`avg: 16.02 ms`) | `10/10` uploads & downloads matched byte-for-byte (`p95 upload: 51.17 ms`, `p95 download: 17.56 ms`) | **PASS** |
| **10. Authorization & Privacy** | 8-point RBAC & IDOR matrix (unauthenticated, Member->Admin, Guest->Admin, DM/Thread/Task/Message tampering) | `401 Unauthorized` for unauthenticated; `403 Forbidden` for all cross-user/cross-role attempts | `8/8` checks enforced (`min: 3.75 ms`, `avg: 12.84 ms`, `p95: 20.05 ms`) | **PASS** |
| **11. Reconnect & Persistence** | Disconnect all 50 WS clients, reconnect all 50 simultaneously, and re-fetch history | `50/50` reconnected (`p50: 86.25 ms`, `p95: 93.46 ms`); 100% history persisted in PostgreSQL | `50/50` reconnected; channel, DM, thread (`reply_count`), and file records intact (`avg: 17.05 ms`) | **PASS** |
| **12. Public Quick Tunnel Check** | 10 simultaneous users log in via HTTPS and broadcast over WSS through `*.trycloudflare.com` | `10/10` HTTPS logins + `10/10` WSS message deliveries | `10/10` HTTPS logins (`avg: 858.82 ms`) and `10/10` WSS deliveries (`142.30 ms` send) | **PASS** |

---

## 2. API & WebSocket Latency Metrics (50-User Simulation)

### 2.1 Post-Fix Latency Distribution (Run `1793173141251`)

| Operation / Endpoint | Sample Count | Min (ms) | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Simultaneous Login (`POST /api/v1/auth/login` × 50)** | 50 | 608.32 | 1359.32 | 1556.27 | 1583.10 | 1585.65 | 1585.65 |
| **WebSocket Initial Connect (`/api/v1/ws` × 60)** | 60 | 48.89 | 98.37 | 69.37 | 282.46 | 314.04 | 314.04 |
| **WebSocket Simultaneous Reconnect (`/api/v1/ws` × 50)** | 50 | 48.38 | 79.00 | 86.25 | 93.46 | 96.46 | 96.46 |
| **Channel Join (`POST /api/v1/channels/{id}/join` × 50)** | 50 | 38.65 | 130.35 | 84.50 | 265.62 | 268.81 | 268.81 |
| **Single Channel Message Send (`POST .../messages`)** | 1 | 9.97 | 9.97 | 9.97 | 9.97 | 9.97 | 9.97 |
| **50-User Simultaneous `#general` Message Burst** | 60 | 42.25 | 622.06 | 757.49 | 966.47 | 983.09 | 983.09 |
| **50-User Simultaneous 1:1 DM Burst (`25` pairs)** | 50 | 81.24 | 303.65 | 280.53 | 478.15 | 483.59 | 483.59 |
| **Create 1:1 DM Group (`POST /api/v1/workspaces/{id}/dms` × 25)** | 25 | 80.40 | 221.82 | 250.15 | 271.55 | 272.02 | 272.02 |
| **Send Thread Reply (`POST` with `parent_id`)** | 3 | 32.05 | 34.54 | 35.27 | 36.31 | 36.31 | 36.31 |
| **Get Historical Thread (`GET /api/v1/messages/{id}/thread`)** | 1 | 26.82 | 26.82 | 26.82 | 26.82 | 26.82 | 26.82 |
| **Concurrent File Upload (`POST .../files/upload` × 10)** | 10 | 41.09 | 46.31 | 46.44 | 51.17 | 51.17 | 51.17 |
| **Concurrent File Download (`GET /uploads/...` × 10)** | 10 | 14.09 | 16.02 | 16.20 | 17.56 | 17.56 | 17.56 |
| **History Fetch After Reconnect (`GET .../messages?limit=50`)** | 3 | 15.14 | 17.05 | 16.63 | 19.38 | 19.38 | 19.38 |
| **RBAC / Privacy Rejection (`401` / `403` checks)** | 11 | 3.75 | 12.84 | 16.16 | 20.05 | 20.05 | 20.05 |
| **Quick Tunnel Simultaneous Login (`https://*.trycloudflare.com` × 10)** | 10 | 852.94 | 858.82 | 860.62 | 865.44 | 865.44 | 865.44 |

> **Note on Simultaneous Login Latency (`~1.35s` avg for 50 concurrent logins)**: `POST /api/v1/auth/login` verifies passwords using `bcrypt` (`Cost = 10`, ~30ms CPU time per hash). Firing 50 `bcrypt.CompareHashAndPassword` operations at the exact same millisecond intentionally bounds CPU concurrency and completes all 50 logins in `1.59 seconds` total wall-clock time (~31 logins/sec throughput).

---

## 3. Hardware Resource Monitoring (CPU, RAM, Network I/O & Errors)

### 3.1 Container Resource Usage Across Simulation Phases

| Container | Baseline Memory | Peak Load Memory (50 Users Active) | Post-Test Memory | Peak CPU % | Memory Limit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`officechat-api`** | `2.13 MiB` (`0.42%`) | `10.30 MiB` (`2.01%`) | `11.66 MiB` (`2.28%`) | `< 1.0%` during steady state (brief CPU burst during 50× bcrypt login) | `512 MiB` |
| **`officechat-postgres`** | `78.77 MiB` (`7.69%`) | `158.70 MiB` (`15.50%`) | `165.50 MiB` (`16.17%`) | `0.16%` | `1 GiB` |
| **`officechat-caddy`** | `16.43 MiB` (`6.42%`) | `28.22 MiB` (`11.02%`) | `31.87 MiB` (`12.45%`) | `0.10%` | `256 MiB` |
| **`officechat-cloudflared`** | `15.05 MiB` (`11.76%`) | `15.04 MiB` (`11.75%`) | `16.99 MiB` (`13.28%`) | `0.17%` | `128 MiB` |
| **`officechat-web`** | `10.99 MiB` (`8.59%`) | `10.20 MiB` (`7.97%`) | `10.20 MiB` (`7.97%`) | `0.00%` | `128 MiB` |
| **`officechat-redis`** | `9.37 MiB` (`3.66%`) | `9.47 MiB` (`3.70%`) | `9.93 MiB` (`3.88%`) | `4.14%` | `256 MiB` |
| **`officechat-minio`** | `152.60 MiB` (`29.81%`) | `158.00 MiB` (`30.87%`) | `153.50 MiB` (`29.98%`) | `11.38%` | `512 MiB` |

### 3.2 Error & Disconnect Counters (Post-Fix Run)
- **Unexpected WebSocket Disconnects**: `0`
- **WebSocket Upgrade / Frame Errors**: `0`
- **HTTP 5xx Responses**: `0`
- **PostgreSQL `ERROR` / `FATAL` / `PANIC` Log Entries**: `0`
- **Go API Runtime Panics / Deadlocks**: `0`

---

## 4. Discovered Issues, Bottlenecks & Applied Fixes

### Issue 1 (Bug — Confirmed & Fixed): PostgreSQL `42804` Type Mismatch in `audit.Record`
- **Symptom**: During the initial 50-user provisioning run, `docker logs officechat-postgres` and `docker logs officechat-api` logged 50 errors:
  `pq: column "target_id" is of type uuid but expression is of type text at position 9:8 (42804)`.
- **Root Cause**: In `backend/internal/audit/audit.go`, `entity_id` was cast to `::uuid` via a regex `CASE` expression, but `target_id` (also a `uuid` column in `audit_logs`) was passed as `NULLIF($5, '')` (`text`).
- **Fix Applied**: Updated `backend/internal/audit/audit.go` line 63 to cast `target_id` to `::uuid` using the same UUID validation `CASE` expression as `entity_id`.
- **Verification**: In the post-fix 50-user run, `SELECT COUNT(*) FROM audit_logs WHERE action = 'member.create'` recorded `50/50` entries with `0` PostgreSQL errors.

### Issue 2 (Bottleneck — Confirmed & Fixed): Database Connection Pool Contention (`SetMaxOpenConns(25)`)
- **Symptom**: In `backend/internal/db/db.go`, the SQL connection pool was capped at `SetMaxOpenConns(25)` and `SetMaxIdleConns(10)`. When 50 users sent messages or logged in simultaneously, half of the requests queued waiting for a free database connection.
- **Fix Applied**: Increased `SetMaxOpenConns(60)` and `SetMaxIdleConns(30)` in `backend/internal/db/db.go` (safely below PostgreSQL's `max_connections = 100`).
- **Verification**: 50-user simultaneous login wall-clock time improved by **13.4%** (`1837.96 ms` → `1591.31 ms`).

### Issue 3 (Bottleneck — Confirmed & Fixed): Unnecessary Metadata Queries & `read_states` Lock Hold Time on Message Send
- **Symptom**: In `backend/internal/chat/message_service.go` (`SendChannelMessage`) and `backend/internal/chat/dm_service.go` (`SendDMMessage`), every new message insert:
  1. Updated `read_states` for all channel/DM members inside the `INSERT INTO messages` transaction without an `ORDER BY user_id` clause, increasing row-lock hold time and risking lock-order contention during simultaneous channel bursts.
  2. Called `populateMessagesMetadata` unconditionally on a newly-inserted message, executing 3 extra SQL queries (`reactions`, `attachments`, `polls`) even when the new message had no attachments.
- **Fix Applied**:
  1. Added `ORDER BY cm.user_id` / `ORDER BY dmm.user_id` to the `read_states` upsert and moved it outside the `INSERT INTO messages` transaction so the message insert commits immediately.
  2. Initialized `msg.Reactions = []` and `msg.Attachments = []` directly and only invoked `populateMessagesMetadata` on send when `len(req.AttachmentIDs) > 0`.
- **Verification**:
  - 50-user simultaneous 1:1 DM send latency dropped from **`625.49 ms` avg (`686.51 ms` p50)** to **`303.65 ms` avg (`280.53 ms` p50)** — a **51.5% average (59.1% median) latency reduction**.
  - Single message send latency dropped from **`23.82 ms`** to **`9.97 ms`** (**58.1% faster**).

---

## 5. Capacity Assessment & Recommended Next Steps

1. **50-User Controlled Pilot Readiness — VERIFIED**:
   - The current Docker Compose stack + Cloudflare Quick Tunnel is **verified ready for a 50-user controlled office pilot**, with `10.3–11.7 MiB` API memory usage, `~160 MiB` PostgreSQL memory usage, `0` dropped WebSockets, and `100%` message persistence.
2. **Do Not Use the Current Quick Tunnel Setup for 600 Production Users**:
   - Load testing has **not** proven 600-user support over the temporary Cloudflare Quick Tunnel (`*.trycloudflare.com`), because Quick Tunnels enforce a hard **200 concurrent in-flight request limit** at the Cloudflare edge and rotate their random URL whenever `officechat-cloudflared` restarts.
3. **Recommended Next Steps Before Scaling Beyond 50 Pilot Users**:
   - **Upgrade to a Named Cloudflare Tunnel** with a custom domain under `immanuvel@bharath.ac.in` to remove the 200-request Quick Tunnel limit and lock in a permanent HTTPS hostname.
   - **Migrate Host Infrastructure** from the Windows 11 laptop to a dedicated always-on Linux server/VM before onboarding multiple departments.
   - **Execute a 600-Connection Load Test** through the Named Tunnel on the dedicated server (raising PostgreSQL `max_connections` to `250` and `db.SetMaxOpenConns(150)`) before claiming 600-user production readiness.

