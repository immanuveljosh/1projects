package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
)

type NotificationService struct {
	db *db.DB
}

func NewNotificationService(database *db.DB) *NotificationService {
	return &NotificationService{db: database}
}

// ListNotifications retrieves notifications for a user, sorted descending by created_at
func (s *NotificationService) ListNotifications(ctx context.Context, userID, workspaceID string, limit int) ([]models.Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT id, user_id, workspace_id, type, title, body, data, is_read, read_at, created_at
		FROM notifications
		WHERE user_id = $1 AND ($2 = '' OR workspace_id = $2::uuid)
		ORDER BY created_at DESC
		LIMIT $3;
	`

	rows, err := s.db.QueryContext(ctx, query, userID, workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query notifications: %w", err)
	}
	defer rows.Close()

	var notifs []models.Notification
	for rows.Next() {
		var n models.Notification
		var rawData []byte
		var readAt *time.Time
		if err := rows.Scan(&n.ID, &n.UserID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &rawData, &n.IsRead, &readAt, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan notification: %w", err)
		}
		if len(rawData) > 0 {
			_ = json.Unmarshal(rawData, &n.Data)
		}
		n.ReadAt = readAt
		notifs = append(notifs, n)
	}

	if notifs == nil {
		notifs = []models.Notification{}
	}
	return notifs, nil
}

// MarkAsRead marks a single notification as read
func (s *NotificationService) MarkAsRead(ctx context.Context, userID, notificationID string) error {
	query := `
		UPDATE notifications
		SET is_read = TRUE, read_at = NOW()
		WHERE id = $1 AND user_id = $2;
	`
	_, err := s.db.ExecContext(ctx, query, notificationID, userID)
	return err
}

// MarkAllAsRead marks all unread notifications for a user as read
func (s *NotificationService) MarkAllAsRead(ctx context.Context, userID, workspaceID string) error {
	query := `
		UPDATE notifications
		SET is_read = TRUE, read_at = NOW()
		WHERE user_id = $1 AND is_read = FALSE AND ($2 = '' OR workspace_id = $2::uuid);
	`
	_, err := s.db.ExecContext(ctx, query, userID, workspaceID)
	return err
}
