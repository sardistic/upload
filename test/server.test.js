import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSardropServer } from "../src/server.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function startApp(dataDir) {
  const app = await createSardropServer({
    dataDir,
    password: "correct horse battery staple",
    sessionSecret: "test-session-secret-that-is-longer-than-thirty-two-characters",
    baseUrl: "http://sardrop.test",
    secureCookies: false,
    maxUploadMb: 2,
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
  assert.match(await home.text(), /Paste it/);

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
  assert.equal(upload.width, 1);
  assert.equal(upload.height, 1);
  assert.equal(upload.visibility, "public");
  assert.equal(upload.views, 0);
  assert.match(upload.publicPath, /^\/[a-z]+-[a-z]+-[a-z0-9]{6}\.png$/);

  const publicFeed = await fetch(`${app.origin}/api/public/uploads`);
  const publicUploads = (await publicFeed.json()).uploads;
  assert.equal(publicUploads.length, 1);
  assert.equal(publicUploads[0].id, upload.id);
  assert.equal(publicUploads[0].views, 0);
  assert.equal(Object.hasOwn(publicUploads[0], "originalName"), false);

  const publicPreview = await fetch(`${app.origin}${publicUploads[0].previewUrl}`);
  assert.equal(publicPreview.status, 200);
  const headImage = await fetch(`${app.origin}${upload.publicPath}`, { method: "HEAD" });
  assert.equal(headImage.status, 200);

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
  assert.equal((await fetch(`${app.origin}${upload.publicPath}`)).status, 200);

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
  assert.equal(migrated.version, 2);
  assert.equal(Object.hasOwn(migrated.uploads[0], "isPrivate"), false);
});
