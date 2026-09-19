# Onboarding-Demo

Interactive Hebrew demo for accounting-office document collection, created for Waives.

Includes office and client views, fictional clients, simulated document submission, review, correction requests, and reminders.

Demo only: no files are uploaded, no messages are sent, no external business systems are connected. State resets on page refresh.

## Document intake pilot

`upload.html` is a separate test-only form. It accepts one PDF/JPG/PNG file per submission (up to 4 MiB) and requires a privately supplied invitation code. The public GitHub Pages configuration in `upload-config.js` stays disabled until the API is deployed.

The API in `netlify/functions/intake.mts` validates the form and file, checks the invitation code stored in Netlify environment variables, then forwards the file to Make. Make writes the file to Google Drive, updates the `Submissions` sheet and returns a receipt only after both steps succeed. The Make webhook URL and invitation code must never be committed to this repository.

To activate the pilot, create a separate Netlify project for this repository (the existing GitHub Pages site remains the user-facing demo), set `MAKE_WEBHOOK_URL` and `INTAKE_DEMO_CODE` as secret environment variables available to functions, deploy it, set `intakeUrl` in `upload-config.js` to the project's `/api/intake` URL, and enable the form. The Make scenario also needs to be active. Test with synthetic documents only.

Open index.html locally or use GitHub Pages.

