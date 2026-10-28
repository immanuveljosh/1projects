package chat

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
)

type ChannelHandler struct {
	service *ChannelService
	tm      *tokens.TokenManager
}

func NewChannelHandler(service *ChannelService, tm *tokens.TokenManager) *ChannelHandler {
	return &ChannelHandler{service: service, tm: tm}
}

func (h *ChannelHandler) RegisterRoutes(r chi.Router) {
	// Mounted under /api/v1
	r.Group(func(cr chi.Router) {
		cr.Use(middleware.Authenticator(h.tm))

		cr.Get("/workspaces/{id}/channels", h.HandleListChannels)
		cr.Post("/workspaces/{id}/channels", h.HandleCreateChannel)

		cr.Get("/channels/{id}", h.HandleGetChannel)
		cr.Post("/channels/{id}/join", h.HandleJoinChannel)
		cr.Post("/channels/{id}/leave", h.HandleLeaveChannel)
	})
}

func (h *ChannelHandler) HandleListChannels(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	wsID := chi.URLParam(r, "id")
	channels, err := h.service.ListWorkspaceChannels(r.Context(), wsID, userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve channels")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{"channels": channels})
}

func (h *ChannelHandler) HandleCreateChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	wsID := chi.URLParam(r, "id")
	var req models.CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	channel, err := h.service.CreateChannel(r.Context(), wsID, userID, req)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusCreated, channel)
}

func (h *ChannelHandler) HandleGetChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	channelID := chi.URLParam(r, "id")
	channel, err := h.service.GetChannel(r.Context(), channelID, userID)
	if err != nil {
		if errors.Is(err, ErrChannelNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Channel not found")
			return
		}
		if errors.Is(err, ErrChannelForbidden) {
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve channel")
		return
	}

	utils.JSON(w, http.StatusOK, channel)
}

func (h *ChannelHandler) HandleJoinChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	channelID := chi.URLParam(r, "id")
	if err := h.service.JoinChannel(r.Context(), channelID, userID); err != nil {
		if errors.Is(err, ErrChannelNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Channel not found")
			return
		}
		if errors.Is(err, ErrChannelForbidden) {
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to join channel")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Joined channel successfully"})
}

func (h *ChannelHandler) HandleLeaveChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	channelID := chi.URLParam(r, "id")
	if err := h.service.LeaveChannel(r.Context(), channelID, userID); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to leave channel")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Left channel successfully"})
}
