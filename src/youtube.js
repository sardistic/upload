import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const AUDIO_QUALITY = /^(?:10|[0-9]|[1-9][0-9]{1,3}[kK])$/;
const PERSONAL_LISTS = new Set(["WL", "LL"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);
const UNAVAILABLE_TITLES = new Set([
  "[private video]",
  "[deleted video]",
  "[unavailable video]",
  "[video unavailable]",
]);

/**
 * Accepts a single candidate string and returns the canonical playlist it names,
 * or null. The returned URL is rebuilt from a validated id rather than reusing the
 * pasted text, so nothing an operator pasted is ever handed to a subprocess verbatim.
 */
export function parsePlaylistUrl(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 2048) return null;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const list = url.searchParams.get("list");
  if (!list || !PLAYLIST_ID.test(list) || PERSONAL_LISTS.has(list)) return null;

  return { id: list, url: `https://www.youtube.com/playlist?list=${list}` };
}

/** Scans pasted text for the first token that resolves to a playlist. */
export function findPlaylistUrl(text) {
  const source = String(text ?? "").slice(0, 4096);
  if (!source.includes("list=")) return null;
  for (const token of source.split(/\s+/)) {
    const trimmed = token.replace(/^[<("'`]+/, "").replace(/[>)"'`,.;!]+$/, "");
    const playlist = parsePlaylistUrl(trimmed);
    if (playlist) return playlist;
  }
  return null;
}

export function normalizeAudioQuality(value, fallback = "0") {
  const quality = String(value ?? "").trim();
  return AUDIO_QUALITY.test(quality) ? quality : fallback;
}

function truncateOutput(chunks, limit) {
  return Buffer.concat(chunks).subarray(0, limit).toString("utf8");
}

/**
 * Runs a command with an argv array and no shell, so arguments are never re-parsed.
 * Output is capped and the child is killed on timeout or abort.
 */
export function runCommand(command, args, options = {}) {
  const {
    timeoutMs = 60_000,
    maxOutputBytes = 16 * 1024 * 1024,
    cwd,
    signal,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        signal,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;

    child.stdout.on("data", (chunk) => {
      if (stdoutSize >= maxOutputBytes) return;
      stdoutSize += chunk.length;
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderrSize >= maxOutputBytes) return;
      stderrSize += chunk.length;
      stderr.push(chunk);
    });

    child.once("error", reject);
    child.once("close", (code, terminationSignal) => {
      resolve({
        code,
        signal: terminationSignal,
        stdout: truncateOutput(stdout, maxOutputBytes),
        stderr: truncateOutput(stderr, maxOutputBytes),
      });
    });
  });
}

/** Reduces yt-dlp's stderr to one short, owner-facing line. */
export function summarizeFailure(result) {
  const lines = String(result?.stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const reported = [...lines].reverse().find((line) => /^ERROR[: ]/i.test(line)) ?? lines.at(-1);
  const message = String(reported ?? "").replace(/^ERROR:\s*/i, "").trim();
  if (message) return message.slice(0, 240);
  if (result?.signal) return `Stopped by ${result.signal}`;
  return `Exited with status ${result?.code ?? "unknown"}`;
}

export class YoutubeTool {
  constructor({
    ytdlpPath = "yt-dlp",
    ffmpegPath = "ffmpeg",
    audioQuality = "0",
    inspectTimeoutMs = 120_000,
    trackTimeoutMs = 900_000,
  } = {}) {
    this.ytdlpPath = ytdlpPath;
    this.ffmpegPath = ffmpegPath;
    this.audioQuality = normalizeAudioQuality(audioQuality);
    this.inspectTimeoutMs = inspectTimeoutMs;
    this.trackTimeoutMs = trackTimeoutMs;
  }

  baseArgs() {
    const args = [
      "--ignore-config",
      "--no-warnings",
      "--no-progress",
      "--no-cache-dir",
      "--socket-timeout",
      "20",
      "--retries",
      "3",
    ];
    if (path.isAbsolute(this.ffmpegPath)) {
      args.push("--ffmpeg-location", this.ffmpegPath);
    }
    return args;
  }

  /** Confirms both binaries exist and can report a version. */
  async probe() {
    try {
      const [ytdlp, ffmpeg] = await Promise.all([
        runCommand(this.ytdlpPath, ["--version"], { timeoutMs: 20_000 }),
        runCommand(this.ffmpegPath, ["-version"], { timeoutMs: 20_000 }),
      ]);
      if (ytdlp.code !== 0 || ffmpeg.code !== 0) return { available: false, version: null };
      return { available: true, version: ytdlp.stdout.trim().split(/\r?\n/)[0] || null };
    } catch {
      return { available: false, version: null };
    }
  }

  /** Lists a playlist without downloading anything. */
  async inspectPlaylist(playlist, { maxTracks = 100, signal } = {}) {
    const result = await runCommand(this.ytdlpPath, [
      ...this.baseArgs(),
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-end",
      String(maxTracks + 1),
      playlist.url,
    ], { timeoutMs: this.inspectTimeoutMs, signal });

    if (result.code !== 0) {
      const error = new Error(summarizeFailure(result));
      error.statusCode = 502;
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      const error = new Error("yt-dlp returned an unreadable playlist listing");
      error.statusCode = 502;
      throw error;
    }

    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const tracks = [];
    for (const entry of entries) {
      const id = String(entry?.id ?? "");
      if (!VIDEO_ID.test(id)) continue;
      const title = String(entry?.title ?? "").trim();
      if (UNAVAILABLE_TITLES.has(title.toLowerCase())) continue;
      const duration = Number(entry?.duration);
      tracks.push({
        id,
        title: title || id,
        uploader: String(entry?.channel ?? entry?.uploader ?? "").trim().slice(0, 120) || null,
        duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      });
    }

    return {
      id: playlist.id,
      url: playlist.url,
      title: String(parsed?.title ?? "").trim().slice(0, 200) || `Playlist ${playlist.id}`,
      uploader: String(parsed?.channel ?? parsed?.uploader ?? "").trim().slice(0, 120) || null,
      truncated: entries.length > maxTracks,
      tracks: tracks.slice(0, maxTracks),
    };
  }

  /**
   * Downloads one video's audio into `directory` as MP3 and returns the file path.
   * The video id is validated and the watch URL is rebuilt here, never pasted through.
   */
  async downloadTrack(videoId, { directory, maxSourceBytes, signal } = {}) {
    if (!VIDEO_ID.test(String(videoId))) throw new Error("Invalid video id");

    const outputTemplate = path.join(directory, "track.%(ext)s");
    const args = [
      ...this.baseArgs(),
      "--no-playlist",
      "--format",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      this.audioQuality,
      "--embed-metadata",
      "--output",
      outputTemplate,
    ];
    if (Number.isFinite(maxSourceBytes) && maxSourceBytes > 0) {
      args.push("--max-filesize", String(Math.round(maxSourceBytes)));
    }
    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const result = await runCommand(this.ytdlpPath, args, {
      timeoutMs: this.trackTimeoutMs,
      signal,
    });
    if (result.code !== 0) throw new Error(summarizeFailure(result));

    const trackPath = path.join(directory, "track.mp3");
    try {
      await stat(trackPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // yt-dlp exits 0 when it declines a download, most often for --max-filesize.
      if (/max-filesize|larger than/i.test(`${result.stdout}${result.stderr}`)) {
        throw new Error("Source audio is larger than the configured limit");
      }
      throw new Error("yt-dlp produced no MP3 for this track");
    }
    return trackPath;
  }
}
