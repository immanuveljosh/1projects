package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"officechat/backend/internal/utils"
)

const DefaultDiscoveryTopic = "officechat-nithra-tunnel-8b4e91f2a3c7"

var quickTunnelRegex = regexp.MustCompile(`https://[a-zA-Z0-9-]+\.trycloudflare\.com`)

// ConfigPayload represents the public, non-sensitive tunnel configuration published to discovery endpoints.
type ConfigPayload struct {
	ServerURL    string `json:"server_url"`
	WSURL        string `json:"ws_url"`
	DiscoveryURL string `json:"discovery_url"`
	Status       string `json:"status"`
	UpdatedAt    string `json:"updated_at"`
}

// ExtractQuickTunnelURL extracts the latest https://*.trycloudflare.com URL from cloudflared metrics or logs.
func ExtractQuickTunnelURL(text string) string {
	matches := quickTunnelRegex.FindAllString(text, -1)
	if len(matches) == 0 {
		return ""
	}
	return matches[len(matches)-1]
}

type Watcher struct {
	mu              sync.RWMutex
	current         ConfigPayload
	lastPublishedAt time.Time
	metricsURL      string
	discoveryTopic  string
	ntfyBaseURL     string
	gistID          string
	gistToken       string
	httpClient      *http.Client
	onUpdate        func(ConfigPayload)
}

func NewWatcher(onUpdate func(ConfigPayload)) *Watcher {
	metricsURL := strings.TrimSpace(os.Getenv("CLOUDFLARED_METRICS_URL"))
	if metricsURL == "" {
		metricsURL = "http://cloudflared:2000/metrics"
	}
	topic := strings.TrimSpace(os.Getenv("TUNNEL_DISCOVERY_TOPIC"))
	if topic == "" {
		topic = DefaultDiscoveryTopic
	}
	ntfyBase := strings.TrimRight(strings.TrimSpace(os.Getenv("TUNNEL_DISCOVERY_BASE_URL")), "/")
	if ntfyBase == "" {
		ntfyBase = "https://ntfy.sh"
	}

	discoveryReadURL := fmt.Sprintf("%s/%s/json?poll=1&since=12h", ntfyBase, topic)

	return &Watcher{
		current: ConfigPayload{
			DiscoveryURL: discoveryReadURL,
			Status:       "initializing",
			UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
		},
		metricsURL:     metricsURL,
		discoveryTopic: topic,
		ntfyBaseURL:    ntfyBase,
		gistID:         strings.TrimSpace(os.Getenv("GITHUB_GIST_ID")),
		gistToken:      strings.TrimSpace(os.Getenv("GITHUB_GIST_TOKEN")),
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
		onUpdate: onUpdate,
	}
}

// SetCustomEndpoints allows tests to override the metrics and discovery URLs.
func (w *Watcher) SetCustomEndpoints(metricsURL, ntfyBaseURL, topic string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.metricsURL = metricsURL
	w.ntfyBaseURL = strings.TrimRight(ntfyBaseURL, "/")
	w.discoveryTopic = topic
	w.current.DiscoveryURL = fmt.Sprintf("%s/%s/json?poll=1&since=12h", w.ntfyBaseURL, w.discoveryTopic)
}

func (w *Watcher) CurrentConfig() ConfigPayload {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.current
}

// Start runs the background polling loop to detect Quick Tunnel URL changes automatically.
func (w *Watcher) Start(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	w.CheckAndPublish(ctx)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.CheckAndPublish(ctx)
		}
	}
}

// CheckAndPublish queries cloudflared metrics and publishes the URL if it changed or needs TTL refresh.
func (w *Watcher) CheckAndPublish(ctx context.Context) bool {
	detectedURL, err := w.fetchTunnelURLFromMetrics(ctx)
	if err != nil || detectedURL == "" {
		return false
	}

	wsURL := strings.Replace(detectedURL, "https://", "wss://", 1) + "/api/v1/ws"
	now := time.Now().UTC()

	w.mu.Lock()
	urlChanged := w.current.ServerURL != detectedURL
	needsRefresh := now.Sub(w.lastPublishedAt) >= 4*time.Hour
	if !urlChanged && !needsRefresh {
		w.mu.Unlock()
		return false
	}

	w.current.ServerURL = detectedURL
	w.current.WSURL = wsURL
	w.current.Status = "online"
	w.current.UpdatedAt = now.Format(time.RFC3339)
	snapshot := w.current
	w.lastPublishedAt = now
	w.mu.Unlock()

	if urlChanged {
		log.Printf("[TUNNEL] Detected active Quick Tunnel URL: %s", detectedURL)
		if w.onUpdate != nil {
			w.onUpdate(snapshot)
		}
	}

	// Publish to permanent free external configuration endpoint
	if err := w.publishToDiscoveryEndpoint(ctx, snapshot); err != nil {
		log.Printf("[TUNNEL] Warning: Could not publish tunnel config to discovery endpoint: %v", err)
	} else if urlChanged {
		log.Printf("[TUNNEL] Published updated tunnel URL to permanent discovery endpoint (%s)", snapshot.DiscoveryURL)
	}

	// Optional: Publish to GitHub Gist if GITHUB_GIST_ID and GITHUB_GIST_TOKEN are configured
	if w.gistID != "" && w.gistToken != "" {
		if err := w.publishToGitHubGist(ctx, snapshot); err != nil {
			log.Printf("[TUNNEL] Warning: Could not update GitHub Gist: %v", err)
		} else if urlChanged {
			log.Printf("[TUNNEL] Published updated tunnel URL to GitHub Gist (%s)", w.gistID)
		}
	}

	return urlChanged
}

func (w *Watcher) fetchTunnelURLFromMetrics(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, w.metricsURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metrics returned status %d", resp.StatusCode)
	}
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return "", err
	}
	return ExtractQuickTunnelURL(string(bodyBytes)), nil
}

func (w *Watcher) publishToDiscoveryEndpoint(ctx context.Context, payload ConfigPayload) error {
	rawJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	pubURL := fmt.Sprintf("%s/%s", w.ntfyBaseURL, w.discoveryTopic)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pubURL, bytes.NewReader(rawJSON))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cache", "yes")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("discovery publish HTTP %d", resp.StatusCode)
	}
	return nil
}

func (w *Watcher) publishToGitHubGist(ctx context.Context, payload ConfigPayload) error {
	prettyJSON, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	gistBody := map[string]any{
		"description": "OfficeChat Live Cloudflare Quick Tunnel Configuration",
		"files": map[string]any{
			"tunnel-config.json": map[string]string{
				"content": string(prettyJSON),
			},
		},
	}
	bodyBytes, err := json.Marshal(gistBody)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("https://api.github.com/gists/%s", w.gistID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+w.gistToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("github gist PATCH HTTP %d", resp.StatusCode)
	}
	return nil
}

// HandleGetTunnelConfig serves GET /api/v1/tunnel-config with CORS support for cross-tunnel discovery.
func (w *Watcher) HandleGetTunnelConfig(rw http.ResponseWriter, r *http.Request) {
	rw.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	utils.JSON(rw, http.StatusOK, w.CurrentConfig())
}

