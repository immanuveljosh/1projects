package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/utils"
)

func (h *Handler) registerChannelRoutes(r chi.Router) {
	r.Route("/channels", func(r chi.Router) {
		r.Get("/", h.HandleListChannels)
		r.Post("/", h.HandleCreateChannel)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", h.HandleGetChannel)
			r.Patch("/", h.HandleUpdateChannel)
			r.Delete("/", h.HandleDeleteChannel)

			r.Route("/members", func(r chi.Router) {
				r.Post("/", h.HandleAddChannelMembers)
				r.Delete("/", h.HandleRemoveChannelMember)
			})
		})
	})
}

func (h *Handler) HandleListChannels(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == "" {
		utils.Error(w, http.StatusBadRequest, "WORKSPACE_REQUIRED", "Active workspace ID is required")
		return
	}

	q := r.URL.Query()
	search := q.Get("search")
	channelType := q.Get("type")
	cursor := q.Get("cursor")
	limit, _ := strconv.Atoi(q.Get("limit"))

	var isArchived *bool
	if archStr := q.Get("is_archived"); archStr != "" {
		val := strings.EqualFold(archStr, "true") || archStr == "1"
		isArchived = &val
	}

	resp, err := h.service.ListChannels(r.Context(), workspaceID, search, channelType, isArchived, cursor, limit)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleGetChannel(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "id")

	channel, err := h.service.GetChannel(r.Context(), workspaceID, channelID)
	if err != nil {
		if errors.Is(err, ErrChannelNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Channel not found")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, channel)
}

func (h *Handler) HandleCreateChannel(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	ip, ua := getClientMeta(r)

	var req CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	created, err := h.service.CreateChannel(r.Context(), actorID, workspaceID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrChannelNameExists):
			utils.Error(w, http.StatusConflict, "CHANNEL_EXISTS", err.Error())
		case errors.Is(err, ErrInvalidChannelName):
			utils.Error(w, http.StatusBadRequest, "INVALID_NAME", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusCreated, created)
}

func (h *Handler) HandleUpdateChannel(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	channelID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req UpdateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	updated, err := h.service.UpdateChannel(r.Context(), actorID, workspaceID, channelID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrChannelNotFound):
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, ErrChannelNameExists):
			utils.Error(w, http.StatusConflict, "CHANNEL_EXISTS", err.Error())
		default:
			utils.Error(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusOK, updated)
}

func (h *Handler) HandleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	channelID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req DeleteChannelRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // optional body

	if !req.Permanent && r.URL.Query().Get("permanent") == "true" {
		req.Permanent = true
	}
	if req.ConfirmText == "" {
		req.ConfirmText = r.URL.Query().Get("confirm_text")
	}

	err := h.service.DeleteChannel(r.Context(), actorID, workspaceID, channelID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrCannotDeleteDefaultChannel):
			utils.Error(w, http.StatusForbidden, "DEFAULT_CHANNEL_PROTECTED", err.Error())
		case errors.Is(err, ErrChannelNotFound):
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		default:
			utils.Error(w, http.StatusBadRequest, "CONFIRMATION_REQUIRED", err.Error())
		}
		return
	}

	action := "archived"
	if req.Permanent {
		action = "permanently deleted"
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "Channel successfully " + action,
	})
}

func (h *Handler) HandleAddChannelMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	channelID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req AddChannelMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	if len(req.UserIDs) == 0 {
		utils.Error(w, http.StatusBadRequest, "EMPTY_USERS", "No users specified to add")
		return
	}

	err := h.service.AddChannelMembers(r.Context(), actorID, workspaceID, channelID, req, ip, ua)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "Channel members successfully added",
	})
}

func (h *Handler) HandleRemoveChannelMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	channelID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	targetUserID := r.URL.Query().Get("user_id")
	if targetUserID == "" {
		var req struct {
			UserID string `json:"user_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		targetUserID = req.UserID
	}

	if targetUserID == "" {
		utils.Error(w, http.StatusBadRequest, "USER_ID_REQUIRED", "user_id is required")
		return
	}

	err := h.service.RemoveChannelMember(r.Context(), actorID, workspaceID, channelID, targetUserID, ip, ua)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "REMOVE_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "Channel member removed",
	})
}
