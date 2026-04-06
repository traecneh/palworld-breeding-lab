param(
    [int]$Port = 4174,
    [switch]$NoBrowser
)

$siteDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:$Port/"

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    throw "Python was not found on PATH. Install Python 3 or run another static file server from $siteDir."
}
$python = $pythonCommand.Source

Write-Host "Serving $siteDir" -ForegroundColor Cyan
Write-Host "Open $url" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the local server." -ForegroundColor DarkGray

$process = Start-Process `
    -FilePath $python `
    -ArgumentList "-m http.server $Port --bind 127.0.0.1 --directory `"$siteDir`"" `
    -WorkingDirectory $siteDir `
    -PassThru

try {
    $serverReady = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250

        if ($process.HasExited) {
            throw "The local server exited before it finished starting. The port may already be in use."
        }

        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 | Out-Null
            $serverReady = $true
            break
        }
        catch {
        }
    }

    if (-not $serverReady) {
        throw "The local server did not start listening on $url."
    }

    if (-not $NoBrowser) {
        Start-Process $url | Out-Null
    }

    while (-not $process.HasExited) {
        Start-Sleep -Seconds 1
    }
}
finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
}
