import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class UploadStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.imagesDir = path.join(dataDir, "images");
    this.metadataPath = path.join(dataDir, "metadata.json");
    this.state = { version: 1, uploads: [] };
    this.mutationQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.imagesDir, { recursive: true });

    try {
      const stored = JSON.parse(await readFile(this.metadataPath, "utf8"));
      if (stored?.version !== 1 || !Array.isArray(stored.uploads)) {
        throw new Error("Unsupported metadata format");
      }
      this.state = stored;
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
