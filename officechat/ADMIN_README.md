# OfficeChat Enterprise Admin Console

## 1. Architecture Overview

The OfficeChat Admin Console provides an enterprise-grade administrative cockpit and control plane across four core domains:

1. **Members**: Full member lifecycle (searchable/paginated list, invite/create, role management, suspend/reactivate, password reset with temp token, force session revocation, and soft/permanent delete with message anonymization).
2. **Channels & Groups**: Full channel lifecycle (public/private/announcement-only flags, topic/description edits, member roster assignment, archive vs permanent deletion, and `#general` default channel deletion protection).
3. **Security & Passwords**: Password complexity policy (min length, symbols, digits, expiry days, lockout threshold, duration), administrative password rotation with entropy meter, and workspace-wide Emergency Logout.
4. **Audit Logs**: Immutable event audit trail recording actor, action, target, before/after JSON diffs, IP address, user agent, and timestamp with instant CSV export.

---

## 2. Strict RBAC Model

The system enforces a strict 4-tier hierarchy across all APIs and UI surfaces:

$$\text{Owner} > \text{Admin} > \text{Member} > \text{Guest}$$

- **Only Owner and Admin** are permitted to access the `/api/v1/admin/*` routes and view the console.
- **Member and Guest** receive HTTP `403 FORBIDDEN`.
- **Admins cannot edit, demote, or delete an Owner.**
- **Only an Owner can promote or demote an Admin or create an Owner.**
- **Last-Owner Protection**: The database and RBAC layer prevent deleting or demoting the last remaining Owner of an organization workspace.
- **Tenant Isolation**: Every database query is strictly scoped by `X-Workspace-ID` or verified workspace membership, preventing cross-tenant IDOR attacks.
- **Re-Authentication**: Sensitive destructive actions (password reset, force logout, permanent delete, and emergency workspace logout) require the administrator to re-enter their current password before execution.

---

## 3. Security Checklist

| Check | Requirement | Implementation Status |
|---|---|---|
| 🛡️ | Server-side role enforcement | `RequireRole(Owner, Admin)` applied to all `/api/v1/admin/*` routes |
| 🛡️ | Cross-tenant IDOR protection | Queries filtered by verified `workspace_id` header or context |
| 🛡️ | Sensitive action re-auth | Admin password verification on Reset, Logout, Delete, and Emergency Logout |
| 🛡️ | Last owner protection | `CheckLastOwnerCount` blocks deleting or demoting the last Owner |
| 🛡️ | Suspended user lockdown | Suspended & deactivated users blocked by middleware with `403 ACCOUNT_SUSPENDED` |
| 🛡️ | Realtime session termination | WebSocket `hub.DisconnectUser` terminates active sessions immediately on suspension/deletion |
| 🛡️ | Immutable audit logging | Every administrative operation writes to `audit_logs` with before/after diffs |
| 🛡️ | Client bundle isolation | Admin console is loaded via `React.lazy` chunk so non-admins never download admin JS |
| 🛡️ | Direct URL guard | `/admin` direct route access by Member or Guest triggers Access Denied redirect |
| 🛡️ | Password hashing | All passwords hashed using `bcrypt` / `argon2id`; hashes never returned in API responses |

---

## 4. Required Changes for Web & Mobile Clients

### A. Force-Change-Password Screen
When a member is created by an admin or has their password reset, `users.must_change_password` is set to `true`.
- **Web App**:
  - In authentication response, check `user.must_change_password === true`.
  - If `true`, render a modal or route (`/change-password`) prompting the user to enter their temporary password and select a new password.
  - Call `POST /api/v1/auth/change-password` with `{ current_password, new_password }`.
  - Upon success, clear `must_change_password` and transition to the chat workspace.
- **Mobile App (Flutter / Android)**:
  - Intercept the login response. If `user.must_change_password == true`, push `ChangePasswordScreen` on top of Navigator.
  - Disallow popping or navigating away until `POST /api/v1/auth/change-password` returns `200 OK`.

### B. Suspended / Deactivated User Handling
When an admin suspends, deactivates, or forces logout of a user:
1. **WebSocket Event Listener**:
   - The backend pushes `SESSION_TERMINATED` via WebSocket (`/api/v1/ws`).
   - Listen for `{ type: "SESSION_TERMINATED", payload: { reason: "..." } }`.
   - On receipt:
     - Clear local `officechat_access_token` and `officechat_refresh_token` from storage (`localStorage` / `FlutterSecureStorage`).
     - Display an alert: *"Your session has been terminated by an administrator."*
     - Redirect to the login screen.
2. **HTTP 403 Interceptor**:
   - Both Axios/fetch in web and Dio/http in mobile should inspect error code `ACCOUNT_SUSPENDED`.
   - Clear credentials and immediately route to the login screen.

---

## 5. Seeding the First Owner

To bootstrap a fresh database with an initial workspace and Owner account:

```bash
# In backend directory
go run scripts/seed_owner.go -email="owner@officechat.local" -name="Initial Owner" -password="Admin@Secure2026!" -workspace="Acme Corporation"
```

Default credentials:
- **Email**: `owner@officechat.local`
- **Password**: `Admin@Secure2026!`
- **Role**: `Owner`
