const TESSERACT_VERSION = "7.0.0";
const MAX_EDGE = 2400;
const MAX_PIXELS = 6_000_000;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before",
  "being", "but", "can", "could", "did", "does", "each", "for", "from", "had",
  "has", "have", "here", "how", "into", "its", "just", "more", "most", "not",
  "now", "only", "other", "our", "out", "over", "some", "such", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "too", "under", "use", "very", "was", "were", "what", "when",
  "where", "which", "while", "who", "will", "with", "would", "you", "your",
]);

let workerPromise = null;
let currentProgress = null;
let queue = Promise.resolve();

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-local-tesseract]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Tesseract), { once: true });
      existing.addEventListener("error", () => reject(new Error("Local OCR engine could not load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `/vendor/tesseract/tesseract.min.js?v=${TESSERACT_VERSION}`;
    script.dataset.localTesseract = "true";
    script.addEventListener("load", () => resolve(window.Tesseract), { once: true });
    script.addEventListener("error", () => reject(new Error("Local OCR engine could not load")), { once: true });
    document.head.append(script);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await loadTesseract();
      return Tesseract.createWorker("eng", 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract/core",
        langPath: "/vendor/tesseract/lang",
        logger(message) {
          currentProgress?.(message);
        },
      });
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function normalizeImage(source) {
  if (!("createImageBitmap" in window)) return source;
  const bitmap = await createImageBitmap(source);
  try {
    const edgeScale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const pixelScale = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
    const scale = Math.min(edgeScale, pixelScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare image for OCR")), "image/png");
    });
  } finally {
    bitmap.close();
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 20_000);
}

function suggestTitle(text, confidence) {
  if (confidence < 42) return "";
  const lines = text.split("\n")
    .map((line) => line.replace(/^[^a-z0-9]+|[^a-z0-9.!?'():,+&\-]+$/gi, "").trim())
    .filter((line) => line.length >= 4 && line.length <= 96 && /[a-z]{3}/i.test(line));
  const candidate = lines.find((line) => line.split(/\s+/).length <= 14) ?? "";
  return candidate.slice(0, 120);
}

function suggestTags(text) {
  const words = text.toLocaleLowerCase("en-US").match(/[a-z][a-z0-9'-]{2,31}/g) ?? [];
  const scores = new Map();
  words.forEach((word, index) => {
    const cleaned = word.replace(/^'+|'+$/g, "");
    if (cleaned.length < 3 || STOP_WORDS.has(cleaned) || /^\d+$/.test(cleaned)) return;
    const previous = scores.get(cleaned) ?? { count: 0, first: index };
    previous.count += 1;
    scores.set(cleaned, previous);
  });
  return [...scores.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].first - right[1].first)
    .slice(0, 8)
    .map(([word]) => word);
}

export function hasGenericImageName(value) {
  const name = String(value ?? "").replace(/\.[a-z0-9]+$/i, "").trim();
  return /^(?:pasted[ _-]?image|clipboard|screen(?: ?shot)?|screenshot|capture|untitled|image|img[ _-]?\d+|photo[ _-]?\d+)$/i.test(name);
}

export function recognizeLocally(source, onProgress = () => {}) {
  const operation = queue.then(async () => {
    currentProgress = onProgress;
    try {
      onProgress({ status: "preparing image", progress: 0 });
      const image = await normalizeImage(source);
      const worker = await getWorker();
      const result = await worker.recognize(image);
      const text = normalizeText(result.data?.text);
      const confidence = Number.isFinite(result.data?.confidence)
        ? Math.max(0, Math.min(100, Math.round(result.data.confidence)))
        : 0;
      return {
        text,
        confidence,
        tags: suggestTags(text),
        suggestedTitle: suggestTitle(text, confidence),
      };
    } finally {
      currentProgress = null;
    }
  });
  queue = operation.catch(() => {});
  return operation;
}
