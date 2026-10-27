package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"officechat/backend/internal/config"
	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
)

func main() {
	emailFlag := flag.String("email", "owner@officechat.local", "Owner email address")
	nameFlag := flag.String("name", "Initial Owner", "Owner full name")
	passFlag := flag.String("password", "Admin@Secure2026!", "Owner initial password")
	wsFlag := flag.String("workspace", "Acme Corporation", "Workspace company name")
	flag.Parse()

	email := strings.ToLower(strings.TrimSpace(*emailFlag))
	name := strings.TrimSpace(*nameFlag)
	password := *passFlag
	wsName := strings.TrimSpace(*wsFlag)

	cfg := config.Load()
	database, err := db.Connect(cfg)
	if err != nil {
		log.Fatalf("[SEED] Failed to connect to database: %v", err)
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Apply migrations
	if err := database.RunMigrations("migrations"); err != nil {
		log.Printf("[SEED] RunMigrations returned: %v", err)
	}

	passHash, err := tokens.HashPassword(password)
	if err != nil {
		log.Fatalf("[SEED] Failed to hash password: %v", err)
	}

	var userID string
	var wsID string

	// 1. Upsert initial user
	err = database.QueryRowContext(ctx, `
		INSERT INTO users (
			email, password_hash, full_name, display_name,
			role, department, account_state, must_change_password,
			status, created_at, updated_at
		) VALUES (
			$1, $2, $3, 'owner',
			'user', 'Leadership', 'active', FALSE,
			'online', NOW(), NOW()
		)
		ON CONFLICT (email) DO UPDATE SET 
			password_hash = EXCLUDED.password_hash,
			updated_at = NOW()
		RETURNING id
	`, email, passHash, name).Scan(&userID)
	if err != nil {
		log.Fatalf("[SEED] Failed to upsert owner user: %v", err)
	}

	// 2. Upsert initial workspace
	slug := "acme-corp"
	err = database.QueryRowContext(ctx, `
		INSERT INTO workspaces (name, slug, description, owner_id, created_at, updated_at)
		VALUES ($1, $2, 'Primary organization workspace', $3, NOW(), NOW())
		ON CONFLICT (slug) DO UPDATE SET 
			name = EXCLUDED.name,
			owner_id = EXCLUDED.owner_id,
			updated_at = NOW()
		RETURNING id
	`, wsName, slug, userID).Scan(&wsID)
	if err != nil {
		log.Fatalf("[SEED] Failed to upsert workspace: %v", err)
	}

	// 3. Upsert workspace member as Owner
	_, err = database.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
		VALUES ($1, $2, 'Owner', NOW(), NOW())
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET 
			role = 'Owner',
			updated_at = NOW()
	`, wsID, userID)
	if err != nil {
		log.Fatalf("[SEED] Failed to assign Owner role: %v", err)
	}

	// 4. Upsert default #general channel
	var generalChanID string
	err = database.QueryRowContext(ctx, `
		INSERT INTO channels (
			workspace_id, name, description, topic,
			is_private, is_archived, is_announcement, created_by,
			created_at, updated_at
		) VALUES (
			$1, 'general', 'Company-wide announcements and workplace chatter', 'Welcome to OfficeChat!',
			FALSE, FALSE, FALSE, $2,
			NOW(), NOW()
		)
		ON CONFLICT (workspace_id, name) DO UPDATE SET updated_at = NOW()
		RETURNING id
	`, wsID, userID).Scan(&generalChanID)
	if err == nil {
		_, _ = database.ExecContext(ctx, `
			INSERT INTO channel_members (channel_id, user_id, role, joined_at)
			VALUES ($1, $2, 'Admin', NOW())
			ON CONFLICT DO NOTHING
		`, generalChanID, userID)
	}

	// 5. Initialize workspace security settings
	_, _ = database.ExecContext(ctx, `
		INSERT INTO workspace_settings (
			workspace_id, min_password_length, require_special_char,
			require_number, password_expiry_days, max_login_attempts,
			lockout_duration_mins, enforce_2fa, session_timeout_mins,
			retention_days, allow_guest_invites, updated_at
		) VALUES (
			$1, 8, FALSE, FALSE, 0, 5, 15, FALSE, 10080, 0, FALSE, NOW()
		)
		ON CONFLICT (workspace_id) DO NOTHING
	`, wsID)

	fmt.Println("=========================================================")
	fmt.Println("🎉 INITIAL OWNER & WORKSPACE SUCCESSFULLY SEEDED")
	fmt.Println("=========================================================")
	fmt.Printf("Workspace Name : %s\n", wsName)
	fmt.Printf("Workspace ID   : %s\n", wsID)
	fmt.Printf("Owner Email    : %s\n", email)
	fmt.Printf("Owner Role     : %s\n", models.RoleOwner)
	fmt.Printf("Initial Pass   : %s\n", password)
	fmt.Println("=========================================================")
}
