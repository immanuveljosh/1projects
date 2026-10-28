package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
)

type DBExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type LogEntry struct {
	WorkspaceID string
	ActorID     string
	Action      string
	TargetType  string
	TargetID    string
	BeforeState any
	AfterState  any
	Details     any
	IPAddress   string
	UserAgent   string
}

// Record inserts a structured immutable audit log record
func Record(ctx context.Context, db DBExecutor, entry LogEntry) error {
	var beforeJSON, afterJSON, detailsJSON []byte
	var err error

	if entry.BeforeState != nil {
		beforeJSON, err = json.Marshal(entry.BeforeState)
		if err != nil {
			log.Printf("[AUDIT] Failed to marshal before_state: %v", err)
		}
	}
	if entry.AfterState != nil {
		afterJSON, err = json.Marshal(entry.AfterState)
		if err != nil {
			log.Printf("[AUDIT] Failed to marshal after_state: %v", err)
		}
	}
	if entry.Details != nil {
		detailsJSON, err = json.Marshal(entry.Details)
		if err != nil {
			log.Printf("[AUDIT] Failed to marshal details: %v", err)
		}
	} else {
		detailsJSON = []byte("{}")
	}

	query := `
		INSERT INTO audit_logs (
			workspace_id, actor_id, action, entity_type, entity_id,
			target_type, target_id, before_state, after_state, details,
			ip_address, user_agent, created_at
		) VALUES (
			$1, NULLIF($2, '')::uuid, $3, $4,
			CASE WHEN $5 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN $5::uuid ELSE NULL END,
			$4,
			CASE WHEN $5 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN $5::uuid ELSE NULL END,
			CASE WHEN $6::text IS NULL THEN NULL ELSE $6::jsonb END,
			CASE WHEN $7::text IS NULL THEN NULL ELSE $7::jsonb END,
			$8::jsonb,
			$9, $10, NOW()
		)
	`

	var beforeArg, afterArg any
	if len(beforeJSON) > 0 {
		beforeArg = string(beforeJSON)
	}
	if len(afterJSON) > 0 {
		afterArg = string(afterJSON)
	}

	_, err = db.ExecContext(ctx, query,
		entry.WorkspaceID,
		entry.ActorID,
		entry.Action,
		entry.TargetType,
		entry.TargetID,
		beforeArg,
		afterArg,
		string(detailsJSON),
		entry.IPAddress,
		entry.UserAgent,
	)
	if err != nil {
		log.Printf("[AUDIT] Error writing audit log: %v", err)
		return fmt.Errorf("failed to write audit log: %w", err)
	}
	return nil
}
