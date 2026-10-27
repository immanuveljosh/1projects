package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/utils"
)

func (h *Handler) registerSettingsAndAuditRoutes(r chi.Router) {
	r.Get("/settings", h.HandleGetSettings)
	r.Patch("/settings", h.HandleUpdateSettings)
	r.Post("/security/emergency-logout", h.HandleEmergencyLogout)
	r.Get("/audit-logs", h.HandleListAuditLogs)
}

func (h *Handler) HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == "" {
		utils.Error(w, http.StatusBadRequest, "WORKSPACE_REQUIRED", "Active workspace ID is required")
		return
	}

	st, err := h.service.GetSettings(r.Context(), workspaceID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, st)
}

func (h *Handler) HandleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	ip, ua := getClientMeta(r)

	var req UpdateSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	updated, err := h.service.UpdateSettings(r.Context(), actorID, workspaceID, req, ip, ua)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, updated)
}

func (h *Handler) HandleEmergencyLogout(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	ip, ua := getClientMeta(r)

	var req EmergencyLogoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	err := h.service.EmergencyLogout(r.Context(), actorID, workspaceID, req, ip, ua)
	if err != nil {
		if errors.Is(err, ErrInvalidAdminPassword) {
			utils.Error(w, http.StatusUnauthorized, "INVALID_ADMIN_PASSWORD", "Invalid administrator password")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "All workspace refresh tokens have been revoked. Emergency logout complete.",
	})
}

func (h *Handler) HandleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == "" {
		utils.Error(w, http.StatusBadRequest, "WORKSPACE_REQUIRED", "Active workspace ID is required")
		return
	}

	q := r.URL.Query()
	actorID := q.Get("actor_id")
	action := q.Get("action")
	target := q.Get("target")
	startDate := q.Get("start_date")
	endDate := q.Get("end_date")
	cursor := q.Get("cursor")
	limit, _ := strconv.Atoi(q.Get("limit"))
	format := q.Get("format")

	if format == "csv" {
		csvBytes, err := h.service.ExportAuditLogsCSV(r.Context(), workspaceID, actorID, action, target, startDate, endDate)
		if err != nil {
			utils.Error(w, http.StatusInternalServerError, "EXPORT_ERROR", err.Error())
			return
		}
		fileName := fmt.Sprintf("audit-logs-%s.csv", time.Now().Format("2006-01-02-150405"))
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(csvBytes)
		return
	}

	resp, err := h.service.ListAuditLogs(r.Context(), workspaceID, actorID, action, target, startDate, endDate, cursor, limit)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, resp)
}
