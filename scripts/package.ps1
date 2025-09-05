New-Item -ItemType Directory -Force -Path "$PSScriptRoot/../dist" | Out-Null
Remove-Item -ErrorAction SilentlyContinue "$PSScriptRoot/../dist/RateMyGaucho.zip"
Push-Location "$PSScriptRoot/.."
try {
  & zip -r "dist/RateMyGaucho.zip" . -x "*.git*" "dist/*" ".github/*" "**/*.ps1" "**/*.sh"
} finally {
  Pop-Location
}
Write-Host "Wrote dist/RateMyGaucho.zip"

