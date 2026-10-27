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

type TaskHandler struct {
	service *TaskService
	tm      *tokens.TokenManager
}

func NewTaskHandler(service *TaskService, tm *tokens.TokenManager) *TaskHandler {
	return &TaskHandler{service: service, tm: tm}
}

func (h *TaskHandler) RegisterRoutes(r chi.Router) {
	r.Group(func(tr chi.Router) {
		tr.Use(middleware.Authenticator(h.tm))

		tr.Post("/tasks", h.HandleCreateTask)
		tr.Get("/workspaces/{id}/tasks", h.HandleListTasks)
		tr.Patch("/tasks/{id}", h.HandleUpdateTask)
		tr.Post("/tasks/{id}/complete", h.HandleCompleteTask)
	})
}

func (h *TaskHandler) HandleCreateTask(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	var req models.CreateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	if req.WorkspaceID == "" {
		if wsID := r.Header.Get("X-Workspace-ID"); wsID != "" {
			req.WorkspaceID = wsID
		}
	}

	task, err := h.service.CreateTask(r.Context(), userID, req)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusCreated, task)
}

func (h *TaskHandler) HandleListTasks(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	workspaceID := chi.URLParam(r, "id")
	statusFilter := r.URL.Query().Get("status")
	assignedFilter := r.URL.Query().Get("assigned_to")

	tasks, err := h.service.ListWorkspaceTasks(r.Context(), workspaceID, statusFilter, assignedFilter)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve tasks")
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (h *TaskHandler) HandleUpdateTask(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	taskID := chi.URLParam(r, "id")
	var req models.UpdateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	task, err := h.service.UpdateTask(r.Context(), taskID, req)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Task not found")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, task)
}

func (h *TaskHandler) HandleCompleteTask(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	taskID := chi.URLParam(r, "id")
	task, err := h.service.CompleteTask(r.Context(), taskID)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Task not found")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, task)
}
