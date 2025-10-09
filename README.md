# RateMyGaucho (Chrome Extension)

RateMyGaucho enhances UCSB GOLD by showing professor ratings and course data directly on course result pages. It works offline and preserves your privacy by using a local dataset.

**Demo Video**: https://www.youtube.com/watch?v=Qlm13DpqkXA

## Novel Features

*   **Offline & Private**: Works without an internet connection and never sends your data to external servers. All data lives in a single packaged CSV (`courses_final_enrollment.csv`).
*   **Gaucho-Themed Ratings**: Displays professor ratings with custom, partially-filled Gaucho star icons for at-a-glance assessments.
*   **In-Depth Course Data**: Goes beyond professor ratings to show course-specific details like grading trends, enrollment history, and recent student reviews.
*   **Visual Summaries**: Inline bar charts translate grade distributions and historic enrollment snapshots into easy-to-interpret visuals.
*   **Smart Review Filtering**: Intelligently filters reviews to show only those relevant to the specific instructor, providing more accurate insights.
*   **UCSB Plat Integration**: Provides direct links to professor profiles and curriculum pages on UCSB Plat.

## Installation

1.  Download the latest release from the [Releases page](https://github.com/itsloganmann/RateMyGaucho/releases).
2.  Extract the ZIP file.
3.  Open Chrome, go to `chrome://extensions`, and enable "Developer mode".
4.  Click "Load unpacked" and select the extracted folder.

## Building

To create a distributable ZIP file, run the appropriate script for your OS:
*   **Windows**: `./scripts/package.ps1`
*   **macOS/Linux**: `bash ./scripts/package.sh`

The build script bundles the unified dataset and content script into `dist/RateMyGaucho.zip`, which is ready to upload to the Chrome Web Store.

## Data Source

The extension ships with `courses_final_enrollment.csv` as its only data source. Every rating, review, and course record comes from this file, ensuring consistent results across the UI. When updating data, replace this CSV and rebuild the package.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.

## License

MIT © 2025
