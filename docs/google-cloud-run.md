# Google Cloud Run Deployment

## Architecture

- Cloud Run hosts the app and API.
- Cloud Storage stores original files, generated PDFs, page images, and MVP metadata.
- The Cloud Run container includes LibreOffice and Poppler, so PPT/PPTX/PDF conversion runs inside Google Cloud.

## Default Project

- Project ID: `project-e231c77e-076f-46db-acb`
- Default region: `asia-southeast1`
- Service name: `weekly-insight`

## Deploy

```bash
PROJECT_ID=project-e231c77e-076f-46db-acb \
REGION=asia-southeast1 \
SERVICE_NAME=weekly-insight \
./scripts/deploy-google-cloud.sh
```

The script creates a Cloud Storage bucket if needed and deploys the container to Cloud Run.

## Notes

- `--concurrency=1` and `--max-instances=1` keep the MVP JSON metadata store safe from concurrent writes.
- `--no-cpu-throttling` keeps CPU available after the upload response returns, so the background LibreOffice/Poppler conversion can finish reliably.
- `CONVERSION_TIMEOUT_MS=900000` gives large PPT/PDF files up to 15 minutes to convert and render page previews.
- For heavier team usage, replace the JSON metadata file with Firestore or Cloud SQL.
