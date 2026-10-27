package admin

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"

	"officechat/backend/internal/db"
	"officechat/backend/internal/tokens"
)

var (
	ErrInvalidAdminPassword = errors.New("admin password verification failed")
	ErrAdminNotFound        = errors.New("admin user record not found")
)

const (
	upperChars   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	lowerChars   = "abcdefghijklmnopqrstuvwxyz"
	numberChars  = "0123456789"
	specialChars = "!@#$%^&*()-_=+[]{}|;:,.<>?"
	allChars     = upperChars + lowerChars + numberChars + specialChars
)

// GenerateSecurePassword generates a cryptographically random, high-entropy password
func GenerateSecurePassword(length int) (string, error) {
	if length < 12 {
		length = 16
	}

	result := make([]byte, length)

	// Ensure at least one character from each character class
	classes := []string{upperChars, lowerChars, numberChars, specialChars}
	for i, class := range classes {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(class))))
		if err != nil {
			return "", fmt.Errorf("failed to generate random character: %w", err)
		}
		result[i] = class[idx.Int64()]
	}

	// Fill the remaining length with characters chosen from all classes
	for i := len(classes); i < length; i++ {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(allChars))))
		if err != nil {
			return "", fmt.Errorf("failed to generate random character: %w", err)
		}
		result[i] = allChars[idx.Int64()]
	}

	// Fisher-Yates shuffle using cryptographically secure random numbers
	for i := length - 1; i > 0; i-- {
		j, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", fmt.Errorf("failed to shuffle characters: %w", err)
		}
		result[i], result[j.Int64()] = result[j.Int64()], result[i]
	}

	return string(result), nil
}

// VerifyAdminPassword verifies the administrator's credentials before sensitive operations
func VerifyAdminPassword(ctx context.Context, database *db.DB, adminID, password string) error {
	if password == "" {
		return ErrInvalidAdminPassword
	}

	var hash string
	err := database.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`, adminID).Scan(&hash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAdminNotFound
		}
		return fmt.Errorf("failed to query admin credentials: %w", err)
	}

	if !tokens.CheckPassword(hash, password) {
		return ErrInvalidAdminPassword
	}

	return nil
}
