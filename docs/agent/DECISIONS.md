# Architectural decisions

## 2026-08-12 — Single-service, dependency-free image host

Sardrop uses the Node.js standard library for HTTP, authentication, file serving, and metadata persistence. Image bytes live in a persistent data directory and upload metadata is stored in an atomically replaced JSON document. This keeps the personal service small, auditable, and portable without an external database.

The dashboard is protected by one environment-provided owner password. Sessions use signed, HTTP-only, same-site cookies. Public image paths do not require authentication; switching an upload to private makes that path return `404`, while the dashboard uses a separate authenticated preview route. Image responses use `no-store` so a privacy change is not undermined by an intermediary's stale cached response.

SVG is intentionally unsupported because active SVG content on the application origin would expand the cross-site scripting attack surface. Uploads are accepted only after server-side file-signature validation.

## 2026-08-12 — Three-level visibility and explicit view semantics

Uploads use one of three visibility states. `public` images retain a working direct URL and appear in an anonymous splash-page gallery. `unlisted` images retain a working direct URL but never appear in that gallery. `private` images are available only through the authenticated owner preview route and return `404` at their direct URL. New uploads default to `unlisted` to preserve paste-and-share utility without accidentally publishing them.

View counts increment for successful GET requests to the randomized direct image path. HEAD requests, owner-dashboard previews, and public-gallery thumbnails do not increment counts. This makes the count describe direct image retrieval rather than internal page rendering. Existing version 1 metadata migrates atomically to version 2 on startup, mapping legacy public/private values without losing upload records.

## 2026-08-13 — Sardistic network branding and discreet owner entry

The public and owner interfaces use `upload.sardistic.com` as the product name. The `S` in `sardistic` is the same animated liquid GIF used by `status.sardistic.com`, loaded from `veles.cards`; the image CSP permits only that additional image origin. A text `S` replaces the animation when it cannot load or when the visitor prefers reduced motion. The surrounding visual system uses editorial cobalt, coral, violet, and neutral colors rather than the previous green motif.

Both dark and light palettes are supported, with dark as the deterministic first-visit default rather than inheriting the operating-system setting. A self-hosted, first-party script applies any saved preference before the stylesheet loads, avoiding a light flash; the header switch persists the choice in local storage. The document, manifest, browser theme color, and fallback favicon all advertise the dark default.

The anonymous splash page presents the public gallery as the primary experience. Owner authentication remains protected by the existing password and signed session, but its form opens from a small key control in the header instead of occupying the hero. This is a presentation choice, not a security boundary; access control continues to be enforced by the server.

## 2026-08-13 — Browser-local OCR and owner-only search metadata

OCR uses pinned, self-hosted Tesseract.js assets and the English trained-data package. Recognition runs only in the authenticated owner's browser, processes one image at a time, and downscales source images before recognition to bound client memory and CPU use. The worker and language model are loaded lazily and cached as immutable assets, so the server pays no per-scan API cost and image bytes are not sent to an OCR provider.

Extracted text, confidence, and normalized tags are stored in metadata version 3 and returned only by the authenticated owner API. The anonymous public feed intentionally omits all OCR fields, even for Public images. OCR can name uploads whose title still comes from a generic filename, but a manual title becomes authoritative and is not overwritten by later rescans. Existing version 1 and 2 records migrate atomically with empty OCR metadata and manual title provenance.

The interface is a flat, dark-first archive rather than a marketing-style hero composition. The splash gives the public index priority and keeps owner login behind the existing minimal header control; the authenticated view keeps upload, visibility, OCR, search, and management controls in a compact workbench.

## 2026-08-13 — Optional tag-derived URL aliases

An upload may have one optional secondary path derived from up to three owner-approved tags plus a random suffix. Creating the alias is an explicit owner action after OCR or manual tagging, because the readable URL inherently discloses those tags. The original randomized direct path remains stable and canonical; edits and rescans do not silently change an existing alias.

The alias resolves to the same stored file, obeys the image's current Public/Link-only/Private state, and increments the same view counter. It can be revoked without deleting the image. Alias paths are stored in metadata version 4 and share the existing global path-collision check with canonical paths.

## 2026-08-13 — Public index without a marketing hero

The anonymous page begins with a compact object manifest rather than a conventional headline, explanatory subtitle, and scroll call-to-action. Host, ordering, surface mode, object count, and the three visibility rules are expressed as terse read-only index metadata, with the contact sheet immediately following. This keeps the public surface product-like and specific to image infrastructure instead of resembling a generic landing page.

## 2026-08-13 — Validated media objects and range-aware delivery

The upload store accepts a deliberately small set of browser-oriented image, video, and audio containers after checking their byte signatures. Supported video containers are MP4, QuickTime/MOV, and WebM; supported audio containers are MP3, MP4/M4A, OGG, WAV, FLAC, and audio WebM. SVG and arbitrary renamed files remain unsupported. Metadata version 5 adds `mediaKind` and optional duration while migrating every older record as an image without moving or renaming stored bytes.

All media uses the existing canonical/alias paths and Public/Link-only/Private rules. File responses advertise byte ranges and return a single requested range with `206`, which makes browser playback and seeking reliable. A full direct GET or a range beginning at byte zero increments the shared view count; later seek ranges, HEAD requests, owner previews, and public-index previews do not. This avoids treating one playback session as many views.

Browser-local OCR remains image-only. Audio and video still support manual titles, tags, tag-derived aliases, search, visibility changes, downloads, and deletion. The default per-file limit is 50 MB, within the existing 100 MB configuration ceiling and the single-process in-memory upload architecture.
