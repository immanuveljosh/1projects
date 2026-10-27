package ws

import (
	"encoding/json"
	"log"
	"net/http"
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

type Client struct {
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	userID      string
	workspaceID string
	role        string
}

type Hub struct {
	clients    map[*Client]bool
	userConns  map[string]map[*Client]bool
	wsConns    map[string]map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	tm         *tokens.TokenManager
}

func NewHub(tm *tokens.TokenManager) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		userConns:  make(map[string]map[*Client]bool),
		wsConns:    make(map[string]map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		tm:         tm,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			if client.userID != "" {
				if h.userConns[client.userID] == nil {
					h.userConns[client.userID] = make(map[*Client]bool)
				}
				h.userConns[client.userID][client] = true
			}
			if client.workspaceID != "" {
				if h.wsConns[client.workspaceID] == nil {
					h.wsConns[client.workspaceID] = make(map[*Client]bool)
				}
				h.wsConns[client.workspaceID][client] = true
			}
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
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
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
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

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(512)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
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

	var userID, role string
	if tokenStr != "" {
		if claims, err := h.tm.ValidateAccessToken(tokenStr); err == nil {
			userID = claims.UserID
			role = claims.Role
		}
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
