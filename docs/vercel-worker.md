# Vercel + Worker Deployment Notes

## Production Shape

- Vercel hosts the static app and lightweight API routes.
- Vercel Blob stores original PPT/PDF files, converted PDFs, page images, and the MVP metadata JSON.
- A separate conversion worker runs on a machine with LibreOffice and Poppler installed.

## Required Vercel Environment Variables

- `BLOB_READ_WRITE_TOKEN`: Vercel Blob token.
- `WORKER_SECRET`: shared secret used by the worker API.

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
