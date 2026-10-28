package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/lib/pq"

	"officechat/backend/internal/db"

	"officechat/backend/internal/models"
	"officechat/backend/internal/ws"
)

var (
	ErrMessageNotFound = errors.New("message not found")
	ErrCannotEditOthers = errors.New("you can only edit your own messages")
)

type MessageService struct {
	db  *db.DB
	hub *ws.Hub
}

func NewMessageService(database *db.DB, hub *ws.Hub) *MessageService {
	return &MessageService{db: database, hub: hub}
}

type PaginatedMessages struct {
	Messages   []models.Message `json:"messages"`
	NextCursor *string          `json:"next_cursor,omitempty"`
	HasMore    bool             `json:"has_more"`
}

// ListChannelMessages fetches messages in reverse chronological order using cursor pagination
func (s *MessageService) ListChannelMessages(ctx context.Context, channelID, currentUserID string, cursor string, limit int) (*PaginatedMessages, error) {
	var isPrivate, isMember bool
	err := s.db.QueryRowContext(ctx, `
		SELECT c.is_private,
		       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2)
		FROM channels c
		WHERE c.id = $1
	`, channelID, currentUserID).Scan(&isPrivate, &isMember)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChannelNotFound
		}
		return nil, err
	}
	if isPrivate && !isMember {
		return nil, ErrChannelForbidden
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
		WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND m.parent_id IS NULL
		  AND ($2 = '' OR m.created_at < (SELECT created_at FROM messages WHERE id = $2::uuid))
		ORDER BY m.created_at DESC
		LIMIT $3;
	`

	rows, err := s.db.QueryContext(ctx, query, channelID, cursor, limit+1)
	if err != nil {
		return nil, fmt.Errorf("failed querying channel messages: %w", err)
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
			return nil, fmt.Errorf("failed scanning message: %w", err)
		}
		m.Sender = &u
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating channel messages: %w", err)
	}

	hasMore := false
	var nextCursor *string
	if len(messages) > limit {
		hasMore = true
		c := messages[limit-1].ID
		nextCursor = &c
		messages = messages[:limit]
	}

	// Populate reactions, attachments, and polls for these messages
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

// SendChannelMessage inserts a message in channel and broadcasts
func (s *MessageService) SendChannelMessage(ctx context.Context, channelID, userID string, req models.SendMessageRequest) (*models.Message, error) {
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" && len(req.AttachmentIDs) == 0 {
		return nil, errors.New("message content or attachment is required")
	}

	// Find workspace_id and privacy settings from channel
	var workspaceID string
	var isPrivate, isMember bool
	err := s.db.QueryRowContext(ctx, `
		SELECT c.workspace_id, c.is_private,
		       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2)
		FROM channels c
		WHERE c.id = $1
	`, channelID, userID).Scan(&workspaceID, &isPrivate, &isMember)
	if err != nil {
		return nil, ErrChannelNotFound
	}
	if isPrivate && !isMember {
		return nil, ErrChannelForbidden
	}

	var msg models.Message
	err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		query := `
			INSERT INTO messages (workspace_id, channel_id, sender_id, parent_id, content, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
			RETURNING id, workspace_id, channel_id, sender_id, parent_id, content, is_pinned, created_at, updated_at;
		`
		if err := tx.QueryRowContext(ctx, query, workspaceID, channelID, userID, req.ParentID, req.Content).Scan(
			&msg.ID, &msg.WorkspaceID, &msg.ChannelID, &msg.SenderID, &msg.ParentID, &msg.Content, &msg.IsPinned, &msg.CreatedAt, &msg.UpdatedAt,
		); err != nil {
			return fmt.Errorf("failed inserting message: %w", err)
		}

		// Link any attachments
		for _, attID := range req.AttachmentIDs {
			_, _ = tx.ExecContext(ctx, `UPDATE attachments SET message_id = $1 WHERE id = $2 AND workspace_id = $3`, msg.ID, attID, workspaceID)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Update unread count for other members in channel outside the insert transaction (ordered by user_id to prevent lock contention/deadlocks)
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO read_states (user_id, channel_id, last_read_at, unread_count)
		SELECT cm.user_id, $1, NOW(), 1
		FROM channel_members cm
		WHERE cm.channel_id = $1 AND cm.user_id != $2
		ORDER BY cm.user_id
		ON CONFLICT (user_id, channel_id) WHERE channel_id IS NOT NULL DO UPDATE SET unread_count = read_states.unread_count + 1;
	`, channelID, userID)

	// Fetch sender details
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

	// Broadcast message.new over WebSocket (only to channel members if private)
	if s.hub != nil {
		if isPrivate {
			memberRows, err := s.db.QueryContext(ctx, `SELECT user_id FROM channel_members WHERE channel_id = $1`, channelID)
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
		} else {
			s.hub.BroadcastToWorkspace(workspaceID, "message.new", msg)
		}
	}

	return &msg, nil
}

// UpdateMessage edits message content
func (s *MessageService) UpdateMessage(ctx context.Context, messageID, userID string, req models.UpdateMessageRequest) (*models.Message, error) {
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		return nil, errors.New("content cannot be empty")
	}

	var senderID, workspaceID string
	err := s.db.QueryRowContext(ctx, `SELECT sender_id, workspace_id FROM messages WHERE id = $1 AND deleted_at IS NULL`, messageID).Scan(&senderID, &workspaceID)
	if err != nil {
		return nil, ErrMessageNotFound
	}

	if senderID != userID {
		return nil, ErrCannotEditOthers
	}

	var msg models.Message
	query := `
		UPDATE messages
		SET content = $1, edited_at = NOW(), updated_at = NOW()
		WHERE id = $2
		RETURNING id, workspace_id, channel_id, dm_group_id, sender_id, parent_id, content, is_pinned, edited_at, created_at, updated_at;
	`
	if err := s.db.QueryRowContext(ctx, query, req.Content, messageID).Scan(
		&msg.ID, &msg.WorkspaceID, &msg.ChannelID, &msg.DMGroupID, &msg.SenderID,
		&msg.ParentID, &msg.Content, &msg.IsPinned, &msg.EditedAt, &msg.CreatedAt, &msg.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("failed updating message: %w", err)
	}

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "message.updated", msg)
	}

	return &msg, nil
}

// DeleteMessage soft deletes a message
func (s *MessageService) DeleteMessage(ctx context.Context, messageID, userID string) error {
	var senderID, workspaceID string
	var channelID, dmGroupID *string
	err := s.db.QueryRowContext(ctx, `SELECT sender_id, workspace_id, channel_id, dm_group_id FROM messages WHERE id = $1 AND deleted_at IS NULL`, messageID).Scan(&senderID, &workspaceID, &channelID, &dmGroupID)
	if err != nil {
		return ErrMessageNotFound
	}

	if senderID != userID {
		return ErrCannotEditOthers
	}

	query := `UPDATE messages SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1;`
	if _, err := s.db.ExecContext(ctx, query, messageID); err != nil {
		return err
	}

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "message.deleted", map[string]any{
			"id":          messageID,
			"channel_id":  channelID,
			"dm_group_id": dmGroupID,
		})
	}
	return nil
}

// ListThreadMessages retrieves all non-deleted replies to a parent message in chronological order,
// enforcing workspace, private-channel, and direct-message participant authorization.
func (s *MessageService) ListThreadMessages(ctx context.Context, parentMessageID, currentUserID string) ([]models.Message, error) {
	var workspaceID string
	var channelID, dmGroupID *string
	err := s.db.QueryRowContext(ctx, `
		SELECT workspace_id, channel_id, dm_group_id
		FROM messages
		WHERE id = $1 AND deleted_at IS NULL
	`, parentMessageID).Scan(&workspaceID, &channelID, &dmGroupID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}

	if channelID != nil && *channelID != "" {
		var isPrivate, isWsMember, isChanMember bool
		err := s.db.QueryRowContext(ctx, `
			SELECT c.is_private,
			       EXISTS(
			           SELECT 1 FROM workspace_members wm
			           JOIN users u ON wm.user_id = u.id
			           WHERE wm.workspace_id = c.workspace_id AND wm.user_id = $2
			             AND COALESCE(u.account_state, 'active') = 'active'
			             AND u.deleted_at IS NULL
			       ),
			       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2)
			FROM channels c
			WHERE c.id = $1
		`, *channelID, currentUserID).Scan(&isPrivate, &isWsMember, &isChanMember)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrChannelNotFound
			}
			return nil, err
		}
		if !isWsMember || (isPrivate && !isChanMember) {
			return nil, ErrChannelForbidden
		}
	} else if dmGroupID != nil && *dmGroupID != "" {
		var isDMMember bool
		if err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS(SELECT 1 FROM direct_message_members WHERE dm_group_id = $1 AND user_id = $2)
		`, *dmGroupID, currentUserID).Scan(&isDMMember); err != nil || !isDMMember {
			return nil, ErrDMForbidden
		}
	}

	query := `
		SELECT m.id, m.workspace_id, m.channel_id, m.dm_group_id, m.sender_id,
		       m.thread_id, m.parent_id, m.content, m.is_pinned, m.edited_at, m.created_at, m.updated_at,
		       u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
		       u.role, COALESCE(u.department, ''), COALESCE(u.account_state, 'active'),
		       u.must_change_password, u.status, COALESCE(u.custom_status, ''), u.created_at
		FROM messages m
		JOIN users u ON m.sender_id = u.id
		WHERE m.parent_id = $1 AND m.deleted_at IS NULL
		ORDER BY m.created_at ASC;
	`
	rows, err := s.db.QueryContext(ctx, query, parentMessageID)
	if err != nil {
		return nil, fmt.Errorf("failed querying thread messages: %w", err)
	}
	defer rows.Close()

	var replies []models.Message
	for rows.Next() {
		var m models.Message
		var u models.UserResponse
		if err := rows.Scan(
			&m.ID, &m.WorkspaceID, &m.ChannelID, &m.DMGroupID, &m.SenderID,
			&m.ThreadID, &m.ParentID, &m.Content, &m.IsPinned, &m.EditedAt, &m.CreatedAt, &m.UpdatedAt,
			&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
			&u.Role, &u.Department, &u.AccountState,
			&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed scanning thread reply: %w", err)
		}
		m.Sender = &u
		replies = append(replies, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating thread replies: %w", err)
	}

	populateMessagesMetadata(ctx, s.db, replies, currentUserID)

	if replies == nil {
		replies = []models.Message{}
	}
	return replies, nil
}

// Helper to batch-query reactions, attachments, and polls for messages
func populateMessagesMetadata(ctx context.Context, database *db.DB, messages []models.Message, currentUserID string) {
	if len(messages) == 0 || database == nil {
		return
	}

	msgIDs := make([]string, len(messages))
	msgMap := make(map[string]*models.Message)
	for i := range messages {
		msgIDs[i] = messages[i].ID
		msgMap[messages[i].ID] = &messages[i]
		messages[i].Reactions = []models.ReactionSummary{}
		messages[i].Attachments = []models.Attachment{}
	}

	// 1. Reactions
	reactionQuery := `
		SELECT message_id::text, emoji, COUNT(*) as count,
		       ARRAY_AGG(user_id::text) as user_ids,
		       BOOL_OR(user_id::text = $2) as has_reacted
		FROM reactions
		WHERE message_id = ANY($1::uuid[])
		GROUP BY message_id, emoji
		ORDER BY emoji ASC;
	`
	if rows, err := database.QueryContext(ctx, reactionQuery, pq.Array(msgIDs), currentUserID); err == nil {
		for rows.Next() {
			var msgID, emoji string
			var count int
			var userIDs pq.StringArray
			var hasReacted bool
			if err := rows.Scan(&msgID, &emoji, &count, &userIDs, &hasReacted); err == nil {
				if m, ok := msgMap[msgID]; ok {
					m.Reactions = append(m.Reactions, models.ReactionSummary{
						Emoji:      emoji,
						Count:      count,
						UserIDs:    []string(userIDs),
						HasReacted: hasReacted,
					})
				}
			}
		}
		_ = rows.Err()
		rows.Close()
	}

	// 2. Attachments
	attQuery := `
		SELECT id, message_id::text, workspace_id, file_name, file_size, content_type,
		       file_key, file_url, COALESCE(virus_scan_status, 'clean'), uploaded_by, created_at
		FROM attachments
		WHERE message_id = ANY($1::uuid[])
		ORDER BY created_at ASC;
	`
	if attRows, err := database.QueryContext(ctx, attQuery, pq.Array(msgIDs)); err == nil {
		for attRows.Next() {
			var att models.Attachment
			var msgID string
			if err := attRows.Scan(
				&att.ID, &msgID, &att.WorkspaceID, &att.FileName, &att.FileSize,
				&att.ContentType, &att.FileKey, &att.FileURL, &att.VirusScanStatus,
				&att.UploadedBy, &att.CreatedAt,
			); err == nil {
				att.MessageID = &msgID
				if m, ok := msgMap[msgID]; ok {
					m.Attachments = append(m.Attachments, att)
				}
			}
		}
		_ = attRows.Err()
		attRows.Close()
	}

	// 3. Polls linked via polls.message_id
	pollSvc := NewPollService(database, nil)
	pollQuery := `
		SELECT id, message_id::text
		FROM polls
		WHERE message_id = ANY($1::uuid[]);
	`
	if pollRows, err := database.QueryContext(ctx, pollQuery, pq.Array(msgIDs)); err == nil {
		type pollLink struct {
			pollID string
			msgID  string
		}
		var links []pollLink
		for pollRows.Next() {
			var pl pollLink
			if err := pollRows.Scan(&pl.pollID, &pl.msgID); err == nil {
				links = append(links, pl)
			}
		}
		_ = pollRows.Err()
		pollRows.Close()
		for _, pl := range links {
			if summary, err := pollSvc.GetPoll(ctx, pl.pollID, currentUserID); err == nil {
				if m, ok := msgMap[pl.msgID]; ok {
					m.Poll = summary
				}
			}
		}
	}
}
