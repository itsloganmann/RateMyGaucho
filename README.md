# RateMyGaucho (Chrome Extension)

RateMyGaucho enhances UCSB GOLD by showing professor ratings inline on course result pages. It reads a packaged CSV dataset locally (no scraping, no external API calls) and links to UCSB Plat for profiles and curriculum browsing.

## Features
- Inline cards with overall rating, review count, stars, and quick links
- Fast, privacy‑preserving local CSV lookup (no network requests)
- Robust instructor matching (supports multiple name formats)
- UCSB‑themed compact UI
- Links to UCSB Plat instructor and curriculum pages

## Development
1. Load the extension:
   - Chrome → `chrome://extensions` → Enable Developer Mode → Load Unpacked → select repo root
2. Edit files in `content/` and `data/` as needed. The CSV is bundled at `data/ucsb_professors_rmp.csv`.
3. Refresh the extension after making changes.

## Build a distributable zip
The repo ships a GitHub Action and local scripts to produce `RateMyGaucho.zip` excluding development files.

- Windows (PowerShell):
```powershell
./scripts/package.ps1
```
- macOS/Linux:
```bash
bash ./scripts/package.sh
```

The archive will be written to `dist/RateMyGaucho.zip`.

## File structure
- `manifest.json` – MV3 manifest
- `content/` – content script (`content.js`) and styles (`styles.css`)
- `data/` – packaged ratings CSV
- `icons/` – extension icons

## License
MIT © 2025

