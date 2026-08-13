# Sardrop

Sardrop is a private, self-hosted image uploader for `upload.sardistic.com`. Sign in once, paste or drop an image, and get a clean randomized URL such as:

```text
https://upload.sardistic.com/silver-ember-k7mx2q.png
```

The owner dashboard provides a searchable upload library with direct-link copying, downloads, titles, public/private switching, and permanent deletion. A private image returns `404` at its direct URL and is only available through the authenticated dashboard.

## Run locally

Sardrop has no runtime package dependencies and requires Node.js 20 or newer.

```powershell
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

Never commit the real `.env`. Back up the complete data directory; image files and `metadata.json` are both required for a full restore.

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
