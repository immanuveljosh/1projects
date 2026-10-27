-- Revert Migration 000002: Admin Console
ALTER TABLE audit_logs DROP COLUMN IF EXISTS target_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS target_type;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS user_agent;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS after_state;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS before_state;

ALTER TABLE workspace_settings DROP COLUMN IF EXISTS session_timeout_mins;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS enforce_2fa;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS lockout_duration_mins;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS max_login_attempts;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS password_expiry_days;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS require_number;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS require_special_char;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS min_password_length;

ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_count;
ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE users DROP COLUMN IF EXISTS department;
ALTER TABLE users DROP COLUMN IF EXISTS account_state;
