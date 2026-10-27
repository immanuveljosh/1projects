package chat

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
)

type MessageHandler struct {
	service *MessageService
	tm      *tokens.TokenManager
}

func NewMessageHandler(service *MessageService, tm *tokens.TokenManager) *MessageHandler {
	return &MessageHandler{service: service, tm: tm}
}

func (h *MessageHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(mr chi.Router) {
		mr.Use(middleware.Authenticator(h.tm))

		mr.Get("/channels/{id}/messages", h.HandleListChannelMessages)
		mr.Post("/channels/{id}/messages", h.HandleSendChannelMessage)

		mr.Patch("/messages/{id}", h.HandleUpdateMessage)
		mr.Delete("/messages/{id}", h.HandleDeleteMessage)
	})
}

func (h *MessageHandler) HandleListChannelMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	channelID := chi.URLParam(r, "id")
	cursor := r.URL.Query().Get("cursor")
	limit := 30
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	res, err := h.service.ListChannelMessages(r.Context(), channelID, userID, cursor, limit)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve messages")
		return
	}

	utils.JSON(w, http.StatusOK, res)
}

func (h *MessageHandler) HandleSendChannelMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	channelID := chi.URLParam(r, "id")
	var req models.SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	msg, err := h.service.SendChannelMessage(r.Context(), channelID, userID, req)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusCreated, msg)
}

func (h *MessageHandler) HandleUpdateMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	messageID := chi.URLParam(r, "id")
	var req models.UpdateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	msg, err := h.service.UpdateMessage(r.Context(), messageID, userID, req)
	if err != nil {
		if errors.Is(err, ErrMessageNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Message not found")
			return
		}
		if errors.Is(err, ErrCannotEditOthers) {
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to update message")
		return
	}

	utils.JSON(w, http.StatusOK, msg)
}

func (h *MessageHandler) HandleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	messageID := chi.URLParam(r, "id")
	if err := h.service.DeleteMessage(r.Context(), messageID, userID); err != nil {
		if errors.Is(err, ErrMessageNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Message not found")
			return
		}
		if errors.Is(err, ErrCannotEditOthers) {
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to delete message")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Message deleted"})
}
