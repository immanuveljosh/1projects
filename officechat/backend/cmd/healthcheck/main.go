package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	targetURL := "http://127.0.0.1:8080/healthz"
	if len(os.Args) > 1 && os.Args[1] != "" {
		targetURL = os.Args[1]
	}

	client := &http.Client{
		Timeout: 3 * time.Second,
	}

	resp, err := client.Get(targetURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Healthcheck connection failed: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fmt.Fprintf(os.Stderr, "Healthcheck returned non-OK status: %d\n", resp.StatusCode)
		os.Exit(1)
	}

	os.Exit(0)
}
