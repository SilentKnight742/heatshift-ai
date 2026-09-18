param()

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $ProjectDir ".venv"
$EnvFile = Join-Path $ProjectDir ".env"
$BackendDir = Join-Path $ProjectDir "backend"
$FrontendDir = Join-Path $ProjectDir "frontend"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "HeatShift needs Python 3.13, but python was not found on PATH."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "HeatShift needs Node.js and npm, but npm was not found on PATH."
}

if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $ProjectDir ".env.example") $EnvFile
    Write-Host "Created .env from .env.example. The app can run in simulated fallback mode without provider keys."
}

Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key -match '^[A-Za-z_][A-Za-z0-9_]*$') {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating the isolated Python environment..."
    & python -m venv $VenvDir
}

Write-Host "Preparing backend dependencies..."
& $VenvPython -m pip install --disable-pip-version-check -q -r (Join-Path $BackendDir "requirements.txt")

$NextBinary = Join-Path $FrontendDir "node_modules\.bin\next.cmd"
if (-not (Test-Path $NextBinary)) {
    Write-Host "Preparing frontend dependencies..."
    Push-Location $FrontendDir
    try { & npm.cmd ci } finally { Pop-Location }
}

Write-Host "Starting HeatShift..."
Write-Host "  Product: http://127.0.0.1:3000"
Write-Host "  API:     http://127.0.0.1:8000"
Write-Host "Press Ctrl+C to stop both services."

$backend = $null
$frontend = $null
try {
    $backend = Start-Process -FilePath $VenvPython -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload", "--env-file", $EnvFile) -WorkingDirectory $BackendDir -NoNewWindow -PassThru
    $frontend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "--", "--hostname", "127.0.0.1") -WorkingDirectory $FrontendDir -NoNewWindow -PassThru
    while (-not $backend.HasExited -and -not $frontend.HasExited) {
        Start-Sleep -Seconds 1
        $backend.Refresh()
        $frontend.Refresh()
    }
    if ($backend.HasExited -and $backend.ExitCode -ne 0) { exit $backend.ExitCode }
    if ($frontend.HasExited -and $frontend.ExitCode -ne 0) { exit $frontend.ExitCode }
}
finally {
    foreach ($process in @($backend, $frontend)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
