package admin

import "time"

type AdminChannel struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspace_id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Topic          string    `json:"topic"`
	IsPrivate      bool      `json:"is_private"`
	IsArchived     bool      `json:"is_archived"`
	IsAnnouncement bool      `json:"is_announcement"`
	MemberCount    int       `json:"member_count"`
	CreatedBy      string    `json:"created_by"`
	CreatorName    string    `json:"creator_name"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type AdminChannelMember struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	FullName    string    `json:"full_name"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email"`
	AvatarURL   string    `json:"avatar_url"`
	Role        string    `json:"role"`
	JoinedAt    time.Time `json:"joined_at"`
}

type AdminChannelDetail struct {
	AdminChannel
	Members []AdminChannelMember `json:"members"`
}

type AdminChannelListResponse struct {
	Channels   []AdminChannel `json:"channels"`
	NextCursor string         `json:"next_cursor,omitempty"`
	HasMore    bool           `json:"has_more"`
	TotalCount int            `json:"total_count"`
}

type CreateChannelRequest struct {
	Name             string   `json:"name"`
	Description      string   `json:"description,omitempty"`
	Topic            string   `json:"topic,omitempty"`
	IsPrivate        bool     `json:"is_private"`
	IsAnnouncement   bool     `json:"is_announcement"`
	InitialMemberIDs []string `json:"initial_member_ids,omitempty"`
}

type UpdateChannelRequest struct {
	Name           *string `json:"name,omitempty"`
	Description    *string `json:"description,omitempty"`
	Topic          *string `json:"topic,omitempty"`
	IsPrivate      *bool   `json:"is_private,omitempty"`
	IsArchived     *bool   `json:"is_archived,omitempty"`
	IsAnnouncement *bool   `json:"is_announcement,omitempty"`
}

type DeleteChannelRequest struct {
	ConfirmText string `json:"confirm_text,omitempty"`
	Permanent   bool   `json:"permanent"`
}

type AddChannelMembersRequest struct {
	UserIDs []string `json:"user_ids"`
	Role    string   `json:"role,omitempty"`
}
