# Sardrop

Sardrop is a private, self-hosted image uploader for `upload.sardistic.com`. Sign in once, paste or drop an image, and get a clean randomized URL such as:

```text
https://upload.sardistic.com/silver-ember-k7mx2q.png
```

The owner dashboard provides a searchable upload library with direct-link copying, downloads, titles, local OCR tags/text, persistent view counts, three visibility levels, and permanent deletion:

- **Public** — accessible by direct URL and displayed on the anonymous splash-page gallery.
- **Link only** — accessible to anyone with the randomized URL but never included in the public gallery. This is the default for new uploads.
- **Private** — available only through the authenticated dashboard; its direct URL returns `404`.

Direct image GET requests increment the view count. Owner and public-gallery thumbnails use dedicated preview routes and do not inflate it.

Local OCR is enabled by default for new uploads. Tesseract.js and its English model are served by this app, run in the owner's browser, and process one downscaled image at a time. Extracted text and tags are saved as owner-only metadata and are never included in the anonymous public API. Generic screenshot filenames can be replaced with a high-confidence first line; manually edited titles are never overwritten by later scans.

After tags exist, the owner can optionally create a second readable URL derived from up to three tags plus a short collision-resistant suffix. The original randomized URL remains unchanged. The tag URL follows the same visibility and view-count rules and can be revoked independently without deleting the image.

## Run locally

Sardrop requires Node.js 20 or newer. Install the pinned browser OCR assets before starting it:

```powershell
npm ci
$env:APP_PASSWORD = "a-long-owner-password"
$env:SESSION_SECRET = "at-least-32-random-characters-go-here"
npm start
```

Open `http://localhost:3000`. Upload files and metadata are written beneath `./data` by default.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_PASSWORD` | yes | — | Password for the owner dashboard |
| `SESSION_SECRET` | yes | — | At least 32 characters; signs login cookies |
| `BASE_URL` | no | `http://localhost:3000` | Canonical origin used for direct links |
| `PORT` | no | `3000` | HTTP listener port |
| `DATA_DIR` | no | `./data` | Persistent metadata and image directory |
| `MAX_UPLOAD_MB` | no | `25` | Per-image limit, from 1–100 MB |
| `SESSION_DAYS` | no | `30` | Owner session lifetime |

Never commit the real `.env`. Back up the complete data directory; image files and `metadata.json` are both required for a full restore. Metadata versions 1–3 migrate automatically to version 4: legacy visibility, views, and OCR data are preserved while the optional tag-URL field is initialized safely.

## Docker

Copy `.env.example` to `.env`, set strong secret values, ensure the external `edge` network exists, then run:

```sh
docker compose up -d --build
```

The Compose service intentionally publishes no host port. It joins the existing edge network as `sard-upload` for the reverse tunnel to reach port `3000`.

## Validation

```sh
npm run check
npm test
docker build -t sardrop:local .
```

Supported uploads are PNG, JPEG, GIF, WebP, and AVIF. File signatures are checked server-side; SVG and arbitrary renamed files are rejected.
