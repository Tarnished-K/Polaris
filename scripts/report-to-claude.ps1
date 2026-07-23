param(
  [Parameter(Mandatory = $true)]
  [string]$Report,
  [string]$RepoRoot,
  [string]$FallbackModel = 'Fabele5'
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent }
$roadmapPath = Join-Path $RepoRoot 'ROADMAP.md'
if (-not (Test-Path -LiteralPath $roadmapPath)) { throw "ROADMAP.md not found: $roadmapPath" }

function Protect-ExternalText([string]$Text) {
  $safe = $Text
  $safe = [regex]::Replace($safe, '(?i)(api[_-]?key|secret|token|password|service[_-]?role)[^\r\n:=]*[:=][^\r\n]+', '$1=[REDACTED]')
  $safe = [regex]::Replace($safe, '(?i)eyJ[a-zA-Z0-9_\-\.]{20,}', '[JWT_REDACTED]')
  $safe = [regex]::Replace($safe, '(?i)sbp_[a-zA-Z0-9]{20,}', '[SUPABASE_KEY_REDACTED]')
  return $safe
}

$roadmap = Protect-ExternalText (Get-Content -LiteralPath $roadmapPath -Raw -Encoding utf8)
$reportSafe = Protect-ExternalText $Report
$prompt = @(
  'You are the next-task navigator for the Polaris project. Follow these rules.',
  '- First understand ROADMAP.md and account for completed work, open work, and dependencies.',
  '- After receiving a Codex completion report, return the next concrete tasks; multiple concise tasks are allowed.',
  '- Do not ask the user questions or confirmation; choose the safest highest-priority next step and give actionable instructions.',
  '- Keep the response short to minimize token usage.',
  '- Never handle or repeat secrets, API keys, JWTs, passwords, or service-role keys.',
  '', 'ROADMAP.md:', '---', $roadmap, '---', '',
  'Codex completion report:', '---', $reportSafe, '---', '',
  'Return the next actionable instructions in Japanese.'
) -join "`n"

$primaryOutput = @($prompt | & claude -p --no-session-persistence --output-format text --model haiku --max-budget-usd 0.15)
$primaryExitCode = $LASTEXITCODE
$primaryText = ($primaryOutput -join "`n").Trim()

if ($primaryExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($primaryText)) {
  Write-Output $primaryText
  exit 0
}

# A usage-limit response can be empty or non-zero. Retry directly with the
# user-selected fallback model without printing the failed provider output.
$fallbackOutput = @($prompt | & claude -p --no-session-persistence --output-format text --model $FallbackModel --max-budget-usd 0.15)
$fallbackExitCode = $LASTEXITCODE
$fallbackText = ($fallbackOutput -join "`n").Trim()
if ($fallbackExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($fallbackText)) {
  throw "Claude CLI and fallback model returned no actionable response."
}
Write-Output $fallbackText
