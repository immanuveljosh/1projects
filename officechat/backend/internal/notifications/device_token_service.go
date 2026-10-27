package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
)

var (
	ErrInvalidPlatform = errors.New("platform must be one of: android, ios, web")
	ErrEmptyToken       = errors.New("token cannot be empty")
)

type DeviceTokenService struct {
	db *db.DB
}

func NewDeviceTokenService(database *db.DB) *DeviceTokenService {
	return &DeviceTokenService{db: database}
}

// UpsertDeviceToken inserts or updates a device token for a user
func (s *DeviceTokenService) UpsertDeviceToken(ctx context.Context, userID, workspaceID, token, platform string) (*models.DeviceToken, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrEmptyToken
	}

	platform = strings.ToLower(strings.TrimSpace(platform))
	if platform != "android" && platform != "ios" && platform != "web" {
		return nil, ErrInvalidPlatform
	}

	var wsParam any
	if strings.TrimSpace(workspaceID) != "" {
		wsParam = workspaceID
	}

	query := `
		INSERT INTO device_tokens (user_id, workspace_id, token, platform, created_at, last_seen_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (token) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			workspace_id = COALESCE(EXCLUDED.workspace_id, device_tokens.workspace_id),
			platform = EXCLUDED.platform,
			last_seen_at = NOW()
		RETURNING id, user_id, workspace_id, token, platform, created_at, last_seen_at;
	`

	var dt models.DeviceToken
	var wsID sql.NullString
	err := s.db.QueryRowContext(ctx, query, userID, wsParam, token, platform).Scan(
		&dt.ID,
		&dt.UserID,
		&wsID,
		&dt.Token,
		&dt.Platform,
		&dt.CreatedAt,
		&dt.LastSeenAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert device token: %w", err)
	}

	if wsID.Valid {
		dt.WorkspaceID = &wsID.String
	}

	return &dt, nil
}

// DeleteDeviceToken removes a single token belonging to the authenticated user
func (s *DeviceTokenService) DeleteDeviceToken(ctx context.Context, userID, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrEmptyToken
	}

	query := `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2;`
	_, err := s.db.ExecContext(ctx, query, token, userID)
	if err != nil {
		return fmt.Errorf("failed to delete device token: %w", err)
	}
	return nil
}

// PurgeUserTokens deletes all device tokens for a given user (on logout, suspension, deletion, force logout)
func (s *DeviceTokenService) PurgeUserTokens(ctx context.Context, userID string) error {
	query := `DELETE FROM device_tokens WHERE user_id = $1;`
	_, err := s.db.ExecContext(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("failed to purge user device tokens: %w", err)
	}
	return nil
}

// PurgeWorkspaceTokens deletes all device tokens for an entire workspace (on emergency logout)
func (s *DeviceTokenService) PurgeWorkspaceTokens(ctx context.Context, workspaceID string) error {
	query := `
		DELETE FROM device_tokens 
		WHERE workspace_id = $1 
		   OR user_id IN (SELECT user_id FROM workspace_members WHERE workspace_id = $1);
	`
	_, err := s.db.ExecContext(ctx, query, workspaceID)
	if err != nil {
		return fmt.Errorf("failed to purge workspace device tokens: %w", err)
	}
	return nil
}
