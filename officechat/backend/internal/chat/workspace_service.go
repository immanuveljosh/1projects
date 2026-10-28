package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
)

var (
	ErrWorkspaceNotFound = errors.New("workspace not found")
	ErrInviteNotFound    = errors.New("invite code not found or expired")
	ErrAlreadyMember     = errors.New("already a member of this workspace")
)

type WorkspaceService struct {
	db *db.DB
}

func NewWorkspaceService(database *db.DB) *WorkspaceService {
	return &WorkspaceService{db: database}
}

// ListUserWorkspaces returns all workspaces the user is a member of
func (s *WorkspaceService) ListUserWorkspaces(ctx context.Context, userID string) ([]models.Workspace, error) {
	query := `
		SELECT w.id, w.name, w.slug, COALESCE(w.description, ''), COALESCE(w.logo_url, ''), w.owner_id, w.created_at, w.updated_at
		FROM workspaces w
		JOIN workspace_members wm ON w.id = wm.workspace_id
		WHERE wm.user_id = $1
		ORDER BY w.name ASC;
	`
	rows, err := s.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query user workspaces: %w", err)
	}
	defer rows.Close()

	var workspaces []models.Workspace
	for rows.Next() {
		var w models.Workspace
		if err := rows.Scan(&w.ID, &w.Name, &w.Slug, &w.Description, &w.LogoURL, &w.OwnerID, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan workspace: %w", err)
		}
		workspaces = append(workspaces, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating user workspaces: %w", err)
	}
	if workspaces == nil {
		workspaces = []models.Workspace{}
	}
	return workspaces, nil
}

// CreateWorkspace creates a workspace and adds the creator as Owner
func (s *WorkspaceService) CreateWorkspace(ctx context.Context, userID string, req models.CreateWorkspaceRequest) (*models.Workspace, error) {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return nil, errors.New("workspace name is required")
	}

	slug := strings.ToLower(strings.TrimSpace(req.Slug))
	if slug == "" {
		slug = strings.ToLower(strings.ReplaceAll(req.Name, " ", "-"))
	}

	var ws models.Workspace
	err := s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		query := `
			INSERT INTO workspaces (name, slug, description, owner_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			RETURNING id, name, slug, description, COALESCE(logo_url, ''), owner_id, created_at, updated_at;
		`
		if err := tx.QueryRowContext(ctx, query, req.Name, slug, req.Description, userID).Scan(
			&ws.ID, &ws.Name, &ws.Slug, &ws.Description, &ws.LogoURL, &ws.OwnerID, &ws.CreatedAt, &ws.UpdatedAt,
		); err != nil {
			return fmt.Errorf("failed creating workspace: %w", err)
		}

		// Insert creator as Owner
		memberQuery := `
			INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
			VALUES ($1, $2, 'Owner', NOW(), NOW());
		`
		if _, err := tx.ExecContext(ctx, memberQuery, ws.ID, userID); err != nil {
			return fmt.Errorf("failed adding owner to workspace_members: %w", err)
		}

		// Also create a default #general channel
		channelQuery := `
			INSERT INTO channels (workspace_id, name, description, is_private, created_by, created_at, updated_at)
			VALUES ($1, 'general', 'Company-wide announcements and general discussion', FALSE, $2, NOW(), NOW())
			RETURNING id;
		`
		var genChanID string
		if err := tx.QueryRowContext(ctx, channelQuery, ws.ID, userID).Scan(&genChanID); err == nil {
			_, _ = tx.ExecContext(ctx, `
				INSERT INTO channel_members (channel_id, user_id, role, joined_at)
				VALUES ($1, $2, 'Admin', NOW());
			`, genChanID, userID)
		}

		// Default workspace settings
		_, _ = tx.ExecContext(ctx, `
			INSERT INTO workspace_settings (workspace_id, min_password_length, require_special_char, require_number, password_expiry_days, max_login_attempts, lockout_duration_mins, enforce_2fa, session_timeout_mins, updated_at)
			VALUES ($1, 8, TRUE, TRUE, 90, 5, 15, FALSE, 1440, NOW())
			ON CONFLICT (workspace_id) DO NOTHING;
		`, ws.ID)

		return nil
	})

	if err != nil {
		return nil, err
	}
	return &ws, nil
}

// GetWorkspace returns a workspace by ID
func (s *WorkspaceService) GetWorkspace(ctx context.Context, workspaceID string) (*models.Workspace, error) {
	var ws models.Workspace
	query := `
		SELECT id, name, slug, COALESCE(description, ''), COALESCE(logo_url, ''), owner_id, created_at, updated_at
		FROM workspaces
		WHERE id = $1;
	`
	err := s.db.QueryRowContext(ctx, query, workspaceID).Scan(
		&ws.ID, &ws.Name, &ws.Slug, &ws.Description, &ws.LogoURL, &ws.OwnerID, &ws.CreatedAt, &ws.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrWorkspaceNotFound
		}
		return nil, fmt.Errorf("failed to query workspace: %w", err)
	}
	return &ws, nil
}

// ListWorkspaceMembers returns public member information
func (s *WorkspaceService) ListWorkspaceMembers(ctx context.Context, workspaceID string) ([]models.WorkspaceMember, error) {
	query := `
		SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.joined_at, wm.updated_at,
		       u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
		       u.role, COALESCE(u.department, ''), COALESCE(u.account_state, 'active'),
		       u.must_change_password, u.status, COALESCE(u.custom_status, ''), u.created_at
		FROM workspace_members wm
		JOIN users u ON wm.user_id = u.id
		WHERE wm.workspace_id = $1 AND u.deleted_at IS NULL
		ORDER BY u.full_name ASC;
	`
	rows, err := s.db.QueryContext(ctx, query, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed querying workspace members: %w", err)
	}
	defer rows.Close()

	var members []models.WorkspaceMember
	for rows.Next() {
		var wm models.WorkspaceMember
		var u models.UserResponse
		if err := rows.Scan(
			&wm.ID, &wm.WorkspaceID, &wm.UserID, &wm.Role, &wm.JoinedAt, &wm.UpdatedAt,
			&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
			&u.Role, &u.Department, &u.AccountState,
			&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan workspace member: %w", err)
		}
		wm.User = &u
		members = append(members, wm)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating workspace members: %w", err)
	}
	if members == nil {
		members = []models.WorkspaceMember{}
	}
	return members, nil
}

// CreateInvite creates an invitation code
func (s *WorkspaceService) CreateInvite(ctx context.Context, workspaceID, creatorID string, req models.CreateWorkspaceInviteRequest) (*models.WorkspaceInvite, error) {
	role := "Member"
	if req.Role == "Guest" || req.Role == "Admin" {
		role = req.Role
	}
	maxUses := 1
	if req.MaxUses > 0 {
		maxUses = req.MaxUses
	}

	code := fmt.Sprintf("inv_%d_%s", time.Now().UnixNano(), strings.ReplaceAll(time.Now().Format("060102150405"), ":", ""))

	var inv models.WorkspaceInvite
	query := `
		INSERT INTO workspace_invites (workspace_id, code, email, role, max_uses, uses_count, expires_at, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, 0, NOW() + INTERVAL '7 days', $6, NOW())
		RETURNING id, workspace_id, code, COALESCE(email, ''), role, max_uses, uses_count, expires_at, created_by, created_at;
	`
	err := s.db.QueryRowContext(ctx, query, workspaceID, code, req.Email, role, maxUses, creatorID).Scan(
		&inv.ID, &inv.WorkspaceID, &inv.Code, &inv.Email, &inv.Role, &inv.MaxUses, &inv.UsesCount, &inv.ExpiresAt, &inv.CreatedBy, &inv.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed creating workspace invite: %w", err)
	}
	return &inv, nil
}

// JoinWorkspaceWithInvite validates code and adds user
func (s *WorkspaceService) JoinWorkspaceWithInvite(ctx context.Context, userID, code string) (*models.Workspace, error) {
	var inv models.WorkspaceInvite
	query := `
		SELECT id, workspace_id, code, COALESCE(email, ''), role, max_uses, uses_count, expires_at, created_by, created_at
		FROM workspace_invites
		WHERE code = $1 AND expires_at > NOW() AND uses_count < max_uses;
	`
	err := s.db.QueryRowContext(ctx, query, code).Scan(
		&inv.ID, &inv.WorkspaceID, &inv.Code, &inv.Email, &inv.Role, &inv.MaxUses, &inv.UsesCount, &inv.ExpiresAt, &inv.CreatedBy, &inv.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInviteNotFound
		}
		return nil, err
	}

	var alreadyMember bool
	_ = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2)`, inv.WorkspaceID, userID).Scan(&alreadyMember)
	if alreadyMember {
		return s.GetWorkspace(ctx, inv.WorkspaceID)
	}

	err = s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
			VALUES ($1, $2, $3, NOW(), NOW());
		`, inv.WorkspaceID, userID, inv.Role)
		if err != nil {
			return err
		}

		_, err = tx.ExecContext(ctx, `
			UPDATE workspace_invites SET uses_count = uses_count + 1 WHERE id = $1;
		`, inv.ID)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("failed joining workspace: %w", err)
	}

	return s.GetWorkspace(ctx, inv.WorkspaceID)
}
