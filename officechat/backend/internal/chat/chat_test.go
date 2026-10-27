package chat_test

import (
	"context"
	"testing"
	"time"

	"officechat/backend/internal/chat"
	"officechat/backend/internal/config"
	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/ws"
)

func setupChatTestDB(t *testing.T) (*db.DB, func()) {
	t.Helper()
	cfg := config.Load()
	database, err := db.Connect(cfg)
	if err != nil {
		t.Skipf("Skipping integration test; PostgreSQL not accessible: %v", err)
		return nil, func() {}
	}
	_ = database.RunMigrations("../../migrations")
	return database, func() {
		database.Close()
	}
}

func TestPollsLifecycle(t *testing.T) {
	database, cleanup := setupChatTestDB(t)
	defer cleanup()

	ctx := context.Background()
	tm := tokens.NewTokenManager("test-jwt", "test-refresh", 15*time.Minute, 7*24*time.Hour)
	hub := ws.NewHub(tm)
	svc := chat.NewPollService(database, hub)

	// Create test user
	userID := "b0000000-0000-0000-0000-000000000001"
	_, _ = database.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, full_name, role)
		VALUES ($1, 'poll_user@officechat.local', 'hash', 'Poll Test User', 'user')
		ON CONFLICT (id) DO NOTHING;
	`, userID)

	// 1. Create Poll
	req := models.CreatePollRequest{
		Question: "Lunch preference today?",
		Options:  []string{"Pizza", "Tacos", "Salad"},
	}
	poll, err := svc.CreatePoll(ctx, userID, req)
	if err != nil {
		t.Fatalf("Failed to create poll: %v", err)
	}

	if poll.Question != "Lunch preference today?" || len(poll.Options) != 3 {
		t.Fatalf("Unexpected poll data: %+v", poll)
	}

	// 2. Cast Vote
	votedPoll, err := svc.VotePoll(ctx, poll.ID, poll.Options[0].ID, userID)
	if err != nil {
		t.Fatalf("Failed to vote in poll: %v", err)
	}
	if votedPoll.TotalVotes != 1 {
		t.Errorf("Expected total votes 1, got %d", votedPoll.TotalVotes)
	}
	if votedPoll.UserVotedID == nil || *votedPoll.UserVotedID != poll.Options[0].ID {
		t.Errorf("Expected UserVotedID to be %s", poll.Options[0].ID)
	}

	// 3. Close Poll
	closedPoll, err := svc.ClosePoll(ctx, poll.ID, userID)
	if err != nil {
		t.Fatalf("Failed to close poll: %v", err)
	}
	if !closedPoll.IsClosed {
		t.Errorf("Expected poll to be closed")
	}

	// 4. Voting after close should fail
	_, err = svc.VotePoll(ctx, poll.ID, poll.Options[1].ID, userID)
	if err == nil {
		t.Errorf("Expected error voting on closed poll")
	}

	// Cleanup
	_, _ = database.ExecContext(ctx, `DELETE FROM polls WHERE id = $1`, poll.ID)
	_, _ = database.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID)
}

func TestTasksLifecycle(t *testing.T) {
	database, cleanup := setupChatTestDB(t)
	defer cleanup()

	ctx := context.Background()
	tm := tokens.NewTokenManager("test-jwt", "test-refresh", 15*time.Minute, 7*24*time.Hour)
	hub := ws.NewHub(tm)
	svc := chat.NewTaskService(database, hub)

	// Create test user and workspace
	userID := "c0000000-0000-0000-0000-000000000001"
	wsID := "c0000000-0000-0000-0000-000000000002"
	_, _ = database.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, full_name, role)
		VALUES ($1, 'task_user@officechat.local', 'hash', 'Task Test User', 'user')
		ON CONFLICT (id) DO NOTHING;
	`, userID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, owner_id)
		VALUES ($1, 'Task Test WS', 'task-test-ws', $2)
		ON CONFLICT (id) DO NOTHING;
	`, wsID, userID)

	// 1. Create Task
	desc := "Prepare slides for Monday demo"
	task, err := svc.CreateTask(ctx, userID, models.CreateTaskRequest{
		WorkspaceID: wsID,
		Title:       "Demo Preparation",
		Description: desc,
		AssignedTo:  &userID,
	})
	if err != nil {
		t.Fatalf("Failed to create task: %v", err)
	}
	if task.Title != "Demo Preparation" || task.Status != "todo" {
		t.Fatalf("Unexpected task: %+v", task)
	}

	// 2. List Tasks
	tasks, err := svc.ListWorkspaceTasks(ctx, wsID, "todo", "")
	if err != nil {
		t.Fatalf("Failed to list tasks: %v", err)
	}
	if len(tasks) == 0 {
		t.Errorf("Expected at least 1 task")
	}

	// 3. Complete Task
	completed, err := svc.CompleteTask(ctx, task.ID)
	if err != nil {
		t.Fatalf("Failed to complete task: %v", err)
	}
	if completed.Status != "done" {
		t.Errorf("Expected task status 'done', got %s", completed.Status)
	}

	// Cleanup
	_, _ = database.ExecContext(ctx, `DELETE FROM tasks WHERE id = $1`, task.ID)
	_, _ = database.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, wsID)
	_, _ = database.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID)
}
