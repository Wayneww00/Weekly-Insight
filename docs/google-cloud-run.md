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
export INSIGHT_AUTH_EMAIL='admin@vtg.com'
export INSIGHT_AUTH_PASSWORD='admin123456'
export SESSION_SECRET="$(openssl rand -base64 48)"

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
- The application requires authentication. `INSIGHT_AUTH_EMAIL` and `INSIGHT_AUTH_PASSWORD` configure the administrator account; bundled team accounts in `config/auth-users.json` are read-only and store only scrypt password hashes.
- Additional runtime users can be supplied with `INSIGHT_AUTH_USERS_JSON`, using a JSON array of `{ "email", "password", "role" }` objects. A random `SESSION_SECRET` is mandatory.
- For a long-lived production deployment, store administrator credentials, runtime users, and the session secret in Secret Manager rather than shell history.
