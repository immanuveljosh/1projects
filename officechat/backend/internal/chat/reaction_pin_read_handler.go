package chat

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/db"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
	"officechat/backend/internal/ws"
)

type ReactionPinReadHandler struct {
	db  *db.DB
	hub *ws.Hub
	tm  *tokens.TokenManager
}

func NewReactionPinReadHandler(database *db.DB, hub *ws.Hub, tm *tokens.TokenManager) *ReactionPinReadHandler {
	return &ReactionPinReadHandler{db: database, hub: hub, tm: tm}
}

func (h *ReactionPinReadHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(cr chi.Router) {
		cr.Use(middleware.Authenticator(h.tm))

		// Reactions
		cr.Post("/messages/{id}/reactions", h.HandleAddReaction)
		cr.Delete("/messages/{id}/reactions", h.HandleRemoveReaction)

		// Pins
		cr.Post("/messages/{id}/pin", h.HandlePinMessage)
		cr.Delete("/messages/{id}/pin", h.HandleUnpinMessage)
		cr.Get("/channels/{id}/pins", h.HandleListChannelPins)
		cr.Get("/dms/{id}/pins", h.HandleListDMPins)

		// Read states
		cr.Post("/channels/{id}/read", h.HandleMarkChannelRead)
		cr.Post("/dms/{id}/read", h.HandleMarkDMRead)
	})
}

// HandleAddReaction adds an emoji reaction to a message
func (h *ReactionPinReadHandler) HandleAddReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	messageID := chi.URLParam(r, "id")
	var req models.AddReactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Emoji) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Valid emoji is required")
		return
	}

	var workspaceID string
	err := h.db.QueryRowContext(r.Context(), `SELECT workspace_id FROM messages WHERE id = $1 AND deleted_at IS NULL`, messageID).Scan(&workspaceID)
	if err != nil {
		utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Message not found")
		return
	}

	query := `
		INSERT INTO reactions (message_id, user_id, emoji, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (message_id, user_id, emoji) DO NOTHING;
	`
	_, err = h.db.ExecContext(r.Context(), query, messageID, userID, req.Emoji)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to add reaction")
		return
	}

	if h.hub != nil {
		h.hub.BroadcastToWorkspace(workspaceID, "reaction.added", map[string]string{
			"message_id": messageID,
			"user_id":    userID,
			"emoji":      req.Emoji,
		})
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Reaction added"})
}

// HandleRemoveReaction removes an emoji reaction from a message
func (h *ReactionPinReadHandler) HandleRemoveReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	messageID := chi.URLParam(r, "id")
	emoji := r.URL.Query().Get("emoji")
	if emoji == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Query parameter 'emoji' is required")
		return
	}

	var workspaceID string
	err := h.db.QueryRowContext(r.Context(), `SELECT workspace_id FROM messages WHERE id = $1 AND deleted_at IS NULL`, messageID).Scan(&workspaceID)
	if err != nil {
		utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Message not found")
		return
	}

	query := `DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3;`
	_, err = h.db.ExecContext(r.Context(), query, messageID, userID, emoji)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to remove reaction")
		return
	}

	if h.hub != nil {
		h.hub.BroadcastToWorkspace(workspaceID, "reaction.removed", map[string]string{
			"message_id": messageID,
			"user_id":    userID,
			"emoji":      emoji,
		})
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Reaction removed"})
}

// HandlePinMessage pins a message
func (h *ReactionPinReadHandler) HandlePinMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	messageID := chi.URLParam(r, "id")
	var workspaceID string
	var channelID, dmGroupID *string
	err := h.db.QueryRowContext(r.Context(), `SELECT workspace_id, channel_id, dm_group_id FROM messages WHERE id = $1 AND deleted_at IS NULL`, messageID).Scan(&workspaceID, &channelID, &dmGroupID)
	if err != nil {
		utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Message not found")
		return
	}

	_, _ = h.db.ExecContext(r.Context(), `UPDATE messages SET is_pinned = TRUE WHERE id = $1`, messageID)
	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO pins (message_id, channel_id, dm_group_id, pinned_by, pinned_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (message_id) DO UPDATE SET pinned_by = EXCLUDED.pinned_by, pinned_at = NOW();
	`, messageID, channelID, dmGroupID, userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to pin message")
		return
	}

	if h.hub != nil {
		h.hub.BroadcastToWorkspace(workspaceID, "pin.added", map[string]any{
			"message_id":  messageID,
			"channel_id":  channelID,
			"dm_group_id": dmGroupID,
			"pinned_by":   userID,
		})
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Message pinned"})
}

// HandleUnpinMessage unpins a message
func (h *ReactionPinReadHandler) HandleUnpinMessage(w http.ResponseWriter, r *http.Request) {
	messageID := chi.URLParam(r, "id")
	var workspaceID string
	var channelID, dmGroupID *string
	err := h.db.QueryRowContext(r.Context(), `SELECT workspace_id, channel_id, dm_group_id FROM messages WHERE id = $1`, messageID).Scan(&workspaceID, &channelID, &dmGroupID)
	if err != nil {
		utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Message not found")
		return
	}

	_, _ = h.db.ExecContext(r.Context(), `UPDATE messages SET is_pinned = FALSE WHERE id = $1`, messageID)
	_, _ = h.db.ExecContext(r.Context(), `DELETE FROM pins WHERE message_id = $1`, messageID)

	if h.hub != nil {
		h.hub.BroadcastToWorkspace(workspaceID, "pin.removed", map[string]any{
			"message_id":  messageID,
			"channel_id":  channelID,
			"dm_group_id": dmGroupID,
		})
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Message unpinned"})
}

// HandleListChannelPins lists pinned messages for channel
func (h *ReactionPinReadHandler) HandleListChannelPins(w http.ResponseWriter, r *http.Request) {
	channelID := chi.URLParam(r, "id")
	query := `
		SELECT m.id, m.workspace_id, m.channel_id, m.sender_id, m.content, m.is_pinned, m.created_at,
		       u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
		       u.role, COALESCE(u.department, ''), COALESCE(u.account_state, 'active'),
		       u.must_change_password, u.status, COALESCE(u.custom_status, ''), u.created_at,
		       p.pinned_at, p.pinned_by
		FROM pins p
		JOIN messages m ON p.message_id = m.id
		JOIN users u ON m.sender_id = u.id
		WHERE p.channel_id = $1 AND m.deleted_at IS NULL
		ORDER BY p.pinned_at DESC;
	`
	rows, err := h.db.QueryContext(r.Context(), query, channelID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve channel pins")
		return
	}
	defer rows.Close()

	var pins []map[string]any
	for rows.Next() {
		var m models.Message
		var u models.UserResponse
		var pinnedAt string
		var pinnedBy string
		if err := rows.Scan(
			&m.ID, &m.WorkspaceID, &m.ChannelID, &m.SenderID, &m.Content, &m.IsPinned, &m.CreatedAt,
			&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
			&u.Role, &u.Department, &u.AccountState,
			&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
			&pinnedAt, &pinnedBy,
		); err == nil {
			m.Sender = &u
			pins = append(pins, map[string]any{
				"message":   m,
				"pinned_at": pinnedAt,
				"pinned_by": pinnedBy,
			})
		}
	}
	if err := rows.Err(); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed reading channel pins")
		return
	}
	if pins == nil {
		pins = []map[string]any{}
	}

	utils.JSON(w, http.StatusOK, map[string]any{"pins": pins})
}

// HandleListDMPins lists pinned messages for DM
func (h *ReactionPinReadHandler) HandleListDMPins(w http.ResponseWriter, r *http.Request) {
	dmGroupID := chi.URLParam(r, "id")
	query := `
		SELECT m.id, m.workspace_id, m.dm_group_id, m.sender_id, m.content, m.is_pinned, m.created_at,
		       u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
		       u.role, COALESCE(u.department, ''), COALESCE(u.account_state, 'active'),
		       u.must_change_password, u.status, COALESCE(u.custom_status, ''), u.created_at,
		       p.pinned_at, p.pinned_by
		FROM pins p
		JOIN messages m ON p.message_id = m.id
		JOIN users u ON m.sender_id = u.id
		WHERE p.dm_group_id = $1 AND m.deleted_at IS NULL
		ORDER BY p.pinned_at DESC;
	`
	rows, err := h.db.QueryContext(r.Context(), query, dmGroupID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve DM pins")
		return
	}
	defer rows.Close()

	var pins []map[string]any
	for rows.Next() {
		var m models.Message
		var u models.UserResponse
		var pinnedAt string
		var pinnedBy string
		if err := rows.Scan(
			&m.ID, &m.WorkspaceID, &m.DMGroupID, &m.SenderID, &m.Content, &m.IsPinned, &m.CreatedAt,
			&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
			&u.Role, &u.Department, &u.AccountState,
			&u.MustChangePassword, &u.Status, &u.CustomStatus, &u.CreatedAt,
			&pinnedAt, &pinnedBy,
		); err == nil {
			m.Sender = &u
			pins = append(pins, map[string]any{
				"message":   m,
				"pinned_at": pinnedAt,
				"pinned_by": pinnedBy,
			})
		}
	}
	if err := rows.Err(); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed reading DM pins")
		return
	}
	if pins == nil {
		pins = []map[string]any{}
	}

	utils.JSON(w, http.StatusOK, map[string]any{"pins": pins})
}

// HandleMarkChannelRead marks a channel as read
func (h *ReactionPinReadHandler) HandleMarkChannelRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	channelID := chi.URLParam(r, "id")
	query := `
		INSERT INTO read_states (user_id, channel_id, last_read_at, unread_count)
		VALUES ($1, $2, NOW(), 0)
		ON CONFLICT (user_id, channel_id) WHERE channel_id IS NOT NULL DO UPDATE SET last_read_at = NOW(), unread_count = 0;
	`
	_, _ = h.db.ExecContext(r.Context(), query, userID, channelID)

	if h.hub != nil {
		h.hub.SendToUser(userID, "read.updated", map[string]any{
			"channel_id":   channelID,
			"unread_count": 0,
		})
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Marked channel read"})
}

// HandleMarkDMRead marks a DM as read
func (h *ReactionPinReadHandler) HandleMarkDMRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	dmGroupID := chi.URLParam(r, "id")
	query := `
		INSERT INTO read_states (user_id, dm_group_id, last_read_at, unread_count)
		VALUES ($1, $2, NOW(), 0)
		ON CONFLICT (user_id, dm_group_id) WHERE dm_group_id IS NOT NULL DO UPDATE SET last_read_at = NOW(), unread_count = 0;
	`
	_, _ = h.db.ExecContext(r.Context(), query, userID, dmGroupID)

	if h.hub != nil {
		h.hub.SendToUser(userID, "read.updated", map[string]any{
			"dm_group_id":  dmGroupID,
			"unread_count": 0,
		})
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Marked DM read"})
}
