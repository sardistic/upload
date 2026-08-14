import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UploadStore } from "./store.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, "..");
const publicDirectory = path.join(projectDirectory, "public");
const dependencyDirectory = path.join(projectDirectory, "node_modules");
const staticFiles = new Map([
  ["/", [path.join(publicDirectory, "index.html"), "text/html; charset=utf-8", false]],
  ["/app.js", [path.join(publicDirectory, "app.js"), "text/javascript; charset=utf-8", false]],
  ["/ocr.js", [path.join(publicDirectory, "ocr.js"), "text/javascript; charset=utf-8", false]],
  ["/theme.js", [path.join(publicDirectory, "theme.js"), "text/javascript; charset=utf-8", false]],
  ["/styles.css", [path.join(publicDirectory, "styles.css"), "text/css; charset=utf-8", false]],
  ["/favicon.svg", [path.join(publicDirectory, "favicon.svg"), "image/svg+xml", false]],
  ["/site.webmanifest", [path.join(publicDirectory, "site.webmanifest"), "application/manifest+json", false]],
  ["/vendor/tesseract/tesseract.min.js", [path.join(dependencyDirectory, "tesseract.js", "dist", "tesseract.min.js"), "text/javascript; charset=utf-8", true]],
  ["/vendor/tesseract/worker.min.js", [path.join(dependencyDirectory, "tesseract.js", "dist", "worker.min.js"), "text/javascript; charset=utf-8", true]],
  ["/vendor/tesseract/lang/eng.traineddata.gz", [path.join(dependencyDirectory, "@tesseract.js-data", "eng", "4.0.0", "eng.traineddata.gz"), "application/gzip", true]],
]);

for (const variant of ["", "-lstm", "-simd", "-simd-lstm", "-relaxedsimd", "-relaxedsimd-lstm"]) {
  for (const suffix of [".js", ".wasm", ".wasm.js"]) {
    const filename = `tesseract-core${variant}${suffix}`;
    staticFiles.set(`/vendor/tesseract/core/${filename}`, [
      path.join(dependencyDirectory, "tesseract.js-core", filename),
      suffix === ".wasm" ? "application/wasm" : "text/javascript; charset=utf-8",
      true,
    ]);
  }
}

const adjectives = [
  "amber", "ashen", "brisk", "cedar", "cobalt", "cosmic", "crimson", "dusky",
  "faint", "frosted", "golden", "hidden", "indigo", "lunar", "mellow", "misty",
  "neon", "quiet", "rapid", "silver", "solar", "velvet", "vivid", "wild",
];
const nouns = [
  "badger", "beacon", "comet", "ember", "falcon", "fern", "harbor", "heron",
  "lantern", "maple", "meteor", "moth", "orbit", "otter", "panda", "pixel",
  "raven", "reef", "signal", "sparrow", "summit", "tiger", "willow", "wolf",
];

const loginAttempts = new Map();

function loadConfig(overrides = {}) {
  const port = Number(overrides.port ?? process.env.PORT ?? 3000);
  const maxUploadMb = Number(overrides.maxUploadMb ?? process.env.MAX_UPLOAD_MB ?? 50);
  const sessionDays = Number(overrides.sessionDays ?? process.env.SESSION_DAYS ?? 30);
  const password = overrides.password ?? process.env.APP_PASSWORD;
  const sessionSecret = overrides.sessionSecret ?? process.env.SESSION_SECRET;

  if (!password) throw new Error("APP_PASSWORD is required");
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0 || maxUploadMb > 100) {
    throw new Error("MAX_UPLOAD_MB must be between 1 and 100");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  if (!Number.isFinite(sessionDays) || sessionDays < 1 || sessionDays > 365) {
    throw new Error("SESSION_DAYS must be between 1 and 365");
  }

  return {
    port,
    password,
    sessionSecret,
    baseUrl: String(overrides.baseUrl ?? process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    dataDir: path.resolve(overrides.dataDir ?? process.env.DATA_DIR ?? path.resolve("data")),
    maxUploadBytes: Math.round(maxUploadMb * 1024 * 1024),
    sessionMs: sessionDays * 86_400_000,
    secureCookies: overrides.secureCookies ?? String(overrides.baseUrl ?? process.env.BASE_URL ?? "").startsWith("https://"),
  };
}

function baseHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
    ...extra,
  };
}

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, baseHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  }));
  response.end(JSON.stringify(body));
}

function sendEmpty(response, statusCode, headers = {}) {
  response.writeHead(statusCode, baseHeaders(headers));
  response.end();
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function makeSession(config) {
  const value = `${Date.now() + config.sessionMs}.${randomBytes(18).toString("base64url")}`;
  return `${value}.${sign(value, config.sessionSecret)}`;
}

function validSession(request, config) {
  const token = parseCookies(request).sardrop_session;
  if (!token) return false;
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  const value = `${segments[0]}.${segments[1]}`;
  const expected = Buffer.from(sign(value, config.sessionSecret));
  const actual = Buffer.from(segments[2]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  return Number(segments[0]) > Date.now();
}

function sessionCookie(token, config) {
  const parts = [
    `sardrop_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(config.sessionMs / 1000)}`,
  ];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie(config) {
  return sessionCookie("", { ...config, sessionMs: 0 });
}

function safeEqualText(left, right) {
  const leftDigest = createHmac("sha256", "sardrop-password-check").update(String(left)).digest();
  const rightDigest = createHmac("sha256", "sardrop-password-check").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function clientAddress(request) {
  return String(request.headers["cf-connecting-ip"] ?? request.socket.remoteAddress ?? "unknown");
}

function canAttemptLogin(request) {
  const key = clientAddress(request);
  const now = Date.now();
  const record = loginAttempts.get(key) ?? { attempts: [], blockedUntil: 0 };
  record.attempts = record.attempts.filter((timestamp) => timestamp > now - 15 * 60_000);
  loginAttempts.set(key, record);
  return { key, record, allowed: record.blockedUntil <= now };
}

function recordFailedLogin(key, record) {
  record.attempts.push(Date.now());
  if (record.attempts.length >= 8) record.blockedUntil = Date.now() + 15 * 60_000;
  loginAttempts.set(key, record);
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

async function readBody(request, maximumBytes) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > maximumBytes) {
    const error = new Error("Request is too large");
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error("Request is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, maximumBytes = 16_384) {
  const body = await readBody(request, maximumBytes);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    const error = new Error("Invalid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function readFtypBrands(buffer) {
  if (buffer.length < 16 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return [];
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16 || boxSize > buffer.length) return [];
  const brands = [buffer.subarray(8, 12).toString("ascii")];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(buffer.subarray(offset, offset + 4).toString("ascii"));
  }
  return brands;
}

function detectImage(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return {
      mime: "image/png",
      extension: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") {
    return {
      mime: "image/gif",
      extension: "gif",
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  if (readFtypBrands(buffer).some((brand) => brand === "avif" || brand === "avis")) {
    return { mime: "image/avif", extension: "avif" };
  }
  return null;
}

function detectMedia(buffer, claimedMime = "", suppliedName = "") {
  const image = detectImage(buffer);
  if (image) return { ...image, mediaKind: "image" };

  const mime = String(claimedMime).split(";", 1)[0].trim().toLowerCase();
  const extension = path.extname(String(suppliedName)).slice(1).toLowerCase();

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return { mediaKind: "audio", mime: "audio/wav", extension: "wav" };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "fLaC") {
    return { mediaKind: "audio", mime: "audio/flac", extension: "flac" };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return { mediaKind: "audio", mime: "audio/ogg", extension: "ogg" };
  }
  if (
    buffer.length >= 3
    && (
      buffer.subarray(0, 3).toString("ascii") === "ID3"
      || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (mime === "audio/mpeg" || extension === "mp3"))
    )
  ) {
    return { mediaKind: "audio", mime: "audio/mpeg", extension: "mp3" };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const audioOnly = mime.startsWith("audio/");
    return {
      mediaKind: audioOnly ? "audio" : "video",
      mime: audioOnly ? "audio/webm" : "video/webm",
      extension: "webm",
    };
  }
  const brands = readFtypBrands(buffer);
  if (brands.length) {
    const supportedBrands = new Set([
      "isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "F4V ",
      "dash", "MSNV", "3gp4", "3gp5", "M4A ", "M4B ", "M4P ", "qt  ",
    ]);
    if (!brands.some((brand) => supportedBrands.has(brand))) return null;
    const audioOnly = mime.startsWith("audio/") || extension === "m4a" || brands.some((brand) => ["M4A ", "M4B ", "M4P "].includes(brand));
    if (audioOnly) return { mediaKind: "audio", mime: "audio/mp4", extension: "m4a" };
    if (brands.includes("qt  ") || mime === "video/quicktime" || extension === "mov") {
      return { mediaKind: "video", mime: "video/quicktime", extension: "mov" };
    }
    return { mediaKind: "video", mime: "video/mp4", extension: "mp4" };
  }
  return null;
}

function cleanFilename(headerValue, fallbackExtension, mediaKind = "file") {
  let value = String(headerValue ?? "");
  try {
    value = decodeURIComponent(value);
  } catch {
    value = "";
  }
  value = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
  return value || `pasted-${mediaKind}.${fallbackExtension}`;
}

function cleanTitle(value, fallback = "Untitled upload") {
  const title = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return title || fallback;
}

function cleanOcrText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 20_000);
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag ?? "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32))
    .filter(Boolean))]
    .slice(0, 8);
}

function cleanConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : null;
}

function makeTagAlias(tags, extension) {
  const base = cleanTags(tags).slice(0, 3).join("-").slice(0, 72).replace(/-+$/g, "");
  if (!base) return null;
  const suffix = randomBytes(4).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5).padEnd(5, "x");
  return `/${base}-${suffix}.${extension}`;
}

function makeSlug() {
  const adjective = adjectives[randomBytes(1)[0] % adjectives.length];
  const noun = nouns[randomBytes(1)[0] % nouns.length];
  const suffix = randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "x");
  return `${adjective}-${noun}-${suffix}`;
}

function serializeUpload(upload, config) {
  return {
    id: upload.id,
    title: upload.title,
    originalName: upload.originalName,
    publicPath: upload.publicPath,
    url: `${config.baseUrl}${upload.publicPath}`,
    aliasPath: upload.aliasPath ?? null,
    aliasUrl: upload.aliasPath ? `${config.baseUrl}${upload.aliasPath}` : null,
    previewUrl: `/api/uploads/${upload.id}/content`,
    mediaKind: upload.mediaKind ?? "image",
    mime: upload.mime,
    extension: upload.extension,
    size: upload.size,
    width: upload.width ?? null,
    height: upload.height ?? null,
    duration: upload.duration ?? null,
    visibility: upload.visibility,
    views: upload.views,
    tags: upload.tags ?? [],
    ocrText: upload.ocrText ?? "",
    ocrConfidence: upload.ocrConfidence ?? null,
    ocrUpdatedAt: upload.ocrUpdatedAt ?? null,
    titleSource: upload.titleSource ?? "manual",
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
  };
}

function serializePublicUpload(upload, config) {
  return {
    id: upload.id,
    title: upload.title,
    publicPath: upload.publicPath,
    url: `${config.baseUrl}${upload.publicPath}`,
    aliasUrl: upload.aliasPath ? `${config.baseUrl}${upload.aliasPath}` : null,
    previewUrl: `/api/public/uploads/${upload.id}/content`,
    mediaKind: upload.mediaKind ?? "image",
    mime: upload.mime,
    extension: upload.extension,
    size: upload.size,
    width: upload.width ?? null,
    height: upload.height ?? null,
    duration: upload.duration ?? null,
    views: upload.views,
    createdAt: upload.createdAt,
  };
}

function parseVisibility(value, fallback = null) {
  const visibility = String(value ?? "").toLowerCase();
  return ["public", "unlisted", "private"].includes(visibility) ? visibility : fallback;
}

function isSameOrigin(request, config) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const forwardedHost = request.headers["x-forwarded-host"] ?? request.headers.host;
  const forwardedProtocol = request.headers["x-forwarded-proto"] ?? (request.socket.encrypted ? "https" : "http");
  const requestOrigin = `${String(forwardedProtocol).split(",")[0]}://${String(forwardedHost).split(",")[0]}`;
  return origin === requestOrigin || origin === new URL(config.baseUrl).origin;
}

function requireOwner(request, response, config) {
  if (validSession(request, config)) return true;
  sendJson(response, 401, { error: "Authentication required" });
  return false;
}

function parseByteRange(value, size) {
  if (value === undefined) return null;
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return false;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return false;
    if (start >= size) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function serveMedia(request, response, upload, store, ownerView = false, countView = false) {
  try {
    const mediaPath = store.mediaPath(upload);
    const details = await stat(mediaPath);
    const range = parseByteRange(request.headers.range, details.size);
    if (range === false) {
      response.writeHead(416, baseHeaders({
        "Content-Range": `bytes */${details.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      }));
      return response.end();
    }
    if (countView && request.method === "GET" && (!range || range.start === 0)) {
      await store.incrementViews(upload.id);
    }
    const contentLength = range ? range.end - range.start + 1 : details.size;
    const headers = baseHeaders({
      "Content-Type": upload.mime,
      "Content-Length": contentLength,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${upload.publicPath.slice(1).replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "Cross-Origin-Resource-Policy": ownerView ? "same-origin" : "cross-origin",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${details.size}`;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === "HEAD") return response.end();
    createReadStream(mediaPath, range ? { start: range.start, end: range.end } : undefined).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "File not found" });
    throw error;
  }
}

export async function createSardropServer(overrides = {}) {
  const config = loadConfig(overrides);
  const store = new UploadStore(config.dataDir);
  await store.init();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, config.baseUrl);

      if (url.pathname === "/healthz" && request.method === "GET") {
        return sendJson(response, 200, { status: "ok" });
      }

      if (request.method === "GET" && staticFiles.has(url.pathname)) {
        const [filename, contentType, immutable] = staticFiles.get(url.pathname);
        const body = await readFile(filename);
        response.writeHead(200, baseHeaders({
          "Content-Type": contentType,
          "Cache-Control": url.pathname === "/" ? "no-cache" : (immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600"),
          "Content-Security-Policy": "default-src 'self'; img-src 'self' https://veles.cards blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        }));
        return response.end(body);
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        return sendJson(response, 200, {
          authenticated: validSession(request, config),
          maxUploadBytes: config.maxUploadBytes,
        });
      }

      if (url.pathname === "/api/session" && request.method === "POST") {
        if (!isSameOrigin(request, config)) return sendJson(response, 403, { error: "Origin not allowed" });
        const attempt = canAttemptLogin(request);
        if (!attempt.allowed) return sendJson(response, 429, { error: "Too many attempts. Try again in 15 minutes." });
        const body = await readJson(request);
        if (!safeEqualText(body.password ?? "", config.password)) {
          recordFailedLogin(attempt.key, attempt.record);
          return sendJson(response, 401, { error: "That password is not correct" });
        }
        clearLoginAttempts(attempt.key);
        return sendJson(response, 200, { authenticated: true }, {
          "Set-Cookie": sessionCookie(makeSession(config), config),
        });
      }

      if (url.pathname === "/api/session" && request.method === "DELETE") {
        if (!isSameOrigin(request, config)) return sendJson(response, 403, { error: "Origin not allowed" });
        return sendEmpty(response, 204, { "Set-Cookie": clearSessionCookie(config) });
      }

      if (url.pathname === "/api/uploads" && request.method === "GET") {
        if (!requireOwner(request, response, config)) return;
        return sendJson(response, 200, {
          uploads: store.list().map((upload) => serializeUpload(upload, config)),
        });
      }

      if (url.pathname === "/api/public/uploads" && request.method === "GET") {
        return sendJson(response, 200, {
          uploads: store.list()
            .filter((upload) => upload.visibility === "public")
            .map((upload) => serializePublicUpload(upload, config)),
        });
      }

      if (url.pathname === "/api/uploads" && request.method === "POST") {
        if (!requireOwner(request, response, config)) return;
        if (!isSameOrigin(request, config)) return sendJson(response, 403, { error: "Origin not allowed" });
        const mediaBuffer = await readBody(request, config.maxUploadBytes);
        if (!mediaBuffer.length) return sendJson(response, 400, { error: "No file data received" });
        const suppliedName = request.headers["x-file-name"];
        const detected = detectMedia(mediaBuffer, request.headers["content-type"], suppliedName);
        if (!detected) {
          return sendJson(response, 415, {
            error: "Use PNG, JPEG, GIF, WebP, AVIF, MP4, MOV, WebM, MP3, M4A, OGG, WAV, or FLAC",
          });
        }

        let slug;
        let publicPath;
        do {
          slug = makeSlug();
          publicPath = `/${slug}.${detected.extension}`;
        } while (store.hasPath(publicPath));

        const originalName = cleanFilename(suppliedName, detected.extension, detected.mediaKind);
        const requestedVisibility = request.headers["x-upload-visibility"];
        const visibility = requestedVisibility === undefined
          ? (request.headers["x-upload-private"] === "true" ? "private" : "unlisted")
          : parseVisibility(requestedVisibility);
        if (!visibility) return sendJson(response, 400, { error: "Invalid visibility" });
        const now = new Date().toISOString();
        const upload = {
          id: randomUUID(),
          slug,
          extension: detected.extension,
          mime: detected.mime,
          mediaKind: detected.mediaKind,
          publicPath,
          originalName,
          title: cleanTitle(
            request.headers["x-media-title"] ?? request.headers["x-image-title"],
            path.parse(originalName).name || `Pasted ${detected.mediaKind}`,
          ),
          size: mediaBuffer.length,
          width: detected.width ?? positiveInteger(request.headers["x-media-width"] ?? request.headers["x-image-width"]),
          height: detected.height ?? positiveInteger(request.headers["x-media-height"] ?? request.headers["x-image-height"]),
          duration: detected.mediaKind === "image" ? null : positiveNumber(request.headers["x-media-duration"]),
          visibility,
          views: 0,
          tags: [],
          ocrText: "",
          ocrConfidence: null,
          ocrUpdatedAt: null,
          titleSource: "filename",
          aliasPath: null,
          createdAt: now,
          updatedAt: now,
        };
        await store.create(upload, mediaBuffer);
        return sendJson(response, 201, { upload: serializeUpload(upload, config) });
      }

      const contentMatch = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]+)\/content$/i);
      if (contentMatch && (request.method === "GET" || request.method === "HEAD")) {
        if (!requireOwner(request, response, config)) return;
        const upload = store.findById(contentMatch[1]);
        if (!upload) return sendJson(response, 404, { error: "Upload not found" });
        return serveMedia(request, response, upload, store, true);
      }

      const publicContentMatch = url.pathname.match(/^\/api\/public\/uploads\/([0-9a-f-]+)\/content$/i);
      if (publicContentMatch && (request.method === "GET" || request.method === "HEAD")) {
        const upload = store.findById(publicContentMatch[1]);
        if (!upload || upload.visibility !== "public") {
          return sendJson(response, 404, { error: "File not found" });
        }
        return serveMedia(request, response, upload, store, false);
      }

      const itemMatch = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]+)$/i);
      if (itemMatch && request.method === "PATCH") {
        if (!requireOwner(request, response, config)) return;
        if (!isSameOrigin(request, config)) return sendJson(response, 403, { error: "Origin not allowed" });
        const body = await readJson(request, 65_536);
        const existingUpload = store.findById(itemMatch[1]);
        if (!existingUpload) return sendJson(response, 404, { error: "Upload not found" });
        const changes = {};
        if (Object.hasOwn(body, "visibility")) {
          changes.visibility = parseVisibility(body.visibility);
          if (!changes.visibility) return sendJson(response, 400, { error: "Invalid visibility" });
        } else if (Object.hasOwn(body, "isPrivate")) {
          changes.visibility = body.isPrivate ? "private" : "unlisted";
        }
        if (Object.hasOwn(body, "title")) {
          changes.title = cleanTitle(body.title);
          changes.titleSource = "manual";
        }
        if (Object.hasOwn(body, "tags")) changes.tags = cleanTags(body.tags);
        if (body.ocr && typeof body.ocr === "object") {
          if ((existingUpload.mediaKind ?? "image") !== "image") {
            return sendJson(response, 400, { error: "OCR is available for images only" });
          }
          changes.ocrText = cleanOcrText(body.ocr.text);
          changes.ocrConfidence = cleanConfidence(body.ocr.confidence);
          changes.tags = cleanTags(body.ocr.tags);
          changes.ocrUpdatedAt = new Date().toISOString();
          const suggestedTitle = cleanTitle(body.ocr.suggestedTitle, "");
          if (body.ocr.applyTitle && suggestedTitle && ["filename", "ocr"].includes(existingUpload.titleSource)) {
            changes.title = suggestedTitle;
            changes.titleSource = "ocr";
          }
        }
        if (Object.hasOwn(body, "tagAlias")) {
          if (body.tagAlias === true) {
            if (!existingUpload.tags?.length) {
              return sendJson(response, 400, { error: "Add at least one tag before creating a tag URL" });
            }
            if (!existingUpload.aliasPath) {
              let aliasPath;
              do {
                aliasPath = makeTagAlias(existingUpload.tags, existingUpload.extension);
              } while (aliasPath && store.hasPath(aliasPath));
              changes.aliasPath = aliasPath;
            }
          } else if (body.tagAlias === false) {
            changes.aliasPath = null;
          } else {
            return sendJson(response, 400, { error: "Invalid tag URL setting" });
          }
        }
        if (!Object.keys(changes).length) return sendJson(response, 400, { error: "No supported changes provided" });
        const upload = await store.update(itemMatch[1], changes);
        if (!upload) return sendJson(response, 404, { error: "Upload not found" });
        return sendJson(response, 200, { upload: serializeUpload(upload, config) });
      }

      if (itemMatch && request.method === "DELETE") {
        if (!requireOwner(request, response, config)) return;
        if (!isSameOrigin(request, config)) return sendJson(response, 403, { error: "Origin not allowed" });
        const upload = await store.delete(itemMatch[1]);
        if (!upload) return sendJson(response, 404, { error: "Upload not found" });
        return sendEmpty(response, 204);
      }

      const publicMediaMatch = url.pathname.match(/^\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|gif|webp|avif|mp4|mov|webm|mp3|m4a|ogg|wav|flac)$/);
      if (publicMediaMatch && (request.method === "GET" || request.method === "HEAD")) {
        const upload = store.findByPath(url.pathname);
        if (!upload || upload.visibility === "private") return sendJson(response, 404, { error: "File not found" });
        return serveMedia(request, response, upload, store, false, true);
      }

      if (url.pathname === "/robots.txt" && request.method === "GET") {
        response.writeHead(200, baseHeaders({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" }));
        return response.end("User-agent: *\nDisallow: /\n");
      }

      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) {
        const statusCode = error.statusCode ?? 500;
        const message = statusCode >= 500 ? "Something went wrong" : error.message;
        sendJson(response, statusCode, { error: message });
      } else {
        response.destroy();
      }
      if (!error.statusCode || error.statusCode >= 500) console.error(error);
    }
  });

  return { server, store, config };
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100_000 ? number : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 604_800
    ? Math.round(number * 1000) / 1000
    : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createSardropServer()
    .then(({ server, config }) => {
      server.listen(config.port, "0.0.0.0", () => {
        console.log(`Sardrop listening on port ${config.port}`);
      });
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
