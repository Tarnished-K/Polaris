param(
  [Parameter(Mandatory = $true)]
  [string]$Report,
  [string]$RepoRoot,
  [string]$FallbackModel = 'Fable5',
  [string]$OutputPath,
  [switch]$ResetSession
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent }
$roadmapPath = Join-Path $RepoRoot 'ROADMAP.md'
if (-not (Test-Path -LiteralPath $roadmapPath)) { throw "ROADMAP.md not found: $roadmapPath" }
$stateDirectory = Join-Path $RepoRoot '.agent-loop'
$sessionPath = Join-Path $stateDirectory 'claude-session-id.txt'
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $stateDirectory 'claude-next.md' }
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
if ($ResetSession -and (Test-Path -LiteralPath $sessionPath)) {
  Remove-Item -LiteralPath $sessionPath -Force
}

function Protect-ExternalText([string]$Text) {
  $safe = $Text
  $safe = [regex]::Replace($safe, '(?i)(api[_-]?key|secret|token|password|service[_-]?role)[^\r\n:=]*[:=][^\r\n]+', '$1=[REDACTED]')
  $safe = [regex]::Replace($safe, '(?i)eyJ[a-zA-Z0-9_\-\.]{20,}', '[JWT_REDACTED]')
  $safe = [regex]::Replace($safe, '(?i)sbp_[a-zA-Z0-9]{20,}', '[SUPABASE_KEY_REDACTED]')
  return $safe
}

$reportSafe = Protect-ExternalText $Report
$isNewSession = -not (Test-Path -LiteralPath $sessionPath)
if ($isNewSession) {
  $sessionId = [guid]::NewGuid().ToString()
  $prompt = @(
    'You are the project progress navigator and reviewer.',
    'First read ROADMAP.md and HANDOFF.md in the repository and understand completed work, remaining tasks, and dependencies.',
    'After each Codex completion report, provide the next concrete tasks. Multiple related tasks are allowed.',
    'Do not ask confirmation questions. Choose the safest highest-priority next step.',
    'Keep token usage low. Return only NEXT, DONE_WHEN, and CAUTION in concise Japanese.',
    'Do not edit code. Never request or repeat secrets.',
    '',
    'Initial Codex completion report:',
    '---',
    $reportSafe,
    '---'
  ) -join "`n"
} else {
  $sessionId = (Get-Content -LiteralPath $sessionPath -Raw -Encoding utf8).Trim()
  $prompt = @(
    'This is a new Codex completion report. Use the existing session context and ROADMAP, then return only the next instructions in concise Japanese.',
    '---',
    $reportSafe,
    '---'
  ) -join "`n"
}

function Invoke-Navigator([string]$Model, [bool]$NewSession, [string]$Id) {
  if ($NewSession) {
    $output = @(
      $prompt | & claude -p --session-id $Id --output-format text --model $Model `
        --max-budget-usd 0.15 --permission-mode dontAsk --tools 'Read,Grep,Glob' `
        --setting-sources project --disable-slash-commands
    )
  } else {
    $output = @(
      $prompt | & claude -p --resume $Id --output-format text --model $Model `
        --max-budget-usd 0.15 --permission-mode dontAsk --tools 'Read,Grep,Glob' `
        --setting-sources project --disable-slash-commands
    )
  }
  return [pscustomobject]@{
    ExitCode = $LASTEXITCODE
    Text = ($output -join "`n").Trim()
  }
}

$result = Invoke-Navigator -Model 'haiku' -NewSession $isNewSession -Id $sessionId
if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Text)) {
  if ($isNewSession) {
    $sessionId = [guid]::NewGuid().ToString()
  }
  $result = Invoke-Navigator -Model $FallbackModel -NewSession $isNewSession -Id $sessionId
}

if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Text)) {
  throw "Claude CLI and fallback model returned no actionable response."
}

[System.IO.File]::WriteAllText($OutputPath, $result.Text + [Environment]::NewLine, $utf8NoBom)
[System.IO.File]::WriteAllText($sessionPath, $sessionId + [Environment]::NewLine, $utf8NoBom)
Write-Output "Claude instruction saved: $OutputPath"
