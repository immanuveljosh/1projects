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

type PollHandler struct {
	service *PollService
	tm      *tokens.TokenManager
}

func NewPollHandler(service *PollService, tm *tokens.TokenManager) *PollHandler {
	return &PollHandler{service: service, tm: tm}
}

func (h *PollHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(pr chi.Router) {
		pr.Use(middleware.Authenticator(h.tm))

		pr.Post("/polls", h.HandleCreatePoll)
		pr.Get("/polls/{id}", h.HandleGetPoll)
		pr.Post("/polls/{id}/vote", h.HandleVotePoll)
		pr.Post("/polls/{id}/close", h.HandleClosePoll)
	})
}

func (h *PollHandler) HandleCreatePoll(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	var req models.CreatePollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	summary, err := h.service.CreatePoll(r.Context(), userID, req)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusCreated, summary)
}

func (h *PollHandler) HandleGetPoll(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	pollID := chi.URLParam(r, "id")
	summary, err := h.service.GetPoll(r.Context(), pollID, userID)
	if err != nil {
		if errors.Is(err, ErrPollNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Poll not found")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve poll")
		return
	}

	utils.JSON(w, http.StatusOK, summary)
}

func (h *PollHandler) HandleVotePoll(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	pollID := chi.URLParam(r, "id")
	var req models.VotePollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OptionID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Valid option_id is required")
		return
	}

	summary, err := h.service.VotePoll(r.Context(), pollID, req.OptionID, userID)
	if err != nil {
		if errors.Is(err, ErrPollClosed) {
			utils.Error(w, http.StatusConflict, "POLL_CLOSED", "This poll is closed")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, summary)
}

func (h *PollHandler) HandleClosePoll(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	pollID := chi.URLParam(r, "id")
	summary, err := h.service.ClosePoll(r.Context(), pollID, userID)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "ACTION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, summary)
}
