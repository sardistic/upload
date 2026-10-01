import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

const FINISHED = new Set(["done", "failed", "cancelled"]);
const RETAINED_JOBS = 8;
const RETENTION_MS = 2 * 60 * 60_000;

function trackTitle(track) {
  return String(track?.title ?? "").trim() || track?.id || "Untitled track";
}

function safeMp3Name(title) {
  const base = String(title ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${base || "track"}.mp3`;
}

/**
 * Imports YouTube playlists as MP3 uploads, one track at a time.
 *
 * Jobs live only in this process: the uploads they produce are ordinary persisted
 * records, but progress is deliberately ephemeral so no metadata version has to
 * describe a transient download. Only one job runs at a time, which keeps the
 * single-process memory and CPU budget predictable.
 */
export class PlaylistImporter {
  constructor({
    youtube,
    ingest,
    workDir,
    maxTracks = 100,
    maxUploadBytes = 50 * 1024 * 1024,
  }) {
    this.youtube = youtube;
    this.ingest = ingest;
    this.workDir = workDir;
    this.maxTracks = maxTracks;
    this.maxUploadBytes = maxUploadBytes;
    this.jobs = new Map();
  }

  get maxSourceBytes() {
    return Math.min(this.maxUploadBytes * 4, 512 * 1024 * 1024);
  }

  async inspect(playlist) {
    return this.youtube.inspectPlaylist(playlist, { maxTracks: this.maxTracks });
  }

  activeJob() {
    return [...this.jobs.values()].find((job) => !FINISHED.has(job.state)) ?? null;
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  start({ playlist, tracks, visibility }) {
    if (this.activeJob()) {
      const error = new Error("A playlist import is already running");
      error.statusCode = 409;
      throw error;
    }
    const selected = tracks.slice(0, this.maxTracks);
    if (!selected.length) {
      const error = new Error("That playlist has no downloadable tracks");
      error.statusCode = 400;
      throw error;
    }

    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      playlistId: playlist.id,
      playlistUrl: playlist.url,
      playlistTitle: playlist.title,
      visibility,
      state: "queued",
      total: selected.length,
      completed: 0,
      failed: 0,
      currentIndex: 0,
      error: null,
      createdAt: now,
      finishedAt: null,
      controller: new AbortController(),
      tracks: selected.map((track) => ({
        id: track.id,
        title: trackTitle(track),
        duration: Number.isFinite(track.duration) && track.duration > 0 ? track.duration : null,
        status: "queued",
        uploadId: null,
        url: null,
        error: null,
      })),
    };

    this.jobs.set(job.id, job);
    this.prune();
    job.promise = this.#run(job).catch((error) => {
      job.state = "failed";
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
    });
    return job;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (!FINISHED.has(job.state)) job.controller.abort();
    return job;
  }

  cancelAll() {
    for (const job of this.jobs.values()) {
      if (!FINISHED.has(job.state)) job.controller.abort();
    }
  }

  prune() {
    const cutoff = Date.now() - RETENTION_MS;
    const finished = this.list().filter((job) => FINISHED.has(job.state));
    for (const job of finished.slice(RETAINED_JOBS)) this.jobs.delete(job.id);
    for (const job of finished) {
      if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) this.jobs.delete(job.id);
    }
  }

  async #run(job) {
    job.state = "running";
    await mkdir(this.workDir, { recursive: true });

    for (const [index, track] of job.tracks.entries()) {
      if (job.controller.signal.aborted) {
        track.status = "cancelled";
        continue;
      }
      job.currentIndex = index + 1;
      track.status = "running";
      try {
        const upload = await this.#importTrack(job, track);
        track.status = "done";
        track.uploadId = upload.id;
        track.url = upload.publicPath;
        job.completed += 1;
      } catch (error) {
        if (job.controller.signal.aborted) {
          track.status = "cancelled";
          continue;
        }
        track.status = "failed";
        track.error = String(error.message ?? error).slice(0, 240);
        job.failed += 1;
      }
    }

    job.currentIndex = job.total;
    job.finishedAt = new Date().toISOString();
    if (job.controller.signal.aborted) job.state = "cancelled";
    else if (job.completed) job.state = "done";
    else job.state = "failed";
  }

  async #importTrack(job, track) {
    const directory = await mkdtemp(path.join(this.workDir, "track-"));
    try {
      const filePath = await this.youtube.downloadTrack(track.id, {
        directory,
        maxSourceBytes: this.maxSourceBytes,
        signal: job.controller.signal,
      });
      const buffer = await readFile(filePath);
      if (buffer.length > this.maxUploadBytes) {
        throw new Error("Converted MP3 is larger than the upload limit");
      }
      return await this.ingest(buffer, {
        suppliedName: safeMp3Name(track.title),
        claimedMime: "audio/mpeg",
        title: track.title,
        duration: track.duration,
        visibility: job.visibility,
        titleSource: "manual",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function serializePlaylistJob(job) {
  return {
    id: job.id,
    playlistId: job.playlistId,
    playlistTitle: job.playlistTitle,
    playlistUrl: job.playlistUrl,
    visibility: job.visibility,
    state: job.state,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    currentIndex: job.currentIndex,
    currentTitle: job.tracks[Math.max(0, job.currentIndex - 1)]?.title ?? null,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    tracks: job.tracks.map((track) => ({
      id: track.id,
      title: track.title,
      duration: track.duration,
      status: track.status,
      uploadId: track.uploadId,
      url: track.url,
      error: track.error,
    })),
  };
}
