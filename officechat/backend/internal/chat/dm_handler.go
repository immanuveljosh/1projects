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

type DMHandler struct {
	service *DMService
	tm      *tokens.TokenManager
}

func NewDMHandler(service *DMService, tm *tokens.TokenManager) *DMHandler {
	return &DMHandler{service: service, tm: tm}
}

func (h *DMHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(dr chi.Router) {
		dr.Use(middleware.Authenticator(h.tm))

		dr.Get("/workspaces/{id}/dms", h.HandleListDMs)
		dr.Post("/workspaces/{id}/dms", h.HandleCreateDM)

		dr.Get("/dms/{id}/messages", h.HandleListDMMessages)
		dr.Post("/dms/{id}/messages", h.HandleSendDMMessage)
	})
}

func (h *DMHandler) HandleListDMs(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	wsID := chi.URLParam(r, "id")
	dms, err := h.service.ListUserDMs(r.Context(), wsID, userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve DMs")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{"dms": dms})
}

func (h *DMHandler) HandleCreateDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	wsID := chi.URLParam(r, "id")
	var req models.CreateDMRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	dm, err := h.service.GetOrCreateDM(r.Context(), wsID, userID, req)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, dm)
}

func (h *DMHandler) HandleListDMMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	dmID := chi.URLParam(r, "id")
	cursor := r.URL.Query().Get("cursor")
	limit := 30
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	res, err := h.service.ListDMMessages(r.Context(), dmID, userID, cursor, limit)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve DM messages")
		return
	}

	utils.JSON(w, http.StatusOK, res)
}

func (h *DMHandler) HandleSendDMMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	dmID := chi.URLParam(r, "id")
	var req models.SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	msg, err := h.service.SendDMMessage(r.Context(), dmID, userID, req)
	if err != nil {
		if errors.Is(err, ErrDMNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "DM group not found")
			return
		}
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusCreated, msg)
}
