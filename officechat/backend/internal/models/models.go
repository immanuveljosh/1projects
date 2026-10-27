package models

import (
	"time"
)

// User System Roles
const (
	SystemRoleAdmin = "admin"
	SystemRoleUser  = "user"
)

// User Presence Statuses
const (
	StatusOnline  = "online"
	StatusAway    = "away"
	StatusDND     = "dnd"
	StatusOffline = "offline"
)

// Workspace Member Roles (Strict 4-tier RBAC)
const (
	RoleOwner  = "Owner"
	RoleAdmin  = "Admin"
	RoleMember = "Member"
	RoleGuest  = "Guest"
)

// User Account States
const (
	AccountStateActive      = "active"
	AccountStateSuspended   = "suspended"
	AccountStateDeactivated = "deactivated"
)

// Channel Member Roles
const (
	ChannelRoleAdmin  = "Admin"
	ChannelRoleMember = "Member"
)

// Task Statuses
const (
	TaskStatusTodo       = "todo"
	TaskStatusInProgress = "in_progress"
	TaskStatusDone       = "done"
)

// User represents a user account
type User struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email"`
	PasswordHash       string     `json:"-"`
	FullName           string     `json:"full_name"`
	DisplayName        string     `json:"display_name"`
	AvatarURL          string     `json:"avatar_url"`
	Role               string     `json:"role"`
	Department         string     `json:"department"`
	AccountState       string     `json:"account_state"`
	MustChangePassword bool       `json:"must_change_password"`
	PasswordChangedAt  *time.Time `json:"password_changed_at,omitempty"`
	FailedLoginCount   int        `json:"failed_login_count"`
	LockedUntil        *time.Time `json:"locked_until,omitempty"`
	Status             string     `json:"status"`
	CustomStatus       string     `json:"custom_status"`
	StatusUpdatedAt    *time.Time `json:"status_updated_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	DeletedAt          *time.Time `json:"deleted_at,omitempty"`
}

// UserResponse is a public sanitized representation of a User
type UserResponse struct {
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
	CreatedAt          time.Time `json:"created_at"`
}

func (u *User) ToResponse() UserResponse {
	accountState := u.AccountState
	if accountState == "" {
		accountState = AccountStateActive
	}
	return UserResponse{
		ID:                 u.ID,
		Email:              u.Email,
		FullName:           u.FullName,
		DisplayName:        u.DisplayName,
		AvatarURL:          u.AvatarURL,
		Role:               u.Role,
		Department:         u.Department,
		AccountState:       accountState,
		MustChangePassword: u.MustChangePassword,
		Status:             u.Status,
		CustomStatus:       u.CustomStatus,
		CreatedAt:          u.CreatedAt,
	}
}

// RefreshToken model
type RefreshToken struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	TokenHash string     `json:"-"`
	ExpiresAt time.Time  `json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	UserAgent string     `json:"user_agent"`
	IPAddress string     `json:"ip_address"`
	CreatedAt time.Time  `json:"created_at"`
}

// Workspace represents an organization/company workspace
type Workspace struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Description string    `json:"description"`
	LogoURL     string    `json:"logo_url"`
	OwnerID     string    `json:"owner_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// WorkspaceMember represents membership in a workspace
type WorkspaceMember struct {
	ID          string        `json:"id"`
	WorkspaceID string        `json:"workspace_id"`
	UserID      string        `json:"user_id"`
	Role        string        `json:"role"` // Owner, Admin, Member, Guest
	JoinedAt    time.Time     `json:"joined_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	User        *UserResponse `json:"user,omitempty"`
}

// WorkspaceInvite represents an invitation to join a workspace
type WorkspaceInvite struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Code        string    `json:"code"`
	Email       string    `json:"email,omitempty"`
	Role        string    `json:"role"`
	MaxUses     int       `json:"max_uses"`
	UsesCount   int       `json:"uses_count"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// Channel represents a public or private discussion channel
type Channel struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspace_id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Topic          string    `json:"topic"`
	IsPrivate      bool      `json:"is_private"`
	IsArchived     bool      `json:"is_archived"`
	IsAnnouncement bool      `json:"is_announcement"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	MemberCount    int       `json:"member_count,omitempty"`
	IsMember       bool      `json:"is_member,omitempty"`
	UnreadCount    int       `json:"unread_count,omitempty"`
}

// ChannelMember represents membership in a channel
type ChannelMember struct {
	ID        string        `json:"id"`
	ChannelID string        `json:"channel_id"`
	UserID    string        `json:"user_id"`
	Role      string        `json:"role"` // Admin, Member
	IsMuted   bool          `json:"is_muted"`
	JoinedAt  time.Time     `json:"joined_at"`
	User      *UserResponse `json:"user,omitempty"`
}

// DirectMessageGroup represents 1:1 or multi-party direct message group
type DirectMessageGroup struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	IsGroup     bool           `json:"is_group"`
	Name        string         `json:"name,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	Members     []UserResponse `json:"members,omitempty"`
	LastMessage *Message       `json:"last_message,omitempty"`
	UnreadCount int            `json:"unread_count,omitempty"`
}

// Message represents a chat message
type Message struct {
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspace_id"`
	ChannelID   *string           `json:"channel_id,omitempty"`
	DMGroupID   *string           `json:"dm_group_id,omitempty"`
	SenderID    string            `json:"sender_id"`
	ThreadID    *string           `json:"thread_id,omitempty"`
	ParentID    *string           `json:"parent_id,omitempty"`
	Content     string            `json:"content"`
	IsPinned    bool              `json:"is_pinned"`
	EditedAt    *time.Time        `json:"edited_at,omitempty"`
	DeletedAt   *time.Time        `json:"deleted_at,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	Sender      *UserResponse     `json:"sender,omitempty"`
	Reactions   []ReactionSummary `json:"reactions,omitempty"`
	Attachments []Attachment      `json:"attachments,omitempty"`
	Poll        *PollSummary      `json:"poll,omitempty"`
	ReplyCount  int               `json:"reply_count,omitempty"`
	LastReplyAt *time.Time        `json:"last_reply_at,omitempty"`
}

// Reaction represents an emoji reaction on a message
type Reaction struct {
	ID        string    `json:"id"`
	MessageID string    `json:"message_id"`
	UserID    string    `json:"user_id"`
	Emoji     string    `json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
}

// ReactionSummary aggregates reactions for a message
type ReactionSummary struct {
	Emoji      string   `json:"emoji"`
	Count      int      `json:"count"`
	UserIDs    []string `json:"user_ids"`
	HasReacted bool     `json:"has_reacted"`
}

// Attachment represents an uploaded file
type Attachment struct {
	ID               string    `json:"id"`
	MessageID        *string   `json:"message_id,omitempty"`
	WorkspaceID      string    `json:"workspace_id"`
	FileName         string    `json:"file_name"`
	FileSize         int64     `json:"file_size"`
	ContentType      string    `json:"content_type"`
	FileKey          string    `json:"file_key"`
	FileURL          string    `json:"file_url"`
	VirusScanStatus  string    `json:"virus_scan_status"`
	UploadedBy       string    `json:"uploaded_by"`
	CreatedAt        time.Time `json:"created_at"`
	UploaderResponse *UserResponse `json:"uploader,omitempty"`
}

// Pin represents a pinned message
type Pin struct {
	ID        string    `json:"id"`
	MessageID string    `json:"message_id"`
	ChannelID *string   `json:"channel_id,omitempty"`
	DMGroupID *string   `json:"dm_group_id,omitempty"`
	PinnedBy  string    `json:"pinned_by"`
	PinnedAt  time.Time `json:"pinned_at"`
	Message   *Message  `json:"message,omitempty"`
	Pinner    *UserResponse `json:"pinner,omitempty"`
}

// Mention represents a user or broadcast mention
type Mention struct {
	ID          string    `json:"id"`
	MessageID   string    `json:"message_id"`
	UserID      *string   `json:"user_id,omitempty"`
	MentionType string    `json:"mention_type"` // 'user', 'channel', 'here'
	CreatedAt   time.Time `json:"created_at"`
}

// ReadState tracks unread counts and last read position
type ReadState struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	ChannelID         *string   `json:"channel_id,omitempty"`
	DMGroupID         *string   `json:"dm_group_id,omitempty"`
	LastReadMessageID *string   `json:"last_read_message_id,omitempty"`
	LastReadAt        time.Time `json:"last_read_at"`
	UnreadCount       int       `json:"unread_count"`
}

// Poll represents an interactive poll
type Poll struct {
	ID        string     `json:"id"`
	MessageID *string    `json:"message_id,omitempty"`
	ChannelID *string    `json:"channel_id,omitempty"`
	DMGroupID *string    `json:"dm_group_id,omitempty"`
	Question  string     `json:"question"`
	IsClosed  bool       `json:"is_closed"`
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	ClosedAt  *time.Time `json:"closed_at,omitempty"`
}

// PollOption represents an option in a poll
type PollOption struct {
	ID         string `json:"id"`
	PollID     string `json:"poll_id"`
	OptionText string `json:"option_text"`
	OrderIndex int    `json:"order_index"`
}

// PollOptionSummary provides option details with vote counts
type PollOptionSummary struct {
	ID         string         `json:"id"`
	OptionText string         `json:"option_text"`
	OrderIndex int            `json:"order_index"`
	VoteCount  int            `json:"vote_count"`
	Voters     []UserResponse `json:"voters,omitempty"`
}

// PollSummary aggregates poll data
type PollSummary struct {
	ID            string              `json:"id"`
	Question      string              `json:"question"`
	IsClosed      bool                `json:"is_closed"`
	CreatedBy     string              `json:"created_by"`
	TotalVotes    int                 `json:"total_votes"`
	Options       []PollOptionSummary `json:"options"`
	UserVotedID   *string             `json:"user_voted_id,omitempty"`
	Creator       *UserResponse       `json:"creator,omitempty"`
}

// Task represents a to-do/task created in an office workspace
type Task struct {
	ID          string        `json:"id"`
	WorkspaceID string        `json:"workspace_id"`
	MessageID   *string       `json:"message_id,omitempty"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	AssignedTo  *string       `json:"assigned_to,omitempty"`
	Status      string        `json:"status"` // todo, in_progress, done
	DueDate     *time.Time    `json:"due_date,omitempty"`
	CreatedBy   string        `json:"created_by"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	Assignee    *UserResponse `json:"assignee,omitempty"`
	Creator     *UserResponse `json:"creator,omitempty"`
}

// Notification represents an alert for user
type Notification struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	WorkspaceID string         `json:"workspace_id"`
	Type        string         `json:"type"` // mention, dm, thread_reply, reaction, task_assigned, announcement
	Title       string         `json:"title"`
	Body        string         `json:"body"`
	Data        map[string]any `json:"data"`
	IsRead      bool           `json:"is_read"`
	ReadAt      *time.Time     `json:"read_at,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

// AuditLog records security and administrative actions
type AuditLog struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	ActorID     *string        `json:"actor_id,omitempty"`
	Action      string         `json:"action"`
	TargetType  string         `json:"target_type"`
	TargetID    *string        `json:"target_id,omitempty"`
	EntityType  string         `json:"entity_type,omitempty"`
	EntityID    *string        `json:"entity_id,omitempty"`
	BeforeState map[string]any `json:"before_state,omitempty"`
	AfterState  map[string]any `json:"after_state,omitempty"`
	Details     map[string]any `json:"details"`
	IPAddress   string         `json:"ip_address,omitempty"`
	UserAgent   string         `json:"user_agent,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	Actor       *UserResponse  `json:"actor,omitempty"`
}

// WorkspaceSettings holds workspace-level settings & password policies
type WorkspaceSettings struct {
	WorkspaceID         string    `json:"workspace_id"`
	RetentionDays       int       `json:"retention_days"`
	AllowGuestInvites   bool      `json:"allow_guest_invites"`
	MinPasswordLength   int       `json:"min_password_length"`
	RequireSpecialChar  bool      `json:"require_special_char"`
	RequireNumber       bool      `json:"require_number"`
	PasswordExpiryDays  int       `json:"password_expiry_days"`
	MaxLoginAttempts    int       `json:"max_login_attempts"`
	LockoutDurationMins int       `json:"lockout_duration_mins"`
	Enforce2FA          bool      `json:"enforce_2fa"`
	SessionTimeoutMins  int       `json:"session_timeout_mins"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// DTOs for Auth
type RegisterRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	FullName    string `json:"full_name"`
	DisplayName string `json:"display_name"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type AuthResponse struct {
	User         UserResponse `json:"user"`
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
	ExpiresIn    int64        `json:"expires_in"` // seconds
}

type UpdateProfileRequest struct {
	FullName     *string `json:"full_name,omitempty"`
	DisplayName  *string `json:"display_name,omitempty"`
	AvatarURL    *string `json:"avatar_url,omitempty"`
	Status       *string `json:"status,omitempty"`
	CustomStatus *string `json:"custom_status,omitempty"`
}

// DeviceToken represents a mobile or web device push notification token
type DeviceToken struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	WorkspaceID *string   `json:"workspace_id,omitempty"`
	Token       string    `json:"token"`
	Platform    string    `json:"platform"` // 'android', 'ios', 'web'
	CreatedAt   time.Time `json:"created_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

type RegisterDeviceTokenRequest struct {
	Token    string `json:"token"`
	Platform string `json:"platform"` // 'android', 'ios', 'web'
}

type CreateWorkspaceRequest struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description,omitempty"`
}

type CreateChannelRequest struct {
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	Topic          string `json:"topic,omitempty"`
	IsPrivate      bool   `json:"is_private"`
	IsAnnouncement bool   `json:"is_announcement"`
}

type SendMessageRequest struct {
	Content     string   `json:"content"`
	ParentID    *string  `json:"parent_id,omitempty"`
	AttachmentIDs []string `json:"attachment_ids,omitempty"`
}

type UpdateMessageRequest struct {
	Content string `json:"content"`
}

type CreateDMRequest struct {
	TargetUserIDs []string `json:"target_user_ids"`
	Name          *string  `json:"name,omitempty"`
}

type AddReactionRequest struct {
	Emoji string `json:"emoji"`
}

type CreatePollRequest struct {
	Question  string   `json:"question"`
	Options   []string `json:"options"`
	ChannelID *string  `json:"channel_id,omitempty"`
	DMGroupID *string  `json:"dm_group_id,omitempty"`
	MessageID *string  `json:"message_id,omitempty"`
}

type VotePollRequest struct {
	OptionID string `json:"option_id"`
}

type CreateTaskRequest struct {
	WorkspaceID string     `json:"workspace_id"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	MessageID   *string    `json:"message_id,omitempty"`
	AssignedTo  *string    `json:"assigned_to,omitempty"`
	DueDate     *time.Time `json:"due_date,omitempty"`
}

type UpdateTaskRequest struct {
	Title       *string    `json:"title,omitempty"`
	Description *string    `json:"description,omitempty"`
	AssignedTo  *string    `json:"assigned_to,omitempty"`
	Status      *string    `json:"status,omitempty"`
	DueDate     *time.Time `json:"due_date,omitempty"`
}

type CreateWorkspaceInviteRequest struct {
	Email   string `json:"email,omitempty"`
	Role    string `json:"role,omitempty"`
	MaxUses int    `json:"max_uses,omitempty"`
}

