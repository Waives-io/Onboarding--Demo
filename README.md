# Onboarding-Demo

Interactive Hebrew demo for accounting-office document collection, created for Waives.

Includes office and client views, fictional clients, simulated document submission, review, correction requests, and reminders.

Demo only: no files are uploaded, no messages are sent, no external business systems are connected. State resets on page refresh.

## Document intake pilot

`upload.html` is a separate test-only form. It accepts one PDF/JPG/PNG file per submission (up to 4 MiB) and requires a privately supplied invitation code. The public GitHub Pages configuration in `upload-config.js` stays disabled until the API is deployed.

The API in `worker/intake.mjs` validates the form and file, checks the invitation code stored in Cloudflare Worker secrets, then forwards the file to Make. Make writes the file to Google Drive, updates the `Submissions` sheet and returns a receipt only after both steps succeed. The Make webhook URL and invitation code must never be committed to this repository.

To activate the pilot, deploy the Worker with `npx wrangler deploy` in a Cloudflare account. Set `MAKE_WEBHOOK_URL` and a private random `INTAKE_DEMO_CODE` (at least 24 characters) as Worker secrets, never as `vars` or committed files. Set `intakeUrl` in `upload-config.js` to `https://<worker>.<account>.workers.dev/api/intake`, enable the form, and activate the Make scenario. The GitHub Pages site remains the user-facing demo. Test with synthetic documents only. Cloudflare Workers Free currently includes 100,000 requests/day and 10 ms CPU per invocation; measure this flow with sample uploads before relying on the 4 MiB maximum.

Open index.html locally or use GitHub Pages.

