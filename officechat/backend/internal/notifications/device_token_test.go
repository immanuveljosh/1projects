package notifications_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/config"
	"officechat/backend/internal/db"
	"officechat/backend/internal/notifications"
	"officechat/backend/internal/tokens"

)

func setupTestDB(t *testing.T) (*db.DB, func()) {
	t.Helper()
	cfg := config.Load()
	database, err := db.Connect(cfg)
	if err != nil {
		t.Skipf("Skipping integration test; PostgreSQL not accessible: %v", err)
		return nil, func() {}
	}
	_ = database.RunMigrations("../../migrations")
	return database, func() {
		database.Close()
	}
}

func TestDeviceTokenValidation(t *testing.T) {
	svc := notifications.NewDeviceTokenService(nil)

	// Test empty token
	_, err := svc.UpsertDeviceToken(context.Background(), "user-1", "ws-1", "", "android")
	if err != notifications.ErrEmptyToken {
		t.Errorf("Expected ErrEmptyToken, got %v", err)
	}

	// Test invalid platform
	_, err = svc.UpsertDeviceToken(context.Background(), "user-1", "ws-1", "token-xyz", "windows-phone")
	if err != notifications.ErrInvalidPlatform {
		t.Errorf("Expected ErrInvalidPlatform, got %v", err)
	}

	// Test delete with empty token
	err = svc.DeleteDeviceToken(context.Background(), "user-1", "")
	if err != notifications.ErrEmptyToken {
		t.Errorf("Expected ErrEmptyToken for delete, got %v", err)
	}
}

func TestDeviceTokenHTTPHandler_AuthRequired(t *testing.T) {
	tm := tokens.NewTokenManager("test-secret", "test-refresh", 15*time.Minute, 7*24*time.Hour)
	handler := notifications.NewDeviceTokenHandler(nil, tm)

	r := chi.NewRouter()
	handler.RegisterRoutes(r)

	// Unauthenticated POST /notifications/device-token
	body, _ := json.Marshal(map[string]string{
		"token":    "test_token_123",
		"platform": "android",
	})
	req := httptest.NewRequest(http.MethodPost, "/notifications/device-token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 Unauthorized for unauthenticated request, got %d", w.Code)
	}

	// Unauthenticated DELETE /notifications/device-token
	delReq := httptest.NewRequest(http.MethodDelete, "/notifications/device-token?token=test_token_123", nil)
	delW := httptest.NewRecorder()

	r.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 Unauthorized for unauthenticated DELETE, got %d", delW.Code)
	}
}

func TestDeviceTokenHTTPHandler_Validation(t *testing.T) {
	tm := tokens.NewTokenManager("test-secret", "test-refresh", 15*time.Minute, 7*24*time.Hour)
	accessToken, _, _ := tm.GenerateAccessToken("user-test-id", "test@example.com", "user")

	database, cleanup := setupTestDB(t)
	defer cleanup()

	svc := notifications.NewDeviceTokenService(database)
	handler := notifications.NewDeviceTokenHandler(svc, tm)

	r := chi.NewRouter()
	handler.RegisterRoutes(r)

	// Invalid platform
	badPlatformBody, _ := json.Marshal(map[string]string{
		"token":    "test_token_123",
		"platform": "symbian",
	})
	req := httptest.NewRequest(http.MethodPost, "/notifications/device-token", bytes.NewReader(badPlatformBody))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 Bad Request for invalid platform, got %d", w.Code)
	}

	// Missing token in DELETE query
	delReq := httptest.NewRequest(http.MethodDelete, "/notifications/device-token", nil)
	delReq.Header.Set("Authorization", "Bearer "+accessToken)
	delW := httptest.NewRecorder()

	r.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 Bad Request for missing token in DELETE query, got %d", delW.Code)
	}
}

func TestDeviceToken_LifecycleIntegration(t *testing.T) {
	database, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Create a test user in DB if not exists
	testUserID := "a0000000-0000-0000-0000-000000000001"
	testUserEmail := "devicetoken_test@officechat.local"
	_, err := database.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, full_name, role)
		VALUES ($1, $2, 'hash', 'Device Test User', 'user')
		ON CONFLICT (id) DO NOTHING;
	`, testUserID, testUserEmail)
	if err != nil {
		t.Fatalf("Failed to seed test user: %v", err)
	}

	svc := notifications.NewDeviceTokenService(database)

	// 1. Upsert Device Token
	tokenVal := "fcm_test_token_alpha_1"
	dt, err := svc.UpsertDeviceToken(ctx, testUserID, "", tokenVal, "android")
	if err != nil {
		t.Fatalf("Failed to register device token: %v", err)
	}
	if dt.Token != tokenVal || dt.Platform != "android" || dt.UserID != testUserID {
		t.Errorf("Mismatch in registered device token: %+v", dt)
	}

	// 2. Upsert same token with new platform/timestamp (re-registration)
	dt2, err := svc.UpsertDeviceToken(ctx, testUserID, "", tokenVal, "android")
	if err != nil {
		t.Fatalf("Failed to re-register device token: %v", err)
	}
	if dt2.ID != dt.ID {
		t.Errorf("Expected same ID on upsert conflict, got %s vs %s", dt2.ID, dt.ID)
	}

	// 3. Delete single token
	if err := svc.DeleteDeviceToken(ctx, testUserID, tokenVal); err != nil {
		t.Fatalf("Failed to delete device token: %v", err)
	}

	// Verify deleted
	var count int
	_ = database.QueryRowContext(ctx, `SELECT COUNT(*) FROM device_tokens WHERE token = $1`, tokenVal).Scan(&count)
	if count != 0 {
		t.Errorf("Expected 0 tokens after delete, got %d", count)
	}

	// 4. Test PurgeUserTokens
	t1 := "fcm_test_purge_1"
	t2 := "fcm_test_purge_2"
	_, _ = svc.UpsertDeviceToken(ctx, testUserID, "", t1, "ios")
	_, _ = svc.UpsertDeviceToken(ctx, testUserID, "", t2, "web")

	if err := svc.PurgeUserTokens(ctx, testUserID); err != nil {
		t.Fatalf("Failed to purge user tokens: %v", err)
	}

	_ = database.QueryRowContext(ctx, `SELECT COUNT(*) FROM device_tokens WHERE user_id = $1`, testUserID).Scan(&count)
	if count != 0 {
		t.Errorf("Expected 0 tokens after PurgeUserTokens, got %d", count)
	}

	// Cleanup user
	_, _ = database.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, testUserID)
}
