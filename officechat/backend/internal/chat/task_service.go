package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"officechat/backend/internal/db"

	"officechat/backend/internal/models"
	"officechat/backend/internal/ws"
)

var (
	ErrTaskNotFound  = errors.New("task not found")
	ErrTaskForbidden = errors.New("access denied: insufficient permissions for this workspace task")
)

type TaskService struct {
	db  *db.DB
	hub *ws.Hub
}

func NewTaskService(database *db.DB, hub *ws.Hub) *TaskService {
	return &TaskService{db: database, hub: hub}
}

// AuthorizeWorkspaceAccess verifies that userID is the workspace owner or an active workspace member.
func (s *TaskService) AuthorizeWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	if workspaceID == "" || userID == "" {
		return ErrTaskForbidden
	}
	var allowed bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM workspaces w WHERE w.id = $1 AND w.owner_id = $2
		) OR EXISTS(
			SELECT 1
			FROM workspace_members wm
			JOIN users u ON wm.user_id = u.id
			WHERE wm.workspace_id = $1 AND wm.user_id = $2
			  AND COALESCE(u.account_state, 'active') = 'active'
			  AND u.deleted_at IS NULL
		)
	`, workspaceID, userID).Scan(&allowed)
	if err != nil || !allowed {
		return ErrTaskForbidden
	}
	return nil
}

// AuthorizeTaskMutation verifies that userID has permission to modify a task in its workspace.
func (s *TaskService) AuthorizeTaskMutation(ctx context.Context, taskID, userID string) error {
	task, err := s.GetTask(ctx, taskID)
	if err != nil {
		return err
	}
	return s.AuthorizeWorkspaceAccess(ctx, task.WorkspaceID, userID)
}

// CreateTask creates a task (optionally from a message)
func (s *TaskService) CreateTask(ctx context.Context, creatorID string, req models.CreateTaskRequest) (*models.Task, error) {
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		return nil, errors.New("task title is required")
	}
	if req.WorkspaceID == "" {
		return nil, errors.New("workspace_id is required")
	}
	if err := s.AuthorizeWorkspaceAccess(ctx, req.WorkspaceID, creatorID); err != nil {
		return nil, err
	}

	var task models.Task
	query := `
		INSERT INTO tasks (workspace_id, message_id, title, description, assigned_to, status, due_date, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7, NOW(), NOW())
		RETURNING id, workspace_id, message_id, title, description, assigned_to, status, due_date, created_by, created_at, updated_at;
	`
	err := s.db.QueryRowContext(ctx, query, req.WorkspaceID, req.MessageID, req.Title, req.Description, req.AssignedTo, req.DueDate, creatorID).Scan(
		&task.ID, &task.WorkspaceID, &task.MessageID, &task.Title, &task.Description,
		&task.AssignedTo, &task.Status, &task.DueDate, &task.CreatedBy, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed creating task: %w", err)
	}

	taskWithProfiles, err := s.GetTask(ctx, task.ID)
	if err != nil {
		return &task, nil
	}

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(task.WorkspaceID, "task.created", taskWithProfiles)
		if task.AssignedTo != nil && *task.AssignedTo != "" && *task.AssignedTo != creatorID {
			s.hub.SendToUser(*task.AssignedTo, "notification.new", map[string]any{
				"type":    "task_assigned",
				"title":   "New Task Assigned",
				"body":    task.Title,
				"task_id": task.ID,
			})
		}
	}

	return taskWithProfiles, nil
}

// GetTask returns a task by ID with assignee and creator profiles
func (s *TaskService) GetTask(ctx context.Context, taskID string) (*models.Task, error) {
	query := `
		SELECT t.id, t.workspace_id, t.message_id, t.title, COALESCE(t.description, ''),
		       t.assigned_to, t.status, t.due_date, t.created_by, t.created_at, t.updated_at
		FROM tasks t
		WHERE t.id = $1;
	`
	var task models.Task
	err := s.db.QueryRowContext(ctx, query, taskID).Scan(
		&task.ID, &task.WorkspaceID, &task.MessageID, &task.Title, &task.Description,
		&task.AssignedTo, &task.Status, &task.DueDate, &task.CreatedBy, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskNotFound
		}
		return nil, err
	}

	// Fetch creator profile
	var creator models.UserResponse
	_ = s.db.QueryRowContext(ctx, `
		SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''),
		       role, COALESCE(department, ''), COALESCE(account_state, 'active'),
		       must_change_password, status, COALESCE(custom_status, ''), created_at
		FROM users WHERE id = $1;
	`, task.CreatedBy).Scan(
		&creator.ID, &creator.Email, &creator.FullName, &creator.DisplayName, &creator.AvatarURL,
		&creator.Role, &creator.Department, &creator.AccountState,
		&creator.MustChangePassword, &creator.Status, &creator.CustomStatus, &creator.CreatedAt,
	)
	task.Creator = &creator

	// Fetch assignee profile if assigned
	if task.AssignedTo != nil && *task.AssignedTo != "" {
		var assignee models.UserResponse
		if err := s.db.QueryRowContext(ctx, `
			SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''),
			       role, COALESCE(department, ''), COALESCE(account_state, 'active'),
			       must_change_password, status, COALESCE(custom_status, ''), created_at
			FROM users WHERE id = $1;
		`, *task.AssignedTo).Scan(
			&assignee.ID, &assignee.Email, &assignee.FullName, &assignee.DisplayName, &assignee.AvatarURL,
			&assignee.Role, &assignee.Department, &assignee.AccountState,
			&assignee.MustChangePassword, &assignee.Status, &assignee.CustomStatus, &assignee.CreatedAt,
		); err == nil {
			task.Assignee = &assignee
		}
	}

	return &task, nil
}

// ListWorkspaceTasks lists tasks in a workspace with optional filters
func (s *TaskService) ListWorkspaceTasks(ctx context.Context, workspaceID, statusFilter, assignedFilter string) ([]models.Task, error) {
	whereClauses := []string{"t.workspace_id = $1"}
	args := []any{workspaceID}
	argIdx := 2

	if statusFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}
	if assignedFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.assigned_to = $%d", argIdx))
		args = append(args, assignedFilter)
		argIdx++
	}

	query := fmt.Sprintf(`
		SELECT t.id, t.workspace_id, t.message_id, t.title, COALESCE(t.description, ''),
		       t.assigned_to, t.status, t.due_date, t.created_by, t.created_at, t.updated_at,
		       cu.id, cu.email, cu.full_name, COALESCE(cu.display_name, ''), COALESCE(cu.avatar_url, ''),
		       cu.role, COALESCE(cu.department, ''), COALESCE(cu.account_state, 'active'),
		       cu.must_change_password, cu.status, COALESCE(cu.custom_status, ''), cu.created_at,
		       au.id, au.email, au.full_name, COALESCE(au.display_name, ''), COALESCE(au.avatar_url, '')
		FROM tasks t
		JOIN users cu ON t.created_by = cu.id
		LEFT JOIN users au ON t.assigned_to = au.id
		WHERE %s
		ORDER BY t.created_at DESC;
	`, strings.Join(whereClauses, " AND "))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed querying tasks: %w", err)
	}
	defer rows.Close()

	var tasks []models.Task
	for rows.Next() {
		var t models.Task
		var cu models.UserResponse
		var auID, auEmail, auFullName, auDisplayName, auAvatar sql.NullString

		if err := rows.Scan(
			&t.ID, &t.WorkspaceID, &t.MessageID, &t.Title, &t.Description,
			&t.AssignedTo, &t.Status, &t.DueDate, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt,
			&cu.ID, &cu.Email, &cu.FullName, &cu.DisplayName, &cu.AvatarURL,
			&cu.Role, &cu.Department, &cu.AccountState,
			&cu.MustChangePassword, &cu.Status, &cu.CustomStatus, &cu.CreatedAt,
			&auID, &auEmail, &auFullName, &auDisplayName, &auAvatar,
		); err != nil {
			return nil, fmt.Errorf("failed scanning task: %w", err)
		}
		t.Creator = &cu
		if auID.Valid {
			t.Assignee = &models.UserResponse{
				ID:          auID.String,
				Email:       auEmail.String,
				FullName:    auFullName.String,
				DisplayName: auDisplayName.String,
				AvatarURL:   auAvatar.String,
			}
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating tasks: %w", err)
	}

	if tasks == nil {
		tasks = []models.Task{}
	}
	return tasks, nil
}

// UpdateTask updates task fields and broadcasts update
func (s *TaskService) UpdateTask(ctx context.Context, taskID string, req models.UpdateTaskRequest) (*models.Task, error) {
	current, err := s.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}

	updates := []string{"updated_at = NOW()"}
	args := []any{taskID}
	argIdx := 2

	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		updates = append(updates, fmt.Sprintf("title = $%d", argIdx))
		args = append(args, strings.TrimSpace(*req.Title))
		argIdx++
	}
	if req.Description != nil {
		updates = append(updates, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *req.Description)
		argIdx++
	}
	if req.AssignedTo != nil {
		updates = append(updates, fmt.Sprintf("assigned_to = $%d", argIdx))
		args = append(args, *req.AssignedTo)
		argIdx++
	}
	if req.Status != nil && (*req.Status == "todo" || *req.Status == "in_progress" || *req.Status == "done") {
		updates = append(updates, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, *req.Status)
		argIdx++
	}
	if req.DueDate != nil {
		updates = append(updates, fmt.Sprintf("due_date = $%d", argIdx))
		args = append(args, *req.DueDate)
		argIdx++
	}

	query := fmt.Sprintf("UPDATE tasks SET %s WHERE id = $1", strings.Join(updates, ", "))
	if _, err := s.db.ExecContext(ctx, query, args...); err != nil {
		return nil, fmt.Errorf("failed updating task: %w", err)
	}

	updated, err := s.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}

	if s.hub != nil {
		s.hub.BroadcastToWorkspace(current.WorkspaceID, "task.updated", updated)
	}

	return updated, nil
}

// CompleteTask marks task as done
func (s *TaskService) CompleteTask(ctx context.Context, taskID string) (*models.Task, error) {
	doneStatus := "done"
	return s.UpdateTask(ctx, taskID, models.UpdateTaskRequest{Status: &doneStatus})
}
