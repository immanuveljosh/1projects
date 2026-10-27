package middleware_test

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
)

type mockAuthorizer struct {
	memberships map[string]struct {
		role         string
		accountState string
	}
	primaryWorkspaces map[string]string
}

func (m *mockAuthorizer) GetMemberRole(ctx context.Context, workspaceID, userID string) (string, string, error) {
	key := workspaceID + ":" + userID
	if data, ok := m.memberships[key]; ok {
		return data.role, data.accountState, nil
	}
	return "", "", sql.ErrNoRows
}

func (m *mockAuthorizer) GetPrimaryWorkspace(ctx context.Context, userID string) (string, error) {
	if ws, ok := m.primaryWorkspaces[userID]; ok {
		return ws, nil
	}
	return "", sql.ErrNoRows
}

func TestRequireRole(t *testing.T) {
	authorizer := &mockAuthorizer{
		memberships: map[string]struct {
			role         string
			accountState string
		}{
			"ws_1:usr_owner":     {role: models.RoleOwner, accountState: models.AccountStateActive},
			"ws_1:usr_admin":     {role: models.RoleAdmin, accountState: models.AccountStateActive},
			"ws_1:usr_member":    {role: models.RoleMember, accountState: models.AccountStateActive},
			"ws_1:usr_guest":     {role: models.RoleGuest, accountState: models.AccountStateActive},
			"ws_1:usr_suspended": {role: models.RoleAdmin, accountState: models.AccountStateSuspended},
			"ws_2:usr_admin":     {role: models.RoleAdmin, accountState: models.AccountStateActive},
		},
		primaryWorkspaces: map[string]string{
			"usr_owner":     "ws_1",
			"usr_admin":     "ws_1",
			"usr_member":    "ws_1",
			"usr_guest":     "ws_1",
			"usr_suspended": "ws_1",
		},
	}

	handler := middleware.RequireRole(authorizer, models.RoleOwner, models.RoleAdmin)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsID := middleware.GetWorkspaceID(r.Context())
		role := middleware.GetWorkspaceRole(r.Context())
		w.Header().Set("X-Result-Workspace", wsID)
		w.Header().Set("X-Result-Role", role)
		w.WriteHeader(http.StatusOK)
	}))

	// Case 1: Unauthenticated request (no user in context) -> 401
	{
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/members", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for unauthenticated request, got %d", rr.Code)
		}
	}

	// Case 2: Member or Guest -> 403 Forbidden
	for _, nonAdminID := range []string{"usr_member", "usr_guest"} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/members", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, nonAdminID))
		req.Header.Set("X-Workspace-ID", "ws_1")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Errorf("expected 403 for %s, got %d", nonAdminID, rr.Code)
		}
	}

	// Case 3: Admin access -> 200 OK
	{
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/members", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "usr_admin"))
		req.Header.Set("X-Workspace-ID", "ws_1")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 for Admin, got %d", rr.Code)
		}
		if rr.Header().Get("X-Result-Role") != models.RoleAdmin {
			t.Errorf("expected context role Admin, got %s", rr.Header().Get("X-Result-Role"))
		}
	}

	// Case 4: Owner access -> 200 OK
	{
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/members", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "usr_owner"))
		req.Header.Set("X-Workspace-ID", "ws_1")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 for Owner, got %d", rr.Code)
		}
		if rr.Header().Get("X-Result-Role") != models.RoleOwner {
			t.Errorf("expected context role Owner, got %s", rr.Header().Get("X-Result-Role"))
		}
	}

	// Case 5: Suspended Admin -> 403 Account Suspended
	{
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/members", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "usr_suspended"))
		req.Header.Set("X-Workspace-ID", "ws_1")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Errorf("expected 403 for suspended user, got %d", rr.Code)
		}
	}

	// Case 6: Cross-workspace IDOR attempt (user tries to access ws_99 where they don't belong) -> 403
	{
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/members", nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "usr_admin"))
		req.Header.Set("X-Workspace-ID", "ws_99")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Errorf("expected 403 for cross-workspace IDOR access, got %d", rr.Code)
		}
	}
}
