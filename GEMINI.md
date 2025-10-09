# GEMINI.md

## Project Overview

This project is a Chrome extension called **RateMyGaucho**. Its purpose is to enhance the UCSB GOLD course registration experience by displaying professor ratings directly on the course search pages. The extension is built with vanilla JavaScript and CSS, and it uses local CSV files for its data, meaning it works offline and does not make any external API calls, thus preserving user privacy.

The core technologies used are:

*   **JavaScript:** For the main extension logic, including data fetching, parsing, and DOM manipulation.
*   **CSS:** For styling the rating cards and creating the star rating display.
*   **CSV:** As the data format for storing professor and course information.
*   **Shell Scripting:** For the build and packaging process.

The architecture is a simple content-script-only model. The extension injects a content script into UCSB GOLD pages, which then fetches the necessary data from local CSV files and renders the rating cards on the page.

## Building and Running

### Running the Extension

To run the extension in a development environment, follow these steps:

1.  Clone the repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable "Developer mode" in the top right corner.
4.  Click "Load unpacked" and select the root directory of the project.

### Building the Extension

To create a distributable ZIP file of the extension, run the following command from the project root:

```bash
bash ./scripts/package.sh
```

This will create a `RateMyGaucho.zip` file in the `dist/` directory.

## Development Conventions

*   **Code Style:** The JavaScript code follows a functional programming style with a focus on asynchronous operations. The code is well-commented and includes debug logging for troubleshooting.
*   **Data Management:** The extension now relies on a single packaged dataset, `courses_final_enrollment.csv`, which contains both instructor and course information used throughout the UI.
*   **Testing:** The project includes a `REVIEWS_FIX_TEST.md` file, which suggests a manual testing process for bug fixes. There is no formal automated testing framework in place.
*   **Documentation:** The project is well-documented, with a detailed `README.md`, a technical specification in `SPEC_RateMyGaucho_Extension.md`, and a privacy policy in `privacy.md`.
