# Builds a signed release and publishes it to GitHub, including the latest.json the
# in-app updater reads.  Usage:  .\scripts\release.ps1 1.0.1 "What changed"
# The updater signing key lives outside the repo, in %USERPROFILE%\.tauri\poemotes.key.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = ""
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$key = "$env:USERPROFILE\.tauri\poemotes.key"
if (-not (Test-Path $key)) { throw "Signing key not found at $key" }

# bump the version everywhere it lives
(Get-Content src-tauri\tauri.conf.json -Raw) -replace '(?m)^  "version": ".*?"', "  `"version`": `"$Version`"" | Set-Content src-tauri\tauri.conf.json -Encoding ascii -NoNewline
(Get-Content src-tauri\Cargo.toml -Raw) -replace '(?m)^version = ".*"', "version = `"$Version`"" | Set-Content src-tauri\Cargo.toml -Encoding ascii -NoNewline
npm pkg set version=$Version | Out-Null

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$nsis = "src-tauri\target\release\bundle\nsis"
$setup = "PoEmotes_${Version}_x64-setup.exe"
$out = "dist-release"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item "$nsis\$setup" $out -Force
Copy-Item "src-tauri\target\release\poemotes.exe" "$out\PoEmotes-portable.exe" -Force

$latest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{
            signature = (Get-Content -Raw "$nsis\$setup.sig").Trim()
            url       = "https://github.com/zombodotcom/PoEmotes/releases/download/v$Version/$setup"
        }
    }
}
$latest | ConvertTo-Json -Depth 5 | Set-Content "$out\latest.json" -Encoding ascii

git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "Release v$Version" }
git push

gh release create "v$Version" "$out\$setup" "$out\PoEmotes-portable.exe" "$out\latest.json" `
    --title "PoEmotes $Version" --notes $(if ($Notes) { $Notes } else { "PoEmotes $Version" })
