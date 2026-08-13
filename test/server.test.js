import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

test("owner flow uploads, privates, persists, and deletes an image", async (context) => {
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
      "X-Upload-Private": "false",
    },
    body: onePixelPng,
  });
  assert.equal(uploadResponse.status, 201);
  const { upload } = await uploadResponse.json();
  assert.equal(upload.mime, "image/png");
  assert.equal(upload.width, 1);
  assert.equal(upload.height, 1);
  assert.equal(upload.isPrivate, false);
  assert.match(upload.publicPath, /^\/[a-z]+-[a-z]+-[a-z0-9]{6}\.png$/);

  const publicImage = await fetch(`${app.origin}${upload.publicPath}`);
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get("cache-control"), "no-store");
  assert.equal(publicImage.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), onePixelPng);

  const privateResponse = await fetch(`${app.origin}/api/uploads/${upload.id}`, {
    method: "PATCH",
    headers: { Cookie: cookie, Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ isPrivate: true, title: "A private pixel" }),
  });
  assert.equal(privateResponse.status, 200);
  assert.equal((await privateResponse.json()).upload.title, "A private pixel");
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
