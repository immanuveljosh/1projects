package rbac_test

import (
	"errors"
	"testing"

	"officechat/backend/internal/models"
	"officechat/backend/internal/rbac"
)

func TestNormalizeRole(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"owner", models.RoleOwner},
		{"Owner", models.RoleOwner},
		{"ADMIN", models.RoleAdmin},
		{"admin", models.RoleAdmin},
		{"member", models.RoleMember},
		{"user", models.RoleMember},
		{"Member", models.RoleMember},
		{"guest", models.RoleGuest},
		{"Guest", models.RoleGuest},
		{"unknown", "Unknown"},
	}

	for _, tc := range cases {
		actual := rbac.NormalizeRole(tc.input)
		if actual != tc.expected {
			t.Errorf("NormalizeRole(%q) = %q; expected %q", tc.input, actual, tc.expected)
		}
	}
}

func TestIsAdminOrOwner(t *testing.T) {
	if !rbac.IsAdminOrOwner("owner") {
		t.Errorf("expected owner to be admin or owner")
	}
	if !rbac.IsAdminOrOwner("Admin") {
		t.Errorf("expected Admin to be admin or owner")
	}
	if rbac.IsAdminOrOwner("member") {
		t.Errorf("expected member to not be admin or owner")
	}
	if rbac.IsAdminOrOwner("guest") {
		t.Errorf("expected guest to not be admin or owner")
	}
}

func TestCanManageMember(t *testing.T) {
	// 1. Member and Guest cannot manage anyone
	for _, nonAdmin := range []string{models.RoleMember, models.RoleGuest} {
		err := rbac.CanManageMember(nonAdmin, models.RoleMember, models.RoleMember)
		if !errors.Is(err, rbac.ErrForbidden) {
			t.Errorf("expected ErrForbidden for actor %s, got: %v", nonAdmin, err)
		}
	}

	// 2. Admin cannot edit or delete Owner
	err := rbac.CanManageMember(models.RoleAdmin, models.RoleOwner, models.RoleMember)
	if !errors.Is(err, rbac.ErrCannotEditOwner) {
		t.Errorf("expected ErrCannotEditOwner for Admin targeting Owner, got: %v", err)
	}

	// 3. Admin cannot promote to Admin or Owner
	err = rbac.CanManageMember(models.RoleAdmin, models.RoleMember, models.RoleAdmin)
	if !errors.Is(err, rbac.ErrOnlyOwnerPromoteAdmin) {
		t.Errorf("expected ErrOnlyOwnerPromoteAdmin for Admin promoting to Admin, got: %v", err)
	}
	err = rbac.CanManageMember(models.RoleAdmin, models.RoleMember, models.RoleOwner)
	if !errors.Is(err, rbac.ErrOnlyOwnerPromoteAdmin) {
		t.Errorf("expected ErrOnlyOwnerPromoteAdmin for Admin promoting to Owner, got: %v", err)
	}

	// 4. Admin cannot demote an Admin
	err = rbac.CanManageMember(models.RoleAdmin, models.RoleAdmin, models.RoleMember)
	if !errors.Is(err, rbac.ErrOnlyOwnerPromoteAdmin) {
		t.Errorf("expected ErrOnlyOwnerPromoteAdmin for Admin demoting an Admin, got: %v", err)
	}

	// 5. Admin CAN manage Member to Guest or Member
	err = rbac.CanManageMember(models.RoleAdmin, models.RoleMember, models.RoleGuest)
	if err != nil {
		t.Errorf("expected Admin to manage Member->Guest, got: %v", err)
	}

	// 6. Owner CAN manage anyone (promote to Admin, demote Admin, edit Owner)
	err = rbac.CanManageMember(models.RoleOwner, models.RoleMember, models.RoleAdmin)
	if err != nil {
		t.Errorf("expected Owner to promote Member to Admin, got: %v", err)
	}

	err = rbac.CanManageMember(models.RoleOwner, models.RoleAdmin, models.RoleMember)
	if err != nil {
		t.Errorf("expected Owner to demote Admin, got: %v", err)
	}

	err = rbac.CanManageMember(models.RoleOwner, models.RoleOwner, models.RoleAdmin)
	if err != nil {
		t.Errorf("expected Owner to manage another Owner, got: %v", err)
	}
}

func TestCheckLastOwnerCount(t *testing.T) {
	// If only 1 owner or fewer left, return ErrLastOwner
	if err := rbac.CheckLastOwnerCount(1); !errors.Is(err, rbac.ErrLastOwner) {
		t.Errorf("expected ErrLastOwner with 1 owner, got: %v", err)
	}
	if err := rbac.CheckLastOwnerCount(0); !errors.Is(err, rbac.ErrLastOwner) {
		t.Errorf("expected ErrLastOwner with 0 owners, got: %v", err)
	}

	// If 2 or more owners, allowed
	if err := rbac.CheckLastOwnerCount(2); err != nil {
		t.Errorf("expected nil error with 2 owners, got: %v", err)
	}
}
