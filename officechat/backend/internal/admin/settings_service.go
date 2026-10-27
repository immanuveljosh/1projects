package admin

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"officechat/backend/internal/audit"
)

// GetSettings retrieves current workspace security, password policies, and retention settings
func (s *Service) GetSettings(ctx context.Context, workspaceID string) (*WorkspaceSettingsDTO, error) {
	var st WorkspaceSettingsDTO
	query := `
		SELECT 
			workspace_id, min_password_length, require_special_char,
			require_number, password_expiry_days, max_login_attempts,
			lockout_duration_mins, enforce_2fa, session_timeout_mins,
			retention_days, allow_guest_invites, updated_at
		FROM workspace_settings
		WHERE workspace_id = $1
	`
	err := s.db.QueryRowContext(ctx, query, workspaceID).Scan(
		&st.WorkspaceID, &st.MinPasswordLength, &st.RequireSpecialChar,
		&st.RequireNumber, &st.PasswordExpiryDays, &st.MaxLoginAttempts,
		&st.LockoutDurationMins, &st.Enforce2FA, &st.SessionTimeoutMins,
		&st.RetentionDays, &st.AllowGuestInvites, &st.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Initialize default settings for workspace
			initQuery := `
				INSERT INTO workspace_settings (
					workspace_id, min_password_length, require_special_char,
					require_number, password_expiry_days, max_login_attempts,
					lockout_duration_mins, enforce_2fa, session_timeout_mins,
					retention_days, allow_guest_invites, updated_at
				) VALUES (
					$1, 8, FALSE, FALSE, 0, 5, 15, FALSE, 10080, 0, FALSE, NOW()
				)
				ON CONFLICT (workspace_id) DO UPDATE SET updated_at = NOW()
				RETURNING 
					workspace_id, min_password_length, require_special_char,
					require_number, password_expiry_days, max_login_attempts,
					lockout_duration_mins, enforce_2fa, session_timeout_mins,
					retention_days, allow_guest_invites, updated_at
			`
			err = s.db.QueryRowContext(ctx, initQuery, workspaceID).Scan(
				&st.WorkspaceID, &st.MinPasswordLength, &st.RequireSpecialChar,
				&st.RequireNumber, &st.PasswordExpiryDays, &st.MaxLoginAttempts,
				&st.LockoutDurationMins, &st.Enforce2FA, &st.SessionTimeoutMins,
				&st.RetentionDays, &st.AllowGuestInvites, &st.UpdatedAt,
			)
			if err != nil {
				return nil, fmt.Errorf("failed to initialize workspace settings: %w", err)
			}
			return &st, nil
		}
		return nil, fmt.Errorf("failed to fetch workspace settings: %w", err)
	}

	return &st, nil
}

// UpdateSettings updates workspace security and password policies
func (s *Service) UpdateSettings(ctx context.Context, actorID, workspaceID string, req UpdateSettingsRequest, ip, ua string) (*WorkspaceSettingsDTO, error) {
	current, err := s.GetSettings(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	updates := []string{"updated_at = NOW()"}
	args := []any{workspaceID}
	argIdx := 2

	if req.MinPasswordLength != nil {
		if *req.MinPasswordLength < 6 || *req.MinPasswordLength > 128 {
			return nil, errors.New("minimum password length must be between 6 and 128 characters")
		}
		updates = append(updates, fmt.Sprintf("min_password_length = $%d", argIdx))
		args = append(args, *req.MinPasswordLength)
		argIdx++
	}

	if req.RequireSpecialChar != nil {
		updates = append(updates, fmt.Sprintf("require_special_char = $%d", argIdx))
		args = append(args, *req.RequireSpecialChar)
		argIdx++
	}

	if req.RequireNumber != nil {
		updates = append(updates, fmt.Sprintf("require_number = $%d", argIdx))
		args = append(args, *req.RequireNumber)
		argIdx++
	}

	if req.PasswordExpiryDays != nil {
		if *req.PasswordExpiryDays < 0 {
			return nil, errors.New("password expiry days cannot be negative")
		}
		updates = append(updates, fmt.Sprintf("password_expiry_days = $%d", argIdx))
		args = append(args, *req.PasswordExpiryDays)
		argIdx++
	}

	if req.MaxLoginAttempts != nil {
		if *req.MaxLoginAttempts < 1 || *req.MaxLoginAttempts > 50 {
			return nil, errors.New("max login attempts must be between 1 and 50")
		}
		updates = append(updates, fmt.Sprintf("max_login_attempts = $%d", argIdx))
		args = append(args, *req.MaxLoginAttempts)
		argIdx++
	}

	if req.LockoutDurationMins != nil {
		if *req.LockoutDurationMins < 1 || *req.LockoutDurationMins > 1440 {
			return nil, errors.New("lockout duration must be between 1 and 1440 minutes")
		}
		updates = append(updates, fmt.Sprintf("lockout_duration_mins = $%d", argIdx))
		args = append(args, *req.LockoutDurationMins)
		argIdx++
	}

	if req.Enforce2FA != nil {
		updates = append(updates, fmt.Sprintf("enforce_2fa = $%d", argIdx))
		args = append(args, *req.Enforce2FA)
		argIdx++
	}

	if req.SessionTimeoutMins != nil {
		if *req.SessionTimeoutMins < 15 {
			return nil, errors.New("session timeout must be at least 15 minutes")
		}
		updates = append(updates, fmt.Sprintf("session_timeout_mins = $%d", argIdx))
		args = append(args, *req.SessionTimeoutMins)
		argIdx++
	}

	if req.RetentionDays != nil {
		if *req.RetentionDays < 0 {
			return nil, errors.New("retention days cannot be negative")
		}
		updates = append(updates, fmt.Sprintf("retention_days = $%d", argIdx))
		args = append(args, *req.RetentionDays)
		argIdx++
	}

	if req.AllowGuestInvites != nil {
		updates = append(updates, fmt.Sprintf("allow_guest_invites = $%d", argIdx))
		args = append(args, *req.AllowGuestInvites)
		argIdx++
	}

	query := fmt.Sprintf("UPDATE workspace_settings SET %s WHERE workspace_id = $1", strings.Join(updates, ", "))
	if _, err := s.db.ExecContext(ctx, query, args...); err != nil {
		return nil, fmt.Errorf("failed to update workspace settings: %w", err)
	}

	updated, err := s.GetSettings(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "settings.update",
		TargetType:  "workspace_settings",
		TargetID:    workspaceID,
		BeforeState: current,
		AfterState:  updated,
		IPAddress:   ip,
		UserAgent:   ua,
	})

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "settings.updated", updated)
	}

	return updated, nil
}

// EmergencyLogout invalidates and revokes all refresh tokens in the workspace
func (s *Service) EmergencyLogout(ctx context.Context, actorID, workspaceID string, req EmergencyLogoutRequest, ip, ua string) error {
	if err := VerifyAdminPassword(ctx, s.db, actorID, req.AdminPassword); err != nil {
		return err
	}

	query := `
		DELETE FROM refresh_tokens
		WHERE user_id IN (
			SELECT user_id FROM workspace_members WHERE workspace_id = $1
		)
	`
	res, err := s.db.ExecContext(ctx, query, workspaceID)
	if err != nil {
		return fmt.Errorf("failed to revoke workspace refresh tokens: %w", err)
	}
	revokedTokens, _ := res.RowsAffected()

	// Also purge all device push notification tokens for the workspace and its users
	_, _ = s.db.ExecContext(ctx, `
		DELETE FROM device_tokens 
		WHERE workspace_id = $1 
		   OR user_id IN (SELECT user_id FROM workspace_members WHERE workspace_id = $1);
	`, workspaceID)


	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "EMERGENCY_LOGOUT", map[string]any{
			"message": "All workspace sessions have been revoked by administrator emergency action.",
		})
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "security.emergency_logout",
		TargetType:  "workspace",
		TargetID:    workspaceID,
		Details: map[string]any{
			"revoked_token_count": revokedTokens,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	return nil
}

// buildAuditSummary converts structured audit log data into a human-readable summary
func buildAuditSummary(action, actorName string, details, beforeState, afterState map[string]any) string {
	actor := actorName
	if actor == "" {
		actor = "System"
	}

	switch action {
	case "member.create":
		if email, ok := details["email"].(string); ok {
			role := details["role"]
			return fmt.Sprintf("%s created new member %s with role %v", actor, email, role)
		}
		return fmt.Sprintf("%s added a new workspace member", actor)

	case "member.update":
		beforeRole, _ := beforeState["role"].(string)
		afterRole, _ := afterState["role"].(string)
		targetName, _ := afterState["full_name"].(string)
		if targetName == "" {
			targetName, _ = beforeState["full_name"].(string)
		}
		if beforeRole != "" && afterRole != "" && beforeRole != afterRole {
			return fmt.Sprintf("%s changed %s's role from %s to %s", actor, targetName, beforeRole, afterRole)
		}
		beforeStateStr, _ := beforeState["account_state"].(string)
		afterStateStr, _ := afterState["account_state"].(string)
		if beforeStateStr != afterStateStr && afterStateStr != "" {
			return fmt.Sprintf("%s changed %s's account state to %s", actor, targetName, afterStateStr)
		}
		return fmt.Sprintf("%s updated profile for %s", actor, targetName)

	case "member.reset_password":
		return fmt.Sprintf("%s reset password for member", actor)

	case "member.force_logout":
		return fmt.Sprintf("%s forced logout of all sessions for member", actor)

	case "member.delete":
		targetName, _ := beforeState["full_name"].(string)
		if targetName == "" {
			targetName = "member"
		}
		return fmt.Sprintf("%s removed %s from workspace", actor, targetName)

	case "member.bulk_import":
		total := details["total"]
		succ := details["succeeded"]
		return fmt.Sprintf("%s imported members via CSV (%v of %v succeeded)", actor, succ, total)

	case "channel.create":
		name, _ := afterState["name"].(string)
		return fmt.Sprintf("%s created channel #%s", actor, name)

	case "channel.update":
		name, _ := afterState["name"].(string)
		return fmt.Sprintf("%s updated channel #%s settings", actor, name)

	case "channel.archive":
		name, _ := beforeState["name"].(string)
		return fmt.Sprintf("%s archived channel #%s", actor, name)

	case "channel.delete_permanent":
		name, _ := beforeState["name"].(string)
		return fmt.Sprintf("%s permanently deleted channel #%s", actor, name)

	case "channel.members_add":
		return fmt.Sprintf("%s added members to channel", actor)

	case "channel.member_remove":
		return fmt.Sprintf("%s removed member from channel", actor)

	case "settings.update":
		return fmt.Sprintf("%s updated workspace security and password policy settings", actor)

	case "security.emergency_logout":
		revoked, _ := details["revoked_token_count"]
		return fmt.Sprintf("%s initiated workspace Emergency Logout (%v tokens revoked)", actor, revoked)

	case "auth.change_password":
		return fmt.Sprintf("%s changed their password", actor)

	default:
		return fmt.Sprintf("%s performed %s", actor, action)
	}
}

// ListAuditLogs retrieves searchable, paginated audit logs
func (s *Service) ListAuditLogs(ctx context.Context, workspaceID, actorID, action, target, startDate, endDate, cursor string, limit int) (*AuditLogListResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	whereClauses := []string{"al.workspace_id = $1"}
	args := []any{workspaceID}
	argIdx := 2

	if actorID != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("al.actor_id = $%d", argIdx))
		args = append(args, actorID)
		argIdx++
	}

	if action = strings.TrimSpace(action); action != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("al.action ILIKE $%d", argIdx))
		args = append(args, "%"+action+"%")
		argIdx++
	}

	if target = strings.TrimSpace(target); target != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(al.target_type ILIKE $%d OR al.target_id::text ILIKE $%d)", argIdx, argIdx))
		args = append(args, "%"+target+"%")
		argIdx++
	}

	if startDate != "" {
		if t, err := time.Parse(time.RFC3339, startDate); err == nil {
			whereClauses = append(whereClauses, fmt.Sprintf("al.created_at >= $%d", argIdx))
			args = append(args, t)
			argIdx++
		}
	}

	if endDate != "" {
		if t, err := time.Parse(time.RFC3339, endDate); err == nil {
			whereClauses = append(whereClauses, fmt.Sprintf("al.created_at <= $%d", argIdx))
			args = append(args, t)
			argIdx++
		}
	}

	// Count total
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM audit_logs al
		WHERE %s
	`, strings.Join(whereClauses, " AND "))

	var totalCount int
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("failed to count audit logs: %w", err)
	}

	if cursor != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("al.created_at < $%d", argIdx))
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
			al.id, al.workspace_id, COALESCE(al.actor_id::text, ''),
			COALESCE(u.full_name, 'System'), COALESCE(u.email, ''),
			al.action, COALESCE(al.target_type, ''), COALESCE(al.target_id::text, ''),
			COALESCE(al.before_state, '{}'::jsonb),
			COALESCE(al.after_state, '{}'::jsonb),
			COALESCE(al.details, '{}'::jsonb),
			COALESCE(al.ip_address, ''), COALESCE(al.user_agent, ''),
			al.created_at
		FROM audit_logs al
		LEFT JOIN users u ON u.id = al.actor_id
		WHERE %s
		ORDER BY al.created_at DESC, al.id DESC
		LIMIT $%d
	`, strings.Join(whereClauses, " AND "), argIdx)
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query audit logs: %w", err)
	}
	defer rows.Close()

	var logs []AuditLogItem
	for rows.Next() {
		var item AuditLogItem
		var beforeJSON, afterJSON, detailsJSON []byte

		if err := rows.Scan(
			&item.ID, &item.WorkspaceID, &item.ActorID,
			&item.ActorName, &item.ActorEmail,
			&item.Action, &item.TargetType, &item.TargetID,
			&beforeJSON, &afterJSON, &detailsJSON,
			&item.IPAddress, &item.UserAgent,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan audit log row: %w", err)
		}

		_ = json.Unmarshal(beforeJSON, &item.BeforeState)
		_ = json.Unmarshal(afterJSON, &item.AfterState)
		_ = json.Unmarshal(detailsJSON, &item.Details)

		item.Summary = buildAuditSummary(item.Action, item.ActorName, item.Details, item.BeforeState, item.AfterState)
		logs = append(logs, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate audit logs: %w", err)
	}

	hasMore := len(logs) > limit
	var nextCursor string
	if hasMore {
		logs = logs[:limit]
		last := logs[len(logs)-1]
		nextCursor = last.CreatedAt.Format(time.RFC3339Nano)
	}

	return &AuditLogListResponse{
		Logs:       logs,
		NextCursor: nextCursor,
		HasMore:    hasMore,
		TotalCount: totalCount,
	}, nil
}

// ExportAuditLogsCSV generates a CSV file with audit logs
func (s *Service) ExportAuditLogsCSV(ctx context.Context, workspaceID, actorID, action, target, startDate, endDate string) ([]byte, error) {
	resp, err := s.ListAuditLogs(ctx, workspaceID, actorID, action, target, startDate, endDate, "", 1000)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)

	// Write CSV Header
	_ = w.Write([]string{
		"Log ID", "Timestamp (UTC)", "Actor Name", "Actor Email",
		"Action", "Target Type", "Target ID", "IP Address", "Summary",
	})

	for _, l := range resp.Logs {
		_ = w.Write([]string{
			l.ID,
			l.CreatedAt.UTC().Format(time.RFC3339),
			l.ActorName,
			l.ActorEmail,
			l.Action,
			l.TargetType,
			l.TargetID,
			l.IPAddress,
			l.Summary,
		})
	}
	w.Flush()

	return buf.Bytes(), nil
}
