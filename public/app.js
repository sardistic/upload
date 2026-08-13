import { hasGenericImageName, recognizeLocally } from "/ocr.js?v=1";

const state = {
  uploads: [],
  publicUploads: [],
  filter: "all",
  search: "",
  maxUploadBytes: 25 * 1024 * 1024,
  editingId: null,
  deletingId: null,
  latestUpload: null,
  uploading: false,
  autoOcr: true,
  ocrJobs: new Map(),
};

const elements = {
  boot: document.querySelector("#boot-screen"),
  loginView: document.querySelector("#login-view"),
  ownerDialog: document.querySelector("#owner-dialog"),
  ownerAccess: document.querySelector("#owner-access-button"),
  ownerDialogClose: document.querySelector("#owner-dialog-close"),
  loginForm: document.querySelector("#login-form"),
  loginError: document.querySelector("#login-error"),
  password: document.querySelector("#password"),
  showPassword: document.querySelector("#show-password"),
  app: document.querySelector("#app-shell"),
  logout: document.querySelector("#logout-button"),
  dropCard: document.querySelector("#drop-card"),
  choose: document.querySelector("#choose-button"),
  fileInput: document.querySelector("#file-input"),
  uploadVisibility: document.querySelector("#upload-visibility"),
  uploadQueue: document.querySelector("#upload-queue"),
  autoOcr: document.querySelector("#auto-ocr"),
  latestResult: document.querySelector("#latest-result"),
  latestTitle: document.querySelector("#latest-title"),
  latestUrl: document.querySelector("#latest-url"),
  latestCopy: document.querySelector("#latest-copy"),
  resultClose: document.querySelector("#result-close"),
  statTotal: document.querySelector("#stat-total"),
  statViews: document.querySelector("#stat-views"),
  statStorage: document.querySelector("#stat-storage"),
  statPrivate: document.querySelector("#stat-private"),
  search: document.querySelector("#search-input"),
  filters: document.querySelector("#filter-tabs"),
  gallery: document.querySelector("#gallery"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyCopy: document.querySelector("#empty-copy"),
  editDialog: document.querySelector("#edit-dialog"),
  editForm: document.querySelector("#edit-form"),
  editTitle: document.querySelector("#edit-title"),
  editTags: document.querySelector("#edit-tags"),
  editOcrDetail: document.querySelector("#edit-ocr-detail"),
  editVisibility: document.querySelector("#edit-visibility"),
  saveEdit: document.querySelector("#save-edit"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteForm: document.querySelector("#delete-form"),
  deleteTitle: document.querySelector("#delete-title"),
  confirmDelete: document.querySelector("#confirm-delete"),
  publicGallery: document.querySelector("#public-gallery"),
  publicEmpty: document.querySelector("#public-empty"),
  publicCount: document.querySelector("#public-count"),
  toasts: document.querySelector("#toast-region"),
};

const iconPaths = {
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/>',
  edit: '<path d="m4 16-.7 4.7L8 20l11-11-4-4L4 16ZM13.5 6.5l4 4"/>',
  eye: '<path d="M2.2 12s3.3-6 9.8-6 9.8 6 9.8 6-3.3 6-9.8 6-9.8-6-9.8-6Z"/><circle cx="12" cy="12" r="2.7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z"/>',
  link: '<path d="m9 15 6-6m-7.5 2.5-2 2a3.5 3.5 0 0 0 5 5l2-2m4-5 2-2a3.5 3.5 0 0 0-5-5l-2 2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  scan: '<path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4m13 5h4a1 1 0 0 0 1-1v-4M7 9h10M7 12h8M7 15h10"/>',
};

const visibilityDetails = {
  public: { label: "Public", icon: "globe", description: "Shown on the public shelf" },
  unlisted: { label: "Link only", icon: "link", description: "Anyone with the URL" },
  private: { label: "Private", icon: "lock", description: "Only inside your vault" },
};

for (const mark of document.querySelectorAll(".liquid-mark")) {
  const showFallback = () => mark.parentElement.classList.add("brand-glyph--failed");
  mark.addEventListener("error", showFallback, { once: true });
  if (mark.complete && !mark.naturalWidth) showFallback();
}

function svgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.innerHTML = iconPaths[name];
  return svg;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  if (response.status !== 204) {
    try {
      body = await response.json();
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/session") showLogin();
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  return body;
}

async function bootstrap() {
  try {
    try {
      state.autoOcr = window.localStorage.getItem("upload-sardistic-auto-ocr") !== "off";
    } catch {
      state.autoOcr = true;
    }
    elements.autoOcr.checked = state.autoOcr;
    const session = await request("/api/session");
    state.maxUploadBytes = session.maxUploadBytes;
    if (session.authenticated) {
      await showApp();
    } else {
      showLogin();
    }
  } catch {
    elements.boot.textContent = "upload.sardistic.com could not connect. Refresh to try again.";
  }
}

elements.autoOcr.addEventListener("change", () => {
  state.autoOcr = elements.autoOcr.checked;
  try {
    window.localStorage.setItem("upload-sardistic-auto-ocr", state.autoOcr ? "on" : "off");
  } catch {
    // The preference still applies for this page when storage is unavailable.
  }
});

function showLogin() {
  elements.boot.classList.add("hidden");
  elements.app.classList.add("hidden");
  elements.loginView.classList.remove("hidden");
  if (elements.ownerDialog.open) elements.ownerDialog.close();
  loadPublicUploads();
}

async function showApp() {
  elements.boot.classList.add("hidden");
  elements.loginView.classList.add("hidden");
  if (elements.ownerDialog.open) elements.ownerDialog.close();
  elements.app.classList.remove("hidden");
  await loadUploads();
}

elements.ownerAccess.addEventListener("click", () => {
  elements.loginError.classList.add("hidden");
  elements.ownerDialog.showModal();
  window.setTimeout(() => elements.password.focus(), 50);
});

elements.ownerDialogClose.addEventListener("click", () => elements.ownerDialog.close());

async function loadUploads() {
  try {
    const body = await request("/api/uploads");
    state.uploads = body.uploads;
    render();
  } catch (error) {
    if (!elements.app.classList.contains("hidden")) toast(error.message, true);
  }
}

async function loadPublicUploads() {
  try {
    const body = await request("/api/public/uploads");
    state.publicUploads = body.uploads;
    renderPublicGallery();
  } catch (error) {
    elements.publicGallery.replaceChildren();
    elements.publicEmpty.classList.remove("hidden");
    elements.publicEmpty.querySelector("h3").textContent = "The public shelf could not load.";
    elements.publicEmpty.querySelector("p").textContent = error.message;
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = elements.loginForm.querySelector("button[type='submit']");
  submit.disabled = true;
  elements.loginError.classList.add("hidden");

  try {
    await request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: elements.password.value }),
    });
    elements.password.value = "";
    await showApp();
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.loginError.classList.remove("hidden");
    elements.password.select();
  } finally {
    submit.disabled = false;
  }
});

elements.showPassword.addEventListener("click", () => {
  const showing = elements.password.type === "text";
  elements.password.type = showing ? "password" : "text";
  elements.showPassword.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  elements.showPassword.setAttribute("title", showing ? "Show password" : "Hide password");
  elements.password.focus();
});

elements.logout.addEventListener("click", async () => {
  try {
    await request("/api/session", { method: "DELETE" });
  } finally {
    state.uploads = [];
    showLogin();
  }
});

elements.choose.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => {
  uploadFiles([...elements.fileInput.files]);
  elements.fileInput.value = "";
});

document.addEventListener("paste", (event) => {
  if (elements.app.classList.contains("hidden") || state.uploading) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  const images = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  uploadFiles(images);
});

for (const eventName of ["dragenter", "dragover"]) {
  document.addEventListener(eventName, (event) => {
    if (elements.app.classList.contains("hidden")) return;
    event.preventDefault();
    if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) {
      elements.dropCard.classList.add("dragging");
    }
  });
}

for (const eventName of ["dragleave", "drop"]) {
  document.addEventListener(eventName, (event) => {
    if (elements.app.classList.contains("hidden")) return;
    event.preventDefault();
    if (eventName === "dragleave" && event.relatedTarget) return;
    elements.dropCard.classList.remove("dragging");
  });
}

document.addEventListener("drop", (event) => {
  if (elements.app.classList.contains("hidden") || state.uploading) return;
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/") || !file.type);
  if (files.length) uploadFiles(files);
});

async function uploadFiles(files) {
  if (!files.length || state.uploading) return;
  const validFiles = files.filter((file) => {
    if (file.size > state.maxUploadBytes) {
      toast(`${file.name || "That image"} is larger than ${formatBytes(state.maxUploadBytes)}`, true);
      return false;
    }
    return true;
  });
  if (!validFiles.length) return;

  state.uploading = true;
  elements.dropCard.classList.add("uploading");
  elements.uploadQueue.classList.remove("hidden");
  const uploaded = [];

  for (let index = 0; index < validFiles.length; index += 1) {
    const file = validFiles[index];
    showQueue(file.name || "Pasted image", index + 1, validFiles.length);
    try {
      const dimensions = await getImageDimensions(file);
      const headers = {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || "pasted-image"),
        "X-Upload-Visibility": selectedVisibility("upload-visibility"),
      };
      if (dimensions) {
        headers["X-Image-Width"] = String(dimensions.width);
        headers["X-Image-Height"] = String(dimensions.height);
      }
      const body = await request("/api/uploads", { method: "POST", headers, body: file });
      state.uploads.unshift(body.upload);
      uploaded.push({ upload: body.upload, file });
    } catch (error) {
      toast(`${file.name || "Image"}: ${error.message}`, true);
    }
  }

  state.uploading = false;
  elements.dropCard.classList.remove("uploading");
  elements.uploadQueue.classList.add("hidden");
  elements.uploadQueue.replaceChildren();
  render();

  if (uploaded.length) {
    showLatest(uploaded.at(-1).upload);
    toast(`${uploaded.length} ${uploaded.length === 1 ? "image" : "images"} uploaded`);
    elements.latestResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (state.autoOcr) {
      for (const item of uploaded) scanUpload(item.upload.id, item.file);
    }
  }
}

function showQueue(name, current, total) {
  const wrapper = document.createElement("div");
  wrapper.className = "queue-content";
  const spinner = document.createElement("span");
  spinner.className = "queue-spinner";
  const title = document.createElement("strong");
  title.textContent = name;
  const detail = document.createElement("span");
  detail.textContent = total > 1 ? `Uploading ${current} of ${total}…` : "Forging your new link…";
  wrapper.append(spinner, title, detail);
  elements.uploadQueue.replaceChildren(wrapper);
}

async function getImageDimensions(file) {
  if (!("createImageBitmap" in window)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return null;
  }
}

function showLatest(upload) {
  state.latestUpload = upload;
  const visibility = visibilityDetails[upload.visibility];
  elements.latestTitle.textContent = `${upload.title} · ${visibility.label.toLowerCase()}`;
  elements.latestUrl.value = upload.url;
  const label = elements.latestCopy.querySelector("span");
  label.textContent = upload.visibility === "private" ? "Private" : "Copy";
  elements.latestCopy.disabled = upload.visibility === "private";
  elements.latestCopy.title = upload.visibility === "private" ? "Choose Public or Link only before sharing" : "Copy image URL";
  elements.latestResult.classList.remove("hidden");
}

elements.latestCopy.addEventListener("click", async () => {
  if (!state.latestUpload || state.latestUpload.visibility === "private") return;
  await copyText(state.latestUpload.url);
  const label = elements.latestCopy.querySelector("span");
  label.textContent = "Copied";
  window.setTimeout(() => { label.textContent = "Copy"; }, 1500);
});

elements.resultClose.addEventListener("click", () => {
  elements.latestResult.classList.add("hidden");
});

elements.search.addEventListener("input", () => {
  state.search = elements.search.value.trim().toLowerCase();
  renderGallery();
});

elements.filters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  for (const item of elements.filters.querySelectorAll("button")) item.classList.toggle("active", item === button);
  renderGallery();
});

function render() {
  elements.statTotal.textContent = String(state.uploads.length);
  elements.statViews.textContent = formatCount(state.uploads.reduce((sum, upload) => sum + upload.views, 0));
  elements.statStorage.textContent = formatBytes(state.uploads.reduce((sum, upload) => sum + upload.size, 0));
  elements.statPrivate.textContent = String(state.uploads.filter((upload) => upload.visibility === "private").length);
  renderGallery();
}

function renderPublicGallery() {
  const uploads = state.publicUploads;
  elements.publicGallery.replaceChildren(...uploads.map(makePublicCard));
  elements.publicEmpty.classList.toggle("hidden", uploads.length > 0);
  elements.publicCount.textContent = `${uploads.length} ${uploads.length === 1 ? "image" : "images"}`;
}

function makePublicCard(upload) {
  const card = document.createElement("article");
  card.className = "public-card";

  const imageLink = document.createElement("a");
  imageLink.className = "public-card__image";
  imageLink.href = upload.url;
  imageLink.target = "_blank";
  imageLink.rel = "noopener";
  imageLink.setAttribute("aria-label", `Open ${upload.title}`);

  const image = document.createElement("img");
  image.src = upload.previewUrl;
  image.alt = upload.title;
  image.loading = "lazy";
  image.decoding = "async";
  const views = document.createElement("span");
  views.className = "view-pill";
  views.append(svgIcon("eye"), document.createTextNode(formatCount(upload.views)));
  imageLink.append(image, views);

  const body = document.createElement("div");
  body.className = "public-card__body";
  const text = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = upload.title;
  title.title = upload.title;
  const metadata = document.createElement("small");
  const dimensions = upload.width && upload.height ? ` · ${upload.width}×${upload.height}` : "";
  metadata.textContent = `${relativeDate(upload.createdAt)}${dimensions}`;
  text.append(title, metadata);

  const copy = document.createElement("button");
  copy.className = "icon-button public-card__copy";
  copy.type = "button";
  copy.title = "Copy image URL";
  copy.setAttribute("aria-label", `Copy URL for ${upload.title}`);
  copy.append(svgIcon("copy"));
  copy.addEventListener("click", async () => {
    await copyText(upload.url);
    toast("Public image URL copied");
  });
  body.append(text, copy);
  card.append(imageLink, body);
  return card;
}

function renderGallery() {
  const uploads = state.uploads.filter((upload) => {
    const visibilityMatch = state.filter === "all" || upload.visibility === state.filter;
    const searchMatch = !state.search || `${upload.title} ${upload.originalName} ${upload.publicPath} ${(upload.tags ?? []).join(" ")} ${upload.ocrText ?? ""}`.toLowerCase().includes(state.search);
    return visibilityMatch && searchMatch;
  });

  elements.gallery.replaceChildren(...uploads.map(makeCard));
  elements.empty.classList.toggle("hidden", uploads.length > 0);

  if (!uploads.length) {
    const hasQuery = Boolean(state.search) || state.filter !== "all";
    elements.emptyTitle.textContent = hasQuery ? "No matching uploads" : "Nothing here yet";
    elements.emptyCopy.textContent = hasQuery
      ? "Try a different search or switch the visibility filter."
      : "Paste a screenshot anywhere on this page to create your first link.";
  }
}

function makeCard(upload) {
  const card = document.createElement("article");
  card.className = "image-card";
  const visibility = visibilityDetails[upload.visibility];

  const imageLink = document.createElement("a");
  imageLink.className = "card-image";
  imageLink.href = upload.visibility === "private" ? upload.previewUrl : upload.url;
  imageLink.target = "_blank";
  imageLink.rel = "noopener";
  imageLink.setAttribute("aria-label", `Open ${upload.title}`);

  const image = document.createElement("img");
  image.src = upload.previewUrl;
  image.alt = upload.title;
  image.loading = "lazy";
  image.decoding = "async";

  const badge = document.createElement("span");
  badge.className = `privacy-badge privacy-badge--${upload.visibility}`;
  badge.append(svgIcon(visibility.icon), document.createTextNode(visibility.label));
  imageLink.append(image, badge);

  const body = document.createElement("div");
  body.className = "card-body";
  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";
  const titleBlock = document.createElement("div");
  titleBlock.className = "card-title";
  const title = document.createElement("h3");
  title.textContent = upload.title;
  title.title = upload.title;
  const metadata = document.createElement("p");
  const dimensions = upload.width && upload.height ? ` · ${upload.width}×${upload.height}` : "";
  metadata.textContent = `${relativeDate(upload.createdAt)} · ${formatBytes(upload.size)}${dimensions} · ${formatCount(upload.views)} ${upload.views === 1 ? "view" : "views"}`;
  titleBlock.append(title, metadata);

  const edit = document.createElement("button");
  edit.className = "icon-button card-edit";
  edit.type = "button";
  edit.title = "Edit title and privacy";
  edit.setAttribute("aria-label", `Edit ${upload.title}`);
  edit.append(svgIcon("edit"));
  edit.addEventListener("click", () => openEdit(upload.id));
  titleRow.append(titleBlock, edit);

  const tags = document.createElement("div");
  tags.className = "card-tags";
  const job = state.ocrJobs.get(upload.id);
  if (job) {
    const status = document.createElement("span");
    status.className = `ocr-state ocr-state--${job.state}`;
    status.textContent = job.label;
    tags.append(status);
  } else if ((upload.tags ?? []).length) {
    for (const tag of upload.tags.slice(0, 5)) {
      const item = document.createElement("span");
      item.className = "card-tag";
      item.textContent = tag;
      tags.append(item);
    }
  } else {
    const status = document.createElement("span");
    status.className = `ocr-state${upload.ocrUpdatedAt ? " ocr-state--complete" : ""}`;
    status.textContent = upload.ocrUpdatedAt
      ? (upload.ocrText ? `Text indexed · ${upload.ocrConfidence ?? 0}%` : "Scanned · no text")
      : "Not scanned";
    tags.append(status);
  }

  const urlLine = document.createElement("div");
  urlLine.className = "card-url";
  urlLine.append(svgIcon(visibility.icon));
  const urlText = document.createElement("span");
  urlText.textContent = upload.visibility === "private" ? "Direct URL disabled while private" : upload.url.replace(/^https?:\/\//, "");
  urlLine.append(urlText);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const copy = makeAction("copy", "Copy URL");
  copy.disabled = upload.visibility === "private";
  copy.title = upload.visibility === "private" ? "Choose Public or Link only before sharing" : "Copy direct URL";
  copy.addEventListener("click", async () => {
    await copyText(upload.url);
    toast("Image URL copied");
  });

  const download = document.createElement("a");
  download.className = "card-action";
  download.href = upload.previewUrl;
  download.download = upload.publicPath.slice(1);
  download.append(svgIcon("download"), document.createTextNode("Download"));

  const scanLabel = job?.state === "running" ? "Working" : (job?.state === "error" ? "Retry" : (upload.ocrUpdatedAt ? "Rescan" : "Scan"));
  const scan = makeAction("scan", scanLabel);
  scan.disabled = Boolean(job && job.state === "running");
  scan.title = "Extract searchable text and tags locally in this browser";
  scan.addEventListener("click", () => scanUpload(upload.id));

  const remove = makeAction("trash", "");
  remove.classList.add("card-action--danger");
  remove.title = "Delete image";
  remove.setAttribute("aria-label", `Delete ${upload.title}`);
  remove.addEventListener("click", () => openDelete(upload.id));
  actions.append(copy, download, scan, remove);

  body.append(titleRow, tags, urlLine, actions);
  card.append(imageLink, body);
  return card;
}

function makeAction(icon, label) {
  const button = document.createElement("button");
  button.className = "card-action";
  button.type = "button";
  button.append(svgIcon(icon));
  if (label) button.append(document.createTextNode(label));
  return button;
}

function openEdit(id) {
  const upload = state.uploads.find((item) => item.id === id);
  if (!upload) return;
  state.editingId = id;
  elements.editTitle.value = upload.title;
  elements.editTags.value = (upload.tags ?? []).join(", ");
  if (upload.ocrUpdatedAt) {
    const confidence = upload.ocrConfidence === null ? "unknown confidence" : `${upload.ocrConfidence}% confidence`;
    const excerpt = upload.ocrText ? `\n${upload.ocrText.slice(0, 500)}` : "\nNo readable text found.";
    elements.editOcrDetail.textContent = `Local OCR · ${confidence}${excerpt}`;
  } else {
    elements.editOcrDetail.textContent = "No text scan saved. Use Scan on the image card to index it.";
  }
  setSelectedVisibility("edit-visibility", upload.visibility);
  elements.editDialog.showModal();
  elements.editTitle.select();
}

elements.editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.editDialog.close();
    return;
  }
  const upload = state.uploads.find((item) => item.id === state.editingId);
  if (!upload) return elements.editDialog.close();

  elements.saveEdit.disabled = true;
  try {
    const body = await request(`/api/uploads/${upload.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: elements.editTitle.value,
        tags: elements.editTags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
        visibility: selectedVisibility("edit-visibility"),
      }),
    });
    state.uploads = state.uploads.map((item) => item.id === body.upload.id ? body.upload : item);
    if (state.latestUpload?.id === body.upload.id) showLatest(body.upload);
    render();
    elements.editDialog.close();
    const detail = visibilityDetails[body.upload.visibility];
    toast(`Saved as ${detail.label} — ${detail.description.toLowerCase()}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.saveEdit.disabled = false;
  }
});

async function scanUpload(id, source = null) {
  const original = state.uploads.find((item) => item.id === id);
  if (!original || state.ocrJobs.get(id)?.state === "running") return;
  state.ocrJobs.delete(id);

  state.ocrJobs.set(id, { state: "running", label: "OCR queued" });
  renderGallery();
  let lastRenderedAt = 0;
  let lastPercent = -1;

  try {
    let imageSource = source;
    if (!imageSource) {
      const response = await fetch(original.previewUrl);
      if (!response.ok) throw new Error("Could not read the image");
      imageSource = await response.blob();
    }
    const result = await recognizeLocally(imageSource, (progress) => {
      const percent = Number.isFinite(progress.progress) ? Math.round(progress.progress * 100) : 0;
      const now = Date.now();
      if (now - lastRenderedAt < 250 && percent === lastPercent) return;
      lastRenderedAt = now;
      lastPercent = percent;
      const phase = ocrPhase(progress.status);
      state.ocrJobs.set(id, { state: "running", label: percent ? `${phase} · ${percent}%` : phase });
      renderGallery();
    });
    const latest = state.uploads.find((item) => item.id === id) ?? original;
    const body = await request(`/api/uploads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ocr: {
          ...result,
          applyTitle: hasGenericImageName(latest.title) || hasGenericImageName(latest.originalName),
        },
      }),
    });
    state.uploads = state.uploads.map((item) => item.id === id ? body.upload : item);
    if (state.latestUpload?.id === id) showLatest(body.upload);
    state.ocrJobs.delete(id);
    render();
    if (result.text) {
      const details = result.tags.length ? ` and ${result.tags.length} tags` : "";
      toast(`Local OCR indexed text${details}`);
    } else {
      toast("Local OCR found no readable text");
    }
  } catch (error) {
    state.ocrJobs.set(id, { state: "error", label: "OCR failed" });
    renderGallery();
    toast(`OCR: ${error.message}`, true);
  }
}

function ocrPhase(status) {
  const phases = {
    "preparing image": "Preparing",
    "loading tesseract core": "Loading OCR",
    "loaded tesseract core": "Loading OCR",
    "initializing tesseract": "Starting OCR",
    "initialized tesseract": "Starting OCR",
    "loading language traineddata": "Loading English",
    "loaded language traineddata": "Loading English",
    "initializing api": "Starting OCR",
    "recognizing text": "Reading text",
  };
  return phases[String(status ?? "").toLowerCase()] ?? "Local OCR";
}

function openDelete(id) {
  const upload = state.uploads.find((item) => item.id === id);
  if (!upload) return;
  state.deletingId = id;
  elements.deleteTitle.textContent = upload.title;
  elements.deleteDialog.showModal();
}

elements.deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.deleteDialog.close();
    return;
  }
  const upload = state.uploads.find((item) => item.id === state.deletingId);
  if (!upload) return elements.deleteDialog.close();

  elements.confirmDelete.disabled = true;
  try {
    await request(`/api/uploads/${upload.id}`, { method: "DELETE" });
    state.uploads = state.uploads.filter((item) => item.id !== upload.id);
    if (state.latestUpload?.id === upload.id) {
      state.latestUpload = null;
      elements.latestResult.classList.add("hidden");
    }
    render();
    elements.deleteDialog.close();
    toast("Image permanently deleted");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.confirmDelete.disabled = false;
  }
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function toast(message, error = false) {
  const item = document.createElement("div");
  item.className = `toast${error ? " toast--error" : ""}`;
  item.textContent = message;
  elements.toasts.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function selectedVisibility(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? "unlisted";
}

function setSelectedVisibility(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function formatCount(value) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function relativeDate(value) {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
}

bootstrap();
