package notifications

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
)

type NotificationHandler struct {
	service *NotificationService
	tm      *tokens.TokenManager
}

func NewNotificationHandler(service *NotificationService, tm *tokens.TokenManager) *NotificationHandler {
	return &NotificationHandler{
		service: service,
		tm:      tm,
	}
}

func (h *NotificationHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(nr chi.Router) {
		nr.Use(middleware.Authenticator(h.tm))
		nr.Get("/notifications", h.HandleList)
		nr.Patch("/notifications/{id}/read", h.HandleMarkRead)
		nr.Post("/notifications/read-all", h.HandleMarkAllRead)
	})
}


func (h *NotificationHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	workspaceID := r.Header.Get("X-Workspace-ID")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	notifs, err := h.service.ListNotifications(r.Context(), userID, workspaceID, limit)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve notifications")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"notifications": notifs,
	})
}

func (h *NotificationHandler) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	notificationID := chi.URLParam(r, "id")
	if notificationID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Notification ID is required")
		return
	}

	if err := h.service.MarkAsRead(r.Context(), userID, notificationID); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to mark notification as read")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]string{
		"message": "Notification marked as read",
	})
}

func (h *NotificationHandler) HandleMarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	workspaceID := r.Header.Get("X-Workspace-ID")
	if err := h.service.MarkAllAsRead(r.Context(), userID, workspaceID); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to mark all notifications as read")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]string{
		"message": "All notifications marked as read",
	})
}
