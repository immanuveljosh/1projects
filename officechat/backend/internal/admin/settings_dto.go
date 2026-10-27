package admin

import "time"

type WorkspaceSettingsDTO struct {
	WorkspaceID         string    `json:"workspace_id"`
	MinPasswordLength   int       `json:"min_password_length"`
	RequireSpecialChar  bool      `json:"require_special_char"`
	RequireNumber       bool      `json:"require_number"`
	PasswordExpiryDays  int       `json:"password_expiry_days"`
	MaxLoginAttempts    int       `json:"max_login_attempts"`
	LockoutDurationMins int       `json:"lockout_duration_mins"`
	Enforce2FA          bool      `json:"enforce_2fa"`
	SessionTimeoutMins  int       `json:"session_timeout_mins"`
	RetentionDays       int       `json:"retention_days"`
	AllowGuestInvites   bool      `json:"allow_guest_invites"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type UpdateSettingsRequest struct {
	MinPasswordLength   *int  `json:"min_password_length,omitempty"`
	RequireSpecialChar  *bool `json:"require_special_char,omitempty"`
	RequireNumber       *bool `json:"require_number,omitempty"`
	PasswordExpiryDays  *int  `json:"password_expiry_days,omitempty"`
	MaxLoginAttempts    *int  `json:"max_login_attempts,omitempty"`
	LockoutDurationMins *int  `json:"lockout_duration_mins,omitempty"`
	Enforce2FA          *bool `json:"enforce_2fa,omitempty"`
	SessionTimeoutMins  *int  `json:"session_timeout_mins,omitempty"`
	RetentionDays       *int  `json:"retention_days,omitempty"`
	AllowGuestInvites   *bool `json:"allow_guest_invites,omitempty"`
}

type EmergencyLogoutRequest struct {
	AdminPassword string `json:"admin_password"`
}

type AuditLogItem struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	ActorID     string         `json:"actor_id"`
	ActorName   string         `json:"actor_name"`
	ActorEmail  string         `json:"actor_email"`
	Action      string         `json:"action"`
	TargetType  string         `json:"target_type"`
	TargetID    string         `json:"target_id"`
	BeforeState map[string]any `json:"before_state,omitempty"`
	AfterState  map[string]any `json:"after_state,omitempty"`
	Details     map[string]any `json:"details"`
	IPAddress   string         `json:"ip_address"`
	UserAgent   string         `json:"user_agent"`
	CreatedAt   time.Time      `json:"created_at"`
	Summary     string         `json:"summary"`
}

type AuditLogListResponse struct {
	Logs       []AuditLogItem `json:"logs"`
	NextCursor string         `json:"next_cursor,omitempty"`
	HasMore    bool           `json:"has_more"`
	TotalCount int            `json:"total_count"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}
