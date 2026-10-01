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

## YouTube playlist import

Pasting a YouTube playlist URL into the signed-in workbench opens an offer rather than starting anything: the dialog names the playlist, lists its tracks, and asks for the visibility to apply before any download begins. Accepting it runs `yt-dlp` and `ffmpeg` on the server, one track at a time, and stores each result as an ordinary MP3 upload with its own randomized URL, title, and duration.

Only one import runs at a time and it can be stopped mid-flight. A track that fails is reported individually and does not abort the rest of the list. Progress lives in memory only, so a restart ends an import without affecting the uploads it already saved. Pasting a media file still uploads that file; the offer appears only for text that resolves to a real playlist.

Watch Later (`WL`) and Liked videos (`LL`) are rejected because they need the viewer's own credentials. The pasted text is never passed to a subprocess: the playlist and video identifiers are validated against a strict character set and the URLs handed to `yt-dlp` are rebuilt from those identifiers.

Downloading from YouTube is governed by YouTube's terms of service and by the copyright in each track. This tool does not check either; that judgement stays with the operator.

## Install on mobile or desktop

Choose **Install app** in the public index or owner archive. Chrome on Android and supported desktop browsers open their native install prompt when available; otherwise the button shows browser-specific instructions. In current Android Chrome, scroll down the **⋮** menu and choose **Install and create shortcut → Install**; older versions call it **Install app** or **Add to Home screen**. On iPhone or iPad, use Safari’s **Share → Add to Home Screen**. On Mac, Safari also offers **File → Add to Dock**.

The installed app opens in its own window and uses the same owner authentication and visibility rules. Browsing and uploads require an internet connection. Serve over HTTPS for production installation; localhost works for development. Chrome may wait for a tap and some time on the page before offering its native prompt.

## Run locally

Sardrop requires Node.js 20 or newer. Playlist import additionally needs `yt-dlp` and `ffmpeg` on `PATH`; without them the rest of the app runs normally and the feature is simply not offered. Install the pinned browser OCR assets before starting it:

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
| `PLAYLIST_IMPORT` | no | `on` | Set to `off` to remove the playlist import entirely |
| `PLAYLIST_MAX_TRACKS` | no | `100` | Tracks read and imported per playlist, from 1-500 |
| `PLAYLIST_AUDIO_QUALITY` | no | `0` | `yt-dlp` audio quality: `0`-`10` VBR, or a bitrate such as `192K` |
| `YTDLP_PATH` | no | `yt-dlp` | Override the `yt-dlp` executable |
| `FFMPEG_PATH` | no | `ffmpeg` | Override the `ffmpeg` executable |

Never commit the real `.env`. Back up the complete data directory; media files and `metadata.json` are both required for a full restore. Metadata versions 1–4 migrate automatically to version 5: existing uploads are preserved as images while media type and duration fields are initialized safely.

## Docker

Copy `.env.example` to `.env`, set strong secret values, ensure the external `edge` network exists, then run:

```sh
docker compose up -d --build
```

The Compose service intentionally publishes no host port. It joins the existing edge network as `sard-upload` for the reverse tunnel to reach port `3000`.

The image installs `ffmpeg` and `python3` from Alpine and downloads the `yt-dlp` release zipapp, pinned by tag and verified against a SHA-256 recorded in the `Dockerfile`. Bump `YTDLP_VERSION` and `YTDLP_SHA256` together; YouTube extraction breaks as a pinned `yt-dlp` ages. If either binary is missing at startup the server logs a warning, reports `playlistImport: false`, and every playlist route answers `503` — the rest of the service is unaffected.

## Validation

```sh
npm run check
npm test
docker build -t sardrop:local .
```

Supported uploads are PNG, JPEG, GIF, WebP, AVIF, MP4, MOV, WebM, MP3, M4A, OGG, WAV, and FLAC. File signatures are checked server-side; SVG, executable formats, and arbitrary renamed files are rejected. Local OCR remains image-only; titles, manual tags, tag URLs, privacy controls, deletion, and view counts apply to every media type.
