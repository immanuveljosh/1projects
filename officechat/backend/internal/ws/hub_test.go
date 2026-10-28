package ws_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"officechat/backend/internal/tokens"
	"officechat/backend/internal/ws"
)

func TestHubServeHTTP_RejectsUnauthenticated(t *testing.T) {
	tm := tokens.NewTokenManager("test-access-secret-32-bytes-long!!", "test-refresh-secret-32-bytes-long!", 15*time.Minute, 24*time.Hour)
	hub := ws.NewHub(tm)

	// Missing token -> 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws", nil)
	rr := httptest.NewRecorder()
	hub.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token, got %d", rr.Code)
	}

	// Invalid token -> 401
	reqInvalid := httptest.NewRequest(http.MethodGet, "/api/v1/ws?token=invalid.jwt.token", nil)
	rrInvalid := httptest.NewRecorder()
	hub.ServeHTTP(rrInvalid, reqInvalid)
	if rrInvalid.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", rrInvalid.Code)
	}
}

