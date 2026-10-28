package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"officechat/backend/internal/audit"
)

var (
	ErrChannelNotFound            = errors.New("channel not found in workspace")
	ErrChannelNameExists          = errors.New("a channel with this name already exists in this workspace")
	ErrCannotDeleteDefaultChannel = errors.New("default channels (e.g. #general) cannot be deleted")
	ErrInvalidChannelName         = errors.New("channel name must be 2-80 characters and contain only lowercase letters, numbers, and hyphens")
)

// ListChannels retrieves channels with filters, member counts, and creators
func (s *Service) ListChannels(ctx context.Context, workspaceID, search, channelType string, isArchived *bool, cursor string, limit int) (*AdminChannelListResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	whereClauses := []string{"c.workspace_id = $1"}
	args := []any{workspaceID}
	argIdx := 2

	if search = strings.TrimSpace(search); search != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(c.name ILIKE $%d OR c.description ILIKE $%d OR c.topic ILIKE $%d)", argIdx, argIdx, argIdx))
		args = append(args, "%"+search+"%")
		argIdx++
	}

	if channelType != "" {
		switch strings.ToLower(channelType) {
		case "private":
			whereClauses = append(whereClauses, "c.is_private = TRUE")
		case "public":
			whereClauses = append(whereClauses, "c.is_private = FALSE AND c.is_announcement = FALSE")
		case "announcement":
			whereClauses = append(whereClauses, "c.is_announcement = TRUE")
		}
	}

	if isArchived != nil {
		whereClauses = append(whereClauses, fmt.Sprintf("c.is_archived = $%d", argIdx))
		args = append(args, *isArchived)
		argIdx++
	}

	// Count total
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM channels c
		WHERE %s
	`, strings.Join(whereClauses, " AND "))

	var totalCount int
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("failed to get channel count: %w", err)
	}

	if cursor != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("c.created_at < $%d", argIdx))
		cursorTime, err := time.Parse(time.RFC3339Nano, cursor)
		if err != nil {
			cursorTime, err = time.Parse(time.RFC3339, cursor)
		}
		if err == nil {
			args = append(args, cursorTime)
			argIdx++
		}
	}

	query := fmt.Sprintf(`
		SELECT 
			c.id, c.workspace_id, c.name, COALESCE(c.description, ''),
			COALESCE(c.topic, ''), c.is_private, c.is_archived,
			c.is_announcement, c.created_by, COALESCE(u.full_name, 'System'),
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) AS member_count
		FROM channels c
		LEFT JOIN users u ON u.id = c.created_by
		WHERE %s
		ORDER BY c.created_at DESC, c.id DESC
		LIMIT $%d
	`, strings.Join(whereClauses, " AND "), argIdx)
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query channels: %w", err)
	}
	defer rows.Close()

	var channels []AdminChannel
	for rows.Next() {
		var c AdminChannel
		if err := rows.Scan(
			&c.ID, &c.WorkspaceID, &c.Name, &c.Description,
			&c.Topic, &c.IsPrivate, &c.IsArchived,
			&c.IsAnnouncement, &c.CreatedBy, &c.CreatorName,
			&c.CreatedAt, &c.UpdatedAt, &c.MemberCount,
		); err != nil {
			return nil, fmt.Errorf("failed to scan channel: %w", err)
		}
		channels = append(channels, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate channels: %w", err)
	}

	hasMore := len(channels) > limit
	var nextCursor string
	if hasMore {
		channels = channels[:limit]
		last := channels[len(channels)-1]
		nextCursor = last.CreatedAt.Format(time.RFC3339Nano)
	}

	return &AdminChannelListResponse{
		Channels:   channels,
		NextCursor: nextCursor,
		HasMore:    hasMore,
		TotalCount: totalCount,
	}, nil
}

// GetChannel retrieves detailed channel metadata and members list
func (s *Service) GetChannel(ctx context.Context, workspaceID, channelID string) (*AdminChannelDetail, error) {
	var c AdminChannel
	query := `
		SELECT 
			c.id, c.workspace_id, c.name, COALESCE(c.description, ''),
			COALESCE(c.topic, ''), c.is_private, c.is_archived,
			c.is_announcement, c.created_by, COALESCE(u.full_name, 'System'),
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) AS member_count
		FROM channels c
		LEFT JOIN users u ON u.id = c.created_by
		WHERE c.workspace_id = $1 AND c.id = $2
	`
	err := s.db.QueryRowContext(ctx, query, workspaceID, channelID).Scan(
		&c.ID, &c.WorkspaceID, &c.Name, &c.Description,
		&c.Topic, &c.IsPrivate, &c.IsArchived,
		&c.IsAnnouncement, &c.CreatedBy, &c.CreatorName,
		&c.CreatedAt, &c.UpdatedAt, &c.MemberCount,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChannelNotFound
		}
		return nil, fmt.Errorf("failed to query channel: %w", err)
	}

	// Fetch members
	membersQuery := `
		SELECT 
			cm.id, cm.user_id, u.full_name, COALESCE(u.display_name, ''),
			u.email, COALESCE(u.avatar_url, ''), cm.role, cm.joined_at
		FROM channel_members cm
		JOIN users u ON u.id = cm.user_id
		WHERE cm.channel_id = $1
		ORDER BY cm.joined_at ASC
	`
	rows, err := s.db.QueryContext(ctx, membersQuery, channelID)
	if err != nil {
		return nil, fmt.Errorf("failed to query channel members: %w", err)
	}
	defer rows.Close()

	var members []AdminChannelMember
	for rows.Next() {
		var m AdminChannelMember
		if err := rows.Scan(
			&m.ID, &m.UserID, &m.FullName, &m.DisplayName,
			&m.Email, &m.AvatarURL, &m.Role, &m.JoinedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan channel member: %w", err)
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate channel members: %w", err)
	}

	return &AdminChannelDetail{
		AdminChannel: c,
		Members:      members,
	}, nil
}

// CreateChannel creates a new public, private, or announcement-only channel
func (s *Service) CreateChannel(ctx context.Context, actorID, workspaceID string, req CreateChannelRequest, ip, ua string) (*AdminChannel, error) {
	name := strings.ToLower(strings.TrimSpace(req.Name))
	name = strings.TrimPrefix(name, "#")
	if len(name) < 2 || len(name) > 80 {
		return nil, ErrInvalidChannelName
	}

	var newChannelID string
	err := s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		// Check name collision
		var existingCount int
		_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM channels WHERE workspace_id = $1 AND name = $2`, workspaceID, name).Scan(&existingCount)
		if existingCount > 0 {
			return ErrChannelNameExists
		}

		// Insert channel
		err := tx.QueryRowContext(ctx, `
			INSERT INTO channels (
				workspace_id, name, description, topic,
				is_private, is_announcement, created_by,
				created_at, updated_at
			) VALUES (
				$1, $2, $3, $4,
				$5, $6, $7,
				NOW(), NOW()
			) RETURNING id
		`, workspaceID, name, req.Description, req.Topic, req.IsPrivate, req.IsAnnouncement, actorID).Scan(&newChannelID)
		if err != nil {
			return fmt.Errorf("failed to insert channel: %w", err)
		}

		// Add creator as Channel Admin
		_, err = tx.ExecContext(ctx, `
			INSERT INTO channel_members (channel_id, user_id, role, joined_at)
			VALUES ($1, $2, 'Admin', NOW())
			ON CONFLICT DO NOTHING
		`, newChannelID, actorID)
		if err != nil {
			return fmt.Errorf("failed to add creator to channel: %w", err)
		}

		// Add initial members if specified
		for _, memberID := range req.InitialMemberIDs {
			memberID = strings.TrimSpace(memberID)
			if memberID == "" || memberID == actorID {
				continue
			}
			_, _ = tx.ExecContext(ctx, `
				INSERT INTO channel_members (channel_id, user_id, role, joined_at)
				VALUES ($1, $2, 'Member', NOW())
				ON CONFLICT DO NOTHING
			`, newChannelID, memberID)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	detail, err := s.GetChannel(ctx, workspaceID, newChannelID)
	if err != nil {
		return nil, err
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "channel.create",
		TargetType:  "channel",
		TargetID:    newChannelID,
		AfterState:  detail.AdminChannel,
		IPAddress:   ip,
		UserAgent:   ua,
	})

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "channel.created", detail.AdminChannel)
	}

	return &detail.AdminChannel, nil
}

// UpdateChannel edits channel details, privacy, and archive status
func (s *Service) UpdateChannel(ctx context.Context, actorID, workspaceID, channelID string, req UpdateChannelRequest, ip, ua string) (*AdminChannel, error) {
	current, err := s.GetChannel(ctx, workspaceID, channelID)
	if err != nil {
		return nil, err
	}

	// Protect default channel from being renamed or made private
	if strings.EqualFold(current.Name, "general") {
		if req.Name != nil && !strings.EqualFold(*req.Name, "general") {
			return nil, errors.New("cannot rename the default #general channel")
		}
		if req.IsPrivate != nil && *req.IsPrivate {
			return nil, errors.New("default #general channel must remain public")
		}
	}

	updates := []string{"updated_at = NOW()"}
	args := []any{workspaceID, channelID}
	argIdx := 3

	if req.Name != nil {
		name := strings.ToLower(strings.TrimSpace(*req.Name))
		name = strings.TrimPrefix(name, "#")
		if len(name) < 2 || len(name) > 80 {
			return nil, ErrInvalidChannelName
		}
		updates = append(updates, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, name)
		argIdx++
	}

	if req.Description != nil {
		updates = append(updates, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, strings.TrimSpace(*req.Description))
		argIdx++
	}

	if req.Topic != nil {
		updates = append(updates, fmt.Sprintf("topic = $%d", argIdx))
		args = append(args, strings.TrimSpace(*req.Topic))
		argIdx++
	}

	if req.IsPrivate != nil {
		updates = append(updates, fmt.Sprintf("is_private = $%d", argIdx))
		args = append(args, *req.IsPrivate)
		argIdx++
	}

	if req.IsArchived != nil {
		updates = append(updates, fmt.Sprintf("is_archived = $%d", argIdx))
		args = append(args, *req.IsArchived)
		argIdx++
	}

	if req.IsAnnouncement != nil {
		updates = append(updates, fmt.Sprintf("is_announcement = $%d", argIdx))
		args = append(args, *req.IsAnnouncement)
		argIdx++
	}

	query := fmt.Sprintf(`UPDATE channels SET %s WHERE workspace_id = $1 AND id = $2`, strings.Join(updates, ", "))
	_, err = s.db.ExecContext(ctx, query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "uq_workspace_channel_name") {
			return nil, ErrChannelNameExists
		}
		return nil, fmt.Errorf("failed to update channel: %w", err)
	}

	updated, err := s.GetChannel(ctx, workspaceID, channelID)
	if err != nil {
		return nil, err
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "channel.update",
		TargetType:  "channel",
		TargetID:    channelID,
		BeforeState: current.AdminChannel,
		AfterState:  updated.AdminChannel,
		IPAddress:   ip,
		UserAgent:   ua,
	})

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "channel.updated", updated.AdminChannel)
	}

	return &updated.AdminChannel, nil
}

// DeleteChannel archives or permanently deletes a channel
func (s *Service) DeleteChannel(ctx context.Context, actorID, workspaceID, channelID string, req DeleteChannelRequest, ip, ua string) error {
	current, err := s.GetChannel(ctx, workspaceID, channelID)
	if err != nil {
		return err
	}

	// Protect default channel #general
	if strings.EqualFold(current.Name, "general") {
		return ErrCannotDeleteDefaultChannel
	}

	if req.Permanent {
		confirm := strings.TrimSpace(req.ConfirmText)
		if confirm != "DELETE" && !strings.EqualFold(confirm, current.Name) {
			return errors.New("permanent delete requires typing channel name or 'DELETE' to confirm")
		}

		err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
			// Delete channel (cascades to channel_members, messages, attachments, etc.)
			_, err := tx.ExecContext(ctx, `DELETE FROM channels WHERE workspace_id = $1 AND id = $2`, workspaceID, channelID)
			return err
		})
		if err != nil {
			return fmt.Errorf("failed to permanently delete channel: %w", err)
		}

		_ = audit.Record(ctx, s.db, audit.LogEntry{
			WorkspaceID: workspaceID,
			ActorID:     actorID,
			Action:      "channel.delete_permanent",
			TargetType:  "channel",
			TargetID:    channelID,
			BeforeState: current.AdminChannel,
			IPAddress:   ip,
			UserAgent:   ua,
		})

		if s.hub != nil {
			s.hub.BroadcastToWorkspace(workspaceID, "channel.deleted", map[string]string{
				"channel_id": channelID,
			})
		}
	} else {
		// Archive channel
		_, err := s.db.ExecContext(ctx, `
			UPDATE channels SET is_archived = TRUE, updated_at = NOW() 
			WHERE workspace_id = $1 AND id = $2
		`, workspaceID, channelID)
		if err != nil {
			return fmt.Errorf("failed to archive channel: %w", err)
		}

		_ = audit.Record(ctx, s.db, audit.LogEntry{
			WorkspaceID: workspaceID,
			ActorID:     actorID,
			Action:      "channel.archive",
			TargetType:  "channel",
			TargetID:    channelID,
			BeforeState: current.AdminChannel,
			IPAddress:   ip,
			UserAgent:   ua,
		})

		if s.hub != nil {
			s.hub.BroadcastToWorkspace(workspaceID, "channel.archived", map[string]string{
				"channel_id": channelID,
			})
		}
	}

	return nil
}

// AddChannelMembers adds one or more members to the channel
func (s *Service) AddChannelMembers(ctx context.Context, actorID, workspaceID, channelID string, req AddChannelMembersRequest, ip, ua string) error {
	_, err := s.GetChannel(ctx, workspaceID, channelID)
	if err != nil {
		return err
	}

	role := "Member"
	if strings.EqualFold(req.Role, "Admin") {
		role = "Admin"
	}

	addedCount := 0
	for _, identifier := range req.UserIDs {
		identifier = strings.TrimSpace(identifier)
		if identifier == "" {
			continue
		}

		var resolvedUserID string
		err := s.db.QueryRowContext(ctx, `
			SELECT id::text FROM users
			WHERE (id::text = $1 OR LOWER(email) = LOWER($1)) AND deleted_at IS NULL
			LIMIT 1
		`, identifier).Scan(&resolvedUserID)
		if err != nil || resolvedUserID == "" {
			continue
		}

		// Ensure the user is also in workspace_members before adding to channel
		_, _ = s.db.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role, account_state, joined_at)
			VALUES ($1, $2, 'Member', 'active', NOW())
			ON CONFLICT (workspace_id, user_id) DO NOTHING
		`, workspaceID, resolvedUserID)

		res, err := s.db.ExecContext(ctx, `
			INSERT INTO channel_members (channel_id, user_id, role, joined_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT DO NOTHING
		`, channelID, resolvedUserID, role)
		if err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				addedCount++
			}
		}
	}

	if len(req.UserIDs) > 0 && addedCount == 0 {
		return ErrMemberNotFound
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "channel.members_add",
		TargetType:  "channel",
		TargetID:    channelID,
		Details: map[string]any{
			"added_count": addedCount,
			"user_ids":    req.UserIDs,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "channel.members_updated", map[string]string{
			"channel_id": channelID,
		})
	}

	return nil
}

// RemoveChannelMember removes a member from a channel
func (s *Service) RemoveChannelMember(ctx context.Context, actorID, workspaceID, channelID, targetUserID string, ip, ua string) error {
	_, err := s.GetChannel(ctx, workspaceID, channelID)
	if err != nil {
		return err
	}

	res, err := s.db.ExecContext(ctx, `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`, channelID, targetUserID)
	if err != nil {
		return fmt.Errorf("failed to remove channel member: %w", err)
	}

	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("user is not a member of this channel")
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "channel.member_remove",
		TargetType:  "channel",
		TargetID:    channelID,
		Details: map[string]any{
			"removed_user_id": targetUserID,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "channel.members_updated", map[string]string{
			"channel_id": channelID,
		})
	}

	return nil
}
