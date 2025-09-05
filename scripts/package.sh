#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/RateMyGaucho.zip
zip -r dist/RateMyGaucho.zip . \
  -x "*.git*" \
     "dist/*" \
     ".github/*" \
     "**/*.ps1" \
     "**/*.sh"
echo "Wrote dist/RateMyGaucho.zip"

