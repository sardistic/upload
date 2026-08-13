# Architectural decisions

## 2026-08-12 — Single-service, dependency-free image host

Sardrop uses the Node.js standard library for HTTP, authentication, file serving, and metadata persistence. Image bytes live in a persistent data directory and upload metadata is stored in an atomically replaced JSON document. This keeps the personal service small, auditable, and portable without an external database.

The dashboard is protected by one environment-provided owner password. Sessions use signed, HTTP-only, same-site cookies. Public image paths do not require authentication; switching an upload to private makes that path return `404`, while the dashboard uses a separate authenticated preview route. Image responses use `no-store` so a privacy change is not undermined by an intermediary's stale cached response.

SVG is intentionally unsupported because active SVG content on the application origin would expand the cross-site scripting attack surface. Uploads are accepted only after server-side file-signature validation.

## 2026-08-12 — Three-level visibility and explicit view semantics

Uploads use one of three visibility states. `public` images retain a working direct URL and appear in an anonymous splash-page gallery. `unlisted` images retain a working direct URL but never appear in that gallery. `private` images are available only through the authenticated owner preview route and return `404` at their direct URL. New uploads default to `unlisted` to preserve paste-and-share utility without accidentally publishing them.

View counts increment for successful GET requests to the randomized direct image path. HEAD requests, owner-dashboard previews, and public-gallery thumbnails do not increment counts. This makes the count describe direct image retrieval rather than internal page rendering. Existing version 1 metadata migrates atomically to version 2 on startup, mapping legacy public/private values without losing upload records.
