package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
)

type Handler struct {
	service *Service
	tm      *tokens.TokenManager
}

func NewHandler(service *Service, tm *tokens.TokenManager) *Handler {
	return &Handler{
		service: service,
		tm:      tm,
	}
}

func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/api/v1/auth", func(r chi.Router) {
		r.Post("/register", h.HandleRegister)
		r.Post("/login", h.HandleLogin)
		r.Post("/refresh", h.HandleRefreshToken)
		r.Post("/logout", h.HandleLogout)

		// Authenticated endpoints
		r.Group(func(r chi.Router) {
			r.Use(middleware.Authenticator(h.tm))
			r.Get("/me", h.HandleGetMe)
			r.Patch("/me", h.HandleUpdateProfile)
			r.Post("/change-password", h.HandleChangePassword)
		})
	})
}

// HandleRegister registers a new user account
func (h *Handler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	ip := r.RemoteAddr
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		ip = strings.Split(f, ",")[0]
	}
	ua := r.UserAgent()

	resp, err := h.service.Register(r.Context(), req, ua, ip)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidEmail), errors.Is(err, ErrWeakPassword):
			utils.Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error())
		case errors.Is(err, ErrEmailAlreadyExists):
			utils.Error(w, http.StatusConflict, "EMAIL_EXISTS", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		}
		return
	}

	utils.JSON(w, http.StatusCreated, resp)
}

// HandleLogin authenticates user credentials
func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	ip := r.RemoteAddr
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		ip = strings.Split(f, ",")[0]
	}
	ua := r.UserAgent()

	resp, err := h.service.Login(r.Context(), req, ua, ip)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			utils.Error(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid email or password")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Login failed")
		return
	}

	utils.JSON(w, http.StatusOK, resp)
}

// HandleRefreshToken issues new access & refresh tokens
func (h *Handler) HandleRefreshToken(w http.ResponseWriter, r *http.Request) {
	var req models.RefreshTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	ip := r.RemoteAddr
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		ip = strings.Split(f, ",")[0]
	}
	ua := r.UserAgent()

	resp, err := h.service.RefreshToken(r.Context(), req.RefreshToken, ua, ip)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "Session expired or invalid. Please log in again.")
		return
	}

	utils.JSON(w, http.StatusOK, resp)
}

// HandleLogout revokes the provided refresh token and purges device tokens
func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	var req models.RefreshTokenRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if req.RefreshToken != "" {
		_ = h.service.Logout(r.Context(), req.RefreshToken)
	}

	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		if claims, err := h.tm.ValidateAccessToken(tokenStr); err == nil && claims.UserID != "" {
			_ = h.service.PurgeDeviceTokens(r.Context(), claims.UserID)
		}
	}

	utils.JSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}


// HandleGetMe returns the authenticated user's profile
func (h *Handler) HandleGetMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	user, err := h.service.GetUserByID(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusNotFound, "USER_NOT_FOUND", "User profile not found")
		return
	}

	utils.JSON(w, http.StatusOK, user)
}

// HandleUpdateProfile updates current user display name, avatar, or status
func (h *Handler) HandleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	var req models.UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	user, err := h.service.UpdateProfile(r.Context(), userID, req)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "UPDATE_FAILED", "Failed to update profile")
		return
	}

	utils.JSON(w, http.StatusOK, user)
}

// HandleChangePassword allows an authenticated user to change their own password
func (h *Handler) HandleChangePassword(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		utils.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON payload")
		return
	}

	ip := r.RemoteAddr
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		ip = strings.Split(f, ",")[0]
	}
	ua := r.UserAgent()

	err := h.service.ChangePassword(r.Context(), userID, req.CurrentPassword, req.NewPassword, ip, ua)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "PASSWORD_CHANGE_FAILED", err.Error())
		return
	}

	utils.JSON(w, http.StatusOK, map[string]any{
		"message": "Password changed successfully. Other sessions have been revoked.",
	})
}

