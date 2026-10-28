<#
.SYNOPSIS
    Start, Stop, and Verify a Free Cloudflare Quick Tunnel (https://*.trycloudflare.com) for OfficeChat.
.DESCRIPTION
    Routes temporary public HTTPS traffic through the local Caddy reverse proxy (http://localhost:80 / http://caddy:80)
    without requiring a purchased domain, static IP, or Cloudflare account.
    Keeps PostgreSQL (5432), Redis (6379), MinIO (9000), and Go API (8080) isolated from direct public access.
.PARAMETER Action
    start | stop | restart | status | verify
#>
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("start", "stop", "restart", "status", "verify")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DeployDir   = Join-Path $ProjectRoot "deploy"
$EnvFile     = Join-Path $DeployDir ".env"
$ComposeFile = Join-Path $DeployDir "docker-compose.prod.yml"

function Get-QuickTunnelUrl {
    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $logs = (docker logs officechat-cloudflared 2>&1) -join "`n"
    $ErrorActionPreference = $oldPref
    $urlMatches = [regex]::Matches($logs, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    if ($urlMatches.Count -gt 0) {
        return $urlMatches[$urlMatches.Count - 1].Value
    }
    return $null
}

function Assert-LocalStackHealthy {
    Write-Host "=== 1. Checking Docker Engine & OfficeChat Containers ===" -ForegroundColor Cyan
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop is not running. Please start Docker Desktop first."
    }

    Write-Host "`n=== 2. Verifying Local Caddy Endpoint (http://127.0.0.1:80/healthz) ===" -ForegroundColor Cyan
    $health = curl.exe -s -w "`n%{http_code}" "http://127.0.0.1:80/healthz"
    $lines = $health -split "`n"
    $code = $lines[-1].Trim()
    if ($code -ne "200") {
        throw "Local Caddy healthcheck failed with HTTP status $code"
    }
    Write-Host "[OK] Local Caddy Gateway responded HTTP ${code}: $($lines[0].Trim())" -ForegroundColor Green
}

switch ($Action) {
    "start" {
        Assert-LocalStackHealthy
        Write-Host "`n=== 3. Starting Free Cloudflare Quick Tunnel ===" -ForegroundColor Cyan
        docker compose -f $ComposeFile --env-file $EnvFile up -d caddy cloudflared | Out-Null
        docker exec officechat-caddy caddy reload --config /etc/caddy/Caddyfile 2>$null | Out-Null

        Write-Host "Waiting for Cloudflare Quick Tunnel URL generation..." -ForegroundColor Yellow
        $url = $null
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Seconds 2
            $url = Get-QuickTunnelUrl
            if ($null -ne $url) { break }
        }

        if ($null -eq $url) {
            throw "Timed out waiting for *.trycloudflare.com URL. Check 'docker logs officechat-cloudflared'."
        }

        Write-Host "`n==================================================================" -ForegroundColor Green
        Write-Host "  OfficeChat Quick Tunnel is LIVE!" -ForegroundColor Green
        Write-Host "  Public HTTPS URL : $url" -ForegroundColor Cyan
        Write-Host "  Admin Console    : $url/admin" -ForegroundColor Cyan
        Write-Host "  Discovery Feed   : https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h" -ForegroundColor Cyan
        Write-Host "  Note: OfficeChat automatically publishes new tunnel URLs so open" -ForegroundColor Yellow
        Write-Host "        browser tabs discover and reconnect to the new URL." -ForegroundColor Yellow
        Write-Host "==================================================================`n" -ForegroundColor Green
    }
    "stop" {
        Write-Host "[INFO] Stopping Cloudflare Quick Tunnel..." -ForegroundColor Yellow
        docker stop officechat-cloudflared 2>$null | Out-Null
        Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
        Write-Host "[OK] Quick Tunnel stopped. Local OfficeChat containers remain intact." -ForegroundColor Green
    }
    "restart" {
        Write-Host "[INFO] Restarting Quick Tunnel (a new *.trycloudflare.com URL will be assigned)..." -ForegroundColor Yellow
        docker rm -f officechat-cloudflared 2>$null | Out-Null
        & $PSCommandPath -Action start
    }
    "status" {
        Assert-LocalStackHealthy
        $url = Get-QuickTunnelUrl
        if ($null -ne $url) {
            Write-Host "`n[ACTIVE] Current Quick Tunnel URL: $url" -ForegroundColor Green
            $cfg = curl.exe -s "http://127.0.0.1:80/api/v1/tunnel-config"
            Write-Host "[AUTO-DISCOVERY] /api/v1/tunnel-config: $cfg" -ForegroundColor Cyan
        } else {
            Write-Host "`n[STOPPED] Quick Tunnel is not running." -ForegroundColor Yellow
        }
    }
    "verify" {
        Assert-LocalStackHealthy
        $url = Get-QuickTunnelUrl
        if ($null -eq $url) {
            throw "No active Quick Tunnel URL found. Run with '-Action start' first."
        }
        Write-Host "`n=== Testing Public Quick Tunnel: $url ===" -ForegroundColor Cyan
        $pubHealth = curl.exe -s -w "`n%{http_code}" "$url/healthz"
        $hLines = $pubHealth -split "`n"
        Write-Host "[OK] GET $url/healthz -> HTTP $($hLines[-1].Trim()) ($($hLines[0].Trim()))" -ForegroundColor Green

        $pubCfg = curl.exe -s -w "`n%{http_code}" "$url/api/v1/tunnel-config"
        $cLines = $pubCfg -split "`n"
        Write-Host "[OK] GET $url/api/v1/tunnel-config -> HTTP $($cLines[-1].Trim()) ($($cLines[0].Trim()))" -ForegroundColor Green

        $pubWeb = curl.exe -s -w "`n%{http_code}" "$url/"
        $wLines = $pubWeb -split "`n"
        Write-Host "[OK] GET $url/ (React Frontend) -> HTTP $($wLines[-1].Trim())" -ForegroundColor Green
    }
}

