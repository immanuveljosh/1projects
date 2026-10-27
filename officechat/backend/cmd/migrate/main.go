package main

import (
	"context"
	"log"
	"os"
	"time"

	"officechat/backend/internal/config"
	"officechat/backend/internal/db"
)

func main() {
	log.Println("[MIGRATION] Starting database migration runner...")

	cfg := config.Load()
	var database *db.DB
	var err error

	maxRetries := 15
	for i := 1; i <= maxRetries; i++ {
		database, err = db.Connect(cfg)
		if err == nil {
			break
		}
		log.Printf("[MIGRATION] Waiting for database (attempt %d/%d): %v", i, maxRetries, err)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatalf("[MIGRATION] Fatal: Unable to connect to database after %d retries: %v", maxRetries, err)
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := database.PingContext(ctx); err != nil {
		log.Fatalf("[MIGRATION] Fatal: Database ping failed: %v", err)
	}

	migrationPath := "migrations"
	if customPath := os.Getenv("MIGRATIONS_DIR"); customPath != "" {
		migrationPath = customPath
	}

	log.Printf("[MIGRATION] Executing migrations from: %s", migrationPath)
	if err := database.RunMigrations(migrationPath); err != nil {
		log.Fatalf("[MIGRATION] Migration execution failed: %v", err)
	}

	log.Println("[MIGRATION] All database schema migrations successfully applied.")
}
