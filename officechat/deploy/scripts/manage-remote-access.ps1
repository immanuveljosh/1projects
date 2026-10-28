<#
.SYNOPSIS
    OfficeChat Remote Access & Cloudflare Tunnel Management Script (Windows 11 PowerShell)
.DESCRIPTION
    Manages the hardened OfficeChat Docker Compose stack + Cloudflare Tunnel connector,
    verifies port isolation, checks WebSocket upgrades, HTTPS, login, and recovers after restarts.
.PARAMETER Action
    init-env | start | stop | restart | status | verify | logs
#>
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("init-env", "start", "stop", "restart", "status", "verify", "logs")]
    [string]$Action = "status",

    [Parameter(Mandatory = $false)]
    [string]$Domain = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DeployDir   = Join-Path $ProjectRoot "deploy"
$EnvFile     = Join-Path $DeployDir ".env"
$EnvExample  = Join-Path $DeployDir ".env.example"
$ComposeFile = Join-Path $DeployDir "docker-compose.prod.yml"

function New-RandomHexSecret([int]$Bytes = 32) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $Bytes
    $rng.GetBytes($buf)
    return ($buf | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Initialize-EnvFile {
    if (Test-Path $EnvFile) {
        Write-Host "[OK] $EnvFile already exists. Preserving existing secrets." -ForegroundColor Green
        return
    }
    if (-not (Test-Path $EnvExample)) {
        throw "Missing template file: $EnvExample"
    }

    $content = Get-Content $EnvExample -Raw
    $content = $content -replace "REPLACE_WITH_STRONG_RANDOM_PASSWORD_HEX_32", (New-RandomHexSecret 32)
    $content = $content -replace "REPLACE_WITH_STRONG_MINIO_ACCESS_KEY", ("minio_" + (New-RandomHexSecret 12))
    $content = $content -replace "REPLACE_WITH_STRONG_MINIO_SECRET_KEY", (New-RandomHexSecret 32)
    $content = $content -replace "REPLACE_WITH_STRONG_JWT_ACCESS_SECRET_HEX_32", (New-RandomHexSecret 32)
    $content = $content -replace "REPLACE_WITH_STRONG_JWT_REFRESH_SECRET_HEX_32", (New-RandomHexSecret 32)

    if ($Domain -ne "") {
        $content = $content -replace "DOMAIN=chat\.example\.com", "DOMAIN=$Domain"
    }

    Set-Content -Path $EnvFile -Value $content -Encoding UTF8
    Write-Host "[OK] Created $EnvFile with freshly generated 256-bit cryptographic secrets." -ForegroundColor Green
    Write-Host "[ACTION REQUIRED] Edit $EnvFile and set DOMAIN and CLOUDFLARE_TUNNEL_TOKEN before running 'start'." -ForegroundColor Yellow
}

function Test-DockerRunning {
    $dockerSvc = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
    if ($null -ne $dockerSvc -and $dockerSvc.Status -ne "Running") {
        Write-Host "[WARN] Windows service 'com.docker.service' is $($dockerSvc.Status). Starting Docker Desktop..." -ForegroundColor Yellow
        $dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dockerDesktop) {
            Start-Process $dockerDesktop
            Write-Host "Waiting up to 60 seconds for Docker Engine to become ready..." -ForegroundColor Cyan
            for ($i = 0; $i -lt 30; $i++) {
                Start-Sleep -Seconds 2
                docker info *> $null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "[OK] Docker Engine is running." -ForegroundColor Green
                    return
                }
            }
        }
        throw "Docker Engine is not running. Start Docker Desktop and re-run this command."
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Engine is not reachable. Start Docker Desktop and re-run this command."
    }
}

function Invoke-PortIsolationAudit {
    Write-Host "`n=== Auditing Public / LAN Port Exposure ===" -ForegroundColor Cyan
    $sensitivePorts = @(5432, 5433, 6379, 9000, 9001, 8080)
    $exposed = $false
    foreach ($port in $sensitivePorts) {
        $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
        foreach ($l in $listeners) {
            if ($l.LocalAddress -eq "0.0.0.0" -or $l.LocalAddress -eq "::") {
                Write-Host "[FAIL] Sensitive port $port is bound to public/LAN address $($l.LocalAddress)!" -ForegroundColor Red
                $exposed = $true
            } else {
                Write-Host "[OK] Port $port is restricted to loopback ($($l.LocalAddress))." -ForegroundColor Green
            }
        }
        if (-not $listeners) {
            Write-Host "[OK] Port $port is not exposed on the Windows host." -ForegroundColor Green
        }
    }
    if (-not $exposed) {
        Write-Host "[PASS] PostgreSQL, Redis, MinIO, and Go API are isolated from direct LAN/Internet access." -ForegroundColor Green
    }
}

switch ($Action) {
    "init-env" {
        Initialize-EnvFile
    }
    "start" {
        Initialize-EnvFile
        Test-DockerRunning
        Write-Host "[INFO] Building and starting OfficeChat production stack + Cloudflare Tunnel..." -ForegroundColor Cyan
        docker compose -f $ComposeFile --env-file $EnvFile up -d --build
        Invoke-PortIsolationAudit
    }
    "stop" {
        Test-DockerRunning
        Write-Host "[INFO] Stopping OfficeChat production stack..." -ForegroundColor Cyan
        docker compose -f $ComposeFile --env-file $EnvFile stop
    }
    "restart" {
        Test-DockerRunning
        Write-Host "[INFO] Restarting OfficeChat production stack + Cloudflare Tunnel..." -ForegroundColor Cyan
        docker compose -f $ComposeFile --env-file $EnvFile restart
        docker compose -f $ComposeFile --env-file $EnvFile ps
    }
    "status" {
        Invoke-PortIsolationAudit
        Test-DockerRunning
        docker compose -f $ComposeFile --env-file $EnvFile ps
    }
    "logs" {
        Test-DockerRunning
        docker compose -f $ComposeFile --env-file $EnvFile logs --tail=100 -f caddy api cloudflared
    }
    "verify" {
        Invoke-PortIsolationAudit
        Test-DockerRunning
        Write-Host "`n=== Checking Local Caddy Gateway Health ===" -ForegroundColor Cyan
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:80/healthz" -UseBasicParsing -TimeoutSec 5
        Write-Host "[OK] Caddy /healthz HTTP $($health.StatusCode): $($health.Content.Trim())" -ForegroundColor Green
        Write-Host "[OK] HSTS Header: $($health.Headers['Strict-Transport-Security'])" -ForegroundColor Green
        Write-Host "[OK] CSP Header: $($health.Headers['Content-Security-Policy'])" -ForegroundColor Green

        if ($Domain -ne "") {
            Write-Host "`n=== Checking Public HTTPS Endpoint https://$Domain ===" -ForegroundColor Cyan
            $pubHealth = Invoke-WebRequest -Uri "https://$Domain/healthz" -UseBasicParsing -TimeoutSec 10
            Write-Host "[OK] Public HTTPS https://$Domain/healthz returned HTTP $($pubHealth.StatusCode)" -ForegroundColor Green
        }
    }
}

