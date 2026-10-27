package notifications

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

type DeviceTokenHandler struct {
	service *DeviceTokenService
	tm      *tokens.TokenManager
}

func NewDeviceTokenHandler(service *DeviceTokenService, tm *tokens.TokenManager) *DeviceTokenHandler {
	return &DeviceTokenHandler{
		service: service,
		tm:      tm,
	}
}

func (h *DeviceTokenHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(tr chi.Router) {
		tr.Use(middleware.Authenticator(h.tm))
		tr.Post("/notifications/device-token", h.HandleRegister)
		tr.Delete("/notifications/device-token", h.HandleDelete)
	})
}


// HandleRegister registers or updates a device token for push notifications
func (h *DeviceTokenHandler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	var req models.RegisterDeviceTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body")
		return
	}

	workspaceID := r.Header.Get("X-Workspace-ID")

	dt, err := h.service.UpsertDeviceToken(r.Context(), userID, workspaceID, req.Token, req.Platform)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidPlatform), errors.Is(err, ErrEmptyToken):
			utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to register device token")
		}
		return
	}

	utils.JSON(w, http.StatusOK, dt)
}

// HandleDelete deletes a device token for the authenticated user
func (h *DeviceTokenHandler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "Query parameter 'token' is required")
		return
	}

	if err := h.service.DeleteDeviceToken(r.Context(), userID, token); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to delete device token")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]string{
		"message": "Device token deleted successfully",
	})
}
