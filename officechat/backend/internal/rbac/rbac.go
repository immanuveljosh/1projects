package rbac

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"officechat/backend/internal/models"
)

var (
	ErrForbidden             = errors.New("access denied: insufficient permissions")
	ErrCannotEditOwner       = errors.New("admins cannot edit or delete an owner")
	ErrOnlyOwnerPromoteAdmin = errors.New("only an owner can create or remove admins")
	ErrLastOwner             = errors.New("cannot delete or demote the last owner of the workspace")
	ErrSelfDemoteLastOwner   = errors.New("the last owner cannot leave or demote themselves")
)

type DBQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// NormalizeRole returns canonical capitalized role (Owner, Admin, Member, Guest)
func NormalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "owner":
		return models.RoleOwner
	case "admin":
		return models.RoleAdmin
	case "member", "user":
		return models.RoleMember
	case "guest":
		return models.RoleGuest
	default:
		return strings.Title(strings.ToLower(strings.TrimSpace(role)))
	}
}

// IsAdminOrOwner checks if role is Owner or Admin
func IsAdminOrOwner(role string) bool {
	norm := NormalizeRole(role)
	return norm == models.RoleOwner || norm == models.RoleAdmin
}

// CanManageMember checks if actorRole has permission to modify targetRole and/or assign newRole
func CanManageMember(actorRole, targetRole, newRole string) error {
	actor := NormalizeRole(actorRole)
	target := NormalizeRole(targetRole)
	newR := NormalizeRole(newRole)

	// Member and Guest cannot manage anyone
	if actor != models.RoleOwner && actor != models.RoleAdmin {
		return ErrForbidden
	}

	// Admins cannot edit, demote, or delete an Owner
	if target == models.RoleOwner && actor != models.RoleOwner {
		return ErrCannotEditOwner
	}

	// Only an Owner can promote someone to Admin or demote an Admin
	if actor != models.RoleOwner {
		if target == models.RoleAdmin && newR != "" && newR != models.RoleAdmin {
			return ErrOnlyOwnerPromoteAdmin
		}
		if newR == models.RoleAdmin || newR == models.RoleOwner {
			return ErrOnlyOwnerPromoteAdmin
		}
	}

	return nil
}

// CheckLastOwnerCount verifies if the workspace has more than one owner remaining
func CheckLastOwnerCount(count int) error {
	if count <= 1 {
		return ErrLastOwner
	}
	return nil
}

// CheckLastOwner verifies if the workspace has more than one owner remaining
func CheckLastOwner(ctx context.Context, q DBQuerier, workspaceID string) error {
	var count int
	err := q.QueryRowContext(ctx, `
		SELECT COUNT(*) 
		FROM workspace_members 
		WHERE workspace_id = $1 AND role = 'Owner'
	`, workspaceID).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check owner count: %w", err)
	}

	return CheckLastOwnerCount(count)
}

