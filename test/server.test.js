import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSardropServer } from "../src/server.js";
import { findPlaylistUrl, normalizeAudioQuality, parsePlaylistUrl } from "../src/youtube.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const tinyWav = Buffer.alloc(52);
tinyWav.write("RIFF", 0, "ascii");
tinyWav.writeUInt32LE(44, 4);
tinyWav.write("WAVEfmt ", 8, "ascii");
tinyWav.writeUInt32LE(16, 16);
tinyWav.writeUInt16LE(1, 20);
tinyWav.writeUInt16LE(1, 22);
tinyWav.writeUInt32LE(8_000, 24);
tinyWav.writeUInt32LE(8_000, 28);
tinyWav.writeUInt16LE(1, 32);
tinyWav.writeUInt16LE(8, 34);
tinyWav.write("data", 36, "ascii");
tinyWav.writeUInt32LE(8, 40);

const tinyMp4 = Buffer.alloc(24);
tinyMp4.writeUInt32BE(24, 0);
tinyMp4.write("ftypmp42", 4, "ascii");
tinyMp4.write("isommp42", 16, "ascii");

async function startApp(dataDir, overrides = {}) {
  const app = await createSardropServer({
    dataDir,
    password: "correct horse battery staple",
    sessionSecret: "test-session-secret-that-is-longer-than-thirty-two-characters",
    baseUrl: "http://sardrop.test",
    secureCookies: false,
    maxUploadMb: 2,
    playlistImport: false,
    ...overrides,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  return {
    ...app,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve())),
  };
}

async function login(app) {
  const response = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin },
    body: JSON.stringify({ password: "correct horse battery staple" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("installation manifest and launch assets are available without an owner session", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-install-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = await startApp(dataDir);
  context.after(() => app.close());

  const home = await (await fetch(app.origin)).text();
  const manifestPath = home.match(/rel="manifest" href="([^"]+)"/)[1];
  const response = await fetch(`${app.origin}${manifestPath}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.prefer_related_applications, false);

  for (const size of [192, 512]) {
    const entry = manifest.icons.find((icon) => icon.sizes === `${size}x${size}` && icon.purpose === "any");
    assert.ok(entry, `manifest needs a ${size}px application icon`);
    const icon = await fetch(`${app.origin}${entry.src}`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await icon.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const scriptPath = home.match(/src="([^"]*\/install\.js[^\"]*)"/)[1];
  const script = await fetch(`${app.origin}${scriptPath}`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /text\/javascript/);
  const worker = await fetch(`${app.origin}/sw.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get("content-type"), /text\/javascript/);
  assert.equal(worker.headers.get("cache-control"), "no-cache");
});

test("owner flow counts views and enforces public, unlisted, and private visibility", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  let app = await startApp(dataDir);
  context.after(async () => {
    if (app.server.listening) await app.close();
  });

  const home = await fetch(app.origin);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(home.headers.get("content-security-policy"), /img-src 'self' https:\/\/veles\.cards/);
  assert.match(home.headers.get("content-security-policy"), /media-src 'self' blob:/);
  assert.match(home.headers.get("content-security-policy"), /worker-src 'self' blob:/);
  assert.match(home.headers.get("content-security-policy"), /wasm-unsafe-eval/);
  const homeHtml = await home.text();
  assert.match(homeHtml, /upload\.sardistic\.com/);
  assert.match(homeHtml, /<title>Uploads \| Sardistic<\/title>/);
  assert.match(homeHtml, /<html lang="en" data-theme="dark">/);
  assert.match(homeHtml, /\/theme\.js\?v=6/);
  assert.match(homeHtml, /\/styles\.css\?v=10/);
  assert.match(homeHtml, /\/app\.js\?v=10/);
  assert.match(homeHtml, /Local OCR/);
  assert.match(homeHtml, /public_objects/);
  assert.doesNotMatch(homeHtml, /A small place/);
  assert.doesNotMatch(homeHtml, /Browse the public index/);
  assert.doesNotMatch(homeHtml, /manifest-live/);
  const themeScript = await fetch(`${app.origin}/theme.js?v=6`);
  assert.equal(themeScript.status, 200);
  assert.match(themeScript.headers.get("content-type"), /text\/javascript/);
  assert.match(await themeScript.text(), /upload-sardistic-theme/);
  // Guards the Rocket Loader replayed-DOMContentLoaded double-bind that made the toggle inert.
  assert.match(await (await fetch(`${app.origin}/theme.js`)).text(), /themeBound/);
  assert.match(homeHtml, /rel="apple-touch-icon"/);
  const favicon = await fetch(`${app.origin}/favicon.svg?v=3`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type"), /image\/svg\+xml/);
  for (const [iconPath, signatureLength] of [["/apple-touch-icon.png", 180], ["/icon-maskable.png", 192]]) {
    const icon = await fetch(`${app.origin}${iconPath}?v=3`);
    assert.equal(icon.status, 200, `${iconPath} should be served`);
    assert.equal(icon.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await icon.arrayBuffer());
    // PNG magic number, so a text-mangled or truncated binary fails loudly.
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${iconPath} should be a real PNG`);
    // IHDR width is a big-endian uint32 at byte 16.
    const width = new DataView(bytes.buffer).getUint32(16);
    assert.equal(width, signatureLength, `${iconPath} should be ${signatureLength}px wide`);
  }
  const ocrModule = await fetch(`${app.origin}/ocr.js?v=1`);
  assert.equal(ocrModule.status, 200);
  assert.match(await ocrModule.text(), /recognizeLocally/);
  const appScript = await fetch(`${app.origin}/app.js?v=9`);
  assert.equal(appScript.status, 200);
  assert.match(await appScript.text(), /OCR complete · low confidence/);
  const tesseractScript = await fetch(`${app.origin}/vendor/tesseract/tesseract.min.js`);
  assert.equal(tesseractScript.status, 200);
  assert.match(tesseractScript.headers.get("cache-control"), /immutable/);

  const anonymousList = await fetch(`${app.origin}/api/uploads`);
  assert.equal(anonymousList.status, 401);
  const emptyPublicFeed = await fetch(`${app.origin}/api/public/uploads`);
  assert.deepEqual((await emptyPublicFeed.json()).uploads, []);

  const badLogin = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin },
    body: JSON.stringify({ password: "not it" }),
  });
  assert.equal(badLogin.status, 401);

  const cookie = await login(app);
  const uploadResponse = await fetch(`${app.origin}/api/uploads`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: app.origin,
      "Content-Type": "image/png",
      "X-File-Name": encodeURIComponent("tiny screenshot.png"),
      "X-Upload-Visibility": "public",
    },
    body: onePixelPng,
  });
  assert.equal(uploadResponse.status, 201);
  const { upload } = await uploadResponse.json();
  assert.equal(upload.mime, "image/png");
  assert.equal(upload.mediaKind, "image");
  assert.equal(upload.width, 1);
  assert.equal(upload.height, 1);
  assert.equal(upload.duration, null);
  assert.equal(upload.visibility, "public");
  assert.equal(upload.views, 0);
  assert.deepEqual(upload.tags, []);
  assert.equal(upload.ocrText, "");
  assert.equal(upload.ocrUpdatedAt, null);
  assert.equal(upload.titleSource, "filename");
  assert.equal(upload.aliasPath, null);
  assert.equal(upload.aliasUrl, null);
  assert.match(upload.publicPath, /^\/[a-z]+-[a-z]+-[a-z0-9]{6}\.png$/);

  const emptyTagAlias = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ tagAlias: true }),
  });
  assert.equal(emptyTagAlias.status, 400);

  const ocrResponse = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ ocr: {
      text: "Quarterly receipt\nTotal due $42.00",
      confidence: 87.6,
      tags: ["receipt", "quarterly", "receipt", "total"],
      suggestedTitle: "Quarterly receipt",
      applyTitle: true,
    } }),
  });
  assert.equal(ocrResponse.status, 200);
  const ocrUpload = (await ocrResponse.json()).upload;
  assert.equal(ocrUpload.title, "Quarterly receipt");
  assert.equal(ocrUpload.titleSource, "ocr");
  assert.equal(ocrUpload.ocrConfidence, 88);
  assert.deepEqual(ocrUpload.tags, ["receipt", "quarterly", "total"]);
  assert.match(ocrUpload.ocrText, /Total due/);

  const aliasResponse = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ tagAlias: true }),
  });
  assert.equal(aliasResponse.status, 200);
  const aliasUpload = (await aliasResponse.json()).upload;
  assert.match(aliasUpload.aliasPath, /^\/receipt-quarterly-total-[a-z0-9]{5}\.png$/);
  assert.equal(aliasUpload.aliasUrl, `http://sardrop.test${aliasUpload.aliasPath}`);

  const publicFeed = await fetch(`${app.origin}/api/public/uploads`);
  const publicUploads = (await publicFeed.json()).uploads;
  assert.equal(publicUploads.length, 1);
  assert.equal(publicUploads[0].id, upload.id);
  assert.equal(publicUploads[0].views, 0);
  assert.equal(publicUploads[0].aliasUrl, aliasUpload.aliasUrl);
  assert.equal(Object.hasOwn(publicUploads[0], "originalName"), false);
  assert.equal(Object.hasOwn(publicUploads[0], "ocrText"), false);
  assert.equal(Object.hasOwn(publicUploads[0], "tags"), false);

  const publicPreview = await fetch(`${app.origin}${publicUploads[0].previewUrl}`);
  assert.equal(publicPreview.status, 200);
  const headImage = await fetch(`${app.origin}${upload.publicPath}`, { method: "HEAD" });
  assert.equal(headImage.status, 200);
  const headAlias = await fetch(`${app.origin}${aliasUpload.aliasPath}`, { method: "HEAD" });
  assert.equal(headAlias.status, 200);

  const publicImage = await fetch(`${app.origin}${upload.publicPath}`);
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get("cache-control"), "no-store");
  assert.equal(publicImage.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), onePixelPng);

  const ownerList = await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: cookie } });
  assert.equal((await ownerList.json()).uploads[0].views, 1);

  const unlistedResponse = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ visibility: "unlisted" }),
  });
  assert.equal(unlistedResponse.status, 200);
  assert.equal((await unlistedResponse.json()).upload.visibility, "unlisted");
  assert.deepEqual((await (await fetch(`${app.origin}/api/public/uploads`)).json()).uploads, []);
  const unlistedAlias = await fetch(`${app.origin}${aliasUpload.aliasPath}`);
  assert.equal(unlistedAlias.status, 200);
  assert.deepEqual(Buffer.from(await unlistedAlias.arrayBuffer()), onePixelPng);

  const privateResponse = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ visibility: "private", title: "A private pixel" }),
  });
  assert.equal(privateResponse.status, 200);
  const privateUpload = (await privateResponse.json()).upload;
  assert.equal(privateUpload.title, "A private pixel");
  assert.equal(privateUpload.visibility, "private");
  assert.equal(privateUpload.views, 2);
  assert.equal((await fetch(`${app.origin}${upload.publicPath}`)).status, 404);
  assert.equal((await fetch(`${app.origin}${aliasUpload.aliasPath}`)).status, 404);

  const privatePreview = await fetch(`${app.origin}/api/uploads/${upload.id}/content`, {
    headers: { Cookie: cookie },
  });
  assert.equal(privatePreview.status, 200);
  assert.equal(privatePreview.headers.get("cache-control"), "no-store");
  assert.equal(privatePreview.headers.get("cross-origin-resource-policy"), "same-origin");

  await app.close();
  app = await startApp(dataDir);
  const restartedCookie = await login(app);
  const listResponse = await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: restartedCookie } });
  assert.equal(listResponse.status, 200);
  const uploads = (await listResponse.json()).uploads;
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].title, "A private pixel");
  assert.equal(uploads[0].visibility, "private");
  assert.equal(uploads[0].views, 2);
  assert.match(uploads[0].ocrText, /Quarterly receipt/);
  assert.deepEqual(uploads[0].tags, ["receipt", "quarterly", "total"]);
  assert.equal(uploads[0].aliasPath, aliasUpload.aliasPath);
  assert.equal(uploads[0].aliasUrl, aliasUpload.aliasUrl);

  const revokeAlias = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: restartedCookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ tagAlias: false }),
  });
  assert.equal(revokeAlias.status, 200);
  assert.equal((await revokeAlias.json()).upload.aliasUrl, null);
  assert.equal(app.store.findByPath(aliasUpload.aliasPath), null);

  const deleteResponse = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "DELETE",
    headers: { Cookie: restartedCookie, Origin: app.origin },
  });
  assert.equal(deleteResponse.status, 204);
  const emptyList = await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: restartedCookie } });
  assert.deepEqual((await emptyList.json()).uploads, []);
});

test("rejects cross-origin mutations and unsupported file data", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-security-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = await startApp(dataDir);
  context.after(() => app.close());
  const cookie = await login(app);

  const crossOrigin = await fetch(`${app.origin}/api/uploads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://attacker.example", "Content-Type": "image/png" },
    body: onePixelPng,
  });
  assert.equal(crossOrigin.status, 403);

  const fakeImage = await fetch(`${app.origin}/api/uploads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "image/png" },
    body: Buffer.from("<svg><script>alert(1)</script></svg>"),
  });
  assert.equal(fakeImage.status, 415);
});

test("accepts audio and video media with range playback and stable view counts", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-media-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = await startApp(dataDir);
  context.after(() => app.close());
  const cookie = await login(app);

  const audioResponse = await fetch(`${app.origin}/api/uploads`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: app.origin,
      "Content-Type": "audio/wav",
      "X-File-Name": encodeURIComponent("short signal.wav"),
      "X-Media-Duration": "2.25",
      "X-Upload-Visibility": "public",
    },
    body: tinyWav,
  });
  assert.equal(audioResponse.status, 201);
  const audio = (await audioResponse.json()).upload;
  assert.equal(audio.mediaKind, "audio");
  assert.equal(audio.mime, "audio/wav");
  assert.equal(audio.extension, "wav");
  assert.equal(audio.duration, 2.25);
  assert.match(audio.publicPath, /\.wav$/);

  const firstRange = await fetch(`${app.origin}${audio.publicPath}`, {
    headers: { Range: "bytes=0-11" },
  });
  assert.equal(firstRange.status, 206);
  assert.equal(firstRange.headers.get("accept-ranges"), "bytes");
  assert.equal(firstRange.headers.get("content-range"), `bytes 0-11/${tinyWav.length}`);
  assert.equal(firstRange.headers.get("content-length"), "12");
  assert.deepEqual(Buffer.from(await firstRange.arrayBuffer()), tinyWav.subarray(0, 12));

  const seekRange = await fetch(`${app.origin}${audio.publicPath}`, {
    headers: { Range: "bytes=12-19" },
  });
  assert.equal(seekRange.status, 206);
  assert.deepEqual(Buffer.from(await seekRange.arrayBuffer()), tinyWav.subarray(12, 20));
  const invalidRange = await fetch(`${app.origin}${audio.publicPath}`, {
    headers: { Range: "bytes=999-1000" },
  });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get("content-range"), `bytes */${tinyWav.length}`);

  const listed = (await (await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: cookie } })).json()).uploads;
  assert.equal(listed.find((upload) => upload.id === audio.id).views, 1);

  const audioOcr = await fetch(`${app.origin}/api/uploads/${audio.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ ocr: { text: "not allowed", tags: ["audio"] } }),
  });
  assert.equal(audioOcr.status, 400);

  const videoResponse = await fetch(`${app.origin}/api/uploads`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: app.origin,
      "Content-Type": "video/mp4",
      "X-File-Name": encodeURIComponent("small clip.mp4"),
      "X-Media-Width": "1920",
      "X-Media-Height": "1080",
      "X-Media-Duration": "3.5",
      "X-Upload-Visibility": "unlisted",
    },
    body: tinyMp4,
  });
  assert.equal(videoResponse.status, 201);
  const video = (await videoResponse.json()).upload;
  assert.equal(video.mediaKind, "video");
  assert.equal(video.mime, "video/mp4");
  assert.equal(video.extension, "mp4");
  assert.equal(video.width, 1920);
  assert.equal(video.height, 1080);
  assert.equal(video.duration, 3.5);

  const publicFeed = (await (await fetch(`${app.origin}/api/public/uploads`)).json()).uploads;
  assert.equal(publicFeed.length, 1);
  assert.equal(publicFeed[0].mediaKind, "audio");
  assert.equal(publicFeed[0].duration, 2.25);
  assert.equal(publicFeed[0].extension, "wav");
});

test("migrates legacy public and private metadata without losing records", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-migration-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(path.join(dataDir, "images"), { recursive: true });
  const now = new Date().toISOString();
  await writeFile(path.join(dataDir, "metadata.json"), JSON.stringify({
    version: 1,
    uploads: [
      { id: "public-id", publicPath: "/old-public.png", extension: "png", isPrivate: false, createdAt: now },
      { id: "private-id", publicPath: "/old-private.png", extension: "png", isPrivate: true, createdAt: now },
    ],
  }));

  const app = await startApp(dataDir);
  context.after(() => app.close());
  assert.equal(app.store.findById("public-id").visibility, "public");
  assert.equal(app.store.findById("private-id").visibility, "private");
  assert.equal(app.store.findById("public-id").views, 0);

  const migrated = JSON.parse(await readFile(path.join(dataDir, "metadata.json"), "utf8"));
  assert.equal(migrated.version, 5);
  assert.equal(Object.hasOwn(migrated.uploads[0], "isPrivate"), false);
  assert.deepEqual(migrated.uploads[0].tags, []);
  assert.equal(migrated.uploads[0].ocrText, "");
  assert.equal(migrated.uploads[0].titleSource, "manual");
  assert.equal(migrated.uploads[0].aliasPath, null);
  assert.equal(migrated.uploads[0].mediaKind, "image");
  assert.equal(migrated.uploads[0].duration, null);
});

const tinyMp3 = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.alloc(180)]);

const stubTracks = [
  { id: "aaaaaaaaaaa", title: "First track", uploader: "Test channel", duration: 191 },
  { id: "bbbbbbbbbbb", title: "Second track", uploader: "Test channel", duration: 244 },
];

function stubYoutube(overrides = {}) {
  const calls = { inspect: [], download: [] };
  return {
    calls,
    async inspectPlaylist(playlist, options) {
      calls.inspect.push({ playlist, options });
      return {
        id: playlist.id,
        url: playlist.url,
        title: "Night drive",
        uploader: "Test channel",
        truncated: false,
        tracks: stubTracks.map((track) => ({ ...track })),
      };
    },
    async downloadTrack(videoId, { directory }) {
      calls.download.push(videoId);
      const filePath = path.join(directory, "track.mp3");
      await writeFile(filePath, tinyMp3);
      return filePath;
    },
    ...overrides,
  };
}

/** A stub whose downloads block until released, so job states are deterministic. */
function gatedYoutube() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return stubYoutube({
    release,
    async downloadTrack(videoId, { directory, signal }) {
      // Cancellation can win the mkdir race before this stub starts listening.
      signal?.throwIfAborted();
      await Promise.race([
        gate,
        new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
        }),
      ]);
      const filePath = path.join(directory, "track.mp3");
      await writeFile(filePath, tinyMp3);
      return filePath;
    },
  });
}

async function waitForJob(app, cookie, jobId) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await fetch(`${app.origin}/api/playlists/jobs/${jobId}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const { job } = await response.json();
    if (["done", "failed", "cancelled"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Playlist job never finished");
}

test("playlist URLs are recognized only for YouTube list identifiers", () => {
  assert.deepEqual(
    parsePlaylistUrl("https://www.youtube.com/playlist?list=PLabcdefghijklmnop"),
    { id: "PLabcdefghijklmnop", url: "https://www.youtube.com/playlist?list=PLabcdefghijklmnop" },
  );
  assert.equal(
    parsePlaylistUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=OLAK5uy_test").url,
    "https://www.youtube.com/playlist?list=OLAK5uy_test",
  );
  assert.equal(parsePlaylistUrl("https://youtu.be/dQw4w9WgXcQ?list=PLtest12345").id, "PLtest12345");

  // Personal lists need the viewer's own credentials, so they are never offered.
  assert.equal(parsePlaylistUrl("https://www.youtube.com/playlist?list=WL"), null);
  assert.equal(parsePlaylistUrl("https://www.youtube.com/playlist?list=LL"), null);
  // Anything that is not a YouTube host, or carries no list, is ignored.
  assert.equal(parsePlaylistUrl("https://vimeo.com/playlist?list=PLabcdef"), null);
  assert.equal(parsePlaylistUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parsePlaylistUrl("javascript:alert(1)?list=PLabcdef"), null);
  // A shell metacharacter cannot survive the identifier charset.
  assert.equal(parsePlaylistUrl("https://www.youtube.com/playlist?list=PL;rm%20-rf%20/"), null);
  assert.equal(parsePlaylistUrl("https://www.youtube.com/playlist?list=$(id)"), null);

  assert.equal(
    findPlaylistUrl("check this out https://www.youtube.com/playlist?list=PLabcdef123, great set").id,
    "PLabcdef123",
  );
  assert.equal(findPlaylistUrl("no link here"), null);

  assert.equal(normalizeAudioQuality("192K"), "192K");
  assert.equal(normalizeAudioQuality("0"), "0");
  assert.equal(normalizeAudioQuality("; reboot"), "0");
  assert.equal(normalizeAudioQuality(undefined), "0");
});

test("playlist import is gated by session, origin, and server capability", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));

  const disabled = await startApp(dataDir);
  context.after(async () => {
    if (disabled.server.listening) await disabled.close();
  });
  const disabledCookie = await login(disabled);

  const session = await (await fetch(`${disabled.origin}/api/session`)).json();
  assert.equal(session.playlistImport, false);

  const anonymous = await fetch(`${disabled.origin}/api/playlists/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: disabled.origin },
    body: JSON.stringify({ url: "https://www.youtube.com/playlist?list=PLabcdef123" }),
  });
  assert.equal(anonymous.status, 401);

  const unavailable = await fetch(`${disabled.origin}/api/playlists/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: disabled.origin, Cookie: disabledCookie },
    body: JSON.stringify({ url: "https://www.youtube.com/playlist?list=PLabcdef123" }),
  });
  assert.equal(unavailable.status, 503);
  await disabled.close();

  const app = await startApp(dataDir, { playlistImport: true, youtube: stubYoutube() });
  context.after(async () => {
    if (app.server.listening) await app.close();
  });
  const cookie = await login(app);

  const enabledSession = await (await fetch(`${app.origin}/api/session`)).json();
  assert.equal(enabledSession.playlistImport, true);
  assert.equal(enabledSession.playlistMaxTracks, 100);

  const crossOrigin = await fetch(`${app.origin}/api/playlists/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.test", Cookie: cookie },
    body: JSON.stringify({ url: "https://www.youtube.com/playlist?list=PLabcdef123" }),
  });
  assert.equal(crossOrigin.status, 403);

  const notAPlaylist = await fetch(`${app.origin}/api/playlists/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, Cookie: cookie },
    body: JSON.stringify({ url: "https://example.com/songs" }),
  });
  assert.equal(notAPlaylist.status, 400);

  const missingJob = await fetch(`${app.origin}/api/playlists/jobs/11111111-2222-3333-4444-555555555555`, {
    headers: { Cookie: cookie },
  });
  assert.equal(missingJob.status, 404);
});

test("a playlist import stores every track as an MP3 upload", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const youtube = stubYoutube();
  const app = await startApp(dataDir, { playlistImport: true, youtube });
  context.after(async () => {
    app.importer?.cancelAll();
    if (app.server.listening) await app.close();
  });
  const cookie = await login(app);

  const inspected = await fetch(`${app.origin}/api/playlists/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, Cookie: cookie },
    body: JSON.stringify({ url: "look at https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLnightdrive" }),
  });
  assert.equal(inspected.status, 200);
  const { playlist } = await inspected.json();
  assert.equal(playlist.title, "Night drive");
  assert.equal(playlist.tracks.length, 2);
  // The canonical URL is rebuilt from the validated id rather than echoed back.
  assert.equal(playlist.url, "https://www.youtube.com/playlist?list=PLnightdrive");

  const started = await fetch(`${app.origin}/api/playlists/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, Cookie: cookie },
    body: JSON.stringify({ url: playlist.url, visibility: "private" }),
  });
  assert.equal(started.status, 202);
  const { job } = await started.json();
  assert.equal(job.total, 2);

  const finished = await waitForJob(app, cookie, job.id);
  assert.equal(finished.state, "done");
  assert.equal(finished.completed, 2);
  assert.equal(finished.failed, 0);
  assert.deepEqual(youtube.calls.download, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);

  const uploads = await (await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: cookie } })).json();
  assert.equal(uploads.uploads.length, 2);
  assert.deepEqual(uploads.uploads.map((upload) => upload.title).sort(), ["First track", "Second track"]);
  for (const upload of uploads.uploads) {
    assert.equal(upload.mediaKind, "audio");
    assert.equal(upload.mime, "audio/mpeg");
    assert.equal(upload.extension, "mp3");
    assert.equal(upload.visibility, "private");
    assert.equal(upload.titleSource, "manual");
    assert.match(upload.originalName, /\.mp3$/);
    assert.match(upload.publicPath, /^\/[a-z]+-[a-z]+-[a-z0-9]{6}\.mp3$/);
  }
  const first = uploads.uploads.find((upload) => upload.title === "First track");
  assert.equal(first.duration, 191);

  // Imported tracks obey the same visibility rules as a pasted upload.
  assert.equal((await fetch(`${app.origin}${first.publicPath}`)).status, 404);
  const owned = await fetch(`${app.origin}${first.previewUrl}`, { headers: { Cookie: cookie } });
  assert.equal(owned.status, 200);
  assert.equal(owned.headers.get("content-type"), "audio/mpeg");
});

test("a failing track is reported without stopping the rest of the import", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));

  const youtube = stubYoutube({
    async downloadTrack(videoId, { directory }) {
      if (videoId === "aaaaaaaaaaa") throw new Error("Video unavailable");
      const filePath = path.join(directory, "track.mp3");
      await writeFile(filePath, tinyMp3);
      return filePath;
    },
  });
  const app = await startApp(dataDir, { playlistImport: true, youtube });
  context.after(async () => {
    app.importer?.cancelAll();
    if (app.server.listening) await app.close();
  });
  const cookie = await login(app);

  const started = await fetch(`${app.origin}/api/playlists/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, Cookie: cookie },
    body: JSON.stringify({ url: "https://www.youtube.com/playlist?list=PLnightdrive" }),
  });
  assert.equal(started.status, 202);
  const { job } = await started.json();

  const finished = await waitForJob(app, cookie, job.id);
  assert.equal(finished.state, "done");
  assert.equal(finished.completed, 1);
  assert.equal(finished.failed, 1);
  assert.equal(finished.tracks[0].status, "failed");
  assert.equal(finished.tracks[0].error, "Video unavailable");
  assert.equal(finished.tracks[1].status, "done");

  const uploads = await (await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: cookie } })).json();
  assert.equal(uploads.uploads.length, 1);
  assert.equal(uploads.uploads[0].title, "Second track");
  // Imports default to link-only when the request does not name a visibility.
  assert.equal(uploads.uploads[0].visibility, "unlisted");
});

test("one import runs at a time and can be stopped mid-flight", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sardrop-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const youtube = gatedYoutube();
  const app = await startApp(dataDir, { playlistImport: true, youtube });
  context.after(async () => {
    youtube.release();
    app.importer?.cancelAll();
    if (app.server.listening) await app.close();
  });
  const cookie = await login(app);

  const started = await fetch(`${app.origin}/api/playlists/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, Cookie: cookie },
    body: JSON.stringify({ url: "https://www.youtube.com/playlist?list=PLnightdrive" }),
  });
  assert.equal(started.status, 202);
  const { job } = await started.json();

  const concurrent = await fetch(`${app.origin}/api/playlists/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, Cookie: cookie },
    body: JSON.stringify({ url: "https://www.youtube.com/playlist?list=PLother12345" }),
  });
  assert.equal(concurrent.status, 409);

  const stopped = await fetch(`${app.origin}/api/playlists/jobs/${job.id}`, {
    method: "DELETE",
    headers: { Origin: app.origin, Cookie: cookie },
  });
  assert.equal(stopped.status, 200);

  const finished = await waitForJob(app, cookie, job.id);
  assert.equal(finished.state, "cancelled");
  assert.equal(finished.completed, 0);
  assert.deepEqual(finished.tracks.map((track) => track.status), ["cancelled", "cancelled"]);

  const uploads = await (await fetch(`${app.origin}/api/uploads`, { headers: { Cookie: cookie } })).json();
  assert.equal(uploads.uploads.length, 0);
});
