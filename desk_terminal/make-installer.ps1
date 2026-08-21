# Packages build-msvc\ into dist\VxnessTerminal-Setup.exe, signs it when a
# certificate is configured, and prints what to publish.
#
#   powershell -ExecutionPolicy Bypass -File build-msvc.ps1      # build first
#   powershell -ExecutionPolicy Bypass -File make-installer.ps1  # then this
#
# Signing is driven by the same environment variables sign.ps1 documents. With a
# certificate present the SETUP, the terminal.exe inside it and the uninstaller
# are all signed; without one everything still builds, unsigned.
$ErrorActionPreference = "Stop"

$src   = $PSScriptRoot
$build = Join-Path $src "build-msvc"
$iss   = Join-Path $src "installer.iss"
$out   = Join-Path $src "dist\VxnessTerminal-Setup.exe"

if (-not (Test-Path (Join-Path $build "terminal.exe"))) {
    throw "build-msvc\terminal.exe not found. Run build-msvc.ps1 first."
}

$iscc = $env:VXNESS_ISCC
if (-not $iscc -or -not (Test-Path $iscc)) {
    $iscc = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw "ISCC.exe not found. Install Inno Setup 6, or set VXNESS_ISCC." }

# terminal.exe is signed BEFORE it is packaged: the signature has to travel into
# the installer, or the file on the trader's disk is the unsigned one and
# SmartScreen judges it every launch.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src "sign.ps1") (Join-Path $build "terminal.exe")
if ($LASTEXITCODE -ne 0) { throw "signing terminal.exe failed" }

$signing = $env:VXNESS_SIGN_THUMBPRINT -or $env:VXNESS_SIGN_PFX
$args = @()
if ($signing) {
    # Inno signs the uninstaller itself - it is generated during the install and
    # cannot be signed from out here. The named tool is handed to ISCC on the
    # command line; installer.iss only asks for it when SIGN is defined, so an
    # unsigned build does not fail on a missing tool.
    $signps1 = Join-Path $src "sign.ps1"
    $args += "/DSIGN"
    $args += "/Ssigntool=powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$signps1`" `$f"
}

Write-Host "==> Compiling the installer..." -ForegroundColor Cyan
& $iscc @args $iss
if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }

# The setup itself, last: it did not exist until ISCC ran.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src "sign.ps1") $out
if ($LASTEXITCODE -ne 0) { throw "signing the installer failed" }

$f = Get-Item $out
$hash = (Get-FileHash $out -Algorithm SHA256).Hash
$sig = (Get-AuthenticodeSignature $out).Status

Write-Host ""
Write-Host "==> Ready to publish" -ForegroundColor Green
Write-Host "    file   : $($f.FullName)"
Write-Host "    size   : $($f.Length) bytes"
Write-Host "    sha256 : $hash"
Write-Host "    signed : $sig"
Write-Host ""
Write-Host "    Upload it as /var/www/vxness-downloads/VxnessTerminal-Setup.exe on the"
Write-Host "    VPS, and bump the ?v= on WINDOWS_URL in"
Write-Host "    frontend/src/website/src/components/desktop-terminal-download.jsx -"
Write-Host "    nginx sends a four-hour Cache-Control on /downloads/ and Cloudflare"
Write-Host "    honours it, so without a new ?v= the CDN keeps serving the old build."
