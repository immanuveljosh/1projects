package ws_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"officechat/backend/internal/tokens"
	"officechat/backend/internal/ws"
)

type mockScopeAuthorizer struct {
	channels map[string]struct {
		workspaceID string
		isPrivate   bool
		members     map[string]bool
	}
	dms map[string]struct {
		workspaceID string
		members     map[string]bool
	}
}

func (m *mockScopeAuthorizer) ResolveChannelTyping(_ context.Context, workspaceID, channelID, userID string) (string, bool, []string, bool) {
	ch, ok := m.channels[channelID]
	if !ok || ch.workspaceID != workspaceID || !ch.members[userID] {
		return "", false, nil, false
	}
	var memberIDs []string
	for uid := range ch.members {
		memberIDs = append(memberIDs, uid)
	}
	return userID, ch.isPrivate, memberIDs, true
}

func (m *mockScopeAuthorizer) ResolveDMTyping(_ context.Context, workspaceID, dmGroupID, userID string) (string, []string, bool) {
	dm, ok := m.dms[dmGroupID]
	if !ok || dm.workspaceID != workspaceID || !dm.members[userID] {
		return "", nil, false
	}
	var memberIDs []string
	for uid := range dm.members {
		memberIDs = append(memberIDs, uid)
	}
	return userID, memberIDs, true
}

func TestHubServeHTTP_RejectsUnauthenticated(t *testing.T) {
	tm := tokens.NewTokenManager("test-access-secret-32-bytes-long!!", "test-refresh-secret-32-bytes-long!", 15*time.Minute, 24*time.Hour)
	hub := ws.NewHub(tm)

	// Missing token -> 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws", nil)
	rr := httptest.NewRecorder()
	hub.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token, got %d", rr.Code)
	}

	// Invalid token -> 401
	reqInvalid := httptest.NewRequest(http.MethodGet, "/api/v1/ws?token=invalid.jwt.token", nil)
	rrInvalid := httptest.NewRecorder()
	hub.ServeHTTP(rrInvalid, reqInvalid)
	if rrInvalid.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", rrInvalid.Code)
	}
}

func TestHubTypingIndicators_ScopedDeliveryRateLimitAndExpiry(t *testing.T) {
	tm := tokens.NewTokenManager("test-access-secret-32-bytes-long!!", "test-refresh-secret-32-bytes-long!", 15*time.Minute, 24*time.Hour)
	hub := ws.NewHub(tm)
	hub.SetTypingConfig(120*time.Millisecond, 240*time.Millisecond)

	const wsID = "11111111-1111-1111-1111-111111111111"
	const userA = "user-a"
	const userB = "user-b"
	const userOutsider = "user-outsider"

	auth := &mockScopeAuthorizer{
		channels: map[string]struct {
			workspaceID string
			isPrivate   bool
			members     map[string]bool
		}{
			"priv-chan-1": {
				workspaceID: wsID,
				isPrivate:   true,
				members:     map[string]bool{userA: true, userB: true},
			},
		},
		dms: map[string]struct {
			workspaceID string
			members     map[string]bool
		}{
			"dm-1": {
				workspaceID: wsID,
				members:     map[string]bool{userA: true, userB: true},
			},
		},
	}
	hub.SetScopeAuthorizer(auth)
	go hub.Run()

	srv := httptest.NewServer(hub)
	defer srv.Close()

	dialUser := func(uid string) (*websocket.Conn, <-chan ws.Event) {
		tok, _, err := tm.GenerateAccessToken(uid, uid+"@officechat.local", "user")
		if err != nil {
			t.Fatalf("GenerateAccessToken failed: %v", err)
		}
		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws?workspace_id=" + wsID + "&token=" + tok
		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("Dial failed for %s: %v", uid, err)
		}
		ch := make(chan ws.Event, 64)
		go func() {
			defer close(ch)
			for {
				_, raw, err := conn.ReadMessage()
				if err != nil {
					return
				}
				for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
					if line == "" {
						continue
					}
					var msg ws.Event
					if err := json.Unmarshal([]byte(line), &msg); err == nil {
						if msg.Type == "typing.start" || msg.Type == "typing.stop" {
							ch <- msg
						}
					}
				}
			}
		}()
		return conn, ch
	}

	connA, chA := dialUser(userA)
	defer connA.Close()
	connB, chB := dialUser(userB)
	defer connB.Close()
	connOutsider, chOutsider := dialUser(userOutsider)
	defer connOutsider.Close()

	readEvents := func(ch <-chan ws.Event, wait time.Duration) []ws.Event {
		var events []ws.Event
		timer := time.NewTimer(wait)
		defer timer.Stop()
		for {
			select {
			case ev, ok := <-ch:
				if !ok {
					return events
				}
				events = append(events, ev)
			case <-timer.C:
				return events
			}
		}
	}

	// Drain initial events
	time.Sleep(40 * time.Millisecond)
	_ = readEvents(chA, 10*time.Millisecond)
	_ = readEvents(chB, 10*time.Millisecond)
	_ = readEvents(chOutsider, 10*time.Millisecond)

	// 1. Unauthorized sender (userOutsider) tries to emit typing.start to dm-1 and priv-chan-1
	_ = connOutsider.WriteMessage(websocket.TextMessage, []byte(`{"type":"typing.start","dm_group_id":"dm-1"}`))
	_ = connOutsider.WriteMessage(websocket.TextMessage, []byte(`{"type":"typing.start","channel_id":"priv-chan-1"}`))

	if evts := readEvents(chB, 80*time.Millisecond); len(evts) != 0 {
		t.Fatalf("expected 0 typing events from unauthorized sender, got %d: %+v", len(evts), evts)
	}

	// 2. Authorized sender (userA) sends 3 rapid typing.start frames to dm-1 within rate limit window
	for i := 0; i < 3; i++ {
		if err := connA.WriteMessage(websocket.TextMessage, []byte(`{"type":"typing.start","dm_group_id":"dm-1"}`)); err != nil {
			t.Fatalf("WriteMessage failed: %v", err)
		}
	}

	// Outsider must NOT receive DM typing events
	if outsiderEvts := readEvents(chOutsider, 60*time.Millisecond); len(outsiderEvts) != 0 {
		t.Fatalf("expected outsider to receive 0 DM typing events, got %d", len(outsiderEvts))
	}

	// User B must receive exactly 1 typing.start (rate-limited) followed by automatic typing.stop after expiry
	bEvts := readEvents(chB, 340*time.Millisecond)
	startCount := 0
	stopCount := 0
	for _, ev := range bEvts {
		if ev.Type == "typing.start" {
			startCount++
		}
		if ev.Type == "typing.stop" {
			stopCount++
		}
	}
	if startCount != 1 {
		t.Fatalf("expected rate-limited startCount == 1 for User B, got %d (events: %+v)", startCount, bEvts)
	}
	if stopCount != 1 {
		t.Fatalf("expected automatic expiry stopCount == 1 for User B, got %d (events: %+v)", stopCount, bEvts)
	}
}


