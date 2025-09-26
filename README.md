# RateMyGaucho (Chrome Extension)

RateMyGaucho enhances UCSB GOLD by showing professor ratings inline on course result pages. It reads a packaged CSV dataset locally (no scraping, no external API calls) and links to UCSB Plat for profiles and curriculum browsing.

 **Demo Video**: https://drive.google.com/file/d/1bIbBjEgG5T8S7LqekHbqtfktfHyuWeSi/view?usp=sharing

## Features

### Enhanced Rating Display
- **Precise Gaucho Star Ratings**: Uses custom gaucho.png images with tenths-based partial fills
- **Dramatic Visual Contrast**: Bright, vibrant filled stars vs. dark, muted empty portions
- **Large 32px Star Images**: Prominent, easy-to-read rating indicators
- **Inline Rating Cards**: Compact cards showing rating badge, stars, review count, and UCSB Plat link

### Smart Professor Matching
- **Advanced Name Recognition**: Handles multiple name formats (LAST F, First Last, LAST, F, etc.)
- **Flexible Matching Algorithm**: Matches page names like "CHILDRESS A" with CSV entries like "James,Childress"
- **Comprehensive Detection**: Finds instructor names across various page layouts
- **Debug Logging**: Console logs for troubleshooting matching issues

### Data Integration
- **Dual CSV Sources**: Uses `scores.csv` for professor ratings and `ucsb_courses_final_corrected.csv` for course metadata
- **Local Data Processing**: Fast, privacy-preserving local CSV lookup (no network requests)
- **UCSB Plat Integration**: Direct links to professor profiles and curriculum pages
- **Course Metadata**: Shows grading basis, enrollment trends, grade distributions, and recent reviews
- **Real-time Updates**: Automatically detects and processes new course listings

### User Interface
- **UCSB-Themed Design**: Clean, modern cards with UCSB color scheme
- **Responsive Layout**: Cards adapt to different screen sizes and content
- **Compact Display**: Shows essential information without cluttering the page
- **Row-Aligned Cards**: Cards align perfectly with course information rows

## Installation

### For Users
1. Download the latest release from the [Releases page](https://github.com/itsloganmann/RateMyGaucho/releases)
2. Extract the ZIP file
3. Open Chrome and navigate to `chrome://extensions`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked" and select the extracted folder
6. Visit UCSB GOLD course search pages to see the extension in action

### For Developers
1. Clone the repository:
   ```bash
   git clone https://github.com/itsloganmann/RateMyGaucho.git
   cd RateMyGaucho
   ```

2. Load the extension in Chrome:
   - Navigate to `chrome://extensions`
   - Enable Developer Mode
   - Click "Load Unpacked" and select the repo root

3. Make changes to files in `content/` and update `scores.csv` as needed

4. Refresh the extension after making changes

## Building Distribution Package

The repository includes scripts to create a distributable ZIP file:

### Windows (PowerShell)
```powershell
./scripts/package.ps1
```

### macOS/Linux
```bash
bash ./scripts/package.sh
```

The archive will be created at `dist/RateMyGaucho.zip`, excluding development files.

## File Structure

```
RateMyGaucho/
├── manifest.json                        # MV3 extension manifest
├── content/
│   ├── papaparse.min.js                # CSV parsing library
│   ├── content.js                      # Main content script with matching logic
│   └── styles.css                      # Card styling and star animations
├── scores.csv                          # Professor ratings and UCSB Plat links
├── ucsb_courses_final_corrected.csv    # Course metadata and trends
├── gaucho.png                          # Gaucho image for star ratings
├── icons/                              # Extension icons (16px, 48px, 128px)
├── scripts/                            # Build and packaging scripts
└── README.md                           # This file
```

## Data Format

### Professor Ratings (`scores.csv`)
- `department`: Professor's department
- `first_name`: Professor's first name
- `last_name`: Professor's last name
- `rmp_score`: Rate My Professor score (0.0-5.0)
- `num_reviews`: Number of reviews
- `profile_url`: UCSB Plat profile URL

### Course Metadata (`ucsb_courses_final_corrected.csv`)
- `course_name`: Course code (e.g., "PSTAT 596", "ITAL 1")
- `course_url`: UCSB Plat curriculum page URL
- `grading_basis`: Grading method (e.g., "Letter Grade", "Pass/No Pass")
- `grading_trend`: Array of recent grade distributions as JSON strings
- `enrollment_trend`: Array of recent enrollment numbers as JSON
- `recent_reviews`: Array of recent student review snippets as JSON

## Star Rating System

The extension uses a sophisticated star rating system:
- **5 Gaucho Images**: Each star is a 32px gaucho.png image
- **Precise Partial Fills**: Shows exact tenths of the score (e.g., 3.7 = 3 full stars + 70% of 4th star)
- **High Contrast**: Filled portions are bright and vibrant, empty portions are dark and muted
- **Visual Clarity**: Easy to distinguish between filled and empty portions

## Troubleshooting

### Stars Not Showing
- Check browser console for errors
- Verify `gaucho.png` is accessible
- Ensure extension is loaded and enabled

### Professors Not Matching
- Check console logs for matching attempts
- Verify professor names in CSV match page format
- Look for debug output showing candidate names and keys

### Cards Not Appearing
- Ensure you're on a UCSB GOLD course search page
- Check that the page contains course listings with instructor names
- Verify the extension is active and has proper permissions

### Course Metadata Not Showing
- Check browser console for CSV loading errors
- Ensure course code extraction is working (look for "Course matched" in console)
- Verify `ucsb_courses_final_corrected.csv` is accessible and properly formatted
- Course codes must match exactly (e.g., "PSTAT 596" vs "PSTAT596")

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on UCSB GOLD pages
5. Submit a pull request

## License

MIT © 2025

## Acknowledgments

- UCSB Plat for providing professor profile data
- UCSB community for feedback and testing

[Privacy Policy](https://itsloganmann.github.io/RateMyGaucho/privacy.html)
