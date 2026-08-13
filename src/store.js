import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((tag) => String(tag ?? "").trim().slice(0, 32))
    .filter(Boolean))]
    .slice(0, 8);
}

export class UploadStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.imagesDir = path.join(dataDir, "images");
    this.metadataPath = path.join(dataDir, "metadata.json");
    this.state = { version: 3, uploads: [] };
    this.mutationQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.imagesDir, { recursive: true });

    try {
      const stored = JSON.parse(await readFile(this.metadataPath, "utf8"));
      if (![1, 2, 3].includes(stored?.version) || !Array.isArray(stored.uploads)) {
        throw new Error("Unsupported metadata format");
      }
      const needsMigration = stored.version !== 3 || stored.uploads.some((upload) => (
        !["public", "unlisted", "private"].includes(upload.visibility)
        || !Number.isInteger(upload.views)
        || upload.views < 0
        || Object.hasOwn(upload, "isPrivate")
        || !Array.isArray(upload.tags)
        || typeof upload.ocrText !== "string"
        || !["filename", "ocr", "manual"].includes(upload.titleSource)
        || !Object.hasOwn(upload, "ocrConfidence")
        || !Object.hasOwn(upload, "ocrUpdatedAt")
      ));
      this.state = {
        version: 3,
        uploads: stored.uploads.map((upload) => {
          const { isPrivate, ...rest } = upload;
          return {
            ...rest,
            visibility: ["public", "unlisted", "private"].includes(upload.visibility)
              ? upload.visibility
              : (isPrivate ? "private" : "public"),
            views: Number.isInteger(upload.views) && upload.views >= 0 ? upload.views : 0,
            tags: normalizeTags(upload.tags),
            ocrText: typeof upload.ocrText === "string" ? upload.ocrText.slice(0, 20_000) : "",
            ocrConfidence: Number.isFinite(upload.ocrConfidence)
              ? Math.max(0, Math.min(100, Math.round(upload.ocrConfidence)))
              : null,
            ocrUpdatedAt: typeof upload.ocrUpdatedAt === "string" ? upload.ocrUpdatedAt : null,
            titleSource: ["filename", "ocr", "manual"].includes(upload.titleSource)
              ? upload.titleSource
              : "manual",
          };
        }),
      };
      if (needsMigration) await this.persist();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  list() {
    return [...this.state.uploads].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findById(id) {
    return this.state.uploads.find((upload) => upload.id === id) ?? null;
  }

  findByPath(publicPath) {
    return this.state.uploads.find((upload) => upload.publicPath === publicPath) ?? null;
  }

  hasPath(publicPath) {
    return this.state.uploads.some((upload) => upload.publicPath === publicPath);
  }

  imagePath(upload) {
    return path.join(this.imagesDir, `${upload.id}.${upload.extension}`);
  }

  async create(upload, imageBuffer) {
    return this.mutate(async () => {
      await writeFile(this.imagePath(upload), imageBuffer, { flag: "wx", mode: 0o600 });
      this.state.uploads.push(upload);

      try {
        await this.persist();
      } catch (error) {
        this.state.uploads = this.state.uploads.filter((item) => item.id !== upload.id);
        await rm(this.imagePath(upload), { force: true });
        throw error;
      }

      return upload;
    });
  }

  async update(id, changes) {
    return this.mutate(async () => {
      const upload = this.findById(id);
      if (!upload) return null;
      const previous = { ...upload };
      Object.assign(upload, changes, { updatedAt: new Date().toISOString() });
      try {
        await this.persist();
      } catch (error) {
        Object.assign(upload, previous);
        throw error;
      }
      return upload;
    });
  }

  async incrementViews(id) {
    return this.mutate(async () => {
      const upload = this.findById(id);
      if (!upload) return null;
      const previousViews = upload.views;
      const previousLastViewedAt = upload.lastViewedAt;
      upload.views += 1;
      upload.lastViewedAt = new Date().toISOString();
      try {
        await this.persist();
      } catch (error) {
        upload.views = previousViews;
        if (previousLastViewedAt) upload.lastViewedAt = previousLastViewedAt;
        else delete upload.lastViewedAt;
        throw error;
      }
      return upload;
    });
  }

  async delete(id) {
    return this.mutate(async () => {
      const upload = this.findById(id);
      if (!upload) return null;

      const imagePath = this.imagePath(upload);
      const stagedPath = `${imagePath}.deleting`;
      const index = this.state.uploads.indexOf(upload);
      try {
        await rename(imagePath, stagedPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      this.state.uploads = this.state.uploads.filter((item) => item.id !== id);
      try {
        await this.persist();
      } catch (error) {
        this.state.uploads.splice(index, 0, upload);
        try {
          await rename(stagedPath, imagePath);
        } catch (restoreError) {
          if (restoreError.code !== "ENOENT") throw restoreError;
        }
        throw error;
      }
      await rm(stagedPath, { force: true });
      return upload;
    });
  }

  async persist() {
    const temporaryPath = `${this.metadataPath}.next`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.metadataPath);
  }

  mutate(operation) {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => {});
    return next;
  }
}
