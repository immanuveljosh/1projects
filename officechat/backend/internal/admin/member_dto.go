package admin

import "time"

type AdminMember struct {
	ID                 string    `json:"id"`
	Email              string    `json:"email"`
	FullName           string    `json:"full_name"`
	DisplayName        string    `json:"display_name"`
	AvatarURL          string    `json:"avatar_url"`
	Role               string    `json:"role"`
	Department         string    `json:"department"`
	AccountState       string    `json:"account_state"`
	MustChangePassword bool      `json:"must_change_password"`
	Status             string    `json:"status"`
	CustomStatus       string    `json:"custom_status"`
	JoinedAt           time.Time `json:"joined_at"`
	CreatedAt          time.Time `json:"created_at"`
}

type AdminMemberListResponse struct {
	Members    []AdminMember `json:"members"`
	NextCursor string        `json:"next_cursor,omitempty"`
	HasMore    bool          `json:"has_more"`
	TotalCount int           `json:"total_count"`
}

type CreateMemberRequest struct {
	Email              string `json:"email"`
	FullName           string `json:"full_name"`
	DisplayName        string `json:"display_name"`
	Role               string `json:"role"`
	Department         string `json:"department"`
	Password           string `json:"password,omitempty"`
	MustChangePassword bool   `json:"must_change_password"`
}

type CreateMemberResponse struct {
	Member            AdminMember `json:"member"`
	GeneratedPassword string      `json:"generated_password,omitempty"`
}

type UpdateMemberRequest struct {
	FullName     *string `json:"full_name,omitempty"`
	DisplayName  *string `json:"display_name,omitempty"`
	Email        *string `json:"email,omitempty"`
	Department   *string `json:"department,omitempty"`
	Role         *string `json:"role,omitempty"`
	AccountState *string `json:"account_state,omitempty"`
}

type ResetPasswordRequest struct {
	AdminPassword      string `json:"admin_password"`
	TemporaryPassword  string `json:"temporary_password,omitempty"`
	MustChangePassword bool   `json:"must_change_password"`
	ForceLogout        bool   `json:"force_logout"`
}

type ResetPasswordResponse struct {
	TemporaryPassword string `json:"temporary_password"`
}

type ForceLogoutRequest struct {
	AdminPassword string `json:"admin_password"`
}

type DeleteMemberRequest struct {
	AdminPassword  string `json:"admin_password"`
	Permanent      bool   `json:"permanent"`
	DeleteMessages bool   `json:"delete_messages"`
	ConfirmText    string `json:"confirm_text,omitempty"`
}

type ImportErrorItem struct {
	Row   int    `json:"row"`
	Email string `json:"email"`
	Error string `json:"error"`
}

type ImportResult struct {
	Total     int                    `json:"total"`
	Succeeded int                    `json:"succeeded"`
	Failed    int                    `json:"failed"`
	Errors    []ImportErrorItem      `json:"errors"`
	Created   []CreateMemberResponse `json:"created"`
}
