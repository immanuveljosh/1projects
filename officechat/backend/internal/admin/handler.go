package admin

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/rbac"
	"officechat/backend/internal/utils"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/members", func(r chi.Router) {
		r.Get("/", h.HandleListMembers)
		r.Post("/", h.HandleCreateMember)
		r.Post("/import", h.HandleImportMembers)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", h.HandleGetMember)
			r.Patch("/", h.HandleUpdateMember)
			r.Delete("/", h.HandleDeleteMember)
			r.Post("/reset-password", h.HandleResetPassword)
			r.Post("/force-logout", h.HandleForceLogout)
		})
	})

	h.registerChannelRoutes(r)
	h.registerSettingsAndAuditRoutes(r)
}

func getClientMeta(r *http.Request) (ip, ua string) {
	ip = r.RemoteAddr
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		ip = strings.Split(f, ",")[0]
	}
	ua = r.UserAgent()
	return strings.TrimSpace(ip), strings.TrimSpace(ua)
}

func (h *Handler) HandleListMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == "" {
		utils.Error(w, http.StatusBadRequest, "WORKSPACE_REQUIRED", "Active workspace ID is required")
		return
	}

	q := r.URL.Query()
	search := q.Get("search")
	role := q.Get("role")
	status := q.Get("status")
	accountState := q.Get("account_state")
	cursor := q.Get("cursor")
	limit, _ := strconv.Atoi(q.Get("limit"))

	resp, err := h.service.ListMembers(r.Context(), workspaceID, search, role, status, accountState, cursor, limit)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleGetMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	memberID := chi.URLParam(r, "id")

	member, err := h.service.GetMember(r.Context(), workspaceID, memberID)
	if err != nil {
		if errors.Is(err, ErrMemberNotFound) {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", "Member not found in this workspace")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, member)
}

func (h *Handler) HandleCreateMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorRole := middleware.GetWorkspaceRole(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	ip, ua := getClientMeta(r)

	var req CreateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	resp, err := h.service.CreateMember(r.Context(), actorID, actorRole, workspaceID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, rbac.ErrForbidden), errors.Is(err, rbac.ErrOnlyOwnerPromoteAdmin):
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
		case errors.Is(err, ErrEmailExistsInWS):
			utils.Error(w, http.StatusConflict, "MEMBER_EXISTS", err.Error())
		default:
			utils.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusCreated, resp)
}

func (h *Handler) HandleUpdateMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorRole := middleware.GetWorkspaceRole(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	memberID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req UpdateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	updated, err := h.service.UpdateMember(r.Context(), actorID, actorRole, workspaceID, memberID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrMemberNotFound):
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, rbac.ErrCannotEditOwner), errors.Is(err, rbac.ErrOnlyOwnerPromoteAdmin), errors.Is(err, rbac.ErrLastOwner):
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
		default:
			utils.Error(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusOK, updated)
}

func (h *Handler) HandleResetPassword(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorRole := middleware.GetWorkspaceRole(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	memberID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	resp, err := h.service.ResetPassword(r.Context(), actorID, actorRole, workspaceID, memberID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidAdminPassword):
			utils.Error(w, http.StatusUnauthorized, "INVALID_ADMIN_PASSWORD", "Invalid administrator password")
		case errors.Is(err, ErrMemberNotFound):
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, rbac.ErrCannotEditOwner):
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleForceLogout(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorRole := middleware.GetWorkspaceRole(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	memberID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req ForceLogoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	err := h.service.ForceLogout(r.Context(), actorID, actorRole, workspaceID, memberID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidAdminPassword):
			utils.Error(w, http.StatusUnauthorized, "INVALID_ADMIN_PASSWORD", "Invalid administrator password")
		case errors.Is(err, ErrMemberNotFound):
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, rbac.ErrCannotEditOwner):
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "User sessions successfully terminated",
	})
}

func (h *Handler) HandleDeleteMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorRole := middleware.GetWorkspaceRole(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	memberID := chi.URLParam(r, "id")
	ip, ua := getClientMeta(r)

	var req DeleteMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	err := h.service.DeleteMember(r.Context(), actorID, actorRole, workspaceID, memberID, req, ip, ua)
	if err != nil {
		switch {
		case errors.Is(err, ErrCannotDeleteSelf):
			utils.Error(w, http.StatusBadRequest, "CANNOT_DELETE_SELF", err.Error())
		case errors.Is(err, ErrInvalidAdminPassword):
			utils.Error(w, http.StatusUnauthorized, "INVALID_ADMIN_PASSWORD", "Invalid administrator password")
		case errors.Is(err, ErrConfirmationNeeded):
			utils.Error(w, http.StatusBadRequest, "CONFIRMATION_REQUIRED", err.Error())
		case errors.Is(err, ErrMemberNotFound):
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, rbac.ErrCannotEditOwner), errors.Is(err, rbac.ErrLastOwner):
			utils.Error(w, http.StatusForbidden, "FORBIDDEN", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "Member successfully removed",
	})
}

func (h *Handler) HandleImportMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	actorRole := middleware.GetWorkspaceRole(r.Context())
	actorID, _ := middleware.GetUserID(r.Context())
	ip, ua := getClientMeta(r)

	var csvData []byte

	// Check content type: multipart form or direct body
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(10 << 20); err != nil { // 10MB
			utils.Error(w, http.StatusBadRequest, "FILE_TOO_LARGE", "Failed to parse multipart form")
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			utils.Error(w, http.StatusBadRequest, "MISSING_FILE", "Uploaded CSV file 'file' is required")
			return
		}
		defer file.Close()
		var buf strings.Builder
		if _, err := io.Copy(&buf, file); err != nil {
			utils.Error(w, http.StatusBadRequest, "FILE_READ_ERROR", "Failed to read uploaded file")
			return
		}
		csvData = []byte(buf.String())
	} else {
		// Read body directly or decode JSON with csv_content
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			utils.Error(w, http.StatusBadRequest, "READ_ERROR", "Failed to read request body")
			return
		}

		var jsonPayload struct {
			CSVContent string `json:"csv_content"`
		}
		if json.Unmarshal(bodyBytes, &jsonPayload) == nil && jsonPayload.CSVContent != "" {
			csvData = []byte(jsonPayload.CSVContent)
		} else {
			csvData = bodyBytes
		}
	}

	if len(csvData) == 0 {
		utils.Error(w, http.StatusBadRequest, "EMPTY_DATA", "CSV data cannot be empty")
		return
	}

	report, err := h.service.ImportMembers(r.Context(), actorID, actorRole, workspaceID, csvData, ip, ua)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "IMPORT_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, report)
}
