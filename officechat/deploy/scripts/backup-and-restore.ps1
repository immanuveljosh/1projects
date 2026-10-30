<#
.SYNOPSIS
    OfficeChat Backup and Disaster Recovery Utility
.DESCRIPTION
    Automates PostgreSQL database dumps, MinIO file attachment archives,
    and recovery operations for production OfficeChat deployments.
.PARAMETER Action
    The action to execute: 'backup', 'restore', or 'list'.
.PARAMETER BackupFile
    Path to the backup file to restore (required when Action is 'restore').
.EXAMPLE
    .\backup-and-restore.ps1 -Action backup
    .\backup-and-restore.ps1 -Action list
    .\backup-and-restore.ps1 -Action restore -BackupFile "..\backups\officechat_db_20261028_160000.sql.gz"
#>
[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [ValidateSet('backup', 'restore', 'list')]
    [string]$Action,

    [Parameter(Mandatory = $false)]
    [string]$BackupFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DeployDir = Split-Path -Parent $ScriptDir
$BackupDir = Join-Path $DeployDir 'backups'

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

function Invoke-OfficeChatBackup {
    $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $dbDumpFile = Join-Path $BackupDir "officechat_db_$timestamp.sql"
    $dbGzFile = "$dbDumpFile.gz"

    Write-Host "==> Starting OfficeChat Database Backup ($timestamp)..." -ForegroundColor Cyan

    # Verify postgres container is running
    $pgState = docker inspect -f '{{.State.Running}}' officechat-postgres 2>$null
    if ($pgState -ne 'true') {
        throw "Cannot perform backup: 'officechat-postgres' container is not running."
    }

    # 1. Database pg_dump
    Write-Host "    Exporting PostgreSQL schema and records..." -ForegroundColor Gray
    cmd.exe /c "docker exec -i officechat-postgres sh -c ""PGPASSWORD=`"`$POSTGRES_PASSWORD`" pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --no-owner --clean --if-exists"" > `"$dbDumpFile`""

    if (-not (Test-Path $dbDumpFile) -or (Get-Item $dbDumpFile).Length -lt 100) {
        throw "Database backup dump failed or created an empty file."
    }

    # Compress SQL dump
    Write-Host "    Compressing database dump..." -ForegroundColor Gray
    tar.exe -czf $dbGzFile -C $BackupDir (Split-Path -Leaf $dbDumpFile)
    Remove-Item -Path $dbDumpFile -Force

    $dbSize = (Get-Item $dbGzFile).Length / 1KB
    Write-Host "    [OK] Database backup saved: $(Split-Path -Leaf $dbGzFile) ($([Math]::Round($dbSize, 1)) KB)" -ForegroundColor Green

    # 2. MinIO Attachments Backup
    $minioState = docker inspect -f '{{.State.Running}}' officechat-minio 2>$null
    if ($minioState -eq 'true') {
        Write-Host "    Archiving MinIO storage attachments..." -ForegroundColor Gray
        $minioTarFile = Join-Path $BackupDir "officechat_minio_$timestamp.tar.gz"
        cmd.exe /c "docker exec -i officechat-minio tar -czf - /data 2>nul > `"$minioTarFile`""
        if ((Test-Path $minioTarFile) -and (Get-Item $minioTarFile).Length -gt 50) {
            $minioSize = (Get-Item $minioTarFile).Length / 1KB
            Write-Host "    [OK] MinIO attachments saved: $(Split-Path -Leaf $minioTarFile) ($([Math]::Round($minioSize, 1)) KB)" -ForegroundColor Green
        }
    }

    # 3. Retention: Keep last 14 backups
    $allDbBackups = Get-ChildItem -Path $BackupDir -Filter 'officechat_db_*.sql.gz' | Sort-Object CreationTime -Descending
    if ($allDbBackups.Count -gt 14) {
        $toRemove = $allDbBackups | Select-Object -Skip 14
        foreach ($item in $toRemove) {
            Remove-Item -Path $item.FullName -Force
            Write-Host "    Pruned older backup: $($item.Name)" -ForegroundColor DarkGray
        }
    }

    Write-Host "==> OfficeChat Backup Complete!" -ForegroundColor Green
}

function Invoke-OfficeChatRestore {
    param ([string]$targetFile)

    if (-not $targetFile) {
        throw "Restore requires -BackupFile parameter specifying the .sql.gz or .sql archive."
    }

    if (-not (Test-Path $targetFile)) {
        throw "Backup file not found at: $targetFile"
    }

    Write-Host "WARNING: Restoring will overwrite existing OfficeChat database tables with backup data!" -ForegroundColor Yellow
    Write-Host "Target backup: $targetFile" -ForegroundColor Cyan

    $pgState = docker inspect -f '{{.State.Running}}' officechat-postgres 2>$null
    if ($pgState -ne 'true') {
        throw "Cannot perform restore: 'officechat-postgres' container is not running."
    }

    $tempSql = Join-Path $BackupDir "temp_restore_$(Get-Date -Format 'yyyyMMddHHmmss').sql"
    if ($targetFile.EndsWith('.gz', [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "Decompressing archive..." -ForegroundColor Gray
        tar.exe -xzf $targetFile -C $BackupDir
        $unpacked = $targetFile.Substring(0, $targetFile.Length - 3)
        if (Test-Path $unpacked) {
            Move-Item -Path $unpacked -Destination $tempSql -Force
        }
    } else {
        Copy-Item -Path $targetFile -Destination $tempSql -Force
    }

    if (-not (Test-Path $tempSql)) {
        throw "Failed to prepare SQL script for restoration."
    }

    Write-Host "Restoring database schema and records..." -ForegroundColor Gray
    cmd.exe /c "type `"$tempSql`" | docker exec -i officechat-postgres sh -c ""PGPASSWORD=`"`$POSTGRES_PASSWORD`" psql -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`""""

    Remove-Item -Path $tempSql -Force -ErrorAction SilentlyContinue

    Write-Host "==> OfficeChat Database Restored Successfully!" -ForegroundColor Green
}

function Invoke-OfficeChatList {
    Write-Host "==> Available OfficeChat Backups in ${BackupDir}:" -ForegroundColor Cyan
    $backups = Get-ChildItem -Path $BackupDir -File | Sort-Object CreationTime -Descending
    if ($backups.Count -eq 0) {
        Write-Host "    (No backups found yet. Run with -Action backup to create one.)" -ForegroundColor Yellow
        return
    }

    foreach ($b in $backups) {
        $sizeKb = [Math]::Round($b.Length / 1KB, 1)
        Write-Host "    $($b.Name) - $sizeKb KB ($($b.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')))" -ForegroundColor Gray
    }
}

switch ($Action) {
    'backup'  { Invoke-OfficeChatBackup }
    'restore' { Invoke-OfficeChatRestore -targetFile $BackupFile }
    'list'    { Invoke-OfficeChatList }
}
