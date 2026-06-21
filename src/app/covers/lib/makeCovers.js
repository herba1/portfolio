// ---------------------------------------------------------------------------
// Cover content + tile textures.
//
// No placeholder photos. Real album art is supplied at runtime via
// setCoverSources() (Spotify). Until that loads — or if it fails — tiles render
// a soft slate rounded fill and the player/minimap show no image at all.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { COUNT, TEX_RESOLUTION } from "./config";

const NAMES = [
  "Nocturne", "Mirage", "Halcyon", "Cinder", "Vapor", "Lustre",
  "Drift", "Ember", "Saffron", "Cobalt", "Vellum", "Onyx",
  "Aether", "Pollen", "Tidal", "Static", "Velour", "Glacier",
  "Marigold", "Dusk", "Solstice", "Reverie", "Quartz", "Loom",
  "Plume", "Cascade", "Indigo", "Specter", "Halo", "Ardent",
];

// soft tints — used only for the ambient background glow behind the grid
const TINTS = [
  "#E9A89A", "#9CB6C4", "#B6C4A6", "#E5C29A", "#C2A9C6", "#EBD79A",
  "#A6AFD2", "#E0AEB9", "#A2C6B4", "#D6A78D", "#AEC2D6", "#CFC1AC",
  "#BCA9D2", "#E6C29C",
];

// ── deterministic meta ──────────────────────────────────────────────────────
// No placeholder photos: real album art comes from Spotify (setCoverSources).
// Until that loads — or if it fails — tiles stay on their soft slate fill and
// the player/minimap simply render no image rather than a fake stand-in.
export function coverMeta(index) {
  const i = ((index % COUNT) + COUNT) % COUNT;
  let type = "video";
  if (i % 5 === 0) type = "audio";
  else if (i % 7 === 0) type = "silent";
  return {
    index: i,
    title: NAMES[i % NAMES.length],
    sub: `№ ${String(i + 1).padStart(2, "0")}`,
    type,
    hasAudio: type !== "silent",
    color: TINTS[i % TINTS.length],
    image: null,
    imageLarge: null,
    duration: 32 + ((i * 37) % 140),
  };
}

export function makeCoversMeta(count = COUNT) {
  return Array.from({ length: count }, (_, i) => coverMeta(i));
}

// Live cover sources (e.g. Spotify album art). When set, tiles paint these
// image URLs; until then there's nothing to load, so tiles keep the slate fill.
// Swapping disposes the texture cache.
let SOURCES = null;
export function setCoverSources(arr) {
  SOURCES = arr && arr.length ? arr : null;
  disposeCoverTextures();
}
const sourceUrl = (i) => (SOURCES ? SOURCES[i % SOURCES.length]?.image : null);

// ── load tracking: lets the grid hold its entrance until album art is in ─────
// `loadedIdx` holds the indices whose album-art image has actually painted into
// its canvas (or errored — we stop waiting on it). The grid uses this two ways:
//   • coverLoaded(i) — a hard per-tile gate so a tile NEVER animates in before
//     its own image is on screen,
//   • coversReady()  — every cover loaded, so the whole sweep can start clean.
// Reset whenever the texture cache is rebuilt (setCoverSources / dispose).
const loadedIdx = new Set();

// Has this specific cover's image painted? Covers with no source URL have
// nothing to wait on, so they count as ready (slate-only fallback).
export function coverLoaded(index) {
  const i = ((index % COUNT) + COUNT) % COUNT;
  return !sourceUrl(i) || loadedIdx.has(i);
}

// Every cover with a source has painted. False until Spotify art is configured,
// so the grid stays blank rather than sweeping in over slate placeholders.
export function coversReady() {
  if (!SOURCES) return false;
  for (let i = 0; i < COUNT; i++) {
    if (sourceUrl(i) && !loadedIdx.has(i)) return false;
  }
  return true;
}

// ── texture cache: a rounded canvas, filled by the photo once it loads ───────
const texCache = new Map();
const keyOf = (i, o) => `${i}|${o.resolution || TEX_RESOLUTION}|${o.cornerRadius ?? 0.12}`;

function drawRounded(ctx, source, s, r) {
  ctx.clearRect(0, 0, s, s);
  ctx.save();
  roundRect(ctx, 0, 0, s, s, r);
  ctx.clip();
  if (source) {
    // cover-fit the image into the square tile
    const ar = source.width / source.height;
    let dw = s, dh = s, dx = 0, dy = 0;
    if (ar > 1) { dh = s; dw = s * ar; dx = (s - dw) / 2; }
    else { dw = s; dh = s / ar; dy = (s - dh) / 2; }
    ctx.drawImage(source, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = "#e7ecf2"; // soft slate placeholder while loading
    ctx.fillRect(0, 0, s, s);
  }
  ctx.restore();
}

export function getCoverTexture(index, opts = {}) {
  const i = ((index % COUNT) + COUNT) % COUNT;
  const key = keyOf(i, opts);
  if (texCache.has(key)) return texCache.get(key);
  if (typeof document === "undefined") return null;

  const s = opts.resolution || TEX_RESOLUTION;
  const r = (opts.cornerRadius ?? 0.12) * s;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  drawRounded(ctx, null, s, r); // placeholder first

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  texCache.set(key, tex);

  const url = sourceUrl(i); // Spotify album art when configured, else none
  if (url) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      drawRounded(ctx, img, s, r);
      tex.needsUpdate = true;
      loadedIdx.add(i); // image is now painted → this tile may animate in
    };
    img.onerror = () => loadedIdx.add(i); // give up waiting; keep slate fill
    img.src = url;
  } else {
    loadedIdx.add(i); // no source to wait on
  }

  return tex;
}

export function warmCoverTextures(count = COUNT, opts = {}) {
  for (let i = 0; i < count; i++) getCoverTexture(i, opts);
}

export function disposeCoverTextures() {
  for (const tex of texCache.values()) tex.dispose();
  texCache.clear();
  loadedIdx.clear();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
