import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRecentTracks } from "../src/lib/spotifyRecent.js";
import { GET as lookUpLyrics } from "../src/app/api/spotify/lyrics/route.js";
import { GET as lookUpPreview } from "../src/app/api/spotify/preview/route.js";
import { cleanTitle } from "../src/app/covers/lib/cleanTitle.js";
import { locateWindow, lyricTexts, lyricsHash, packLine } from "../src/app/covers/lib/previewSync.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "src/app/covers/lib/previewSync.json");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const force = flag("force");
const limit = Number(option("limit", 50));
const onlyIsrc = option("isrc", null);
const mode = option("mode", "song");
const wordsDir = resolve(root, option("words-dir", process.env.WORDS_DIR || "../words"));
const wordsPort = Number(option("words-port", process.env.WORDS_PORT || 3000));
const explicitUrl = option("words-url", process.env.WORDS_URL || null);
const candidateUrls = explicitUrl ? [explicitUrl] : ["http://localhost:3100", `http://localhost:${wordsPort}`];
let wordsUrl = candidateUrls[0];
const ALIGN_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (message) => console.log(message);

const readStore = () => (existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf-8")) : {});
const writeStore = (store) => {
  const sorted = Object.fromEntries(Object.entries(store).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(outputPath, JSON.stringify(sorted, null, 1) + "\n");
};

async function wordsReachable() {
  for (const url of candidateUrls) {
    try {
      const response = await fetch(`${url}/api/align/status?id=ping`, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        wordsUrl = url;
        return true;
      }
    } catch {}
  }
  return false;
}

async function ensureWords() {
  if (await wordsReachable()) return null;
  if (!existsSync(join(wordsDir, "package.json"))) {
    throw new Error(`words is not running at ${wordsUrl} and ${wordsDir} does not exist. Start it, or pass --words-dir / --words-url.`);
  }
  wordsUrl = `http://localhost:${wordsPort}`;
  candidateUrls.splice(0, candidateUrls.length, wordsUrl);
  log(`starting words from ${wordsDir} on port ${wordsPort}`);
  const child = spawn("npx", ["next", "dev", "-p", String(wordsPort)], { cwd: wordsDir, stdio: "ignore", detached: true });
  for (let waited = 0; waited < 120_000; waited += 2000) {
    await sleep(2000);
    if (await wordsReachable()) return child;
  }
  stopWords(child);
  throw new Error("words did not come up within two minutes");
}

function stopWords(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}

async function previewAudio(artist, title) {
  const query = new URLSearchParams({ artist, title });
  const found = await lookUpPreview(new Request(`http://local/api/spotify/preview?${query}`));
  if (!found.ok) return null;
  const { url } = await found.json();
  const audio = await fetch(url);
  if (!audio.ok) return null;
  return audio.blob();
}

async function lyricsFor(track, title) {
  const query = new URLSearchParams({ artist: track.artist, title, isrc: track.isrc || "", raw: "1" });
  if (track.durationMs) query.set("duration", String(Math.round(track.durationMs / 1000)));
  const response = await lookUpLyrics(new Request(`http://local/api/spotify/lyrics?${query}`));
  const found = await response.json();
  return found.plain ? lyricTexts(found.plain) : null;
}

async function runWords({ audio, lyrics, title, hear }) {
  const form = new FormData();
  form.set("audio", audio, "preview.m4a");
  form.set("lyrics", lyrics);
  form.set("title", title);
  form.set("mode", hear ? "turbo" : mode);
  form.set("language", "en");
  if (hear) form.set("hear", "1");
  const started = await fetch(`${wordsUrl}/api/align`, { method: "POST", body: form });
  const raw = await started.text();
  const job = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return { error: `words answered ${started.status}: ${raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}` };
    }
  })();
  if (!started.ok || !job.id) throw new Error(job.error || `words refused the job (${started.status})`);
  const deadline = Date.now() + ALIGN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2500);
    const state = await (await fetch(`${wordsUrl}/api/align/status?id=${job.id}`)).json().catch(() => ({}));
    if (state.status === "done") return state.record;
    if (["error", "cancelled", "interrupted", "unknown"].includes(state.status)) {
      throw new Error(state.error || `alignment ${state.status}`);
    }
  }
  throw new Error("alignment timed out");
}

const MIN_LINE_CONFIDENCE = 0.3;

function confident(line) {
  const words = line.words || [];
  if (!words.length) return false;
  const total = words.reduce((sum, word) => sum + (word.confidence ?? 0), 0);
  return total / words.length >= MIN_LINE_CONFIDENCE;
}

function packRecord(texts, record) {
  const aligned = record.lines || [];
  let cursor = 0;
  return texts.map((text) => {
    for (let i = cursor; i < aligned.length; i++) {
      if (aligned[i].text.trim() === text) {
        cursor = i + 1;
        return confident(aligned[i]) ? packLine(text, aligned[i]) : null;
      }
    }
    return null;
  });
}

async function withRetry(work) {
  try {
    return await work();
  } catch {
    await sleep(3000);
    return work();
  }
}

async function syncTrack(track, store) {
  const title = cleanTitle(track.title);
  const label = `${track.artist} — ${title}`;
  const texts = await lyricsFor(track, title);
  if (!texts?.length) return log(`skip   ${label}: no lyrics found`);
  const hash = lyricsHash(texts);
  if (!force && store[track.isrc]?.hash === hash) return log(`keep   ${label}`);
  const audio = await previewAudio(track.artist, title);
  if (!audio) return log(`skip   ${label}: no preview`);
  const transcript = await withRetry(() => runWords({ audio, lyrics: "", title, hear: true }));
  const window = locateWindow(texts, (transcript.lines || []).map((line) => line.text));
  if (!window) return log(`skip   ${label}: could not tell which lines are in the preview`);
  const inPreview = texts.slice(window.first, window.last + 1);
  const record = await withRetry(() => runWords({ audio, lyrics: inPreview.join("\n"), title, hear: false }));
  const packed = packRecord(inPreview, record);
  const lines = texts.map((_, i) => packed[i - window.first] ?? null);
  const heard = lines.filter(Boolean).length;
  if (heard < 2) return log(`skip   ${label}: too few confident lines`);
  store[track.isrc] = { label, hash, lines };
  writeStore(store);
  log(`synced ${label}: ${heard} of ${texts.length} lines in the preview`);
}

async function main() {
  const { tracks } = await getRecentTracks();
  const wanted = tracks
    .filter((track) => track.isrc && (!onlyIsrc || track.isrc === onlyIsrc))
    .slice(0, limit);
  if (!wanted.length) throw new Error("no tracks to sync (is SPOTIFY_REFRESH_TOKEN set? run with node --env-file=.env.local)");
  const store = readStore();
  const owned = await ensureWords();
  const failures = [];
  try {
    for (const [i, track] of wanted.entries()) {
      log(`[${i + 1}/${wanted.length}]`);
      try {
        await syncTrack(track, store);
      } catch (error) {
        failures.push(track.title);
        log(`fail   ${track.artist} — ${track.title}: ${error.message}`);
      }
    }
  } finally {
    stopWords(owned);
  }
  log(`done. ${Object.keys(store).length} tracks synced${failures.length ? `, ${failures.length} failed` : ""}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
