package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/ws"
)

var (
	ErrChannelNotFound  = errors.New("channel not found")
	ErrChannelForbidden = errors.New("access denied: you are not a member of this private channel")
)

type ChannelService struct {
	db  *db.DB
	hub *ws.Hub
}

func NewChannelService(database *db.DB, hub *ws.Hub) *ChannelService {
	return &ChannelService{db: database, hub: hub}
}

// ListWorkspaceChannels lists channels visible to the user
func (s *ChannelService) ListWorkspaceChannels(ctx context.Context, workspaceID, userID string) ([]models.Channel, error) {
	query := `
		SELECT c.id, c.workspace_id, c.name, COALESCE(c.description, ''), COALESCE(c.topic, ''),
		       c.is_private, c.is_archived, c.is_announcement, c.created_by, c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) as member_count,
		       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2) as is_member,
		       COALESCE((SELECT unread_count FROM read_states rs WHERE rs.channel_id = c.id AND rs.user_id = $2), 0) as unread_count
		FROM channels c
		WHERE c.workspace_id = $1 AND c.is_archived = FALSE
		  AND (c.is_private = FALSE OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2))
		ORDER BY c.name ASC;
	`
	rows, err := s.db.QueryContext(ctx, query, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed querying channels: %w", err)
	}
	defer rows.Close()

	var channels []models.Channel
	for rows.Next() {
		var c models.Channel
		if err := rows.Scan(
			&c.ID, &c.WorkspaceID, &c.Name, &c.Description, &c.Topic,
			&c.IsPrivate, &c.IsArchived, &c.IsAnnouncement, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt,
			&c.MemberCount, &c.IsMember, &c.UnreadCount,
		); err != nil {
			return nil, fmt.Errorf("failed scanning channel: %w", err)
		}
		channels = append(channels, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating channels: %w", err)
	}
	if channels == nil {
		channels = []models.Channel{}
	}
	return channels, nil
}

// CreateChannel creates a channel and adds creator
func (s *ChannelService) CreateChannel(ctx context.Context, workspaceID, userID string, req models.CreateChannelRequest) (*models.Channel, error) {
	name := strings.TrimSpace(strings.ToLower(req.Name))
	name = strings.TrimPrefix(name, "#")
	if name == "" {
		return nil, errors.New("channel name is required")
	}

	var ch models.Channel
	err := s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		query := `
			INSERT INTO channels (workspace_id, name, description, topic, is_private, is_announcement, created_by, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
			RETURNING id, workspace_id, name, description, topic, is_private, is_archived, is_announcement, created_by, created_at, updated_at;
		`
		if err := tx.QueryRowContext(ctx, query, workspaceID, name, req.Description, req.Topic, req.IsPrivate, req.IsAnnouncement, userID).Scan(
			&ch.ID, &ch.WorkspaceID, &ch.Name, &ch.Description, &ch.Topic,
			&ch.IsPrivate, &ch.IsArchived, &ch.IsAnnouncement, &ch.CreatedBy, &ch.CreatedAt, &ch.UpdatedAt,
		); err != nil {
			return fmt.Errorf("failed creating channel: %w", err)
		}

		// Add creator as Admin member
		_, err := tx.ExecContext(ctx, `
			INSERT INTO channel_members (channel_id, user_id, role, joined_at)
			VALUES ($1, $2, 'Admin', NOW());
		`, ch.ID, userID)
		return err
	})

	if err != nil {
		return nil, err
	}

	ch.IsMember = true
	ch.MemberCount = 1

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "channel.created", ch)
	}

	return &ch, nil
}

// GetChannel retrieves a single channel
func (s *ChannelService) GetChannel(ctx context.Context, channelID, userID string) (*models.Channel, error) {
	query := `
		SELECT c.id, c.workspace_id, c.name, COALESCE(c.description, ''), COALESCE(c.topic, ''),
		       c.is_private, c.is_archived, c.is_announcement, c.created_by, c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) as member_count,
		       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2) as is_member,
		       COALESCE((SELECT unread_count FROM read_states rs WHERE rs.channel_id = c.id AND rs.user_id = $2), 0) as unread_count
		FROM channels c
		WHERE c.id = $1;
	`
	var c models.Channel
	err := s.db.QueryRowContext(ctx, query, channelID, userID).Scan(
		&c.ID, &c.WorkspaceID, &c.Name, &c.Description, &c.Topic,
		&c.IsPrivate, &c.IsArchived, &c.IsAnnouncement, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt,
		&c.MemberCount, &c.IsMember, &c.UnreadCount,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChannelNotFound
		}
		return nil, err
	}
	if c.IsPrivate && !c.IsMember {
		return nil, ErrChannelForbidden
	}
	return &c, nil
}

// JoinChannel adds the user to channel_members (only allowed for public channels)
func (s *ChannelService) JoinChannel(ctx context.Context, channelID, userID string) error {
	var isPrivate bool
	err := s.db.QueryRowContext(ctx, `SELECT is_private FROM channels WHERE id = $1`, channelID).Scan(&isPrivate)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrChannelNotFound
		}
		return err
	}
	if isPrivate {
		return ErrChannelForbidden
	}

	query := `
		INSERT INTO channel_members (channel_id, user_id, role, joined_at)
		VALUES ($1, $2, 'Member', NOW())
		ON CONFLICT (channel_id, user_id) DO NOTHING;
	`
	_, err = s.db.ExecContext(ctx, query, channelID, userID)
	return err
}

// LeaveChannel removes user from channel_members
func (s *ChannelService) LeaveChannel(ctx context.Context, channelID, userID string) error {
	query := `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2;`
	_, err := s.db.ExecContext(ctx, query, channelID, userID)
	return err
}
