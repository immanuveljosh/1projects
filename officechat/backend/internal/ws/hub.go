package ws

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"officechat/backend/internal/tokens"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for dev/CORS
	},
}

type Event struct {
	Type        string `json:"type"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	UserID      string `json:"user_id,omitempty"`
	Payload     any    `json:"payload"`
	Timestamp   string `json:"timestamp"`
}

type ClientIncomingMessage struct {
	Type      string `json:"type"`
	ChannelID string `json:"channel_id,omitempty"`
	DMGroupID string `json:"dm_group_id,omitempty"`
}

// ScopeAuthorizer validates whether a user is authorized to emit typing events
// in a workspace channel or DM and resolves the authorized recipient list.
type ScopeAuthorizer interface {
	ResolveChannelTyping(ctx context.Context, workspaceID, channelID, userID string) (userName string, isPrivate bool, memberIDs []string, allowed bool)
	ResolveDMTyping(ctx context.Context, workspaceID, dmGroupID, userID string) (userName string, memberIDs []string, allowed bool)
}

type sqlScopeAuthorizer struct {
	db *sql.DB
}

func NewSQLScopeAuthorizer(db *sql.DB) ScopeAuthorizer {
	return &sqlScopeAuthorizer{db: db}
}

func (a *sqlScopeAuthorizer) ResolveChannelTyping(ctx context.Context, workspaceID, channelID, userID string) (string, bool, []string, bool) {
	if a.db == nil || workspaceID == "" || channelID == "" || userID == "" {
		return "", false, nil, false
	}

	var isPrivate, isWsMember, isChanMember bool
	var userName string
	err := a.db.QueryRowContext(ctx, `
		SELECT c.is_private,
		       COALESCE((SELECT full_name FROM users WHERE id = $3 AND deleted_at IS NULL), ''),
		       EXISTS(
		           SELECT 1 FROM workspace_members wm
		           JOIN users u ON wm.user_id = u.id
		           WHERE wm.workspace_id = c.workspace_id AND wm.user_id = $3
		             AND COALESCE(u.account_state, 'active') = 'active'
		             AND u.deleted_at IS NULL
		       ),
		       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $3)
		FROM channels c
		WHERE c.id = $1 AND c.workspace_id = $2 AND c.is_archived = FALSE
	`, channelID, workspaceID, userID).Scan(&isPrivate, &userName, &isWsMember, &isChanMember)
	if err != nil || !isWsMember || (isPrivate && !isChanMember) {
		return "", false, nil, false
	}

	if !isPrivate {
		return userName, false, nil, true
	}

	rows, err := a.db.QueryContext(ctx, `SELECT user_id FROM channel_members WHERE channel_id = $1`, channelID)
	if err != nil {
		return "", true, nil, false
	}
	defer rows.Close()

	var members []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err == nil && uid != "" {
			members = append(members, uid)
		}
	}
	return userName, true, members, true
}

func (a *sqlScopeAuthorizer) ResolveDMTyping(ctx context.Context, workspaceID, dmGroupID, userID string) (string, []string, bool) {
	if a.db == nil || workspaceID == "" || dmGroupID == "" || userID == "" {
		return "", nil, false
	}

	var isParticipant bool
	var userName string
	err := a.db.QueryRowContext(ctx, `
		SELECT EXISTS(
		           SELECT 1
		           FROM direct_message_groups g
		           JOIN direct_message_members dmm ON g.id = dmm.dm_group_id
		           WHERE g.id = $1 AND g.workspace_id = $2 AND dmm.user_id = $3
		       ),
		       COALESCE((SELECT full_name FROM users WHERE id = $3 AND deleted_at IS NULL), '')
	`, dmGroupID, workspaceID, userID).Scan(&isParticipant, &userName)
	if err != nil || !isParticipant {
		return "", nil, false
	}

	rows, err := a.db.QueryContext(ctx, `SELECT user_id FROM direct_message_members WHERE dm_group_id = $1`, dmGroupID)
	if err != nil {
		return "", nil, false
	}
	defer rows.Close()

	var members []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err == nil && uid != "" {
			members = append(members, uid)
		}
	}
	return userName, members, true
}

type Client struct {
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	userID      string
	workspaceID string
	role        string
}

type Hub struct {
	clients            map[*Client]bool
	userConns          map[string]map[*Client]bool
	wsConns            map[string]map[*Client]bool
	broadcast          chan []byte
	register           chan *Client
	unregister         chan *Client
	mu                 sync.RWMutex
	tm                 *tokens.TokenManager
	authorizer         ScopeAuthorizer
	typingMu           sync.Mutex
	lastTypingAt       map[string]time.Time
	activeTypingTimers map[string]*time.Timer
	typingRateInterval time.Duration
	typingExpiryTTL    time.Duration
}

func NewHub(tm *tokens.TokenManager) *Hub {
	return &Hub{
		clients:            make(map[*Client]bool),
		userConns:          make(map[string]map[*Client]bool),
		wsConns:            make(map[string]map[*Client]bool),
		broadcast:          make(chan []byte, 256),
		register:           make(chan *Client),
		unregister:         make(chan *Client),
		tm:                 tm,
		lastTypingAt:       make(map[string]time.Time),
		activeTypingTimers: make(map[string]*time.Timer),
		typingRateInterval: 1200 * time.Millisecond,
		typingExpiryTTL:    4000 * time.Millisecond,
	}
}

func (h *Hub) SetScopeAuthorizer(auth ScopeAuthorizer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.authorizer = auth
}

func (h *Hub) SetTypingConfig(rateInterval, expiryTTL time.Duration) {
	h.typingMu.Lock()
	defer h.typingMu.Unlock()
	if rateInterval > 0 {
		h.typingRateInterval = rateInterval
	}
	if expiryTTL > 0 {
		h.typingExpiryTTL = expiryTTL
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			var notifyOnline bool
			var wsID, uID string
			h.mu.Lock()
			h.clients[client] = true
			if client.userID != "" {
				if h.userConns[client.userID] == nil {
					h.userConns[client.userID] = make(map[*Client]bool)
				}
				h.userConns[client.userID][client] = true
				if len(h.userConns[client.userID]) == 1 {
					notifyOnline = true
					wsID = client.workspaceID
					uID = client.userID
				}
			}
			if client.workspaceID != "" {
				if h.wsConns[client.workspaceID] == nil {
					h.wsConns[client.workspaceID] = make(map[*Client]bool)
				}
				h.wsConns[client.workspaceID][client] = true
			}
			h.mu.Unlock()

			if notifyOnline && wsID != "" && uID != "" {
				go h.BroadcastToWorkspace(wsID, "presence.updated", map[string]any{
					"user_id": uID,
					"status":  "online",
				})
			}

		case client := <-h.unregister:
			var notifyOffline bool
			var wsID, uID string
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				if client.userID != "" && h.userConns[client.userID] != nil {
					delete(h.userConns[client.userID], client)
					if len(h.userConns[client.userID]) == 0 {
						delete(h.userConns, client.userID)
						notifyOffline = true
						wsID = client.workspaceID
						uID = client.userID
					}
				}
				if client.workspaceID != "" && h.wsConns[client.workspaceID] != nil {
					delete(h.wsConns[client.workspaceID], client)
					if len(h.wsConns[client.workspaceID]) == 0 {
						delete(h.wsConns, client.workspaceID)
					}
				}
			}
			h.mu.Unlock()

			if notifyOffline && wsID != "" && uID != "" {
				go h.BroadcastToWorkspace(wsID, "presence.updated", map[string]any{
					"user_id": uID,
					"status":  "offline",
				})
			}

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
					if client.userID != "" && h.userConns[client.userID] != nil {
						delete(h.userConns[client.userID], client)
						if len(h.userConns[client.userID]) == 0 {
							delete(h.userConns, client.userID)
						}
					}
					if client.workspaceID != "" && h.wsConns[client.workspaceID] != nil {
						delete(h.wsConns[client.workspaceID], client)
						if len(h.wsConns[client.workspaceID]) == 0 {
							delete(h.wsConns, client.workspaceID)
						}
					}
				}
			}
			h.mu.Unlock()
		}
	}
}

// BroadcastToAll sends an event to all connected WebSocket clients
func (h *Hub) BroadcastToAll(eventType string, payload any) {
	evt := Event{
		Type:      eventType,
		Payload:   payload,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(evt)
	if err != nil {
		log.Printf("[WS] Failed to marshal global event: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		select {
		case client.send <- data:
		default:
		}
	}
}

// BroadcastToWorkspace sends an event to all users connected in that workspace
func (h *Hub) BroadcastToWorkspace(workspaceID string, eventType string, payload any) {
	evt := Event{
		Type:        eventType,
		WorkspaceID: workspaceID,
		Payload:     payload,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(evt)
	if err != nil {
		log.Printf("[WS] Failed to marshal workspace event: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, ok := h.wsConns[workspaceID]; ok {
		for client := range clients {
			select {
			case client.send <- data:
			default:
				// Buffer full
			}
		}
	}
}

// SendToUser sends an event to all active sessions of a single user
func (h *Hub) SendToUser(userID string, eventType string, payload any) {
	evt := Event{
		Type:      eventType,
		UserID:    userID,
		Payload:   payload,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(evt)
	if err != nil {
		log.Printf("[WS] Failed to marshal user event: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, ok := h.userConns[userID]; ok {
		for client := range clients {
			select {
			case client.send <- data:
			default:
			}
		}
	}
}

// DisconnectUser sends a termination notice and terminates all active WebSocket sessions for that user
func (h *Hub) DisconnectUser(userID string, reason string) {
	h.SendToUser(userID, "SESSION_TERMINATED", map[string]string{
		"reason": reason,
	})

	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, ok := h.userConns[userID]; ok {
		for client := range clients {
			_ = client.conn.Close()
		}
	}
}

func (h *Hub) handleIncomingClientMessage(c *Client, raw []byte) {
	if c == nil || c.userID == "" || c.workspaceID == "" {
		return
	}

	var msg ClientIncomingMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}
	msg.Type = strings.TrimSpace(msg.Type)
	msg.ChannelID = strings.TrimSpace(msg.ChannelID)
	msg.DMGroupID = strings.TrimSpace(msg.DMGroupID)

	if msg.Type != "typing.start" && msg.Type != "typing.stop" {
		return
	}
	if msg.ChannelID == "" && msg.DMGroupID == "" {
		return
	}

	h.mu.RLock()
	auth := h.authorizer
	h.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var (
		userName   string
		isTargeted bool
		memberIDs  []string
		targetKey  string
	)

	if msg.ChannelID != "" {
		targetKey = "chan:" + msg.ChannelID
		if auth != nil {
			var isPrivate, allowed bool
			userName, isPrivate, memberIDs, allowed = auth.ResolveChannelTyping(ctx, c.workspaceID, msg.ChannelID, c.userID)
			if !allowed {
				return
			}
			isTargeted = isPrivate
		}
	} else {
		targetKey = "dm:" + msg.DMGroupID
		if auth != nil {
			var allowed bool
			userName, memberIDs, allowed = auth.ResolveDMTyping(ctx, c.workspaceID, msg.DMGroupID, c.userID)
			if !allowed {
				return
			}
			isTargeted = true
		}
	}

	stateKey := c.workspaceID + ":" + targetKey + ":" + c.userID

	emitScoped := func(eventType string, expiresMs int64) {
		payload := map[string]any{
			"user_id":       c.userID,
			"user_name":     userName,
			"channel_id":    msg.ChannelID,
			"dm_group_id":   msg.DMGroupID,
			"expires_in_ms": expiresMs,
		}
		if isTargeted {
			for _, uid := range memberIDs {
				if uid != "" && uid != c.userID {
					h.SendToUser(uid, eventType, payload)
				}
			}
		} else {
			h.BroadcastToWorkspace(c.workspaceID, eventType, payload)
		}
	}

	h.typingMu.Lock()
	rateInterval := h.typingRateInterval
	expiryTTL := h.typingExpiryTTL

	if msg.Type == "typing.stop" {
		if t, ok := h.activeTypingTimers[stateKey]; ok {
			t.Stop()
			delete(h.activeTypingTimers, stateKey)
		}
		h.typingMu.Unlock()
		emitScoped("typing.stop", 0)
		return
	}

	// Rate limit check for typing.start
	now := time.Now()
	if last, ok := h.lastTypingAt[stateKey]; ok && now.Sub(last) < rateInterval {
		h.typingMu.Unlock()
		return
	}
	h.lastTypingAt[stateKey] = now

	if t, ok := h.activeTypingTimers[stateKey]; ok {
		t.Stop()
	}
	h.activeTypingTimers[stateKey] = time.AfterFunc(expiryTTL, func() {
		h.typingMu.Lock()
		delete(h.activeTypingTimers, stateKey)
		h.typingMu.Unlock()
		emitScoped("typing.stop", 0)
	})
	h.typingMu.Unlock()

	emitScoped("typing.start", expiryTTL.Milliseconds())
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		c.hub.handleIncomingClientMessage(c, raw)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeHTTP handles incoming websocket upgrade requests
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		tokenStr = r.Header.Get("Sec-WebSocket-Protocol")
	}
	if tokenStr == "" {
		if cookie, err := r.Cookie("officechat_access_token"); err == nil {
			tokenStr = cookie.Value
		}
	}

	var userID, role string
	if tokenStr != "" {
		if claims, err := h.tm.ValidateAccessToken(tokenStr); err == nil {
			userID = claims.UserID
			role = claims.Role
		}
	}
	if userID == "" {
		http.Error(w, "Unauthorized WebSocket connection", http.StatusUnauthorized)
		return
	}

	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Workspace-ID")
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade error: %v", err)
		return
	}

	client := &Client{
		hub:         h,
		conn:        conn,
		send:        make(chan []byte, 256),
		userID:      userID,
		workspaceID: workspaceID,
		role:        role,
	}

	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}
