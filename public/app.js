const state = {
  uploads: [],
  filter: "all",
  search: "",
  maxUploadBytes: 25 * 1024 * 1024,
  editingId: null,
  deletingId: null,
  latestUpload: null,
  uploading: false,
};

const elements = {
  boot: document.querySelector("#boot-screen"),
  loginView: document.querySelector("#login-view"),
  loginForm: document.querySelector("#login-form"),
  loginError: document.querySelector("#login-error"),
  password: document.querySelector("#password"),
  showPassword: document.querySelector("#show-password"),
  app: document.querySelector("#app-shell"),
  logout: document.querySelector("#logout-button"),
  dropCard: document.querySelector("#drop-card"),
  choose: document.querySelector("#choose-button"),
  fileInput: document.querySelector("#file-input"),
  privateDefault: document.querySelector("#private-default"),
  uploadQueue: document.querySelector("#upload-queue"),
  latestResult: document.querySelector("#latest-result"),
  latestTitle: document.querySelector("#latest-title"),
  latestUrl: document.querySelector("#latest-url"),
  latestCopy: document.querySelector("#latest-copy"),
  resultClose: document.querySelector("#result-close"),
  statTotal: document.querySelector("#stat-total"),
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
  editPrivate: document.querySelector("#edit-private"),
  saveEdit: document.querySelector("#save-edit"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteForm: document.querySelector("#delete-form"),
  deleteTitle: document.querySelector("#delete-title"),
  confirmDelete: document.querySelector("#confirm-delete"),
  toasts: document.querySelector("#toast-region"),
};

const iconPaths = {
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/>',
  edit: '<path d="m4 16-.7 4.7L8 20l11-11-4-4L4 16ZM13.5 6.5l4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z"/>',
  link: '<path d="m9 15 6-6m-7.5 2.5-2 2a3.5 3.5 0 0 0 5 5l2-2m4-5 2-2a3.5 3.5 0 0 0-5-5l-2 2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
};

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
    const session = await request("/api/session");
    state.maxUploadBytes = session.maxUploadBytes;
    if (session.authenticated) {
      await showApp();
    } else {
      showLogin();
    }
  } catch {
    elements.boot.textContent = "Sardrop could not connect. Refresh to try again.";
  }
}

function showLogin() {
  elements.boot.classList.add("hidden");
  elements.app.classList.add("hidden");
  elements.loginView.classList.remove("hidden");
  window.setTimeout(() => elements.password.focus(), 50);
}

async function showApp() {
  elements.boot.classList.add("hidden");
  elements.loginView.classList.add("hidden");
  elements.app.classList.remove("hidden");
  await loadUploads();
}

async function loadUploads() {
  try {
    const body = await request("/api/uploads");
    state.uploads = body.uploads;
    render();
  } catch (error) {
    if (!elements.app.classList.contains("hidden")) toast(error.message, true);
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
        "X-Upload-Private": String(elements.privateDefault.checked),
      };
      if (dimensions) {
        headers["X-Image-Width"] = String(dimensions.width);
        headers["X-Image-Height"] = String(dimensions.height);
      }
      const body = await request("/api/uploads", { method: "POST", headers, body: file });
      state.uploads.unshift(body.upload);
      uploaded.push(body.upload);
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
    showLatest(uploaded.at(-1));
    toast(`${uploaded.length} ${uploaded.length === 1 ? "image" : "images"} uploaded`);
    elements.latestResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  elements.latestTitle.textContent = upload.isPrivate ? `${upload.title} · private` : upload.title;
  elements.latestUrl.value = upload.url;
  const label = elements.latestCopy.querySelector("span");
  label.textContent = upload.isPrivate ? "Private" : "Copy";
  elements.latestCopy.disabled = upload.isPrivate;
  elements.latestCopy.title = upload.isPrivate ? "Make this upload public before sharing its URL" : "Copy image URL";
  elements.latestResult.classList.remove("hidden");
}

elements.latestCopy.addEventListener("click", async () => {
  if (!state.latestUpload || state.latestUpload.isPrivate) return;
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
  elements.statStorage.textContent = formatBytes(state.uploads.reduce((sum, upload) => sum + upload.size, 0));
  elements.statPrivate.textContent = String(state.uploads.filter((upload) => upload.isPrivate).length);
  renderGallery();
}

function renderGallery() {
  const uploads = state.uploads.filter((upload) => {
    const visibilityMatch = state.filter === "all" || (state.filter === "private" ? upload.isPrivate : !upload.isPrivate);
    const searchMatch = !state.search || `${upload.title} ${upload.originalName} ${upload.publicPath}`.toLowerCase().includes(state.search);
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

  const imageLink = document.createElement("a");
  imageLink.className = "card-image";
  imageLink.href = upload.isPrivate ? upload.previewUrl : upload.url;
  imageLink.target = "_blank";
  imageLink.rel = "noopener";
  imageLink.setAttribute("aria-label", `Open ${upload.title}`);

  const image = document.createElement("img");
  image.src = upload.previewUrl;
  image.alt = upload.title;
  image.loading = "lazy";
  image.decoding = "async";

  const badge = document.createElement("span");
  badge.className = `privacy-badge ${upload.isPrivate ? "" : "privacy-badge--public"}`;
  badge.append(svgIcon(upload.isPrivate ? "lock" : "globe"), document.createTextNode(upload.isPrivate ? "Private" : "Public"));
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
  metadata.textContent = `${relativeDate(upload.createdAt)} · ${formatBytes(upload.size)}${dimensions}`;
  titleBlock.append(title, metadata);

  const edit = document.createElement("button");
  edit.className = "icon-button card-edit";
  edit.type = "button";
  edit.title = "Edit title and privacy";
  edit.setAttribute("aria-label", `Edit ${upload.title}`);
  edit.append(svgIcon("edit"));
  edit.addEventListener("click", () => openEdit(upload.id));
  titleRow.append(titleBlock, edit);

  const urlLine = document.createElement("div");
  urlLine.className = "card-url";
  urlLine.append(svgIcon(upload.isPrivate ? "lock" : "link"));
  const urlText = document.createElement("span");
  urlText.textContent = upload.isPrivate ? "Direct URL disabled while private" : upload.url.replace(/^https?:\/\//, "");
  urlLine.append(urlText);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const copy = makeAction("copy", "Copy URL");
  copy.disabled = upload.isPrivate;
  copy.title = upload.isPrivate ? "Make this image public before sharing" : "Copy direct URL";
  copy.addEventListener("click", async () => {
    await copyText(upload.url);
    toast("Image URL copied");
  });

  const download = document.createElement("a");
  download.className = "card-action";
  download.href = upload.previewUrl;
  download.download = upload.publicPath.slice(1);
  download.append(svgIcon("download"), document.createTextNode("Download"));

  const remove = makeAction("trash", "");
  remove.classList.add("card-action--danger");
  remove.title = "Delete image";
  remove.setAttribute("aria-label", `Delete ${upload.title}`);
  remove.addEventListener("click", () => openDelete(upload.id));
  actions.append(copy, download, remove);

  body.append(titleRow, urlLine, actions);
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
  elements.editPrivate.checked = upload.isPrivate;
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
      body: JSON.stringify({ title: elements.editTitle.value, isPrivate: elements.editPrivate.checked }),
    });
    state.uploads = state.uploads.map((item) => item.id === body.upload.id ? body.upload : item);
    if (state.latestUpload?.id === body.upload.id) showLatest(body.upload);
    render();
    elements.editDialog.close();
    toast(body.upload.isPrivate ? "Image is now private" : "Changes saved — direct URL is live");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.saveEdit.disabled = false;
  }
});

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
