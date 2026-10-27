package chat

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/db"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
)

type FileSearchPresenceHandler struct {
	db        *db.DB
	tm        *tokens.TokenManager
	uploadDir string
}

func NewFileSearchPresenceHandler(database *db.DB, tm *tokens.TokenManager) *FileSearchPresenceHandler {
	uploadDir := "./uploads"
	_ = os.MkdirAll(uploadDir, 0755)
	return &FileSearchPresenceHandler{
		db:        database,
		tm:        tm,
		uploadDir: uploadDir,
	}
}

func (h *FileSearchPresenceHandler) RegisterRoutes(r chi.Router) {
	// Serve public uploaded files
	r.Get("/files/{key}", h.HandleGetFile)

	r.Group(func(cr chi.Router) {
		cr.Use(middleware.Authenticator(h.tm))

		cr.Post("/workspaces/{id}/files/upload", h.HandleUploadFile)
		cr.Get("/workspaces/{id}/search", h.HandleSearch)
		cr.Get("/workspaces/{id}/presence", h.HandleGetPresence)
	})
}

// HandleUploadFile uploads a file up to 25MB
func (h *FileSearchPresenceHandler) HandleUploadFile(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok || userID == "" {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	workspaceID := chi.URLParam(r, "id")
	// 25 MB max memory
	if err := r.ParseMultipartForm(25 << 20); err != nil {
		utils.Error(w, http.StatusBadRequest, "FILE_TOO_LARGE", "Maximum file size is 25 MB")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "File field is required in form-data")
		return
	}
	defer file.Close()

	fileKey := fmt.Sprintf("%d_%s", time.Now().UnixNano(), filepath.Base(header.Filename))
	savePath := filepath.Join(h.uploadDir, fileKey)

	dst, err := os.Create(savePath)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to save file")
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to write file")
		return
	}

	fileURL := fmt.Sprintf("/api/v1/files/%s", fileKey)
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	var att models.Attachment
	query := `
		INSERT INTO attachments (workspace_id, file_name, file_size, content_type, file_key, file_url, virus_scan_status, uploaded_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'clean', $7, NOW())
		RETURNING id, workspace_id, file_name, file_size, content_type, file_key, file_url, virus_scan_status, uploaded_by, created_at;
	`
	err = h.db.QueryRowContext(r.Context(), query, workspaceID, header.Filename, written, contentType, fileKey, fileURL, userID).Scan(
		&att.ID, &att.WorkspaceID, &att.FileName, &att.FileSize, &att.ContentType, &att.FileKey, &att.FileURL, &att.VirusScanStatus, &att.UploadedBy, &att.CreatedAt,
	)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to record attachment metadata")
		return
	}

	utils.JSON(w, http.StatusCreated, map[string]any{"attachment": att})
}

// HandleGetFile serves an uploaded file by its key
func (h *FileSearchPresenceHandler) HandleGetFile(w http.ResponseWriter, r *http.Request) {
	key := filepath.Clean(chi.URLParam(r, "key"))
	if strings.Contains(key, "..") {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	filePath := filepath.Join(h.uploadDir, key)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	http.ServeFile(w, r, filePath)
}

// HandleSearch performs full-text search across messages and files in a workspace
func (h *FileSearchPresenceHandler) HandleSearch(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	queryStr := strings.TrimSpace(r.URL.Query().Get("q"))
	if queryStr == "" {
		utils.JSON(w, http.StatusOK, map[string]any{"messages": []models.Message{}, "attachments": []models.Attachment{}})
		return
	}

	// Search messages
	msgQuery := `
		SELECT m.id, m.workspace_id, m.channel_id, m.dm_group_id, m.sender_id, m.content, m.created_at,
		       u.id, u.email, u.full_name, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, '')
		FROM messages m
		JOIN users u ON m.sender_id = u.id
		WHERE m.workspace_id = $1 AND m.deleted_at IS NULL
		  AND m.search_vector @@ plainto_tsquery('english', $2)
		ORDER BY m.created_at DESC
		LIMIT 20;
	`
	rows, err := h.db.QueryContext(r.Context(), msgQuery, workspaceID, queryStr)
	var messages []models.Message
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var m models.Message
			var u models.UserResponse
			if err := rows.Scan(
				&m.ID, &m.WorkspaceID, &m.ChannelID, &m.DMGroupID, &m.SenderID, &m.Content, &m.CreatedAt,
				&u.ID, &u.Email, &u.FullName, &u.DisplayName, &u.AvatarURL,
			); err == nil {
				m.Sender = &u
				messages = append(messages, m)
			}
		}
	}
	if messages == nil {
		messages = []models.Message{}
	}

	// Search attachments
	attQuery := `
		SELECT id, workspace_id, file_name, file_size, content_type, file_key, file_url, virus_scan_status, uploaded_by, created_at
		FROM attachments
		WHERE workspace_id = $1 AND file_name ILIKE '%' || $2 || '%'
		ORDER BY created_at DESC
		LIMIT 20;
	`
	attRows, err := h.db.QueryContext(r.Context(), attQuery, workspaceID, queryStr)
	var attachments []models.Attachment
	if err == nil {
		defer attRows.Close()
		for attRows.Next() {
			var a models.Attachment
			if err := attRows.Scan(
				&a.ID, &a.WorkspaceID, &a.FileName, &a.FileSize, &a.ContentType, &a.FileKey, &a.FileURL, &a.VirusScanStatus, &a.UploadedBy, &a.CreatedAt,
			); err == nil {
				attachments = append(attachments, a)
			}
		}
	}
	if attachments == nil {
		attachments = []models.Attachment{}
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"messages":    messages,
		"attachments": attachments,
	})
}

// HandleGetPresence returns live presence status for workspace members
func (h *FileSearchPresenceHandler) HandleGetPresence(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	query := `
		SELECT u.id, u.status, COALESCE(u.custom_status, ''), u.status_updated_at
		FROM users u
		JOIN workspace_members wm ON u.id = wm.user_id
		WHERE wm.workspace_id = $1 AND u.deleted_at IS NULL;
	`
	rows, err := h.db.QueryContext(r.Context(), query, workspaceID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve presence")
		return
	}
	defer rows.Close()

	type MemberPresence struct {
		UserID          string     `json:"user_id"`
		Status          string     `json:"status"`
		CustomStatus    string     `json:"custom_status"`
		StatusUpdatedAt *time.Time `json:"status_updated_at,omitempty"`
	}

	var presences []MemberPresence
	for rows.Next() {
		var p MemberPresence
		if err := rows.Scan(&p.UserID, &p.Status, &p.CustomStatus, &p.StatusUpdatedAt); err == nil {
			presences = append(presences, p)
		}
	}
	if presences == nil {
		presences = []MemberPresence{}
	}

	utils.JSON(w, http.StatusOK, map[string]any{"presence": presences})
}
