package tokens_test

import (
	"testing"
	"time"

	"officechat/backend/internal/tokens"
)

func TestHashPasswordAndCheck(t *testing.T) {
	password := "SecretP@ssw0rd!"

	hash, err := tokens.HashPassword(password)
	if err != nil {
		t.Fatalf("unexpected error hashing password: %v", err)
	}

	if hash == password {
		t.Fatalf("hash should not match plain password")
	}

	if !tokens.CheckPassword(hash, password) {
		t.Fatalf("password check should have succeeded for valid password")
	}

	if tokens.CheckPassword(hash, "WrongPassword!") {
		t.Fatalf("password check should have failed for incorrect password")
	}
}

func TestAccessTokenGenerationAndValidation(t *testing.T) {
	accessSecret := "my_test_access_secret_32bytes_long!"
	refreshSecret := "my_test_refresh_secret_32bytes_long!"
	tm := tokens.NewTokenManager(accessSecret, refreshSecret, 15*time.Minute, 24*time.Hour)

	userID := "usr_12345"
	email := "test@officechat.com"
	role := "admin"

	tokenStr, expiresIn, err := tm.GenerateAccessToken(userID, email, role)
	if err != nil {
		t.Fatalf("failed to generate access token: %v", err)
	}
	if tokenStr == "" {
		t.Fatalf("token string should not be empty")
	}
	if expiresIn <= 0 {
		t.Fatalf("expiresIn should be positive, got: %d", expiresIn)
	}

	claims, err := tm.ValidateAccessToken(tokenStr)
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("expected userID %s, got %s", userID, claims.UserID)
	}
	if claims.Email != email {
		t.Errorf("expected email %s, got %s", email, claims.Email)
	}
	if claims.Role != role {
		t.Errorf("expected role %s, got %s", role, claims.Role)
	}
}

func TestExpiredAccessToken(t *testing.T) {
	tm := tokens.NewTokenManager("secret_key_1234567890123456789012", "secret_key_1234567890123456789012", -1*time.Minute, 1*time.Hour)

	tokenStr, _, err := tm.GenerateAccessToken("usr_1", "usr@test.com", "user")
	if err != nil {
		t.Fatalf("failed generating token: %v", err)
	}

	_, err = tm.ValidateAccessToken(tokenStr)
	if err == nil {
		t.Fatalf("expected error validating expired token, got nil")
	}
}

func TestRefreshTokenGenerationAndHashing(t *testing.T) {
	tm := tokens.NewTokenManager("secret12345678901234567890123456", "secret12345678901234567890123456", 15*time.Minute, 7*24*time.Hour)

	raw, hash, expiresAt, err := tm.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("failed to generate refresh token: %v", err)
	}
	if raw == "" || hash == "" {
		t.Fatalf("tokens must not be empty")
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("refresh expiry must be in the future")
	}

	expectedHash := tokens.HashRefreshToken(raw)
	if hash != expectedHash {
		t.Errorf("hash mismatch: expected %s, got %s", expectedHash, hash)
	}
}
