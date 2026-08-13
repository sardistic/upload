# Architectural decisions

## 2026-08-12 — Single-service, dependency-free image host

Sardrop uses the Node.js standard library for HTTP, authentication, file serving, and metadata persistence. Image bytes live in a persistent data directory and upload metadata is stored in an atomically replaced JSON document. This keeps the personal service small, auditable, and portable without an external database.

The dashboard is protected by one environment-provided owner password. Sessions use signed, HTTP-only, same-site cookies. Public image paths do not require authentication; switching an upload to private makes that path return `404`, while the dashboard uses a separate authenticated preview route. Image responses use `no-store` so a privacy change is not undermined by an intermediary's stale cached response.

SVG is intentionally unsupported because active SVG content on the application origin would expand the cross-site scripting attack surface. Uploads are accepted only after server-side file-signature validation.
