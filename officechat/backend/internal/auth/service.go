package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"officechat/backend/internal/audit"
	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
)

var (
	ErrInvalidEmail       = errors.New("invalid email format")
	ErrWeakPassword       = errors.New("password must be at least 6 characters")
	ErrEmailAlreadyExists = errors.New("email is already registered")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserNotFound       = errors.New("user not found")
	ErrInvalidToken       = errors.New("refresh token is invalid, expired, or revoked")
)

type Service struct {
	db *db.DB
	tm *tokens.TokenManager
}

func NewService(database *db.DB, tm *tokens.TokenManager) *Service {
	return &Service{
		db: database,
		tm: tm,
	}
}

// Register creates a new user account and returns authentication tokens
func (s *Service) Register(ctx context.Context, req models.RegisterRequest, userAgent, ipAddress string) (*models.AuthResponse, error) {
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	if _, err := mail.ParseAddress(req.Email); err != nil {
		return nil, ErrInvalidEmail
	}
	if len(req.Password) < 6 {
		return nil, ErrWeakPassword
	}
	if req.FullName == "" {
		return nil, errors.New("full name is required")
	}
	if req.DisplayName == "" {
		req.DisplayName = req.FullName
	}

	// Check if email already registered
	var existingID string
	checkQuery := `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1;`
	err := s.db.QueryRowContext(ctx, checkQuery, req.Email).Scan(&existingID)
	if err == nil {
		return nil, ErrEmailAlreadyExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("failed checking existing user: %w", err)
	}

	passHash, err := tokens.HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed hashing password: %w", err)
	}

	user := models.User{
		Email:        req.Email,
		PasswordHash: passHash,
		FullName:     req.FullName,
		DisplayName:  req.DisplayName,
		AvatarURL:    "",
		Role:         models.SystemRoleUser,
		Status:       models.StatusOnline,
		CustomStatus: "",
	}

	insertQuery := `
		INSERT INTO users (email, password_hash, full_name, display_name, avatar_url, role, status, custom_status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		RETURNING id, created_at, updated_at;
	`
	err = s.db.QueryRowContext(ctx, insertQuery,
		user.Email, user.PasswordHash, user.FullName, user.DisplayName,
		user.AvatarURL, user.Role, user.Status, user.CustomStatus,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed creating user: %w", err)
	}

	// Automatically attach user to target or default workspace as Member
	targetWS := req.WorkspaceID
	if targetWS == "" {
		_ = s.db.QueryRowContext(ctx, `SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`).Scan(&targetWS)
	}
	if targetWS != "" {
		_, _ = s.db.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
			VALUES ($1, $2, 'Member', NOW(), NOW())
			ON CONFLICT (workspace_id, user_id) DO NOTHING;
		`, targetWS, user.ID)
	}

	// Generate tokens
	accessToken, expiresIn, err := s.tm.GenerateAccessToken(user.ID, user.Email, user.Role)
	if err != nil {
		return nil, err
	}

	rawRefresh, tokenHash, refreshExpiresAt, err := s.tm.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	refreshInsert := `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW());
	`
	_, err = s.db.ExecContext(ctx, refreshInsert, user.ID, tokenHash, refreshExpiresAt, userAgent, ipAddress)
	if err != nil {
		return nil, fmt.Errorf("failed storing refresh token: %w", err)
	}

	return &models.AuthResponse{
		User:         user.ToResponse(),
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    expiresIn,
	}, nil
}

// Login verifies credentials and issues new tokens
func (s *Service) Login(ctx context.Context, req models.LoginRequest, userAgent, ipAddress string) (*models.AuthResponse, error) {
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	var user models.User
	query := `
		SELECT id, email, password_hash, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''), role, status, COALESCE(custom_status, ''), created_at, updated_at
		FROM users
		WHERE email = $1 AND deleted_at IS NULL
		LIMIT 1;
	`
	err := s.db.QueryRowContext(ctx, query, req.Email).Scan(
		&user.ID, &user.Email, &user.PasswordHash, &user.FullName, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.Status, &user.CustomStatus, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("error querying user: %w", err)
	}

	if !tokens.CheckPassword(user.PasswordHash, req.Password) {
		return nil, ErrInvalidCredentials
	}

	// Update user status to online upon login
	_, _ = s.db.ExecContext(ctx, `UPDATE users SET status = $1, status_updated_at = NOW() WHERE id = $2`, models.StatusOnline, user.ID)
	user.Status = models.StatusOnline

	accessToken, expiresIn, err := s.tm.GenerateAccessToken(user.ID, user.Email, user.Role)
	if err != nil {
		return nil, err
	}

	rawRefresh, tokenHash, refreshExpiresAt, err := s.tm.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	refreshInsert := `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW());
	`
	_, err = s.db.ExecContext(ctx, refreshInsert, user.ID, tokenHash, refreshExpiresAt, userAgent, ipAddress)
	if err != nil {
		return nil, fmt.Errorf("failed storing refresh token: %w", err)
	}

	return &models.AuthResponse{
		User:         user.ToResponse(),
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    expiresIn,
	}, nil
}

// RefreshToken validates refresh token and rotates it
func (s *Service) RefreshToken(ctx context.Context, rawRefreshToken, userAgent, ipAddress string) (*models.AuthResponse, error) {
	if rawRefreshToken == "" {
		return nil, ErrInvalidToken
	}

	tokenHash := tokens.HashRefreshToken(rawRefreshToken)

	var tokenID, userID string
	var expiresAt time.Time
	var revokedAt *time.Time

	query := `
		SELECT id, user_id, expires_at, revoked_at
		FROM refresh_tokens
		WHERE token_hash = $1
		LIMIT 1;
	`
	err := s.db.QueryRowContext(ctx, query, tokenHash).Scan(&tokenID, &userID, &expiresAt, &revokedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidToken
		}
		return nil, fmt.Errorf("failed querying refresh token: %w", err)
	}

	if revokedAt != nil || time.Now().After(expiresAt) {
		return nil, ErrInvalidToken
	}

	// Fetch user details
	var user models.User
	userQuery := `
		SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''), role, status, COALESCE(custom_status, ''), created_at, updated_at
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
		LIMIT 1;
	`
	err = s.db.QueryRowContext(ctx, userQuery, userID).Scan(
		&user.ID, &user.Email, &user.FullName, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.Status, &user.CustomStatus, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, ErrUserNotFound
	}

	// Revoke old refresh token (token rotation)
	_, _ = s.db.ExecContext(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, tokenID)

	// Issue new access and refresh tokens
	accessToken, expiresIn, err := s.tm.GenerateAccessToken(user.ID, user.Email, user.Role)
	if err != nil {
		return nil, err
	}

	newRawRefresh, newTokenHash, newRefreshExpiresAt, err := s.tm.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	refreshInsert := `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW());
	`
	_, err = s.db.ExecContext(ctx, refreshInsert, user.ID, newTokenHash, newRefreshExpiresAt, userAgent, ipAddress)
	if err != nil {
		return nil, fmt.Errorf("failed storing new refresh token: %w", err)
	}

	return &models.AuthResponse{
		User:         user.ToResponse(),
		AccessToken:  accessToken,
		RefreshToken: newRawRefresh,
		ExpiresIn:    expiresIn,
	}, nil
}

// Logout revokes refresh token and purges user's device push tokens
func (s *Service) Logout(ctx context.Context, rawRefreshToken string) error {
	if rawRefreshToken == "" {
		return nil
	}
	tokenHash := tokens.HashRefreshToken(rawRefreshToken)
	var userID string
	_ = s.db.QueryRowContext(ctx, `SELECT user_id FROM refresh_tokens WHERE token_hash = $1`, tokenHash).Scan(&userID)

	query := `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL;`
	_, err := s.db.ExecContext(ctx, query, tokenHash)

	if userID != "" {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1;`, userID)
	}
	return err
}

// PurgeDeviceTokens deletes all push notification tokens for a user
func (s *Service) PurgeDeviceTokens(ctx context.Context, userID string) error {
	if userID == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1;`, userID)
	return err
}


// GetUserByID retrieves a user profile by ID
func (s *Service) GetUserByID(ctx context.Context, userID string) (*models.UserResponse, error) {
	var user models.User
	query := `
		SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''), role, status, COALESCE(custom_status, ''), created_at, updated_at
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
		LIMIT 1;
	`
	err := s.db.QueryRowContext(ctx, query, userID).Scan(
		&user.ID, &user.Email, &user.FullName, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.Status, &user.CustomStatus, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	resp := user.ToResponse()
	return &resp, nil
}

// UpdateProfile updates the current user's profile details or presence status
func (s *Service) UpdateProfile(ctx context.Context, userID string, req models.UpdateProfileRequest) (*models.UserResponse, error) {
	var user models.User
	query := `
		SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''), role, status, COALESCE(custom_status, ''), created_at, updated_at
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
		LIMIT 1;
	`
	err := s.db.QueryRowContext(ctx, query, userID).Scan(
		&user.ID, &user.Email, &user.FullName, &user.DisplayName,
		&user.AvatarURL, &user.Role, &user.Status, &user.CustomStatus, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, ErrUserNotFound
	}

	if req.FullName != nil && strings.TrimSpace(*req.FullName) != "" {
		user.FullName = strings.TrimSpace(*req.FullName)
	}
	if req.DisplayName != nil {
		user.DisplayName = strings.TrimSpace(*req.DisplayName)
	}
	if req.AvatarURL != nil {
		user.AvatarURL = strings.TrimSpace(*req.AvatarURL)
	}
	if req.Status != nil {
		st := strings.ToLower(strings.TrimSpace(*req.Status))
		if st == models.StatusOnline || st == models.StatusAway || st == models.StatusDND || st == models.StatusOffline {
			user.Status = st
		}
	}
	if req.CustomStatus != nil {
		user.CustomStatus = strings.TrimSpace(*req.CustomStatus)
	}

	updateQuery := `
		UPDATE users
		SET full_name = $1, display_name = $2, avatar_url = $3, status = $4, custom_status = $5, status_updated_at = NOW(), updated_at = NOW()
		WHERE id = $6;
	`
	_, err = s.db.ExecContext(ctx, updateQuery, user.FullName, user.DisplayName, user.AvatarURL, user.Status, user.CustomStatus, user.ID)
	if err != nil {
		return nil, fmt.Errorf("failed updating user: %w", err)
	}

	resp := user.ToResponse()
	return &resp, nil
}

// ChangePassword updates an authenticated user's own password, validating against workspace password policy
func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string, ip, ua string) error {
	if currentPassword == "" || newPassword == "" {
		return errors.New("current password and new password are required")
	}

	if currentPassword == newPassword {
		return errors.New("new password cannot be the same as your current password")
	}

	// 1. Fetch user password hash
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`, userID).Scan(&hash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrUserNotFound
		}
		return fmt.Errorf("failed to fetch user: %w", err)
	}

	// 2. Verify current password
	if !tokens.CheckPassword(hash, currentPassword) {
		return errors.New("current password is incorrect")
	}

	// 3. Resolve user's primary workspace and validate policy
	var workspaceID string
	_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM workspace_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1`, userID).Scan(&workspaceID)

	minLen := 8
	reqSpecial := false
	reqNumber := false

	if workspaceID != "" {
		var wsMinLen int
		var wsReqSpecial, wsReqNumber bool
		err := s.db.QueryRowContext(ctx, `
			SELECT min_password_length, require_special_char, require_number 
			FROM workspace_settings 
			WHERE workspace_id = $1
		`, workspaceID).Scan(&wsMinLen, &wsReqSpecial, &wsReqNumber)
		if err == nil {
			if wsMinLen > 0 {
				minLen = wsMinLen
			}
			reqSpecial = wsReqSpecial
			reqNumber = wsReqNumber
		}
	}

	if len(newPassword) < minLen {
		return fmt.Errorf("password must be at least %d characters long", minLen)
	}
	if reqSpecial && !strings.ContainsAny(newPassword, "!@#$%^&*()-_=+[]{}|;:,.<>?") {
		return errors.New("password must contain at least one special character")
	}
	if reqNumber && !strings.ContainsAny(newPassword, "0123456789") {
		return errors.New("password must contain at least one number")
	}

	// 4. Hash new password and save
	newHash, err := tokens.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash new password: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE users 
		SET password_hash = $1, 
		    must_change_password = FALSE, 
		    password_changed_at = NOW(), 
		    failed_login_count = 0, 
		    locked_until = NULL, 
		    updated_at = NOW() 
		WHERE id = $2
	`, newHash, userID)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// 5. Invalidate existing refresh tokens to revoke other sessions
	_, _ = s.db.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)

	// 6. Audit log
	if workspaceID != "" {
		_ = audit.Record(ctx, s.db, audit.LogEntry{
			WorkspaceID: workspaceID,
			ActorID:     userID,
			Action:      "auth.change_password",
			TargetType:  "user",
			TargetID:    userID,
			IPAddress:   ip,
			UserAgent:   ua,
		})
	}

	return nil
}
