# Authenticode-signs the files it is given, if this machine has been given a
# certificate to sign with. Without one it prints why and returns cleanly, so an
# ordinary developer build still works - signing is a release step, not a
# prerequisite for compiling.
#
# WHY THIS EXISTS: Chrome refuses an unsigned installer outright ("Unverified
# download blocked"), and Windows SmartScreen shows "Windows protected your PC"
# with an Unknown publisher. Both judge the SIGNATURE, not the file: a signed
# binary from a known publisher is trusted immediately, an unsigned one has to
# earn reputation download by download and a fresh build starts at zero every
# release. A self-signed certificate does not help - nothing trusts it.
#
# Usage:
#   powershell -File sign.ps1 build-msvc\terminal.exe dist\VxnessTerminal-Setup.exe
#
# Configure ONE of these, on the release machine only:
#
#   $env:VXNESS_SIGN_THUMBPRINT = "AB12...CD"   # cert in the Windows store.
#                                               # This is the form a hardware
#                                               # token or a cloud HSM presents
#                                               # (Sectigo/DigiCert/SSL.com all
#                                               # install a store certificate
#                                               # backed by their provider), and
#                                               # since 2023 a code-signing key
#                                               # may not sit on disk, so this is
#                                               # normally the one to use.
#
#   $env:VXNESS_SIGN_PFX  = "C:\path\cert.pfx"  # legacy file-based cert
#   $env:VXNESS_SIGN_PASS = "..."                 # its password
#
# Optional:
#   $env:VXNESS_SIGN_TIMESTAMP = "http://timestamp.digicert.com"
#   $env:VXNESS_SIGNTOOL       = "C:\...\x64\signtool.exe"
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)

$ErrorActionPreference = "Stop"

if (-not $Files -or $Files.Count -eq 0) { throw "sign.ps1: no files given" }

$thumb = $env:VXNESS_SIGN_THUMBPRINT
$pfx   = $env:VXNESS_SIGN_PFX
if (-not $thumb -and -not $pfx) {
    Write-Host "==> Not signing: no certificate configured (VXNESS_SIGN_THUMBPRINT or VXNESS_SIGN_PFX)." -ForegroundColor Yellow
    Write-Host "    The build is fine; the download will carry a browser warning until a certificate is set." -ForegroundColor DarkGray
    exit 0
}

# The x64 signtool specifically. The SDK ships arm, arm64, x86 and x64 copies in
# sibling directories and Get-ChildItem finds the arm one first, which cannot run
# here.
$signtool = $env:VXNESS_SIGNTOOL
if (-not $signtool -or -not (Test-Path $signtool)) {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match "\\x64\\" } |
                Sort-Object FullName -Descending |
                Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) { throw "signtool.exe not found. Install the Windows SDK, or set VXNESS_SIGNTOOL." }

# Timestamping is not optional. Without it every signature dies the day the
# certificate expires, and installers already in the wild start warning again.
$ts = $env:VXNESS_SIGN_TIMESTAMP
if (-not $ts) { $ts = "http://timestamp.digicert.com" }

foreach ($f in $Files) {
    if (-not (Test-Path $f)) { throw "sign.ps1: $f does not exist" }
    $full = (Resolve-Path $f).Path
    Write-Host "==> Signing $([System.IO.Path]::GetFileName($full))" -ForegroundColor Cyan

    $args = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $ts, "/d", "Vxness Terminal", "/v")
    if ($thumb) { $args += @("/sha1", $thumb) }
    else        { $args += @("/f", $pfx); if ($env:VXNESS_SIGN_PASS) { $args += @("/p", $env:VXNESS_SIGN_PASS) } }
    $args += $full

    & $signtool @args
    if ($LASTEXITCODE -ne 0) { throw "signtool failed on $full (exit $LASTEXITCODE)" }

    $sig = Get-AuthenticodeSignature $full
    if ($sig.Status -ne "Valid") { throw "signature on $full is $($sig.Status)" }
    Write-Host "    signed by $($sig.SignerCertificate.Subject)" -ForegroundColor Green
}
