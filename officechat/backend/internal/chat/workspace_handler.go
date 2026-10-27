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

type WorkspaceHandler struct {
	service *WorkspaceService
	tm      *tokens.TokenManager
}

func NewWorkspaceHandler(service *WorkspaceService, tm *tokens.TokenManager) *WorkspaceHandler {
	return &WorkspaceHandler{service: service, tm: tm}
}

func (h *WorkspaceHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(wr chi.Router) {
		wr.Use(middleware.Authenticator(h.tm))

		wr.Get("/workspaces", h.HandleListWorkspaces)
		wr.Get("/workspaces/", h.HandleListWorkspaces)
		wr.Post("/workspaces", h.HandleCreateWorkspace)
		wr.Post("/workspaces/", h.HandleCreateWorkspace)
		wr.Get("/workspaces/{id}", h.HandleGetWorkspace)
		wr.Get("/workspaces/{id}/members", h.HandleListMembers)
		wr.Post("/workspaces/{id}/invites", h.HandleCreateInvite)
		wr.Post("/workspaces/join/{code}", h.HandleJoinWorkspace)
	})
}


func (h *WorkspaceHandler) HandleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	workspaces, err := h.service.ListUserWorkspaces(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list workspaces")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{"workspaces": workspaces})
}

func (h *WorkspaceHandler) HandleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	var req models.CreateWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	ws, err := h.service.CreateWorkspace(r.Context(), userID, req)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusCreated, ws)
}

func (h *WorkspaceHandler) HandleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "id")
	if wsID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Workspace ID is required")
		return
	}

	ws, err := h.service.GetWorkspace(r.Context(), wsID)
	if err != nil {
		if errors.Is(err, ErrWorkspaceNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Workspace not found")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve workspace")
		return
	}

	utils.JSON(w, http.StatusOK, ws)
}

func (h *WorkspaceHandler) HandleListMembers(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "id")
	if wsID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Workspace ID is required")
		return
	}

	members, err := h.service.ListWorkspaceMembers(r.Context(), wsID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve members")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{"members": members})
}

func (h *WorkspaceHandler) HandleCreateInvite(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	wsID := chi.URLParam(r, "id")
	var req models.CreateWorkspaceInviteRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	inv, err := h.service.CreateInvite(r.Context(), wsID, userID, req)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create invite")
		return
	}

	utils.JSON(w, http.StatusCreated, inv)
}

func (h *WorkspaceHandler) HandleJoinWorkspace(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	code := chi.URLParam(r, "code")
	if code == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invite code is required")
		return
	}

	ws, err := h.service.JoinWorkspaceWithInvite(r.Context(), userID, code)
	if err != nil {
		if errors.Is(err, ErrInviteNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Invite code is invalid or has expired")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, ws)
}
