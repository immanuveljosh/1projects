package middleware

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
)

type contextKey string

const (
	UserIDKey        contextKey = "user_id"
	UserEmailKey     contextKey = "user_email"
	UserRoleKey      contextKey = "user_role"
	WorkspaceIDKey   contextKey = "workspace_id"
	WorkspaceRoleKey contextKey = "workspace_role"
)

type DBQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// extractBearerOrCookieToken retrieves the access token from Authorization header, HttpOnly session cookie, or token query parameter
func extractBearerOrCookieToken(r *http.Request) (string, bool, string) {
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
			return "", false, "Invalid authorization header format. Expected 'Bearer <token>'"
		}
		return strings.TrimSpace(parts[1]), true, ""
	}
	if cookie, err := r.Cookie("officechat_access_token"); err == nil && strings.TrimSpace(cookie.Value) != "" {
		return strings.TrimSpace(cookie.Value), true, ""
	}
	if tokenQuery := strings.TrimSpace(r.URL.Query().Get("token")); tokenQuery != "" {
		return tokenQuery, true, ""
	}
	return "", false, "Missing authorization header"
}

// Authenticator validates Bearer tokens or HttpOnly session cookies on protected routes
func Authenticator(tm *tokens.TokenManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr, ok, errMsg := extractBearerOrCookieToken(r)
			if !ok {
				utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", errMsg)
				return
			}

			claims, err := tm.ValidateAccessToken(tokenStr)
			if err != nil {
				utils.Error(w, http.StatusUnauthorized, "INVALID_TOKEN", "Authentication token is invalid or expired")
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, UserEmailKey, claims.Email)
			ctx = context.WithValue(ctx, UserRoleKey, claims.Role)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OptionalAuthenticator extracts user if Bearer token or session cookie is present, but does not block if missing
func OptionalAuthenticator(tm *tokens.TokenManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if tokenStr, ok, _ := extractBearerOrCookieToken(r); ok {
				if claims, err := tm.ValidateAccessToken(tokenStr); err == nil {
					ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
					ctx = context.WithValue(ctx, UserEmailKey, claims.Email)
					ctx = context.WithValue(ctx, UserRoleKey, claims.Role)
					r = r.WithContext(ctx)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// GetUserID retrieves authenticated user ID from context
func GetUserID(ctx context.Context) (string, bool) {
	val, ok := ctx.Value(UserIDKey).(string)
	return val, ok && val != ""
}

// GetUserEmail retrieves authenticated user email from context
func GetUserEmail(ctx context.Context) string {
	val, ok := ctx.Value(UserEmailKey).(string)
	if !ok {
		return ""
	}
	return val
}

// GetUserRole retrieves authenticated user system role from context
func GetUserRole(ctx context.Context) string {
	val, ok := ctx.Value(UserRoleKey).(string)
	if !ok {
		return ""
	}
	return val
}

// GetWorkspaceID retrieves active workspace ID from context
func GetWorkspaceID(ctx context.Context) string {
	val, ok := ctx.Value(WorkspaceIDKey).(string)
	if !ok {
		return ""
	}
	return val
}

// GetWorkspaceRole retrieves active workspace member role from context
func GetWorkspaceRole(ctx context.Context) string {
	val, ok := ctx.Value(WorkspaceRoleKey).(string)
	if !ok {
		return ""
	}
	return val
}

type MemberAuthorizer interface {
	GetMemberRole(ctx context.Context, workspaceID, userID string) (role string, accountState string, err error)
	GetPrimaryWorkspace(ctx context.Context, userID string) (workspaceID string, err error)
}

type SQLMemberAuthorizer struct {
	q DBQuerier
}

func NewSQLMemberAuthorizer(q DBQuerier) MemberAuthorizer {
	return &SQLMemberAuthorizer{q: q}
}

func (s *SQLMemberAuthorizer) GetPrimaryWorkspace(ctx context.Context, userID string) (string, error) {
	var workspaceID string
	err := s.q.QueryRowContext(ctx,
		`SELECT workspace_id FROM workspace_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1`,
		userID,
	).Scan(&workspaceID)
	return workspaceID, err
}

func (s *SQLMemberAuthorizer) GetMemberRole(ctx context.Context, workspaceID, userID string) (string, string, error) {
	var role, accountState string
	err := s.q.QueryRowContext(ctx, `
		SELECT wm.role, COALESCE(u.account_state, 'active')
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND u.deleted_at IS NULL
	`, workspaceID, userID).Scan(&role, &accountState)
	return role, accountState, err
}

// RequireRole enforces role-based access control (e.g. Owner, Admin).
// Returns 401 if unauthenticated, 403 FORBIDDEN if the role is insufficient, account suspended, or user is not in workspace.
func RequireRole(authorizer MemberAuthorizer, allowedRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := GetUserID(r.Context())
			if !ok || userID == "" {
				utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
				return
			}

			// 1. Resolve workspace_id from header X-Workspace-ID or query param
			workspaceID := strings.TrimSpace(r.Header.Get("X-Workspace-ID"))
			if workspaceID == "" {
				workspaceID = strings.TrimSpace(r.URL.Query().Get("workspace_id"))
			}

			// 2. If no workspace passed, lookup user's primary workspace membership
			if workspaceID == "" {
				var err error
				workspaceID, err = authorizer.GetPrimaryWorkspace(r.Context(), userID)
				if err != nil {
					utils.Error(w, http.StatusBadRequest, "WORKSPACE_REQUIRED", "No active workspace identified for this request")
					return
				}
			}

			// 3. Query role and account status within this workspace (prevents cross-tenant IDOR)
			role, accountState, err := authorizer.GetMemberRole(r.Context(), workspaceID, userID)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					utils.Error(w, http.StatusForbidden, "FORBIDDEN", "Access denied: User is not a member of this workspace")
					return
				}
				utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to verify workspace permissions")
				return
			}

			// 4. Block suspended or deactivated accounts
			if strings.EqualFold(accountState, "suspended") || strings.EqualFold(accountState, "deactivated") {
				utils.Error(w, http.StatusForbidden, "ACCOUNT_SUSPENDED", "Your account has been suspended or deactivated")
				return
			}

			// 5. Check if user's role matches any allowed roles (case-insensitive)
			roleAllowed := false
			for _, allowed := range allowedRoles {
				if strings.EqualFold(role, allowed) {
					roleAllowed = true
					break
				}
			}

			if !roleAllowed {
				utils.Error(w, http.StatusForbidden, "FORBIDDEN", "Access denied: insufficient permissions (requires Admin or Owner)")
				return
			}

			// 6. Inject verified workspace_id and role into request context
			ctx := context.WithValue(r.Context(), WorkspaceIDKey, workspaceID)
			ctx = context.WithValue(ctx, WorkspaceRoleKey, role)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RateLimiter implements a simple sliding window rate limiter
type RateLimiter struct {
	mu      sync.Mutex
	clients map[string][]time.Time
	limit   int
	window  time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		clients: make(map[string][]time.Time),
		limit:   limit,
		window:  window,
	}

	// Periodic cleanup routine
	go func() {
		ticker := time.NewTicker(rl.window * 2)
		for range ticker.C {
			rl.mu.Lock()
			cutoff := time.Now().Add(-rl.window)
			for ip, times := range rl.clients {
				var valid []time.Time
				for _, t := range times {
					if t.After(cutoff) {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(rl.clients, ip)
				} else {
					rl.clients[ip] = valid
				}
			}
			rl.mu.Unlock()
		}
	}()

	return rl
}

func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.RemoteAddr
			if cfIP := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cfIP != "" {
				key = cfIP
			} else if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				key = strings.TrimSpace(strings.Split(forwarded, ",")[0])
			}
			// Key by authenticated token when present so multiple office members behind one NAT IP do not throttle each other
			if tok, ok, _ := extractBearerOrCookieToken(r); ok && tok != "" {
				key = "tok:" + tok
			} else if wsTok := strings.TrimSpace(r.URL.Query().Get("token")); wsTok != "" {
				key = "tok:" + wsTok
			}

			rl.mu.Lock()
			now := time.Now()
			cutoff := now.Add(-rl.window)

			times := rl.clients[key]
			var valid []time.Time
			for _, t := range times {
				if t.After(cutoff) {
					valid = append(valid, t)
				}
			}

			if len(valid) >= rl.limit {
				rl.mu.Unlock()
				utils.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests, please slow down")
				return
			}

			valid = append(valid, now)
			rl.clients[key] = valid
			rl.mu.Unlock()

			next.ServeHTTP(w, r)
		})
	}
}
