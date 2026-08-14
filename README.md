# Sardrop

Sardrop is a private, self-hosted media uploader for `upload.sardistic.com`. Sign in once, paste or drop an image, video, or audio file and get a clean randomized URL such as:

```text
https://upload.sardistic.com/silver-ember-k7mx2q.png
```

The owner dashboard provides a searchable upload library with direct-link copying, downloads, titles, local OCR tags/text, persistent view counts, three visibility levels, and permanent deletion:

- **Public** — accessible by direct URL and displayed on the anonymous splash-page gallery.
- **Link only** — accessible to anyone with the randomized URL but never included in the public gallery. This is the default for new uploads.
- **Private** — available only through the authenticated dashboard; its direct URL returns `404`.

Direct file GET requests increment the view count. Audio and video responses support byte ranges so browser playback and seeking work without reading the whole file. Owner and public-index previews use dedicated routes and do not inflate views.

Local OCR is enabled by default for new uploads. Tesseract.js and its English model are served by this app, run in the owner's browser, and process one downscaled image at a time. Extracted text and tags are saved as owner-only metadata and are never included in the anonymous public API. Generic screenshot filenames can be replaced with a high-confidence first line; manually edited titles are never overwritten by later scans.

After tags exist, the owner can optionally create a second readable URL derived from up to three tags plus a short collision-resistant suffix. The original randomized URL remains unchanged. The tag URL follows the same visibility and view-count rules and can be revoked independently without deleting the file.

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
| `DATA_DIR` | no | `./data` | Persistent metadata and media directory |
| `MAX_UPLOAD_MB` | no | `50` | Per-file limit, from 1–100 MB |
| `SESSION_DAYS` | no | `30` | Owner session lifetime |

Never commit the real `.env`. Back up the complete data directory; media files and `metadata.json` are both required for a full restore. Metadata versions 1–4 migrate automatically to version 5: existing uploads are preserved as images while media type and duration fields are initialized safely.

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

Supported uploads are PNG, JPEG, GIF, WebP, AVIF, MP4, MOV, WebM, MP3, M4A, OGG, WAV, and FLAC. File signatures are checked server-side; SVG, executable formats, and arbitrary renamed files are rejected. Local OCR remains image-only; titles, manual tags, tag URLs, privacy controls, deletion, and view counts apply to every media type.
