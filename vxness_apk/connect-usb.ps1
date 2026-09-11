# Connect a USB-attached phone to the local dev servers.
#
# Why this exists: ngrok's tunnel endpoint (connect.ngrok-agent.com) is blocked
# on this network, so `expo start --tunnel` can never connect, and the Wi-Fi
# profile is Public, so Windows Firewall drops the phone's inbound connections
# to Metro and the API. USB sidesteps both — adb forwards the phone's own
# localhost to this machine, so no network path is involved at all.
#
# Run this AFTER plugging the phone in with USB debugging enabled.

$ErrorActionPreference = 'Stop'

Write-Host "Checking for a connected device..." -ForegroundColor Cyan
$devices = (adb devices | Select-String -Pattern "\tdevice$")
if (-not $devices) {
    Write-Host "No device found." -ForegroundColor Red
    Write-Host "  1. Plug the phone in over USB."
    Write-Host "  2. On the phone: Settings > Developer options > USB debugging = ON."
    Write-Host "  3. Accept the 'Allow USB debugging?' prompt on the phone."
    Write-Host "  Then run this again."
    exit 1
}
Write-Host "Device found." -ForegroundColor Green

# 8081 = Metro (the JS bundle), 5000 = the local Vxness backend.
adb reverse tcp:8081 tcp:8081 | Out-Null
adb reverse tcp:5000 tcp:5000 | Out-Null

Write-Host ""
Write-Host "Ports forwarded:" -ForegroundColor Green
adb reverse --list
Write-Host ""
Write-Host "Now:" -ForegroundColor Cyan
Write-Host "  1. npx expo start        (plain, no --tunnel)"
Write-Host "  2. Open Expo Go on the phone"
Write-Host "  3. Enter this URL by hand:  exp://127.0.0.1:8081"
