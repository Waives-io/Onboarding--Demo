# Onboarding-Demo

Interactive Hebrew demo for accounting-office document collection, created for Waives.

Includes office and client views, fictional clients, simulated document submission, review, correction requests, and reminders.

Demo only: no files are uploaded, no messages are sent, no external business systems are connected. State resets on page refresh.

## Document intake pilot

`upload.html` is a separate test-only form. It accepts one PDF/JPG/PNG file per submission (up to 4 MiB) and requires a privately supplied invitation code. The public GitHub Pages configuration in `upload-config.js` stays disabled until the API is deployed.

The API in `worker/intake.mjs` validates the form and file, checks the invitation code stored in Cloudflare Worker secrets, then forwards the file to Make. Make writes the file to Google Drive, updates the `Submissions` sheet and returns a receipt only after both steps succeed. The Make webhook URL and invitation code must never be committed to this repository.

The pilot runs through the Worker in the contact@waives.io Cloudflare account. `MAKE_WEBHOOK_URL` and `INTAKE_DEMO_CODE` are Worker secrets, never `vars` or committed files. The public Worker URL is configured in `upload-config.js`, the form is enabled, and the Make scenario must remain active. The GitHub Pages site is the user-facing demo. Use synthetic documents only. Cloudflare Workers Free currently includes 100,000 requests/day and 10 ms CPU per invocation; measure this flow with sample uploads before relying on the 4 MiB maximum.

Open index.html locally or use GitHub Pages.

