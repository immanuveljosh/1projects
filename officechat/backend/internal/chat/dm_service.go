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
	ErrDMNotFound  = errors.New("direct message conversation not found")
	ErrDMForbidden = errors.New("access denied: you are not a participant in this direct message")
)

type DMService struct {
	db  *db.DB
	hub *ws.Hub
}

func NewDMService(database *db.DB, hub *ws.Hub) *DMService {
	return &DMService{db: database, hub: hub}
}

// ListUserDMs returns all DM conversations for the user in a workspace
func (s *DMService) ListUserDMs(ctx context.Context, workspaceID, userID string) ([]models.DirectMessageGroup, error) {
	query := `
		SELECT g.id, g.workspace_id, g.is_group, COALESCE(g.name, ''), g.created_at, g.updated_at,
		       COALESCE((SELECT unread_count FROM read_states rs WHERE rs.dm_group_id = g.id AND rs.user_id = $2), 0) as unread_count
		FROM direct_message_groups g
		JOIN direct_message_members dmm ON g.id = dmm.dm_group_id
		WHERE g.workspace_id = $1 AND dmm.user_id = $2
		ORDER BY g.updated_at DESC;
	`
	rows, err := s.db.QueryContext(ctx, query, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed querying user DMs: %w", err)
	}
	defer rows.Close()

	var groups []models.DirectMessageGroup
	for rows.Next() {
		var g models.DirectMessageGroup
		if err := rows.Scan(&g.ID, &g.WorkspaceID, &g.IsGroup, &g.Name, &g.CreatedAt, &g.UpdatedAt, &g.UnreadCount); err != nil {
			return nil, fmt.Errorf("failed scanning DM group: %w", err)
		}
		groups = append(groups, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating user DMs: %w", err)
	}

	// For each group, load other members
	for i := range groups {
		memberRows, err := s.db.QueryContext(ctx, `
			SELECT u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
			       u.role, COALESCE(u.department, ''), COALESCE(u.account_state, 'active'),
			       u.must_change_password, u.status, COALESCE(u.custom_status, ''), u.created_at
			FROM users u
			JOIN direct_message_members dmm ON u.id = dmm.user_id
			WHERE dmm.dm_group_id = $1
		`, groups[i].ID)
		if err == nil {
			var members []models.UserResponse
			for memberRows.Next() {
				var u models.UserResponse
				if err := memberRows.Scan(
					&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
					&u.Role, &u.Department, &u.AccountState,
					&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
				); err == nil {
					members = append(members, u)
				}
			}
			_ = memberRows.Err()
			memberRows.Close()
			groups[i].Members = members
		}
	}

	if groups == nil {
		groups = []models.DirectMessageGroup{}
	}
	return groups, nil
}

// GetOrCreateDM creates or finds existing 1:1 or group DM
func (s *DMService) GetOrCreateDM(ctx context.Context, workspaceID, userID string, req models.CreateDMRequest) (*models.DirectMessageGroup, error) {
	if len(req.TargetUserIDs) == 0 {
		return nil, errors.New("at least one target user is required")
	}

	allUserIDs := append([]string{userID}, req.TargetUserIDs...)
	// Deduplicate
	userMap := make(map[string]bool)
	var uniqueUsers []string
	for _, u := range allUserIDs {
		if !userMap[u] {
			userMap[u] = true
			uniqueUsers = append(uniqueUsers, u)
		}
	}

	isGroup := len(uniqueUsers) > 2
	var name string
	if req.Name != nil {
		name = *req.Name
	}

	// If 1:1 DM, check if already exists
	if !isGroup && len(uniqueUsers) == 2 {
		otherUserID := uniqueUsers[1]
		if uniqueUsers[0] != userID {
			otherUserID = uniqueUsers[0]
		}

		var existingGroupID string
		findQuery := `
			SELECT g.id
			FROM direct_message_groups g
			WHERE g.workspace_id = $1 AND g.is_group = FALSE
			  AND EXISTS (SELECT 1 FROM direct_message_members m WHERE m.dm_group_id = g.id AND m.user_id = $2)
			  AND EXISTS (SELECT 1 FROM direct_message_members m WHERE m.dm_group_id = g.id AND m.user_id = $3)
			LIMIT 1;
		`
		err := s.db.QueryRowContext(ctx, findQuery, workspaceID, userID, otherUserID).Scan(&existingGroupID)
		if err == nil && existingGroupID != "" {
			dms, _ := s.ListUserDMs(ctx, workspaceID, userID)
			for _, dm := range dms {
				if dm.ID == existingGroupID {
					return &dm, nil
				}
			}
		}
	}

	var group models.DirectMessageGroup
	err := s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		insertGroup := `
			INSERT INTO direct_message_groups (workspace_id, is_group, name, created_at, updated_at)
			VALUES ($1, $2, $3, NOW(), NOW())
			RETURNING id, workspace_id, is_group, COALESCE(name, ''), created_at, updated_at;
		`
		if err := tx.QueryRowContext(ctx, insertGroup, workspaceID, isGroup, name).Scan(
			&group.ID, &group.WorkspaceID, &group.IsGroup, &group.Name, &group.CreatedAt, &group.UpdatedAt,
		); err != nil {
			return fmt.Errorf("failed creating DM group: %w", err)
		}

		for _, uid := range uniqueUsers {
			_, err := tx.ExecContext(ctx, `
				INSERT INTO direct_message_members (dm_group_id, user_id, joined_at)
				VALUES ($1, $2, NOW());
			`, group.ID, uid)
			if err != nil {
				return fmt.Errorf("failed adding DM member %s: %w", uid, err)
			}
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	dms, err := s.ListUserDMs(ctx, workspaceID, userID)
	if err == nil {
		for _, dm := range dms {
			if dm.ID == group.ID {
				return &dm, nil
			}
		}
	}

	return &group, nil
}

// ListDMMessages fetches messages in a DM conversation with cursor pagination
func (s *DMService) ListDMMessages(ctx context.Context, dmGroupID, currentUserID, cursor string, limit int) (*PaginatedMessages, error) {
	var isMember bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM direct_message_members WHERE dm_group_id = $1 AND user_id = $2)
	`, dmGroupID, currentUserID).Scan(&isMember); err != nil || !isMember {
		return nil, ErrDMForbidden
	}

	if limit <= 0 || limit > 50 {
		limit = 30
	}

	query := `
		SELECT m.id, m.workspace_id, m.channel_id, m.dm_group_id, m.sender_id,
		       m.thread_id, m.parent_id, m.content, m.is_pinned, m.edited_at, m.created_at, m.updated_at,
		       u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
		       u.role, COALESCE(u.department, ''), COALESCE(u.account_state, 'active'),
		       u.must_change_password, u.status, COALESCE(u.custom_status, ''), u.created_at,
		       (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL) as reply_count,
		       (SELECT MAX(r.created_at) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL) as last_reply_at
		FROM messages m
		JOIN users u ON m.sender_id = u.id
		WHERE m.dm_group_id = $1 AND m.deleted_at IS NULL AND m.parent_id IS NULL
		  AND ($2 = '' OR m.created_at < (SELECT created_at FROM messages WHERE id = $2::uuid))
		ORDER BY m.created_at DESC
		LIMIT $3;
	`

	rows, err := s.db.QueryContext(ctx, query, dmGroupID, cursor, limit+1)
	if err != nil {
		return nil, fmt.Errorf("failed querying DM messages: %w", err)
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var m models.Message
		var u models.UserResponse
		if err := rows.Scan(
			&m.ID, &m.WorkspaceID, &m.ChannelID, &m.DMGroupID, &m.SenderID,
			&m.ThreadID, &m.ParentID, &m.Content, &m.IsPinned, &m.EditedAt, &m.CreatedAt, &m.UpdatedAt,
			&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
			&u.Role, &u.Department, &u.AccountState,
			&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
			&m.ReplyCount, &m.LastReplyAt,
		); err != nil {
			return nil, fmt.Errorf("failed scanning DM message: %w", err)
		}
		m.Sender = &u
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating DM messages: %w", err)
	}

	hasMore := false
	var nextCursor *string
	if len(messages) > limit {
		hasMore = true
		c := messages[limit-1].ID
		nextCursor = &c
		messages = messages[:limit]
	}

	populateMessagesMetadata(ctx, s.db, messages, currentUserID)

	if messages == nil {
		messages = []models.Message{}
	}

	return &PaginatedMessages{
		Messages:   messages,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// SendDMMessage inserts a message in DM and broadcasts to members
func (s *DMService) SendDMMessage(ctx context.Context, dmGroupID, userID string, req models.SendMessageRequest) (*models.Message, error) {
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" && len(req.AttachmentIDs) == 0 {
		return nil, errors.New("message content or attachment is required")
	}

	var workspaceID string
	err := s.db.QueryRowContext(ctx, `SELECT workspace_id FROM direct_message_groups WHERE id = $1`, dmGroupID).Scan(&workspaceID)
	if err != nil {
		return nil, ErrDMNotFound
	}

	var isMember bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM direct_message_members WHERE dm_group_id = $1 AND user_id = $2)
	`, dmGroupID, userID).Scan(&isMember); err != nil || !isMember {
		return nil, ErrDMForbidden
	}

	var msg models.Message
	err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		query := `
			INSERT INTO messages (workspace_id, dm_group_id, sender_id, parent_id, content, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
			RETURNING id, workspace_id, dm_group_id, sender_id, parent_id, content, is_pinned, created_at, updated_at;
		`
		if err := tx.QueryRowContext(ctx, query, workspaceID, dmGroupID, userID, req.ParentID, req.Content).Scan(
			&msg.ID, &msg.WorkspaceID, &msg.DMGroupID, &msg.SenderID, &msg.ParentID, &msg.Content, &msg.IsPinned, &msg.CreatedAt, &msg.UpdatedAt,
		); err != nil {
			return fmt.Errorf("failed inserting DM message: %w", err)
		}

		// Link any attachments
		for _, attID := range req.AttachmentIDs {
			_, _ = tx.ExecContext(ctx, `UPDATE attachments SET message_id = $1 WHERE id = $2 AND workspace_id = $3`, msg.ID, attID, workspaceID)
		}

		// Update DM group updated_at
		_, _ = tx.ExecContext(ctx, `UPDATE direct_message_groups SET updated_at = NOW() WHERE id = $1`, dmGroupID)

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Update unread count for other members outside the insert transaction (ordered by user_id)
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO read_states (user_id, dm_group_id, last_read_at, unread_count)
		SELECT dmm.user_id, $1, NOW(), 1
		FROM direct_message_members dmm
		WHERE dmm.dm_group_id = $1 AND dmm.user_id != $2
		ORDER BY dmm.user_id
		ON CONFLICT (user_id, dm_group_id) WHERE dm_group_id IS NOT NULL DO UPDATE SET unread_count = read_states.unread_count + 1;
	`, dmGroupID, userID)

	var u models.UserResponse
	_ = s.db.QueryRowContext(ctx, `
		SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''),
		       role, COALESCE(department, ''), COALESCE(account_state, 'active'),
		       must_change_password, status, COALESCE(custom_status, ''), created_at
		FROM users WHERE id = $1
	`, userID).Scan(
		&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
		&u.Role, &u.Department, &u.AccountState,
		&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
	)
	msg.Sender = &u
	msg.Reactions = []models.ReactionSummary{}
	msg.Attachments = []models.Attachment{}
	if len(req.AttachmentIDs) > 0 {
		single := []models.Message{msg}
		populateMessagesMetadata(ctx, s.db, single, userID)
		msg = single[0]
	}

	if s.hub != nil {
		memberRows, err := s.db.QueryContext(ctx, `SELECT user_id FROM direct_message_members WHERE dm_group_id = $1`, dmGroupID)
		if err == nil {
			defer memberRows.Close()
			for memberRows.Next() {
				var memberID string
				if err := memberRows.Scan(&memberID); err == nil && memberID != "" {
					s.hub.SendToUser(memberID, "message.new", msg)
				}
			}
			_ = memberRows.Err()
		}
	}

	return &msg, nil
}
