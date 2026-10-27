package admin_test

import (
	"strings"
	"testing"

	"officechat/backend/internal/admin"
)

func TestGenerateSecurePassword(t *testing.T) {
	pwd, err := admin.GenerateSecurePassword(16)
	if err != nil {
		t.Fatalf("failed to generate secure password: %v", err)
	}

	if len(pwd) != 16 {
		t.Errorf("expected length 16, got %d", len(pwd))
	}

	hasUpper := strings.ContainsAny(pwd, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
	hasLower := strings.ContainsAny(pwd, "abcdefghijklmnopqrstuvwxyz")
	hasNumber := strings.ContainsAny(pwd, "0123456789")
	hasSpecial := strings.ContainsAny(pwd, "!@#$%^&*()-_=+[]{}|;:,.<>?")

	if !hasUpper {
		t.Errorf("password must contain uppercase character: %s", pwd)
	}
	if !hasLower {
		t.Errorf("password must contain lowercase character: %s", pwd)
	}
	if !hasNumber {
		t.Errorf("password must contain number character: %s", pwd)
	}
	if !hasSpecial {
		t.Errorf("password must contain special character: %s", pwd)
	}
}

func TestGenerateSecurePasswordMinimumLength(t *testing.T) {
	// Requesting length < 12 defaults to 16
	pwd, err := admin.GenerateSecurePassword(6)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pwd) < 12 {
		t.Errorf("expected minimum length enforced, got %d", len(pwd))
	}
}
