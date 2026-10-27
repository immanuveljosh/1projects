package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"officechat/backend/internal/config"
)

type DB struct {
	*sql.DB
}

func Connect(cfg *config.Config) (*DB, error) {
	connStr := cfg.DatabaseURL
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Printf("[DB] Connected to PostgreSQL at %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)
	return &DB{db}, nil
}

// RunMigrations applies all *.up.sql migration scripts in order, tracking applied versions
func (d *DB) RunMigrations(migrationsDir string) error {
	// Create schema_migrations tracker table if it doesn't exist
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version VARCHAR(100) PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);`)
	if err != nil {
		return fmt.Errorf("failed to initialize schema_migrations table: %w", err)
	}

	// Resolve directory path with relative fallback
	dir := migrationsDir
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		fallback := filepath.Join("..", migrationsDir)
		if _, err := os.Stat(fallback); err == nil {
			dir = fallback
		}
	}

	// Also support single file path if passed
	var files []string
	if strings.HasSuffix(dir, ".sql") {
		files = []string{dir}
	} else {
		matches, err := filepath.Glob(filepath.Join(dir, "*.up.sql"))
		if err != nil {
			return fmt.Errorf("failed to list migration files: %w", err)
		}
		sort.Strings(matches)
		files = matches
	}

	for _, file := range files {
		base := filepath.Base(file)
		var alreadyApplied bool
		_ = d.QueryRow(`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, base).Scan(&alreadyApplied)
		if alreadyApplied {
			continue
		}

		log.Printf("[DB] Applying migration: %s", base)
		content, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", file, err)
		}

		if err := d.WithTransaction(context.Background(), func(tx *sql.Tx) error {
			if _, err := tx.Exec(string(content)); err != nil {
				return err
			}
			_, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, base)
			return err
		}); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", base, err)
		}
	}

	log.Printf("[DB] Database migrations are up to date")
	return nil
}

// WithTransaction runs a function within a transaction, handling rollback on error
func (d *DB) WithTransaction(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}

	return tx.Commit()
}
