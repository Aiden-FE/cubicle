<#
  Start-Cubicle.ps1 - the packaged launcher (ticket 13).

  NOTE ON ENCODING: this file must stay ASCII-only. Windows PowerShell 5.1
  reads BOM-less files as the ANSI codepage; UTF-8 Chinese comments decode as
  mojibake and can break the parser (ticket 13 e2e proved it the hard way).

  It mirrors scripts/sandbox-degrade.mjs (PowerShell cannot import ESM - the
  two copies must stay word-for-word equivalent, and e2e-13 runs THIS launcher
  for real to prove the mirror did not drift):

  this machine's security policy cannot bring up Electron's Chromium process
  sandbox - cubicle.exe exits with 0x80000003 (STATUS_BREAKPOINT, silent under
  the GUI subsystem) before any JS runs; 0xc0000005 (ACCESS_VIOLATION) is the
  same failure family. On that signature, retry exactly once with
  --no-sandbox (the app itself still runs renderers with contextIsolation +
  sandbox:true webPreferences).

  CUBICLE_LAUNCHER_EVIDENCE=<path> records the launch as one line of JSON.
#>
param(
  [string]$InstallDir = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  # App args (e2e switch etc.) are forwarded on BOTH attempts and never
  # suppress the degrade. Only user-passed electron flags (-ElectronFlags,
  # the CUBICLE_ELECTRON_ARGS analogue) do - same rule as start.mjs.
  [string[]]$AppArgs = @(),
  [string[]]$ElectronFlags = @()
)

$ErrorActionPreference = "Stop"
# M0 lesson: a stray ELECTRON_RUN_AS_NODE degrades the exe into plain Node.
# Strip it defensively so a double-click launch behaves the same as a clean one.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$exe = Join-Path $InstallDir "cubicle.exe"
if (-not (Test-Path $exe)) {
  Write-Error "cubicle.exe not found under $InstallDir"
  exit 1
}

# mirror of sandbox-degrade.mjs: 0x80000003 = signed -2147483645 / unsigned
# 2147483651; 0xc0000005 = signed -1073741819 / unsigned 3221225477.
function Test-SandboxCrash([int]$code) {
  return ($code -eq -2147483645) -or ($code -eq 2147483651) -or
         ($code -eq -1073741819) -or ($code -eq 3221225477)
}

function Write-Evidence($obj) {
  if ($env:CUBICLE_LAUNCHER_EVIDENCE) {
    # ASCII: PS 5.1's Set-Content -Encoding UTF8 adds a BOM that would break JSON.parse.
    ($obj | ConvertTo-Json -Compress) | Out-File -FilePath $env:CUBICLE_LAUNCHER_EVIDENCE -Encoding ascii
  }
}

function Invoke-Cubicle([string[]]$forwardArgs) {
  & $exe @forwardArgs | Out-Null
  return $LASTEXITCODE
}

# mirror of decideLaunchOutcome: attempt 0 + no user flags + sandbox signature
# -> retry once.
$degraded = $false
$finalCode = Invoke-Cubicle ($ElectronFlags + $AppArgs)

if ($ElectronFlags.Count -eq 0 -and (Test-SandboxCrash $finalCode)) {
  $degraded = $true
  Write-Host ""
  # NB: PS cannot cast a negative exit code to UInt32 directly; mask first.
  Write-Host ("cubicle.exe exited with 0x{0:X8} before the app started:" -f ($finalCode -band 0xFFFFFFFF))
  Write-Host "this machine's policy blocks the Chromium process sandbox."
  Write-Host "retrying once with --no-sandbox (renderer still uses sandbox:true)..."
  Write-Host ""
  $finalCode = Invoke-Cubicle (@("--no-sandbox") + $ElectronFlags + $AppArgs)
}

Write-Evidence @{
  exe = $exe
  sandboxCrash = $degraded
  finalExitCode = $finalCode
  at = (Get-Date).ToString("o")
}

exit $finalCode
