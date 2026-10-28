package chat_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"officechat/backend/internal/chat"
	"officechat/backend/internal/config"
	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/ws"
)

func TestMessageAndTaskHandlers_RejectUnauthenticated(t *testing.T) {
	tm := tokens.NewTokenManager("test-access-secret-32-bytes-long!!", "test-refresh-secret-32-bytes-long!", 15*time.Minute, 24*time.Hour)
	r := chi.NewRouter()
	msgHandler := chat.NewMessageHandler(nil, tm)
	taskHandler := chat.NewTaskHandler(nil, tm)
	r.Route("/api/v1", func(api chi.Router) {
		msgHandler.RegisterRoutes(api)
		taskHandler.RegisterRoutes(api)
	})

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v1/messages/11111111-1111-1111-1111-111111111111/thread", ""},
		{http.MethodPost, "/api/v1/tasks", `{"workspace_id":"11111111-1111-1111-1111-111111111111","title":"Test"}`},
		{http.MethodGet, "/api/v1/workspaces/11111111-1111-1111-1111-111111111111/tasks", ""},
		{http.MethodPatch, "/api/v1/tasks/11111111-1111-1111-1111-111111111111", `{"status":"in_progress"}`},
		{http.MethodPost, "/api/v1/tasks/11111111-1111-1111-1111-111111111111/complete", ""},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: expected 401 Unauthorized, got %d", tc.method, tc.path, rr.Code)
		}
	}
}

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

	// Create test user, outsider user, and workspace
	userID := "c0000000-0000-0000-0000-000000000001"
	outsiderID := "c0000000-0000-0000-0000-000000000009"
	wsID := "c0000000-0000-0000-0000-000000000002"
	_, _ = database.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, full_name, role)
		VALUES
			($1, 'task_user@officechat.local', 'hash', 'Task Test User', 'user'),
			($2, 'task_outsider@officechat.local', 'hash', 'Task Outsider User', 'user')
		ON CONFLICT (id) DO NOTHING;
	`, userID, outsiderID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, owner_id)
		VALUES ($1, 'Task Test WS', 'task-test-ws', $2)
		ON CONFLICT (id) DO NOTHING;
	`, wsID, userID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'Member')
		ON CONFLICT (workspace_id, user_id) DO NOTHING;
	`, wsID, userID)

	// 0. Unauthorized user (not a workspace member) must be rejected with ErrTaskForbidden
	_, err := svc.CreateTask(ctx, outsiderID, models.CreateTaskRequest{
		WorkspaceID: wsID,
		Title:       "Unauthorized Task",
	})
	if !errors.Is(err, chat.ErrTaskForbidden) {
		t.Fatalf("Expected ErrTaskForbidden for non-workspace member creating task, got: %v", err)
	}

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

	// Unauthorized user must not be able to mutate the task
	if err := svc.AuthorizeTaskMutation(ctx, task.ID, outsiderID); !errors.Is(err, chat.ErrTaskForbidden) {
		t.Fatalf("Expected ErrTaskForbidden for outsider mutating task, got: %v", err)
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
	_, _ = database.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, wsID)
	_, _ = database.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, wsID)
	_, _ = database.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, userID, outsiderID)
}

func TestThreadRetrievalAndPermissions(t *testing.T) {
	database, cleanup := setupChatTestDB(t)
	defer cleanup()

	ctx := context.Background()
	tm := tokens.NewTokenManager("test-jwt", "test-refresh", 15*time.Minute, 7*24*time.Hour)
	hub := ws.NewHub(tm)
	msgSvc := chat.NewMessageService(database, hub)

	memberID := "d0000000-0000-0000-0000-000000000001"
	outsiderID := "d0000000-0000-0000-0000-000000000002"
	wsID := "d0000000-0000-0000-0000-000000000003"
	privChanID := "d0000000-0000-0000-0000-000000000004"

	_, _ = database.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, full_name, role)
		VALUES
			($1, 'thread_member@officechat.local', 'hash', 'Thread Member', 'user'),
			($2, 'thread_outsider@officechat.local', 'hash', 'Thread Outsider', 'user')
		ON CONFLICT (id) DO NOTHING;
	`, memberID, outsiderID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, owner_id)
		VALUES ($1, 'Thread Test WS', 'thread-test-ws', $2)
		ON CONFLICT (id) DO NOTHING;
	`, wsID, memberID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'Member'), ($1, $3, 'Member')
		ON CONFLICT (workspace_id, user_id) DO NOTHING;
	`, wsID, memberID, outsiderID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO channels (id, workspace_id, name, is_private, created_by)
		VALUES ($1, $2, 'secret-thread-chan', TRUE, $3)
		ON CONFLICT (id) DO NOTHING;
	`, privChanID, wsID, memberID)
	_, _ = database.ExecContext(ctx, `
		INSERT INTO channel_members (channel_id, user_id, role)
		VALUES ($1, $2, 'admin')
		ON CONFLICT (channel_id, user_id) DO NOTHING;
	`, privChanID, memberID)

	parentMsg, err := msgSvc.SendChannelMessage(ctx, privChanID, memberID, models.SendMessageRequest{
		Content: "Parent message in private channel",
	})
	if err != nil {
		t.Fatalf("SendChannelMessage (parent) failed: %v", err)
	}

	parentID := parentMsg.ID
	replyMsg, err := msgSvc.SendChannelMessage(ctx, privChanID, memberID, models.SendMessageRequest{
		Content:  "Thread reply #1",
		ParentID: &parentID,
	})
	if err != nil {
		t.Fatalf("SendChannelMessage (reply) failed: %v", err)
	}

	// Authorized member retrieves thread replies
	replies, err := msgSvc.ListThreadMessages(ctx, parentID, memberID)
	if err != nil {
		t.Fatalf("ListThreadMessages failed for authorized member: %v", err)
	}
	if len(replies) != 1 || replies[0].ID != replyMsg.ID {
		t.Fatalf("Expected 1 reply (%s), got: %+v", replyMsg.ID, replies)
	}

	// Unauthorized workspace member (not in private channel) must be rejected with ErrChannelForbidden
	_, err = msgSvc.ListThreadMessages(ctx, parentID, outsiderID)
	if !errors.Is(err, chat.ErrChannelForbidden) {
		t.Fatalf("Expected ErrChannelForbidden for outsider reading private channel thread, got: %v", err)
	}

	// Cleanup
	_, _ = database.ExecContext(ctx, `DELETE FROM messages WHERE channel_id = $1`, privChanID)
	_, _ = database.ExecContext(ctx, `DELETE FROM channel_members WHERE channel_id = $1`, privChanID)
	_, _ = database.ExecContext(ctx, `DELETE FROM channels WHERE id = $1`, privChanID)
	_, _ = database.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, wsID)
	_, _ = database.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, wsID)
	_, _ = database.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, memberID, outsiderID)
}
