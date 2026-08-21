# Vercel + Worker Deployment Notes

## Production Shape

- Vercel hosts the static app and lightweight API routes.
- Vercel Blob stores original PPT/PDF files, converted PDFs, page images, and the MVP metadata JSON.
- A separate conversion worker runs on a machine with LibreOffice and Poppler installed.

## Required Vercel Environment Variables

- `BLOB_READ_WRITE_TOKEN`: Vercel Blob token.
- `WORKER_SECRET`: shared secret used by the worker API.
- `INSIGHT_AUTH_EMAIL`: login email; defaults to `admin@vtg.com` when omitted.
- `INSIGHT_AUTH_PASSWORD`: login password; defaults to `admin123456` when omitted.
- `INSIGHT_AUTH_USERS_JSON`: optional JSON array of additional runtime users. Bundled team accounts in `config/auth-users.json` are read-only and use scrypt password hashes.
- `SESSION_SECRET`: a random string of at least 32 characters, for example `openssl rand -base64 48`.

## Worker Environment Variables

- `APP_BASE_URL`: deployed Vercel app URL, for example `https://weekly-insight.vercel.app`.
- `BLOB_READ_WRITE_TOKEN`: same Blob token used by the Vercel project.
- `WORKER_SECRET`: same shared secret used by the Vercel project.
- `PREVIEW_DPI`: optional, defaults to `300`.
- `SOFFICE_PATH`: optional LibreOffice binary path.

## Run Worker

```bash
npm install
APP_BASE_URL=https://your-app.vercel.app \
BLOB_READ_WRITE_TOKEN=... \
WORKER_SECRET=... \
node worker/conversion-worker.js
```

The worker polls `/api/worker/claim`, downloads the original file from Blob, converts it, uploads previews to Blob, and marks the issue as published.

## Confidential content

The login session protects the Vercel API routes. However, this MVP's existing Vercel Blob implementation stores preview URLs as public objects so that browsers can render them directly. Do not use this deployment shape for confidential internal materials until the Blob assets are made private and served through an authenticated asset proxy. The Cloud Run deployment is the supported deployment shape for protected Insight Hub content.
