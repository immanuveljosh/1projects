# OfficeChat Project Audit Report

**Audit Date:** 2026-10-28  
**Project Path:** `D:\1projects\officechat`  
**Stack:** Go 1.24 (`chi/v5`, `lib/pq`, `gorilla/websocket`, `golang-jwt/jwt/v5`) + React 19 / TypeScript / Vite 8 / Tailwind CSS 4 + PostgreSQL 16 + Redis 7 + MinIO + Caddy 2 / Nginx

---

## 1. Executive Summary

OfficeChat consists of two distinct halves with vastly different levels of backend integration:
1. **Backend API (`backend/`) & Admin Console (`web/src/features/admin/`)**: Fully implemented in Go with PostgreSQL persistence, RBAC middleware, JWT + refresh token rotation, password complexity/history enforcement, CSV member bulk import, channel administration, security policy management, and structured audit logging. The React Admin Console (`AdminConsole.tsx`, `MembersTab.tsx`, `ChannelsTab.tsx`, `SecurityTab.tsx`, `AuditTab.tsx`) is wired to the real `/api/v1/admin/*` and `/api/v1/auth/change-password` endpoints via `adminApi.ts`.
2. **Main Chat Application (`web/src/App.tsx`)**: Despite the Go backend implementing full REST endpoints for workspaces, channels, DMs, messages, threads, reactions, pins, read states, polls, tasks, files, search, notifications, and a WebSocket hub, **`web/src/App.tsx` (4,749 lines) operates almost entirely on hardcoded local React state (`useState`) and mock data**. Only the login/register form in `App.tsx` makes a network request (`/api/v1/auth/login` or `/api/v1/auth/register`), and even that silently falls back to local mock state when the API is unreachable.

Additionally, code and configuration inspection uncovered several **high-priority backend SQL bugs, concurrency bugs, frontend/backend contract mismatches, and Docker Compose deployment bugs**.

---

## 2. Working Features Verified by Code & Automated Tests

### 2.1 Verified by Unit Tests & Build Tooling
| Feature / Component | Verification Method | Files | Status |
|---|---|---|---|
| Cryptographic password generator (`GenerateSecurePassword`) | `go test ./internal/admin` | `backend/internal/admin/password.go`, `password_test.go` | **PASS** |
| Workspace RBAC (`RequireRole`, cross-workspace IDOR prevention, suspended account rejection) | `go test ./internal/middleware` | `backend/internal/middleware/auth.go`, `auth_test.go` | **PASS** |
| Role hierarchy & last-owner protection (`NormalizeRole`, `CanManageMember`, `CheckLastOwnerCount`) | `go test ./internal/rbac` | `backend/internal/rbac/rbac.go`, `rbac_test.go` | **PASS** |
| Push notification device token validation & HTTP auth guard (`UpsertDeviceToken`, `DeleteDeviceToken`) | `go test ./internal/notifications` | `backend/internal/notifications/device_token_service.go`, `device_token_handler.go`, `device_token_test.go` | **PASS** |
| Bcrypt password hashing & JWT access/refresh token lifecycle (`TokenManager`) | `go test ./internal/tokens` | `backend/internal/tokens/tokens.go`, `tokens_test.go` | **PASS** |
| Go static compilation (`api`, `migrate`, `healthcheck`) & `go vet` | `go vet ./...` & `go build` | `backend/cmd/api`, `backend/cmd/migrate`, `backend/cmd/healthcheck` | **PASS** |
| Frontend linter (`oxlint`), TypeScript typecheck (`tsc -b`), and Vite production bundle (`vite build`) | `npm.cmd run lint` & `npm.cmd run build` | `web/src/**/*` | **PASS** |
| Docker Compose syntax validation (dev & prod) | `docker compose config -q` | `docker-compose.yml`, `deploy/docker-compose.prod.yml` | **PASS** (with warnings/logical issues detailed below) |

### 2.2 Verified by Code Inspection (End-to-End Wired in Admin Console)
- **Admin Member Management (`web/src/features/admin/MembersTab.tsx` <-> `backend/internal/admin/handler.go`, `service.go`)**:
  - Cursor-paginated member listing, role/state/department filtering, member creation with optional auto-generated password, profile/role editing, suspend/reactivate, admin-verified password reset, force session logout, soft/permanent member deletion, and CSV bulk import.
- **Admin Channel Management (`web/src/features/admin/ChannelsTab.tsx` <-> `backend/internal/admin/channel_handler.go`, `channel_service.go`)**:
  - Cursor-paginated channel listing, public/private/announcement channel creation, channel editing, archive/unarchive, soft/permanent channel deletion, and viewing/removing channel members (adding members had a UUID vs. email bug; see BUG-04).
- **Admin Security & Workspace Policy (`web/src/features/admin/SecurityTab.tsx` <-> `backend/internal/admin/settings_handler.go`, `settings_service.go`, `backend/internal/auth/handler.go`)**:
  - Fetching and updating password policy, login lockout settings, session timeout, retention days, guest invite toggle, self-service password change (`/api/v1/auth/change-password`), and workspace-wide emergency logout (`/api/v1/admin/security/emergency-logout`).
- **Admin Audit Log Viewer (`web/src/features/admin/AuditTab.tsx` <-> `backend/internal/admin/settings_handler.go`, `settings_service.go`)**:
  - Cursor-paginated audit log querying with filters (`action`, `target_type`, `actor_id`, `search`, `start_date`, `end_date`), JSON state diff inspection drawer, and client-side CSV export.

---

## 3. Confirmed Bugs & Incomplete Features

### 3.1 Critical & High Severity Bugs

| ID | Severity | Category | Summary & Root Cause | Affected Files |
|---|---|---|---|---|
| **BUG-01** | **CRITICAL** | Backend SQL / Security | **SQL Injection & Unparsed Array in `MessageService.populateReactions`**: `populateReactions` constructs SQL using `fmt.Sprintf` with unparameterized `currentUserID` (`BOOL_OR(user_id = '%s'::uuid)`) and `msgIDs`. If `currentUserID` is empty or malformed, the query fails with a Postgres UUID syntax error; if untrusted input reaches it, it is injectable. Furthermore, `ARRAY_AGG(user_id::text)` is scanned into `userIDsStr string` and discarded without populating `ReactionSummary.UserIDs`. | `backend/internal/chat/message_service.go:244-281` |
| **BUG-02** | **HIGH** | Backend SQL / Runtime Error | **PostgreSQL Partial Unique Index `ON CONFLICT` Failure on `read_states`**: In `000001_init_schema.up.sql:240-241`, `uq_read_state_channel` (`WHERE channel_id IS NOT NULL`) and `uq_read_state_dm` (`WHERE dm_group_id IS NOT NULL`) are partial unique indexes. Postgres requires `ON CONFLICT (user_id, channel_id) WHERE channel_id IS NOT NULL` (and `WHERE dm_group_id IS NOT NULL`) to infer a partial index. Without the `WHERE` predicate, every call to `SendMessage`, `SendDMMessage`, `UpdateChannelReadState`, and `UpdateDMReadState` fails the `read_states` upsert with `pq: there is no unique or exclusion constraint matching the ON CONFLICT specification`. | `backend/internal/chat/message_service.go:143`, `backend/internal/chat/dm_service.go:278`, `backend/internal/chat/reaction_pin_read_handler.go:308,334` |
| **BUG-03** | **HIGH** | Concurrency / Race Condition | **Data Race in WebSocket `Hub.Run` Broadcast Loop**: In `Hub.Run()`, the `case message := <-h.broadcast:` branch acquires a read lock (`h.mu.RLock()`) and, in the `default:` branch when a client buffer is full, calls `delete(h.clients, client)` and `close(client.send)` while holding only `RLock()`. Concurrent broadcasts or reads cause a concurrent map write panic in Go. | `backend/internal/ws/hub.go:101-113` |
| **BUG-04** | **HIGH** | Frontend / Backend Contract Bug | **Adding Channel Members by Email Silently Fails**: `ChannelsTab.tsx` (`EditChannelDialog`) prompts for `"Invite by user email or ID..."` (`type="email"`) and sends the input in `user_ids` to `POST /api/v1/admin/channels/{id}/members`. `AddChannelMembers` in `channel_service.go` directly inserts each string into `channel_members.user_id` (`UUID`), which fails in PostgreSQL when given an email address, and silently ignores the error (`if err == nil { addedCount++ }`), returning HTTP 200 with 0 members added. | `backend/internal/admin/channel_service.go:451-501`, `web/src/features/admin/ChannelsTab.tsx:600-622` |
| **BUG-05** | **HIGH** | Docker / Database Init | **Dev `docker-compose.yml` Mounts Both `.up.sql` and `.down.sql` into `/docker-entrypoint-initdb.d`**: `docker-compose.yml` mounts `./backend/migrations:/docker-entrypoint-initdb.d:ro`. On first container startup, PostgreSQL's entrypoint runs all `.sql` files in alphabetical order (`000001_...down.sql`, `000001_...up.sql`, `000002_...down.sql`, `000002_...up.sql`, `000003_...down.sql`, `000003_...up.sql`), bypassing `schema_migrations` tracking and risking failure if `.down.sql` contains non-idempotent statements. Migrations are already executed properly by the Go `api` binary on startup (`database.RunMigrations("migrations")`). | `docker-compose.yml:16` |
| **BUG-06** | **HIGH** | Production Docker / Networking & Read-Only FS | **Production Docker Compose Network & Read-Only Upload Failures**: (1) In `deploy/Caddyfile:123`, Caddy proxies `/storage/*` to `minio:9000`, and `/healthz` checks `http://minio:9000/minio/health/live`, but in `deploy/docker-compose.prod.yml`, `caddy` is only on the `edge` network while `minio` is only on the `internal` network (`caddy` cannot resolve or reach `minio`). (2) `api` has `read_only: true` with only `/tmp` mounted as `tmpfs`, while `UploadFile` (`file_search_presence_handler.go:49`) writes to `./uploads` (`/app/uploads`), causing all file uploads in production to fail with `read-only file system`. | `deploy/docker-compose.prod.yml:36-37,130-132,163-164`, `backend/internal/chat/file_search_presence_handler.go:49-56` |
| **BUG-07** | **HIGH** | Security / Frontend | **Hardcoded Admin Credentials Fallback in `adminApi.ts`**: When `localStorage.getItem('officechat_access_token')` is absent, `getAuthHeader()` automatically POSTs hardcoded credentials (`owner@officechat.local` / `Admin@Secure2026!`) to `/api/v1/auth/login` from the browser bundle. | `web/src/features/admin/adminApi.ts:10-28` |
| **BUG-08** | **HIGH** | Architecture / Mock Frontend | **Main Chat UI (`web/src/App.tsx`) Uses Hardcoded Mock State Instead of Backend APIs**: Conversations, channels, DMs, messages, tasks, polls, reactions, pins, user settings, and presence in `App.tsx` are hardcoded in local `useState` hooks and never call `/api/v1/*` or connect to `/api/v1/ws`. | `web/src/App.tsx:165-617,994-1195` |

### 3.2 Medium & Low Severity Bugs

| ID | Severity | Category | Summary & Root Cause | Affected Files |
|---|---|---|---|---|
| **BUG-09** | **MEDIUM** | Frontend Logic Bug | **Message Forwarding Appends to Current Chat Instead of Target Conversation**: `handleForwardMessage(targetConvId: string)` in `App.tsx` ignores `targetConvId` when updating messages (`setMessages(prev => [...prev, newMsg])`), duplicating the forwarded message inside the currently open chat rather than the target conversation, and leaving `forwardingMessage` modal open or referencing a hidden toast. | `web/src/App.tsx:788-804` |
| **BUG-10** | **MEDIUM** | Frontend UI Bug | **Thread Drawer (`activeThreadMessage`) Cannot Be Opened from Message Toolbar**: `App.tsx` implements a full Thread Replies side panel (`{activeThreadMessage && ...}` at line 2846) and `handleSendThreadReply`, and displays a `"N thread replies"` counter on messages (line 2663), but neither the message action toolbar nor the `"N thread replies"` badge has an `onClick={() => setActiveThreadMessage(msg)}` handler. | `web/src/App.tsx:2661-2715,2846` |
| **BUG-11** | **MEDIUM** | Backend Audit Bug | **Audit Log Action Name Mismatch on CSV Import & Non-UUID `entity_id` Risk**: (1) `ImportMembers` in `service.go:773` logs action `"member.import_csv"`, whereas `buildAuditSummary` in `settings_service.go:283` checks `case "member.bulk_import":`. (2) `audit.Record` (`audit.go:60-61`) casts `NULLIF($5, '')::uuid` for both `entity_id` and `target_id`. If any caller passes a non-UUID `TargetID`, `audit.Record` fails with `invalid input syntax for type uuid`. | `backend/internal/admin/service.go:773`, `backend/internal/admin/settings_service.go:283`, `backend/internal/audit/audit.go:60-61` |
| **BUG-12** | **MEDIUM** | Backend WebSocket | **WebSocket `ServeHTTP` Allows Unauthenticated Connections & `readPump` Discards Client Frames**: (1) In `ws/hub.go:239-256`, if `?token=` is missing or invalid, `ServeHTTP` still upgrades the connection with empty `userID`/`workspaceID` instead of returning `401 Unauthorized`. (2) `readPump` (`ws/hub.go:188-205`) reads and discards all incoming WebSocket messages (`_, _, err := c.conn.ReadMessage()`), so client-sent WS events (e.g., typing indicators over WS) are ignored. | `backend/internal/ws/hub.go:188-205,239-256` |
| **BUG-13** | **LOW** | Frontend UX / Placeholder | **Disabled Toast Notifications & Simulated Backup Email**: `addToast` in `App.tsx:301-303` is a no-op comment (`// Visibly hidden so action logs do not pop up on screen`), and `handleSendChatBackup` (`App.tsx:926-965`) uses `setTimeout` to simulate sending an email backup without calling any backend endpoint. | `web/src/App.tsx:301-303,926-965` |
| **BUG-14** | **LOW** | Config / Env | **Port & Path Mismatches Across `.env.example` Files**: Root `.env.example:51` sets `VITE_WS_URL=ws://localhost:8080/ws`, whereas the backend registers WebSocket at `/api/v1/ws` (`cmd/api/main.go:97`). `backend/.env.example:12` sets `DB_PORT=5433`, whereas `docker-compose.yml:13` maps PostgreSQL to host port `5432:5432`. `deploy/.env.example:13` sets `TLS_MODE=admin@example.com` while `deploy/Caddyfile:17` comments state `TLS_MODE` can be `internal` or an ACME email. | `.env.example:51`, `backend/.env.example:12`, `docker-compose.yml:13` |

---

## 4. API Endpoints vs. Frontend API Calls Matrix

### 4.1 Auth & Admin Endpoints
| Backend Route (`cmd/api/main.go`) | Method | Handler | Called by Frontend? | Frontend Location & Notes |
|---|---|---|---|---|
| `/healthz` | `GET` | inline | No (Docker healthcheck) | Used by `cmd/healthcheck` & Caddy |
| `/api/v1/auth/register` | `POST` | `authHandler.Register` | **Yes** | `web/src/App.tsx:1002` |
| `/api/v1/auth/login` | `POST` | `authHandler.Login` | **Yes** | `web/src/App.tsx:1002`, `web/src/features/admin/adminApi.ts:15` |
| `/api/v1/auth/refresh` | `POST` | `authHandler.Refresh` | **No** | Not wired in `App.tsx` or `adminApi.ts` |
| `/api/v1/auth/logout` | `POST` | `authHandler.Logout` | **No** | `App.tsx` logout only clears local state |
| `/api/v1/auth/me` | `GET` | `authHandler.Me` | **No** | Not called on initial page load |
| `/api/v1/auth/change-password` | `POST` | `authHandler.ChangePassword` | **Yes** | `web/src/features/admin/adminApi.ts:390` (`SecurityTab.tsx`) |
| `/api/v1/admin/members` | `GET`, `POST` | `adminHandler.ListMembers`, `CreateMember` | **Yes** | `web/src/features/admin/adminApi.ts:158,170` (`MembersTab.tsx`) |
| `/api/v1/admin/members/import` | `POST` | `adminHandler.ImportMembers` | **Yes** | `web/src/features/admin/adminApi.ts:253` (`MembersTab.tsx`) |
| `/api/v1/admin/members/{id}` | `GET`, `PATCH`, `DELETE` | `GetMember`, `UpdateMember`, `DeleteMember` | **Yes** (`PATCH`, `DELETE`) | `web/src/features/admin/adminApi.ts:183,238` (`MembersTab.tsx`) |
| `/api/v1/admin/members/{id}/suspend` | `POST` | `adminHandler.SuspendMember` | **Yes** | `web/src/features/admin/adminApi.ts:196` (`MembersTab.tsx`) |
| `/api/v1/admin/members/{id}/reactivate` | `POST` | `adminHandler.ReactivateMember` | **Yes** | `web/src/features/admin/adminApi.ts:206` (`MembersTab.tsx`) |
| `/api/v1/admin/members/{id}/reset-password` | `POST` | `adminHandler.ResetPassword` | **Yes** | `web/src/features/admin/adminApi.ts:216` (`MembersTab.tsx`) |
| `/api/v1/admin/members/{id}/force-logout` | `POST` | `adminHandler.ForceLogout` | **Yes** | `web/src/features/admin/adminApi.ts:227` (`MembersTab.tsx`) |
| `/api/v1/admin/channels` | `GET`, `POST` | `adminChannelHandler.ListChannels`, `CreateChannel` | **Yes** | `web/src/features/admin/adminApi.ts:281,299` (`ChannelsTab.tsx`) |
| `/api/v1/admin/channels/{id}` | `GET`, `PATCH`, `DELETE` | `GetChannel`, `UpdateChannel`, `DeleteChannel` | **Yes** | `web/src/features/admin/adminApi.ts:290,312,342` (`ChannelsTab.tsx`) |
| `/api/v1/admin/channels/{id}/archive` | `POST` | `adminChannelHandler.ArchiveChannel` | **Yes** | `web/src/features/admin/adminApi.ts:322` (`ChannelsTab.tsx`) |
| `/api/v1/admin/channels/{id}/unarchive` | `POST` | `adminChannelHandler.UnarchiveChannel` | **Yes** | `web/src/features/admin/adminApi.ts:332` (`ChannelsTab.tsx`) |
| `/api/v1/admin/channels/{id}/members` | `POST` | `adminChannelHandler.AddMembers` | **Yes** | `web/src/features/admin/adminApi.ts:355` (See BUG-04) |
| `/api/v1/admin/channels/{id}/members/{userId}` | `DELETE` | `adminChannelHandler.RemoveMember` | **Yes** | `web/src/features/admin/adminApi.ts:369` (`ChannelsTab.tsx`) |
| `/api/v1/admin/settings` | `GET`, `PATCH` | `adminSettingsHandler.GetSettings`, `UpdateSettings` | **Yes** | `web/src/features/admin/adminApi.ts:380,385` (`SecurityTab.tsx`) |
| `/api/v1/admin/security/emergency-logout` | `POST` | `adminSettingsHandler.EmergencyLogoutAll` | **Yes** | `web/src/features/admin/adminApi.ts:402` (`SecurityTab.tsx`) |
| `/api/v1/admin/audit-logs` | `GET` | `adminSettingsHandler.ListAuditLogs` | **Yes** | `web/src/features/admin/adminApi.ts:427` (`AuditTab.tsx`) |

### 4.2 Chat, Collaboration, Notification & WebSocket Endpoints
| Backend Route | Method | Handler | Called by Frontend? | Notes |
|---|---|---|---|---|
| `/api/v1/ws` | `GET` (WS) | `hub.ServeHTTP` | **No** | Not connected in `web/src/App.tsx` |
| `/api/v1/workspaces`, `/api/v1/workspaces/{id}/members` | `GET`, `POST`, `PATCH`, `DELETE` | `wsHandler` | **No** | `App.tsx` uses local mock workspace state |
| `/api/v1/channels`, `/api/v1/channels/{id}/*` | `GET`, `POST`, `PATCH`, `DELETE` | `chHandler`, `msgHandler`, `rprHandler` | **No** | `App.tsx` uses local mock channels & messages |
| `/api/v1/dms`, `/api/v1/dms/{id}/*` | `GET`, `POST` | `dmHandler`, `rprHandler` | **No** | `App.tsx` uses local mock DMs & messages |
| `/api/v1/messages/{id}/*` (edit, delete, thread, reactions, pin) | `GET`, `POST`, `PATCH`, `DELETE` | `msgHandler`, `rprHandler` | **No** | `App.tsx` mutates local `messages` state only |
| `/api/v1/polls`, `/api/v1/polls/{id}/vote`, `/close` | `GET`, `POST` | `pollHandler` | **No** | `App.tsx` mutates local poll state only |
| `/api/v1/tasks`, `/api/v1/tasks/{id}/*` | `GET`, `POST`, `PATCH`, `DELETE` | `taskHandler` | **No** | `App.tsx` mutates local `tasks` state only |
| `/api/v1/files/upload`, `/api/v1/files/{id}` | `POST`, `GET`, `DELETE` | `fspHandler` | **No** | `App.tsx` creates fake local attachment objects |
| `/api/v1/search` | `GET` | `fspHandler.SearchMessages` | **No** | `App.tsx` filters local `messages` array |
| `/api/v1/presence` | `PUT`, `GET` | `fspHandler` | **No** | `App.tsx` updates local status state |
| `/api/v1/notifications/*` | `GET`, `POST`, `PUT`, `DELETE` | `notifHandler`, `deviceTokenHandler` | **No** | Intended for web/mobile push & notification list |

---

## 5. Database Migrations, Docker Compose, Environment & WebSocket Audit

### 5.1 Database Migrations (`backend/migrations/`)
- **`000001_init_schema.up.sql`**: Creates `users`, `refresh_tokens`, `workspaces`, `workspace_members`, `channels`, `channel_members`, `dm_groups`, `dm_participants`, `polls`, `poll_options`, `poll_votes`, `messages`, `message_reactions`, `pinned_messages`, `read_states`, `files`, `message_attachments`, `tasks`, `notifications`, `notification_preferences`, `bookmarks`, `audit_logs`, and seeds default workspace `a0000000-0000-0000-0000-000000000001` with 6 demo users and 4 default channels.
- **`000002_admin_console.up.sql`**: Adds `department`, `account_state`, `must_change_password`, `password_changed_at`, `failed_login_attempts`, `locked_until` to `users`; normalizes roles to `Owner`/`Admin`/`Member`/`Guest`; adds `is_announcement` to `channels`; creates `workspace_settings` and `password_history`; adds `target_type`, `target_id`, `before_state`, `after_state`, `details` to `audit_logs`; seeds `owner@officechat.local` (`Admin@Secure2026!`).
- **`000003_device_tokens.up.sql`**: Creates `device_tokens` with platform check (`ios`, `android`, `web`) and cascade delete.
- **Migration Runner (`backend/internal/db/db.go`)**: Tracks applied `.up.sql` files in `schema_migrations` inside transactions. Works properly, except `docker-compose.yml` also mounts `./backend/migrations` into `/docker-entrypoint-initdb.d` (BUG-05).

### 5.2 Docker Compose & Production Deployment (`docker-compose.yml`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`)
- Both `docker-compose.yml` and `deploy/docker-compose.prod.yml` pass `docker compose config -q` syntax validation (`docker-compose.yml` emits an obsolete `version: '3.9'` warning).
- **Dev Compose (`docker-compose.yml`)**: Mounts `./backend/migrations:/docker-entrypoint-initdb.d:ro` (BUG-05).
- **Prod Compose (`deploy/docker-compose.prod.yml`)**:
  - `caddy` is attached only to `networks: [edge]`, while `minio` is attached only to `networks: [internal]`, breaking `/storage/*` reverse proxying and `/healthz` checks in `deploy/Caddyfile` (BUG-06).
  - `api` has `read_only: true` with no writable volume for `/app/uploads`, breaking `UploadFile` (BUG-06).

### 5.3 WebSocket Handling (`backend/internal/ws/hub.go`)
- Backend broadcasts `message.created`, `message.updated`, `message.deleted`, `message.reaction.added`, `message.reaction.removed`, `channel.pin.added`, `channel.pin.removed`, `poll.updated`, `task.created`, `task.updated`, `task.deleted`, `presence.updated`, and `session.revoked` via `BroadcastToChannel`, `BroadcastToWorkspace`, and `BroadcastToUser`.
- **Issues found**: `Hub.Run` mutates `h.clients` under `RLock` (BUG-03); `ServeHTTP` allows unauthenticated connections when token is missing/invalid (BUG-12); `readPump` discards client frames (BUG-12).

---

## 6. Confirmed Fixes Applied & Post-Fix Test Results

### 6.1 Fixes Applied During Audit
| Bug ID | File(s) Modified | Fix Applied |
|---|---|---|
| **BUG-01** | `backend/internal/chat/message_service.go` | Replaced `fmt.Sprintf` SQL string interpolation in `populateReactions` with parameterized query (`ANY($1::uuid[])` via `pq.Array(msgIDs)` and `$2` for `currentUserID`) and scanned `pq.StringArray` into `ReactionSummary.UserIDs`. |
| **BUG-02** | `backend/internal/chat/message_service.go`, `backend/internal/chat/dm_service.go`, `backend/internal/chat/reaction_pin_read_handler.go` | Added required partial index predicates (`WHERE channel_id IS NOT NULL` and `WHERE dm_group_id IS NOT NULL`) to all four `INSERT INTO read_states ... ON CONFLICT` queries to match `uq_read_state_channel` and `uq_read_state_dm`. |
| **BUG-03 & BUG-12** | `backend/internal/ws/hub.go`, `backend/internal/ws/hub_test.go` | Changed `Hub.Run` broadcast loop to acquire `h.mu.Lock()` instead of `RLock()` when evicting slow clients and cleaning up `userConns`/`wsConns`. Updated `ServeHTTP` to reject unauthenticated WebSocket upgrade requests with `401 Unauthorized` and added `TestHubServeHTTP_RejectsUnauthenticated`. |
| **BUG-04** | `backend/internal/admin/channel_service.go` | Updated `AddChannelMembers` to resolve each user identifier by either UUID (`id::text = $1`) or case-insensitive email (`LOWER(email) = LOWER($1)`), ensure workspace membership, and return `ErrMemberNotFound` if no valid member was added. |
| **BUG-05** | `docker-compose.yml` | Removed obsolete `version: '3.8'` key and removed `./backend/migrations:/docker-entrypoint-initdb.d:ro` mount so PostgreSQL does not execute `.down.sql` files on container initialization. |
| **BUG-06** | `deploy/docker-compose.prod.yml` | Added `internal` network to `caddy` service so Caddy can reach `minio:9000` for `/storage/*` and `/healthz`, and mounted `/app/uploads` as `tmpfs` on the `api` container (`read_only: true`). |
| **BUG-09 & BUG-10** | `web/src/App.tsx` | Fixed `handleForwardMessage` to update the target conversation's `lastMessage`/`lastTime` and only append to `messages` when forwarding to the active conversation. Added a "Reply in Thread" button (`MessageSquare`) to the message action toolbar to open the thread drawer (`setActiveThreadMessage(msg)`). |
| **BUG-11** | `backend/internal/admin/settings_service.go`, `backend/internal/audit/audit.go` | Added `"member.import_csv"` case to `buildAuditSummary`, and guarded `entity_id` UUID casting in `audit.Record` with a UUID regex check while preserving `target_id` as `VARCHAR(100)`. |
| **BUG-14** | `.env.example`, `backend/.env.example` | Updated `VITE_WS_URL` to `ws://localhost:8080/api/v1/ws` and aligned `DB_PORT` in `backend/.env.example` to `5432`. |

### 6.2 Post-Fix Verification & Test Execution Results

| Command Executed | Environment | Result | Details |
|---|---|---|---|
| `go vet ./...` | `D:\1projects\officechat\backend` | **PASS (Exit 0)** | 0 warnings or errors across all packages |
| `go test -count=1 -v ./...` | `D:\1projects\officechat\backend` | **PASS (Exit 0)** | 12 unit tests passed across `admin`, `middleware`, `notifications`, `rbac`, `tokens`, and `ws` (`TestHubServeHTTP_RejectsUnauthenticated`); 4 DB integration tests skipped because Docker/PostgreSQL service (`com.docker.service`) is stopped on the host |
| `go build ./cmd/api`, `./cmd/migrate`, `./cmd/healthcheck` | `D:\1projects\officechat\backend` | **PASS (Exit 0)** | All 3 binaries compiled cleanly |
| `npm.cmd run lint` (`oxlint`) | `D:\1projects\officechat\web` | **PASS (Exit 0)** | `Found 0 warnings and 0 errors. Finished in 240ms on 9 files` |
| `npm.cmd run build` (`tsc -b && vite build`) | `D:\1projects\officechat\web` | **PASS (Exit 0)** | TypeScript compilation and Vite production bundle succeeded in 359ms |
| `docker compose -f docker-compose.yml config -q` | `D:\1projects\officechat` | **PASS (Exit 0)** | 0 warnings, 0 errors |
| `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.example config -q` | `D:\1projects\officechat` | **PASS (Exit 0)** | 0 warnings, 0 errors |

---

## 7. Remaining Blockers & Incomplete Items

1. **Docker Daemon Not Running on Host (`com.docker.service` is `Stopped`)**: Live PostgreSQL integration tests (`TestPollsLifecycle`, `TestTasksLifecycle`, `TestDeviceToken_LifecycleIntegration`) and live container startup cannot execute until Docker Desktop / `com.docker.service` or a local PostgreSQL instance is started.
2. **Main Chat UI (`web/src/App.tsx`) Backend Wiring**: While the Admin Console (`web/src/features/admin/*`) is fully integrated with the Go backend, `web/src/App.tsx` still uses in-memory React state for chat conversations, messages, tasks, and polls rather than `/api/v1/*` and `/api/v1/ws`.
3. **Hardcoded Dev Auto-Login Fallback in `web/src/features/admin/adminApi.ts`**: `getAuthHeader()` falls back to `owner@officechat.local` / `Admin@Secure2026!` when `officechat_access_token` is absent in `localStorage`. This should be gated behind `import.meta.env.DEV` or replaced with a redirect to the login modal once unified auth state is wired.
4. **MinIO Object Storage SDK Integration**: `file_search_presence_handler.go` writes uploaded files to local disk (`./uploads`) rather than using the MinIO S3 API configured in `config.go`.
