-- Migration 000002: Admin Console, RBAC, Security & Audit Logs Enhancement

-- 1. Enhance users table with administrative & password lifecycle fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_state VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_account_state ON users(account_state);
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until);

-- 2. Enhance workspace_settings with security and password policies
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS min_password_length INT NOT NULL DEFAULT 8;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS require_special_char BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS require_number BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS password_expiry_days INT NOT NULL DEFAULT 0;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS max_login_attempts INT NOT NULL DEFAULT 5;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS lockout_duration_mins INT NOT NULL DEFAULT 15;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS enforce_2fa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS session_timeout_mins INT NOT NULL DEFAULT 10080;

-- 3. Enhance audit_logs with before/after state diffs and user agent
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_state JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_state JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_type VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_id UUID;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(workspace_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
