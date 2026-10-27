package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"officechat/backend/internal/admin"
	"officechat/backend/internal/auth"
	"officechat/backend/internal/chat"
	"officechat/backend/internal/config"
	"officechat/backend/internal/db"
	"officechat/backend/internal/middleware"
	"officechat/backend/internal/models"
	"officechat/backend/internal/notifications"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/utils"
	"officechat/backend/internal/ws"
)


func main() {
	cfg := config.Load()
	log.Printf("[STARTUP] Starting %s (ENV=%s) on port %s", cfg.AppName, cfg.Env, cfg.Port)

	// Connect to Database with retry loop for containerized setups
	var database *db.DB
	var err error
	maxRetries := 10
	for i := 1; i <= maxRetries; i++ {
		database, err = db.Connect(cfg)
		if err == nil {
			break
		}
		log.Printf("[DB] Waiting for database (attempt %d/%d): %v", i, maxRetries, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("[DB] Fatal: Could not connect to database after %d attempts: %v", maxRetries, err)
	}
	defer database.Close()

	// Apply migrations if enabled
	if cfg.RunMigrations {
		migrationPath := "migrations"
		if err := database.RunMigrations(migrationPath); err != nil {
			log.Printf("[DB] Warning: RunMigrations returned: %v", err)
		}
	} else {
		log.Println("[STARTUP] Automatic migrations disabled on API startup (managed via migration service)")
	}

	// Token Manager
	tm := tokens.NewTokenManager(
		cfg.JWTAccessSecret,
		cfg.JWTRefreshSecret,
		cfg.JWTAccessExpiry,
		cfg.JWTRefreshExpiry,
	)

	// Router setup
	r := chi.NewRouter()

	// Global Middlewares
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(60 * time.Second))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Workspace-ID"},
		ExposedHeaders:   []string{"Link", "Content-Length"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Rate Limiting (100 requests per minute per IP)
	rateLimiter := middleware.NewRateLimiter(100, time.Minute)
	r.Use(rateLimiter.Middleware())

	// Health Check Endpoints
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		utils.JSON(w, http.StatusOK, map[string]any{
			"status":    "healthy",
			"app":       cfg.AppName,
			"env":       cfg.Env,
			"timestamp": time.Now().UTC(),
		})
	})

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		utils.JSON(w, http.StatusOK, map[string]any{
			"status": "ok",
		})
	})

	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		dbErr := database.PingContext(ctx)
		var redisErr error
		if cfg.RedisHost != "" {
			conn, err := net.DialTimeout("tcp", net.JoinHostPort(cfg.RedisHost, cfg.RedisPort), 2*time.Second)
			if err != nil {
				redisErr = err
			} else {
				_ = conn.Close()
			}
		}

		if dbErr != nil || redisErr != nil {
			status := map[string]any{
				"status": "degraded",
			}
			if dbErr != nil {
				status["database"] = dbErr.Error()
			}
			if redisErr != nil {
				status["redis"] = redisErr.Error()
			}
			utils.JSON(w, http.StatusServiceUnavailable, status)
			return
		}

		utils.JSON(w, http.StatusOK, map[string]any{
			"status":   "ready",
			"database": "connected",
			"redis":    "connected",
		})
	})

	// Realtime WebSocket Event Hub
	hub := ws.NewHub(tm)
	go hub.Run()
	r.Get("/api/v1/ws", hub.ServeHTTP)
	r.Get("/ws", hub.ServeHTTP)

	// Authorizer for RBAC middleware
	authorizer := middleware.NewSQLMemberAuthorizer(database.DB)

	// Services & Handlers
	authService := auth.NewService(database, tm)
	authHandler := auth.NewHandler(authService, tm)
	authHandler.RegisterRoutes(r)

	// Operational Services & Handlers
	deviceTokenService := notifications.NewDeviceTokenService(database)
	deviceTokenHandler := notifications.NewDeviceTokenHandler(deviceTokenService, tm)

	notificationService := notifications.NewNotificationService(database)
	notificationHandler := notifications.NewNotificationHandler(notificationService, tm)

	workspaceService := chat.NewWorkspaceService(database)
	workspaceHandler := chat.NewWorkspaceHandler(workspaceService, tm)

	channelService := chat.NewChannelService(database, hub)
	channelHandler := chat.NewChannelHandler(channelService, tm)

	messageService := chat.NewMessageService(database, hub)
	messageHandler := chat.NewMessageHandler(messageService, tm)

	dmService := chat.NewDMService(database, hub)
	dmHandler := chat.NewDMHandler(dmService, tm)

	reactionPinReadHandler := chat.NewReactionPinReadHandler(database, hub, tm)
	fileSearchPresenceHandler := chat.NewFileSearchPresenceHandler(database, tm)

	pollService := chat.NewPollService(database, hub)
	pollHandler := chat.NewPollHandler(pollService, tm)

	taskService := chat.NewTaskService(database, hub)
	taskHandler := chat.NewTaskHandler(taskService, tm)

	// API v1 Routes
	r.Route("/api/v1", func(apiRouter chi.Router) {
		deviceTokenHandler.RegisterRoutes(apiRouter)
		notificationHandler.RegisterRoutes(apiRouter)
		workspaceHandler.RegisterRoutes(apiRouter)
		channelHandler.RegisterRoutes(apiRouter)
		messageHandler.RegisterRoutes(apiRouter)
		dmHandler.RegisterRoutes(apiRouter)
		reactionPinReadHandler.RegisterRoutes(apiRouter)
		fileSearchPresenceHandler.RegisterRoutes(apiRouter)
		pollHandler.RegisterRoutes(apiRouter)
		taskHandler.RegisterRoutes(apiRouter)
	})

	// Admin Console Routes (Restricted strictly to Owner and Admin)
	adminService := admin.NewService(database, tm, hub)
	adminHandler := admin.NewHandler(adminService)

	r.Route("/api/v1/admin", func(adminRouter chi.Router) {
		adminRouter.Use(middleware.Authenticator(tm))
		adminRouter.Use(middleware.RequireRole(authorizer, models.RoleOwner, models.RoleAdmin))
		adminHandler.RegisterRoutes(adminRouter)
	})



	// Server execution with graceful shutdown
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("[HTTP] Server listening on :%s", cfg.Port)
		serverErrors <- server.ListenAndServe()
	}()

	// Graceful shutdown listener
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		log.Fatalf("[HTTP] Fatal server error: %v", err)
	case sig := <-shutdown:
		log.Printf("[HTTP] Signal received (%v), initiating graceful shutdown...", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[HTTP] Forced server shutdown: %v", err)
			_ = server.Close()
		}
	}

	log.Println("[SHUTDOWN] OfficeChat API server cleanly terminated")
}
