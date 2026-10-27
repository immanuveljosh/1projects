package admin

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"strings"
	"time"

	"officechat/backend/internal/audit"
	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/rbac"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/ws"
)

var (
	ErrMemberNotFound     = errors.New("member not found in workspace")
	ErrEmailExistsInWS    = errors.New("a user with this email is already a member of this workspace")
	ErrCannotDeleteSelf   = errors.New("you cannot delete your own account from the admin console")
	ErrConfirmationNeeded = errors.New("permanent delete requires typing 'DELETE' or user email to confirm")
	ErrInvalidCSVFormat   = errors.New("invalid CSV format or missing required headers")
)

type Service struct {
	db  *db.DB
	tm  *tokens.TokenManager
	hub *ws.Hub
}

func NewService(db *db.DB, tm *tokens.TokenManager, hub *ws.Hub) *Service {
	return &Service{
		db:  db,
		tm:  tm,
		hub: hub,
	}
}

// ListMembers fetches workspace members with search, filters, and cursor pagination
func (s *Service) ListMembers(ctx context.Context, workspaceID, search, role, status, accountState, cursor string, limit int) (*AdminMemberListResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	whereClauses := []string{"wm.workspace_id = $1"}
	args := []any{workspaceID}
	argIdx := 2

	if search = strings.TrimSpace(search); search != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(u.full_name ILIKE $%d OR u.display_name ILIKE $%d OR u.email ILIKE $%d OR u.department ILIKE $%d)", argIdx, argIdx, argIdx, argIdx))
		args = append(args, "%"+search+"%")
		argIdx++
	}

	if role = strings.TrimSpace(role); role != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("LOWER(wm.role) = LOWER($%d)", argIdx))
		args = append(args, role)
		argIdx++
	}

	if status = strings.TrimSpace(status); status != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("LOWER(u.status) = LOWER($%d)", argIdx))
		args = append(args, status)
		argIdx++
	}

	if accountState = strings.TrimSpace(accountState); accountState != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("LOWER(COALESCE(u.account_state, 'active')) = LOWER($%d)", argIdx))
		args = append(args, accountState)
		argIdx++
	} else {
		// By default show active and suspended; exclude soft deleted unless asked
		whereClauses = append(whereClauses, "u.deleted_at IS NULL")
	}

	// Total count for filters
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE %s
	`, strings.Join(whereClauses, " AND "))

	var totalCount int
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("failed to get member count: %w", err)
	}

	// Cursor pagination (based on joined_at)
	if cursor != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("wm.joined_at < $%d", argIdx))
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
			u.id, u.email, u.full_name, COALESCE(u.display_name, ''),
			COALESCE(u.avatar_url, ''), wm.role, COALESCE(u.department, ''),
			COALESCE(u.account_state, 'active'), u.must_change_password,
			u.status, COALESCE(u.custom_status, ''), wm.joined_at, u.created_at
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE %s
		ORDER BY wm.joined_at DESC, wm.id DESC
		LIMIT $%d
	`, strings.Join(whereClauses, " AND "), argIdx)
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query members: %w", err)
	}
	defer rows.Close()

	var members []AdminMember
	for rows.Next() {
		var m AdminMember
		if err := rows.Scan(
			&m.ID, &m.Email, &m.FullName, &m.DisplayName,
			&m.AvatarURL, &m.Role, &m.Department,
			&m.AccountState, &m.MustChangePassword,
			&m.Status, &m.CustomStatus, &m.JoinedAt, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan member row: %w", err)
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate members: %w", err)
	}

	hasMore := len(members) > limit
	var nextCursor string
	if hasMore {
		members = members[:limit]
		last := members[len(members)-1]
		nextCursor = last.JoinedAt.Format(time.RFC3339Nano)
	}

	return &AdminMemberListResponse{
		Members:    members,
		NextCursor: nextCursor,
		HasMore:    hasMore,
		TotalCount: totalCount,
	}, nil
}

// GetMember retrieves a single workspace member
func (s *Service) GetMember(ctx context.Context, workspaceID, memberUserID string) (*AdminMember, error) {
	var m AdminMember
	query := `
		SELECT 
			u.id, u.email, u.full_name, COALESCE(u.display_name, ''),
			COALESCE(u.avatar_url, ''), wm.role, COALESCE(u.department, ''),
			COALESCE(u.account_state, 'active'), u.must_change_password,
			u.status, COALESCE(u.custom_status, ''), wm.joined_at, u.created_at
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1 AND wm.user_id = $2
	`
	err := s.db.QueryRowContext(ctx, query, workspaceID, memberUserID).Scan(
		&m.ID, &m.Email, &m.FullName, &m.DisplayName,
		&m.AvatarURL, &m.Role, &m.Department,
		&m.AccountState, &m.MustChangePassword,
		&m.Status, &m.CustomStatus, &m.JoinedAt, &m.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrMemberNotFound
		}
		return nil, fmt.Errorf("failed to query member: %w", err)
	}

	return &m, nil
}

// CreateMember creates a new member in workspace, generating a secure password if needed
func (s *Service) CreateMember(ctx context.Context, actorID, actorRole, workspaceID string, req CreateMemberRequest, ip, ua string) (*CreateMemberResponse, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, errors.New("invalid email address format")
	}

	fullName := strings.TrimSpace(req.FullName)
	if fullName == "" {
		return nil, errors.New("full name is required")
	}

	role := rbac.NormalizeRole(req.Role)
	if role == "" {
		role = models.RoleMember
	}

	// Enforce role assignment permissions (Admins cannot create Admins or Owners)
	if err := rbac.CanManageMember(actorRole, "", role); err != nil {
		return nil, err
	}

	// Handle password
	var initialPassword string
	var err error
	if strings.TrimSpace(req.Password) != "" {
		initialPassword = req.Password
	} else {
		initialPassword, err = GenerateSecurePassword(16)
		if err != nil {
			return nil, fmt.Errorf("failed to generate password: %w", err)
		}
	}

	hashedPassword, err := tokens.HashPassword(initialPassword)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	var newUserID string
	err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		// 1. Check if user already exists
		var existingID string
		err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&existingID)
		if err == nil {
			// User exists in system, check if already in workspace
			var memberCount int
			_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, existingID).Scan(&memberCount)
			if memberCount > 0 {
				return ErrEmailExistsInWS
			}
			newUserID = existingID
			// Add to workspace
			_, err = tx.ExecContext(ctx, `
				INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
				VALUES ($1, $2, $3, NOW(), NOW())
			`, workspaceID, newUserID, role)
			return err
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		// 2. Insert new user
		err = tx.QueryRowContext(ctx, `
			INSERT INTO users (
				email, password_hash, full_name, display_name, department,
				account_state, must_change_password, password_changed_at,
				role, status, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5,
				'active', $6, NOW(),
				'user', 'offline', NOW(), NOW()
			) RETURNING id
		`, email, hashedPassword, fullName, req.DisplayName, req.Department, req.MustChangePassword).Scan(&newUserID)
		if err != nil {
			return fmt.Errorf("failed to insert user: %w", err)
		}

		// 3. Insert workspace member
		_, err = tx.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
			VALUES ($1, $2, $3, NOW(), NOW())
		`, workspaceID, newUserID, role)
		return err
	})
	if err != nil {
		return nil, err
	}

	createdMember, err := s.GetMember(ctx, workspaceID, newUserID)
	if err != nil {
		return nil, err
	}

	// Audit Log
	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "member.create",
		TargetType:  "user",
		TargetID:    newUserID,
		AfterState:  createdMember,
		Details: map[string]any{
			"email":                email,
			"role":                 role,
			"must_change_password": req.MustChangePassword,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	// WebSocket notification to workspace admins
	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "member.created", createdMember)
	}

	return &CreateMemberResponse{
		Member:            *createdMember,
		GeneratedPassword: initialPassword,
	}, nil
}

// UpdateMember edits an existing member's profile, role, and account status
func (s *Service) UpdateMember(ctx context.Context, actorID, actorRole, workspaceID, memberUserID string, req UpdateMemberRequest, ip, ua string) (*AdminMember, error) {
	currentMember, err := s.GetMember(ctx, workspaceID, memberUserID)
	if err != nil {
		return nil, err
	}

	newRole := currentMember.Role
	if req.Role != nil && strings.TrimSpace(*req.Role) != "" {
		newRole = rbac.NormalizeRole(*req.Role)
	}

	// Check RBAC permissions for actor -> target & role change
	if err := rbac.CanManageMember(actorRole, currentMember.Role, newRole); err != nil {
		return nil, err
	}

	// Prevent demoting last Owner
	if currentMember.Role == models.RoleOwner && newRole != models.RoleOwner {
		if err := rbac.CheckLastOwner(ctx, s.db, workspaceID); err != nil {
			return nil, err
		}
	}

	// Prevent deactivating/suspending last Owner
	if req.AccountState != nil && (*req.AccountState == models.AccountStateSuspended || *req.AccountState == models.AccountStateDeactivated) {
		if currentMember.Role == models.RoleOwner {
			if err := rbac.CheckLastOwner(ctx, s.db, workspaceID); err != nil {
				return nil, err
			}
		}
	}

	err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		// Update workspace member role
		if req.Role != nil {
			_, err := tx.ExecContext(ctx, `
				UPDATE workspace_members 
				SET role = $1, updated_at = NOW() 
				WHERE workspace_id = $2 AND user_id = $3
			`, newRole, workspaceID, memberUserID)
			if err != nil {
				return err
			}
		}

		// Update user details
		updates := []string{"updated_at = NOW()"}
		args := []any{memberUserID}
		argIdx := 2

		if req.FullName != nil {
			updates = append(updates, fmt.Sprintf("full_name = $%d", argIdx))
			args = append(args, strings.TrimSpace(*req.FullName))
			argIdx++
		}
		if req.DisplayName != nil {
			updates = append(updates, fmt.Sprintf("display_name = $%d", argIdx))
			args = append(args, strings.TrimSpace(*req.DisplayName))
			argIdx++
		}
		if req.Email != nil {
			em := strings.ToLower(strings.TrimSpace(*req.Email))
			if _, err := mail.ParseAddress(em); err != nil {
				return errors.New("invalid email format")
			}
			updates = append(updates, fmt.Sprintf("email = $%d", argIdx))
			args = append(args, em)
			argIdx++
		}
		if req.Department != nil {
			updates = append(updates, fmt.Sprintf("department = $%d", argIdx))
			args = append(args, strings.TrimSpace(*req.Department))
			argIdx++
		}
		if req.AccountState != nil {
			state := strings.ToLower(strings.TrimSpace(*req.AccountState))
			if state != models.AccountStateActive && state != models.AccountStateSuspended && state != models.AccountStateDeactivated {
				return errors.New("invalid account state; must be active, suspended, or deactivated")
			}
			updates = append(updates, fmt.Sprintf("account_state = $%d", argIdx))
			args = append(args, state)
			argIdx++
		}

		if len(updates) > 1 {
			q := fmt.Sprintf("UPDATE users SET %s WHERE id = $1", strings.Join(updates, ", "))
			if _, err := tx.ExecContext(ctx, q, args...); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	updatedMember, err := s.GetMember(ctx, workspaceID, memberUserID)
	if err != nil {
		return nil, err
	}

	// Audit Log
	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "member.update",
		TargetType:  "user",
		TargetID:    memberUserID,
		BeforeState: currentMember,
		AfterState:  updatedMember,
		IPAddress:   ip,
		UserAgent:   ua,
	})

	// If user was suspended or deactivated, immediately terminate all active sessions & tokens
	if updatedMember.AccountState == models.AccountStateSuspended || updatedMember.AccountState == models.AccountStateDeactivated {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, memberUserID)
		_, _ = s.db.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1`, memberUserID)
		if s.hub != nil {
			s.hub.DisconnectUser(memberUserID, fmt.Sprintf("Your account has been %s by administrator", updatedMember.AccountState))
		}
	} else if currentMember.Role != updatedMember.Role {
		// Broadcast role update so client permissions refresh immediately
		if s.hub != nil {
			s.hub.SendToUser(memberUserID, "member.role_changed", map[string]string{
				"new_role": updatedMember.Role,
			})
		}
	}

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(workspaceID, "member.updated", updatedMember)
	}

	return updatedMember, nil
}

// ResetPassword resets a user's password after verifying administrator credentials
func (s *Service) ResetPassword(ctx context.Context, actorID, actorRole, workspaceID, memberUserID string, req ResetPasswordRequest, ip, ua string) (*ResetPasswordResponse, error) {
	// Re-authenticate admin
	if err := VerifyAdminPassword(ctx, s.db, actorID, req.AdminPassword); err != nil {
		return nil, err
	}

	targetMember, err := s.GetMember(ctx, workspaceID, memberUserID)
	if err != nil {
		return nil, err
	}

	// RBAC check: Admin cannot reset password of Owner
	if err := rbac.CanManageMember(actorRole, targetMember.Role, targetMember.Role); err != nil {
		return nil, err
	}

	var tempPassword string
	if strings.TrimSpace(req.TemporaryPassword) != "" {
		tempPassword = req.TemporaryPassword
	} else {
		tempPassword, err = GenerateSecurePassword(16)
		if err != nil {
			return nil, fmt.Errorf("failed to generate secure temporary password: %w", err)
		}
	}

	hashed, err := tokens.HashPassword(tempPassword)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE users 
		SET password_hash = $1, 
		    must_change_password = $2, 
		    password_changed_at = NOW(), 
		    failed_login_count = 0, 
		    locked_until = NULL,
		    updated_at = NOW()
		WHERE id = $3
	`, hashed, req.MustChangePassword, memberUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to update password: %w", err)
	}

	// Force logout of all sessions
	if req.ForceLogout {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, memberUserID)
		_, _ = s.db.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1`, memberUserID)
		if s.hub != nil {
			s.hub.DisconnectUser(memberUserID, "Password was reset by administrator. Please log in with your temporary password.")
		}
	}

	// Audit log
	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "member.reset_password",
		TargetType:  "user",
		TargetID:    memberUserID,
		Details: map[string]any{
			"must_change_password": req.MustChangePassword,
			"forced_logout":        req.ForceLogout,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	return &ResetPasswordResponse{TemporaryPassword: tempPassword}, nil
}

// ForceLogout revokes all active refresh tokens and terminates active WebSocket sessions
func (s *Service) ForceLogout(ctx context.Context, actorID, actorRole, workspaceID, memberUserID string, req ForceLogoutRequest, ip, ua string) error {
	if err := VerifyAdminPassword(ctx, s.db, actorID, req.AdminPassword); err != nil {
		return err
	}

	targetMember, err := s.GetMember(ctx, workspaceID, memberUserID)
	if err != nil {
		return err
	}

	if err := rbac.CanManageMember(actorRole, targetMember.Role, targetMember.Role); err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, memberUserID)
	if err != nil {
		return fmt.Errorf("failed to revoke refresh tokens: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1`, memberUserID)

	if s.hub != nil {
		s.hub.DisconnectUser(memberUserID, "Your session has been terminated by administrator.")
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "member.force_logout",
		TargetType:  "user",
		TargetID:    memberUserID,
		IPAddress:   ip,
		UserAgent:   ua,
	})

	return nil
}

// DeleteMember soft-deletes (deactivates) or permanently removes a workspace member
func (s *Service) DeleteMember(ctx context.Context, actorID, actorRole, workspaceID, memberUserID string, req DeleteMemberRequest, ip, ua string) error {
	if actorID == memberUserID {
		return ErrCannotDeleteSelf
	}

	if err := VerifyAdminPassword(ctx, s.db, actorID, req.AdminPassword); err != nil {
		return err
	}

	targetMember, err := s.GetMember(ctx, workspaceID, memberUserID)
	if err != nil {
		return err
	}

	if err := rbac.CanManageMember(actorRole, targetMember.Role, targetMember.Role); err != nil {
		return err
	}

	if targetMember.Role == models.RoleOwner {
		if err := rbac.CheckLastOwner(ctx, s.db, workspaceID); err != nil {
			return err
		}
	}

	if req.Permanent {
		// Verify confirmation text
		confirm := strings.TrimSpace(req.ConfirmText)
		if confirm != "DELETE" && !strings.EqualFold(confirm, targetMember.Email) {
			return ErrConfirmationNeeded
		}

		err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
			// Handle user messages
			if req.DeleteMessages {
				_, err := tx.ExecContext(ctx, `DELETE FROM messages WHERE workspace_id = $1 AND sender_id = $2`, workspaceID, memberUserID)
				if err != nil {
					return fmt.Errorf("failed to delete member messages: %w", err)
				}
			}

			// Remove membership from workspace
			_, err := tx.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, memberUserID)
			if err != nil {
				return fmt.Errorf("failed to delete workspace membership: %w", err)
			}

			// Check if user has other workspaces
			var otherWSCount int
			_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspace_members WHERE user_id = $1`, memberUserID).Scan(&otherWSCount)
			if otherWSCount == 0 {
				// User has no other workspaces; delete or anonymize user record
				if req.DeleteMessages {
					_, _ = tx.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, memberUserID)
				} else {
					// Soft-anonymize so foreign key constraints on messages remain valid
					_, _ = tx.ExecContext(ctx, `
						UPDATE users 
						SET full_name = 'Deleted User', 
						    display_name = 'Deleted User', 
						    account_state = 'deactivated', 
						    deleted_at = NOW() 
						WHERE id = $1
					`, memberUserID)
				}
			}

			// Delete refresh tokens & device tokens
			_, _ = tx.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, memberUserID)
			_, _ = tx.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1`, memberUserID)
			return nil
		})
	} else {
		// Default soft delete: mark deactivated
		err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `
				UPDATE users 
				SET account_state = 'deactivated', deleted_at = NOW(), updated_at = NOW() 
				WHERE id = $1
			`, memberUserID)
			if err != nil {
				return err
			}
			_, _ = tx.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, memberUserID)
			_, _ = tx.ExecContext(ctx, `DELETE FROM device_tokens WHERE user_id = $1`, memberUserID)
			return nil
		})
	}

	if err != nil {
		return err
	}

	if s.hub != nil {
		s.hub.DisconnectUser(memberUserID, "Your account has been deleted by administrator.")
		s.hub.BroadcastToWorkspace(workspaceID, "member.deleted", map[string]string{
			"user_id": memberUserID,
		})
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "member.delete",
		TargetType:  "user",
		TargetID:    memberUserID,
		BeforeState: targetMember,
		Details: map[string]any{
			"permanent":       req.Permanent,
			"delete_messages": req.DeleteMessages,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	return nil
}

// ImportMembers imports members from CSV data
func (s *Service) ImportMembers(ctx context.Context, actorID, actorRole, workspaceID string, csvData []byte, ip, ua string) (*ImportResult, error) {
	r := csv.NewReader(bytes.NewReader(csvData))
	r.TrimLeadingSpace = true

	headers, err := r.Read()
	if err != nil {
		return nil, ErrInvalidCSVFormat
	}

	colIdx := make(map[string]int)
	for i, h := range headers {
		colIdx[strings.ToLower(strings.TrimSpace(h))] = i
	}

	if _, ok := colIdx["email"]; !ok {
		return nil, errors.New("CSV missing required 'email' column")
	}

	result := &ImportResult{
		Errors:  []ImportErrorItem{},
		Created: []CreateMemberResponse{},
	}

	rowNum := 1
	for {
		record, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		rowNum++
		if err != nil {
			result.Errors = append(result.Errors, ImportErrorItem{Row: rowNum, Error: "corrupt row syntax"})
			result.Failed++
			continue
		}

		result.Total++

		email := strings.ToLower(strings.TrimSpace(record[colIdx["email"]]))
		if _, err := mail.ParseAddress(email); err != nil {
			result.Errors = append(result.Errors, ImportErrorItem{Row: rowNum, Email: email, Error: "invalid email format"})
			result.Failed++
			continue
		}

		fullName := "Member"
		if idx, ok := colIdx["full_name"]; ok && idx < len(record) && strings.TrimSpace(record[idx]) != "" {
			fullName = strings.TrimSpace(record[idx])
		} else if idx, ok := colIdx["name"]; ok && idx < len(record) && strings.TrimSpace(record[idx]) != "" {
			fullName = strings.TrimSpace(record[idx])
		}

		role := models.RoleMember
		if idx, ok := colIdx["role"]; ok && idx < len(record) && strings.TrimSpace(record[idx]) != "" {
			role = rbac.NormalizeRole(record[idx])
		}

		department := ""
		if idx, ok := colIdx["department"]; ok && idx < len(record) {
			department = strings.TrimSpace(record[idx])
		} else if idx, ok := colIdx["team"]; ok && idx < len(record) {
			department = strings.TrimSpace(record[idx])
		}

		// Enforce RBAC per row
		if err := rbac.CanManageMember(actorRole, "", role); err != nil {
			result.Errors = append(result.Errors, ImportErrorItem{Row: rowNum, Email: email, Error: err.Error()})
			result.Failed++
			continue
		}

		createdResp, err := s.CreateMember(ctx, actorID, actorRole, workspaceID, CreateMemberRequest{
			Email:              email,
			FullName:           fullName,
			Role:               role,
			Department:         department,
			MustChangePassword: true,
		}, ip, ua)

		if err != nil {
			result.Errors = append(result.Errors, ImportErrorItem{Row: rowNum, Email: email, Error: err.Error()})
			result.Failed++
			continue
		}

		result.Succeeded++
		result.Created = append(result.Created, *createdResp)
	}

	_ = audit.Record(ctx, s.db, audit.LogEntry{
		WorkspaceID: workspaceID,
		ActorID:     actorID,
		Action:      "member.import_csv",
		TargetType:  "workspace",
		TargetID:    workspaceID,
		Details: map[string]any{
			"total":     result.Total,
			"succeeded": result.Succeeded,
			"failed":    result.Failed,
		},
		IPAddress: ip,
		UserAgent: ua,
	})

	return result, nil
}
