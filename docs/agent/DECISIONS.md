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
