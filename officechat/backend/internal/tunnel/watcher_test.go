package tunnel_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"officechat/backend/internal/tunnel"
)

func TestExtractQuickTunnelURL(t *testing.T) {
	sampleMetrics := `
# HELP cloudflared_tunnel_user_hostnames_counts
cloudflared_tunnel_user_hostnames_counts{userHostname="https://alpha-bravo-charlie-delta.trycloudflare.com"} 1
`
	got := tunnel.ExtractQuickTunnelURL(sampleMetrics)
	want := "https://alpha-bravo-charlie-delta.trycloudflare.com"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestWatcher_DetectsURLChangeAndPublishes(t *testing.T) {
	var currentHost atomic.Value
	currentHost.Store("https://first-tunnel-host-name.trycloudflare.com")

	metricsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := currentHost.Load().(string)
		_, _ = w.Write([]byte(`cloudflared_tunnel_user_hostnames_counts{userHostname="` + host + `"} 1`))
	}))
	defer metricsSrv.Close()

	var publishedPayloads []tunnel.ConfigPayload
	discoverySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var p tunnel.ConfigPayload
		if err := json.Unmarshal(body, &p); err == nil {
			publishedPayloads = append(publishedPayloads, p)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer discoverySrv.Close()

	var callbackEvents []tunnel.ConfigPayload
	watcher := tunnel.NewWatcher(func(cfg tunnel.ConfigPayload) {
		callbackEvents = append(callbackEvents, cfg)
	})
	watcher.SetCustomEndpoints(metricsSrv.URL, discoverySrv.URL, "test-topic")

	// 1. Initial check should detect first URL and publish
	if changed := watcher.CheckAndPublish(context.Background()); !changed {
		t.Fatalf("expected initial CheckAndPublish to report URL change")
	}
	if len(publishedPayloads) != 1 || publishedPayloads[0].ServerURL != "https://first-tunnel-host-name.trycloudflare.com" {
		t.Fatalf("unexpected published payloads after first check: %+v", publishedPayloads)
	}

	// 2. Second check with same URL should NOT re-publish immediately
	if changed := watcher.CheckAndPublish(context.Background()); changed {
		t.Fatalf("expected no change when tunnel URL is identical")
	}
	if len(publishedPayloads) != 1 {
		t.Fatalf("expected 1 published payload, got %d", len(publishedPayloads))
	}

	// 3. Simulate cloudflared restart with a new Quick Tunnel URL
	currentHost.Store("https://second-rotated-tunnel-url.trycloudflare.com")
	if changed := watcher.CheckAndPublish(context.Background()); !changed {
		t.Fatalf("expected CheckAndPublish to detect rotated tunnel URL")
	}
	if len(publishedPayloads) != 2 || publishedPayloads[1].ServerURL != "https://second-rotated-tunnel-url.trycloudflare.com" {
		t.Fatalf("expected second published payload with new URL, got: %+v", publishedPayloads)
	}
	if len(callbackEvents) != 2 {
		t.Fatalf("expected 2 callback events, got %d", len(callbackEvents))
	}
}

