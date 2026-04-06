param(
    [string]$PalworldRoot = "C:\Program Files (x86)\Steam\steamapps\common\Palworld"
)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceOutput = Join-Path $PalworldRoot "Tools\PalworldBreedingExtract\output"
$targetData = Join-Path $projectRoot "data"

$requiredPaths = @(
    (Join-Path $sourceOutput "palworld-breeding-data.json"),
    (Join-Path $sourceOutput "pal-icons"),
    (Join-Path $sourceOutput "pal-icons-thumb")
)

foreach ($path in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required extractor output was not found: $path"
    }
}

if (-not (Test-Path -LiteralPath $targetData)) {
    New-Item -ItemType Directory -Path $targetData | Out-Null
}

$replaceTargets = @(
    (Join-Path $targetData "palworld-breeding-data.json"),
    (Join-Path $targetData "pal-icons"),
    (Join-Path $targetData "pal-icons-thumb")
)

foreach ($path in $replaceTargets) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}

Copy-Item -LiteralPath (Join-Path $sourceOutput "palworld-breeding-data.json") -Destination $targetData
Copy-Item -LiteralPath (Join-Path $sourceOutput "pal-icons") -Destination $targetData -Recurse
Copy-Item -LiteralPath (Join-Path $sourceOutput "pal-icons-thumb") -Destination $targetData -Recurse

Write-Host "Copied latest breeding data into $targetData" -ForegroundColor Green
