import { createVfdSound } from "./vfdAudio";
import { createVfdGL } from "./vfdGL";
import { SEVEN, SIXTEEN, STROKE16, sevenGeometry, sevenMask, sixteenGeometry, sixteenMask } from "./vfdGlyphs";

const FONT = "VfdLegend";
const PHOS = [48, 255, 196];
const GHOST = "rgba(140, 190, 182, 0.055)";
const INTRO_SECONDS = 14;
const FF_RATE = 16;

const LENGTHS = {
  "come together": 259,
  something: 182,
  taxman: 159,
  "eleanor rigby": 126,
  "drive my car": 150,
  "norwegian wood": 125,
  "norwegian wood (this bird has flown)": 125,
  "sgt. pepper's lonely hearts club band": 122,
  "with a little help from my friends": 164,
  "two of us": 216,
  "across the universe": 228,
  "magical mystery tour": 171,
  "the fool on the hill": 180,
  "help!": 138,
  "the night before": 154,
  "a hard day's night": 154,
  "i should have known better": 163,
  "here comes the sun": 185,
  "let it be": 243,
  "in my life": 146,
  yesterday: 125,
};

const WIDE = {
  w: 1020,
  h: 392,
  chars: 12,
  track: { x: 44, y: 82, w: 40, h: 86, pitch: 56 },
  alpha: { x: 196, y: 90, w: 34, h: 70, pitch: 46 },
  time: { x: 770, y: 82, w: 38, h: 86, pitch: 50, colon: 10 },
  icons: { y: 34 },
  spectrum: { x: 44, y: 212, w: 932, h: 132, bands: 24, segs: 12 },
  labels: 368,
};

const TALL = {
  w: 400,
  h: 612,
  chars: 8,
  track: { x: 22, y: 92, w: 36, h: 76, pitch: 50 },
  alpha: { x: 22, y: 212, w: 33, h: 66, pitch: 44 },
  time: { x: 176, y: 92, w: 34, h: 76, pitch: 46, colon: 9 },
  icons: { y: 34 },
  spectrum: { x: 22, y: 326, w: 356, h: 232, bands: 14, segs: 12 },
  labels: 584,
};

const BAND_LABELS = ["40", "100", "250", "630", "1.6K", "4K", "10K"];

function pathFrom(poly) {
  const p = new Path2D();
  if (poly.circle) {
    const [cx, cy, r] = poly.circle;
    p.arc(cx, cy, r, 0, Math.PI * 2);
    return p;
  }
  poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

function translatePoly(poly, dx, dy) {
  if (poly.circle) return { circle: [poly.circle[0] + dx, poly.circle[1] + dy, poly.circle[2]] };
  return poly.map(([x, y]) => [x + dx, y + dy]);
}

function fmtTitle(track, n) {
  const title = track.title.replace(/\s*\(.*?\)\s*/g, " ").trim().toUpperCase();
  const artist = (track.artist || "The Beatles").toUpperCase();
  const head = title.length < n ? title.padEnd(n) : `${title}  -  `;
  return `${head}${artist}`;
}

function lengthOf(track) {
  if (track.durationMs) return Math.round(track.durationMs / 1000);
  if (track.duration_ms) return Math.round(track.duration_ms / 1000);
  const key = track.title.toLowerCase();
  if (LENGTHS[key]) return LENGTHS[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 150 + (h % 90);
}

export function createVfd(stage, { tracks: initialTracks = [], caption = null, embedded = false, onLive = () => {}, onFail = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "vfd-screen";
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "Now playing display. Scroll or use the arrow keys to skip tracks, hold to fast-forward, Space to pause.");
  if (embedded) root.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "vfd-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createVfdGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false, setTracks() {} };
  }

  const scene = document.createElement("canvas");
  const sx = scene.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  const mx = maskCanvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let sound = null;
  let tracks = initialTracks.length ? initialTracks : [];
  let idx = 0;
  let elapsed = 0;
  let playing = true;
  let intro = true;
  let remain = false;
  let seek = 0;
  let clock = 0;
  let bootT = reduced ? 2 : 0;
  let L = WIDE;
  let scale = 1;
  let dpr = 1;
  let offX = 0;
  let offY = 0;
  let pxW = 0;
  let pxH = 0;
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let fade = reduced ? 1 : 0;
  let lastSecond = -1;
  let scrollOffset = 0;
  let scrollClock = -1.8;
  let titleText = "";

  let alpha = [];
  let trackDigits = [];
  let timeDigits = [];
  let colon = [];
  let icons = [];
  let legends = [];
  let ring = [];
  let bands = [];
  let labels = [];
  let filaments = [];
  let timeBox = null;

  const smooth = (cur, want, dt) => (want > cur ? cur + (want - cur) * Math.min(1, dt / 0.01) : cur + (want - cur) * Math.min(1, dt / 0.045));

  const makeSixteen = (x, y, w, h) => {
    const geo = sixteenGeometry(w, h);
    const paths = SIXTEEN.map((k) => pathFrom(translatePoly(geo[k], x, y)));
    return { paths, cur: new Float32Array(SIXTEEN.length), mask: 0, anim: null };
  };

  const makeSeven = (x, y, w, h) => {
    const geo = sevenGeometry(w, h);
    const paths = SEVEN.map((k) => pathFrom(translatePoly(geo[k], x, y)));
    return { paths, cur: new Float32Array(SEVEN.length), mask: 0, anim: null };
  };

  const icon = (id, build) => {
    const p = new Path2D();
    build(p);
    return { id, path: p, cur: 0, want: 0 };
  };

  const legend = (id, text, x, y, size, align = "left") => ({ id, text, x, y, size, align, cur: 0, want: 0 });

  const buildLayout = () => {
    const { track, alpha: al, time, spectrum: sp, icons: ic } = L;
    alpha = [];
    for (let i = 0; i < L.chars; i += 1) alpha.push(makeSixteen(al.x + i * al.pitch, al.y, al.w, al.h));
    trackDigits = [0, 1].map((i) => makeSeven(track.x + i * track.pitch, track.y, track.w, track.h));
    const tx = [time.x, time.x + time.pitch, time.x + time.pitch * 2 + time.colon * 2, time.x + time.pitch * 3 + time.colon * 2];
    timeDigits = tx.map((x) => makeSeven(x, time.y, time.w, time.h));
    const cx = time.x + time.pitch * 2 + time.colon * 0.2 - 2;
    const dotR = time.w * 0.09;
    colon = [time.h * 0.3, time.h * 0.72].map((dy) => {
      const p = new Path2D();
      p.arc(cx + (time.h - dy) * 0.1, time.y + dy, dotR, 0, Math.PI * 2);
      return { path: p, cur: 0 };
    });
    timeBox = { x: time.x - 10, y: time.y - 30, w: time.pitch * 3 + time.colon * 2 + time.w + 24, h: time.h + 40 };

    const y = ic.y;
    const wide = L === WIDE;
    const base = wide ? 196 : 22;
    const rx = base + 14;
    ring = [];
    for (let i = 0; i < 12; i += 1) {
      const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2 + 0.07;
      const a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2 - 0.07;
      const p = new Path2D();
      p.arc(rx, y, 13, a0, a1);
      p.arc(rx, y, 9, a1, a0, true);
      p.closePath();
      ring.push({ path: p, cur: 0 });
    }
    const hub = new Path2D();
    hub.arc(rx, y, 3, 0, Math.PI * 2);
    ring.hub = { path: hub, cur: 0 };
    let x = base + 40;
    icons = [
      icon("play", (p) => {
        p.moveTo(x, y - 8);
        p.lineTo(x + 13, y);
        p.lineTo(x, y + 8);
        p.closePath();
      }),
    ];
    x += 24;
    icons.push(
      icon("pause", (p) => {
        p.rect(x, y - 8, 4.5, 16);
        p.rect(x + 8, y - 8, 4.5, 16);
      }),
    );
    x += 24;
    icons.push(
      icon("ff", (p) => {
        p.moveTo(x, y - 7);
        p.lineTo(x + 10, y);
        p.lineTo(x, y + 7);
        p.closePath();
        p.moveTo(x + 10, y - 7);
        p.lineTo(x + 20, y);
        p.lineTo(x + 10, y + 7);
        p.closePath();
      }),
    );
    x += 34;
    const rpx = x;
    icons.push(
      icon("repeat", (p) => {
        const r = 7;
        p.moveTo(rpx + 4, y - r - 1.5);
        p.lineTo(rpx + 18, y - r - 1.5);
        p.arc(rpx + 18, y, r + 1.5, -Math.PI / 2, Math.PI / 2);
        p.lineTo(rpx + 10, y + r + 1.5);
        p.lineTo(rpx + 10, y + r - 1.5);
        p.lineTo(rpx + 18, y + r - 1.5);
        p.arc(rpx + 18, y, r - 1.5, Math.PI / 2, -Math.PI / 2, true);
        p.lineTo(rpx + 4, y - r + 1.5);
        p.closePath();
        p.moveTo(rpx + 4, y - r - 5);
        p.lineTo(rpx - 2, y - r);
        p.lineTo(rpx + 4, y - r + 5);
        p.closePath();
      }),
    );
    legends = [legend("all", "ALL", rpx + 32, y + 5, 12)];
    const lx = wide ? rpx + 74 : rpx + 70;
    legends.push(legend("intro", "INTRO", lx, y + 5, 12));
    if (wide) legends.push(legend("random", "RANDOM", lx + 62, y + 5, 12));
    if (wide) legends.push(legend("remain", "REMAIN", 976, y + 5, 12, "right"));
    else legends.push(legend("remain", "REMAIN", 378, y + 5, 12, "right"));
    legends.push(legend("track", "TRACK", track.x, track.y - 14, 11));
    legends.push(legend("min", "MIN", tx[0], time.y - 14, 11));
    legends.push(legend("sec", "SEC", tx[2], time.y - 14, 11));
    legends.push(legend("title", wide ? "TITLE" : "TITLE", al.x, al.y - 22, 11));

    bands = [];
    const bandW = sp.w / sp.bands;
    const segH = sp.h / sp.segs;
    for (let b = 0; b < sp.bands; b += 1) {
      const segs = [];
      for (let s = 0; s < sp.segs; s += 1) {
        const p = new Path2D();
        const yy = sp.y + sp.h - (s + 1) * segH + segH * 0.18;
        const x0 = sp.x + b * bandW + bandW * 0.14;
        p.rect(x0, yy, bandW * 0.72, segH * 0.64);
        segs.push({ path: p, cur: 0 });
      }
      bands.push({ segs, value: 0, peak: 0, peakHold: 0 });
    }
    labels = BAND_LABELS.map((text, i) => {
      const b = Math.round((i / (BAND_LABELS.length - 1)) * (sp.bands - 1));
      return { text, x: sp.x + (b + 0.5) * bandW, y: L.labels };
    });
    const mainMid = track.y + track.h / 2;
    filaments = [track.y + track.h * 0.22, mainMid + track.h * 0.12, sp.y + sp.h * 0.3, sp.y + sp.h * 0.78];
  };

  const drawMask = () => {
    maskCanvas.width = Math.max(1, Math.round(pxW / 2));
    maskCanvas.height = Math.max(1, Math.round(pxH / 2));
    const k = (scale * dpr) / 2;
    mx.setTransform(1, 0, 0, 1, 0, 0);
    mx.fillStyle = "#000";
    mx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    mx.setTransform(k, 0, 0, k, (offX * dpr) / 2, (offY * dpr) / 2);
    mx.fillStyle = "#fff";
    mx.filter = `blur(${Math.max(1, 3 * k)}px)`;
    const { track, alpha: al, time, spectrum: sp } = L;
    mx.fillRect(track.x - 12, track.y - 10, track.pitch + track.w + 26, track.h + 20);
    mx.fillRect(al.x - 12, al.y - 10, al.pitch * (L.chars - 1) + al.w + 30, al.h + 20);
    mx.fillRect(time.x - 12, time.y - 10, time.pitch * 3 + time.colon * 2 + time.w + 26, time.h + 20);
    mx.fillRect(sp.x - 6, sp.y - 6, sp.w + 12, sp.h + 12);
    mx.fillRect(L === WIDE ? 180 : 8, L.icons.y - 20, L === WIDE ? 800 : 384, 40);
    mx.filter = "none";
    gl.mask(maskCanvas);
  };

  const currentTrack = () => tracks[idx % Math.max(1, tracks.length)];

  const setText = (text) => {
    titleText = text;
    scrollOffset = 0;
    scrollClock = -1.8;
  };

  const windowText = () => {
    const n = L.chars;
    if (titleText.length <= n) return titleText.padEnd(n);
    const loop = `${titleText}    `;
    let s = "";
    for (let i = 0; i < n; i += 1) s += loop[(scrollOffset + i) % loop.length];
    return s;
  };

  const redrawChars = (list, masks, order, start, stagger, clearStep, lightStep) => {
    list.forEach((el, i) => {
      el.anim = { from: el.mask, to: masks[i], start: start + i * stagger, order, clearStep, lightStep };
    });
  };

  const animMask = (el, t) => {
    const a = el.anim;
    if (!a) return el.mask;
    const tt = t - a.start;
    if (tt < 0) return a.from;
    const fromBits = a.order.filter((b) => a.from & (1 << b));
    const clearN = Math.floor(tt / a.clearStep);
    if (clearN < fromBits.length) {
      let m = a.from;
      for (let k = 0; k < clearN; k += 1) m &= ~(1 << fromBits[fromBits.length - 1 - k]);
      return m;
    }
    const t2 = tt - fromBits.length * a.clearStep - 0.05;
    if (t2 < 0) return 0;
    const toBits = a.order.filter((b) => a.to & (1 << b));
    const lightN = Math.floor(t2 / a.lightStep) + 1;
    if (lightN >= toBits.length) {
      el.mask = a.to;
      el.anim = null;
      return a.to;
    }
    let m = 0;
    for (let k = 0; k < lightN; k += 1) m |= 1 << toBits[k];
    return m;
  };

  const SEVEN_ORDER = [5, 0, 1, 6, 4, 3, 2];

  const trackString = () => String((idx % Math.max(1, tracks.length)) + 1).padStart(2, "0");

  const timeString = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m < 10 ? ` ${m}` : String(m).slice(-2)}${String(r).padStart(2, "0")}`;
  };

  const shownSeconds = () => {
    const t = currentTrack();
    if (!t) return 0;
    const len = lengthOf(t);
    return remain ? len - elapsed : elapsed;
  };

  const redrawAll = (delay = 0) => {
    const t = currentTrack();
    if (!t) return;
    setText(fmtTitle(t, L.chars));
    const masks = [...windowText()].map((c) => sixteenMask(c));
    redrawChars(alpha, masks, STROKE16, clock + delay + 0.06, 0.035, 0.007, 0.012);
    const tm = [...trackString()].map((c) => sevenMask(c));
    redrawChars(trackDigits, tm, SEVEN_ORDER, clock + delay, 0.05, 0.012, 0.022);
    const sm = [...timeString(shownSeconds())].map((c) => sevenMask(c));
    redrawChars(timeDigits, sm, SEVEN_ORDER, clock + delay + 0.1, 0.03, 0.01, 0.018);
    lastSecond = Math.floor(shownSeconds());
  };

  const announce = () => {
    const t = currentTrack();
    if (t) onLive(`Track ${idx + 1}: ${t.title}`);
  };

  const skip = (dir, byUser = true) => {
    if (!tracks.length) return;
    idx = (idx + dir + tracks.length) % tracks.length;
    elapsed = 0;
    if (byUser) intro = false;
    sound?.click();
    redrawAll();
    announce();
    wake();
  };

  const togglePause = () => {
    playing = !playing;
    intro = false;
    sound?.setPaused(!playing);
    sound?.click();
    onLive(playing ? "Playing" : "Paused");
  };

  const setSeek = (s) => {
    if (s === seek) return;
    seek = s;
    if (s) intro = false;
    sound?.setDucked(Boolean(s));
  };

  const simSpectrum = (t, out) => {
    const bpm = 88;
    const beat = (t * bpm) / 60;
    const ph = beat % 1;
    const bar = Math.floor(beat) % 4;
    const kick = Math.exp(-ph * 7) * (bar === 1 || bar === 3 ? 0.75 : 1);
    const snare = bar === 1 || bar === 3 ? Math.exp(-ph * 9) : 0;
    const eighth = (beat * 2) % 1;
    const hat = Math.exp(-eighth * 16) * (0.55 + 0.45 * Math.sin(beat * 1.7) ** 2);
    const n = out.length;
    for (let b = 0; b < n; b += 1) {
      const f = b / (n - 1);
      const body = 0.42 + 0.1 * Math.sin(t * 0.9 + b * 0.7) + 0.07 * Math.sin(t * 2.3 + b * 1.9);
      const mids = 0.18 * Math.exp(-((f - 0.45) ** 2) / 0.04) * (0.7 + 0.3 * Math.sin(t * 3.1 + b));
      const tilt = 1 - f * 0.55;
      let v = body * tilt + mids;
      v += kick * 0.55 * Math.exp(-f * 9);
      v += snare * 0.38 * Math.exp(-((f - 0.55) ** 2) / 0.06);
      v += hat * 0.3 * Math.exp(-((f - 0.88) ** 2) / 0.02);
      v += (Math.sin(t * 13.7 + b * 4.1) * 0.5 + 0.5) * 0.05;
      out[b] = Math.max(0, Math.min(1, v));
    }
  };

  const realSpectrum = (out) => {
    const { bins, rate, size } = sound.spectrum();
    const n = out.length;
    const lo = Math.log(40);
    const hi = Math.log(16000);
    for (let b = 0; b < n; b += 1) {
      const f0 = Math.exp(lo + ((hi - lo) * b) / n);
      const f1 = Math.exp(lo + ((hi - lo) * (b + 1)) / n);
      const i0 = Math.max(1, Math.floor((f0 * size) / rate));
      const i1 = Math.max(i0 + 1, Math.ceil((f1 * size) / rate));
      let m = 0;
      for (let i = i0; i < i1 && i < bins.length; i += 1) m = Math.max(m, bins[i]);
      const tilt = 0.86 + (b / n) * 0.3;
      out[b] = Math.min(1, ((m / 255) * tilt) ** 1.25);
    }
  };

  const bandTargets = new Float32Array(32);

  const update = (dt) => {
    clock += dt;
    if (fade < 1) fade = Math.min(1, fade + dt / 0.45);
    if (bootT < 2) {
      const before = bootT;
      bootT += dt;
      if (before < 1.15 && bootT >= 1.15) redrawAll(0);
    }
    const booted = bootT >= 1.15;
    const t = currentTrack();
    if (booted && t) {
      const len = lengthOf(t);
      if (seek) {
        elapsed += dt * FF_RATE * seek;
        if (elapsed < 0) elapsed = 0;
      } else if (playing) elapsed += dt;
      if (elapsed >= len || (intro && elapsed >= INTRO_SECONDS)) skip(1, false);
      const shown = Math.floor(shownSeconds());
      if (shown !== lastSecond && !timeDigits.some((d) => d.anim)) {
        lastSecond = shown;
        const s = timeString(shown);
        [...s].forEach((c, i) => {
          timeDigits[i].mask = sevenMask(c);
        });
        if (seek) sound?.tick();
      }
      if (titleText.length > L.chars && !alpha.some((a) => a.anim)) {
        scrollClock += dt;
        if (scrollClock >= 0.26) {
          scrollClock -= 0.26;
          scrollOffset = (scrollOffset + 1) % (titleText.length + 4);
          if (scrollOffset === 0) scrollClock = -1.8;
          const w = windowText();
          alpha.forEach((a, i) => {
            a.mask = sixteenMask(w[i]);
          });
        }
      }
    }

    const test = bootT > 0.25 && bootT < 1.0;
    const nb = bands.length;
    const live = sound?.playing();
    if (live) realSpectrum(bandTargets.subarray(0, nb));
    else simSpectrum(clock, bandTargets.subarray(0, nb));
    const segs = L.spectrum.segs;
    bands.forEach((b, i) => {
      let target = booted && (playing || seek) ? bandTargets[i] : 0;
      if (seek && !live) target = Math.min(1, target * 0.7 + 0.25 * Math.abs(Math.sin(clock * 31 + i * 2.1)));
      b.value = target > b.value ? target : b.value + (target - b.value) * Math.min(1, dt / 0.09);
      const lit = Math.round(b.value * segs);
      if (lit >= b.peak) {
        b.peak = lit;
        b.peakHold = 0.5;
      } else {
        b.peakHold -= dt;
        if (b.peakHold < 0) b.peak = Math.max(lit, b.peak - dt * 14);
      }
      const pk = Math.min(segs - 1, Math.floor(b.peak) - 1);
      b.segs.forEach((s, k) => {
        const want = test ? 1 : k < lit || (k === pk && pk >= 0) ? 1 : 0;
        s.cur = smooth(s.cur, want, dt);
      });
    });

    const applyMask = (el) => {
      const m = test ? 0x1ffff : booted ? animMask(el, clock) : 0;
      for (let k = 0; k < el.cur.length; k += 1) el.cur[k] = smooth(el.cur[k], m & (1 << k) ? 1 : 0, dt);
    };
    alpha.forEach(applyMask);
    trackDigits.forEach(applyMask);
    timeDigits.forEach(applyMask);
    const colonOn = test || (booted && (playing || seek ? true : Math.floor(clock / 0.5) % 2 === 0));
    colon.forEach((c) => {
      c.cur = smooth(c.cur, colonOn ? 1 : 0, dt);
    });
    const step = Math.floor(clock * (seek ? 22 : playing ? 7 : 0)) % 12;
    const spin = booted && (playing || seek);
    ring.forEach((r, i) => {
      const gap = (i - step + 12) % 12;
      const on = test || (booted && (!spin || gap > 2));
      r.cur = smooth(r.cur, on ? 1 : 0, dt);
    });
    ring.hub.cur = smooth(ring.hub.cur, test || booted ? 1 : 0, dt);
    const blinkFast = Math.floor(clock / 0.18) % 2 === 0;
    const iconWant = {
      play: booted && playing && !seek,
      pause: booted && !playing && !seek,
      ff: booted && seek !== 0 && blinkFast,
      repeat: booted,
    };
    icons.forEach((ic) => {
      ic.cur = smooth(ic.cur, test || iconWant[ic.id] ? 1 : 0, dt);
    });
    const legendWant = {
      all: booted,
      intro: booted && intro && Math.floor(clock / 0.6) % 2 === 0,
      random: false,
      remain: booted && remain,
      track: booted,
      min: booted,
      sec: booted,
      title: booted,
    };
    legends.forEach((lg) => {
      lg.cur = smooth(lg.cur, test || legendWant[lg.id] ? 1 : 0, dt);
    });
  };

  const fillLit = (path, v) => {
    sx.fillStyle = GHOST;
    sx.fill(path);
    if (v > 0.003) {
      sx.fillStyle = `rgba(${PHOS[0]}, ${PHOS[1]}, ${PHOS[2]}, ${Math.min(1, v)})`;
      sx.fill(path);
    }
  };

  const draw = () => {
    sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.fillStyle = "#000";
    sx.fillRect(0, 0, scene.width, scene.height);
    const k = scale * dpr;
    sx.setTransform(k, 0, 0, k, offX * dpr, offY * dpr);
    const warm = bootT < 0.25 ? 0 : 1;
    for (const a of alpha) a.paths.forEach((p, i) => fillLit(p, a.cur[i] * warm));
    for (const d of trackDigits) d.paths.forEach((p, i) => fillLit(p, d.cur[i]));
    for (const d of timeDigits) d.paths.forEach((p, i) => fillLit(p, d.cur[i]));
    colon.forEach((c) => fillLit(c.path, c.cur));
    ring.forEach((r) => fillLit(r.path, r.cur));
    fillLit(ring.hub.path, ring.hub.cur);
    icons.forEach((ic) => fillLit(ic.path, ic.cur));
    for (const b of bands) b.segs.forEach((s) => fillLit(s.path, s.cur));
    sx.textBaseline = "alphabetic";
    for (const lg of legends) {
      sx.font = `${lg.size}px ${FONT}`;
      sx.textAlign = lg.align;
      sx.fillStyle = GHOST;
      sx.fillText(lg.text, lg.x, lg.y);
      if (lg.cur > 0.003) {
        sx.fillStyle = `rgba(${PHOS[0]}, ${PHOS[1]}, ${PHOS[2]}, ${lg.cur * 0.92})`;
        sx.fillText(lg.text, lg.x, lg.y);
      }
    }
    sx.font = `10px ${FONT}`;
    sx.textAlign = "center";
    const labelV = bootT > 0.25 ? 0.62 : 0;
    for (const lb of labels) {
      sx.fillStyle = `rgba(${PHOS[0]}, ${PHOS[1]}, ${PHOS[2]}, ${labelV})`;
      sx.fillText(lb.text, lb.x, lb.y);
    }
    const sp = L.spectrum;
    sx.fillStyle = `rgba(${PHOS[0]}, ${PHOS[1]}, ${PHOS[2]}, ${labelV * 0.55})`;
    sx.fillRect(sp.x, sp.y + sp.h + 4, sp.w, 1.4);
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = narrow ? 16 : 32;
    const bottom = narrow ? 32 : 56;
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 24) : side;
    const availW = sr.width - side * 2;
    const availH = Math.max(200, sr.height - top - bottom);
    const nextL = availW / availH > 1.05 ? WIDE : TALL;
    const pad = narrow ? 14 : 36;
    scale = Math.min((availW - pad * 2) / nextL.w, (availH - pad * 2) / nextL.h, nextL === WIDE ? 1.25 : 1.4);
    const w = Math.round(nextL.w * scale + pad * 2);
    const h = Math.round(nextL.h * scale + pad * 2);
    const left = Math.round((sr.width - w) / 2);
    const topY = Math.round(top + Math.max(0, (availH - h) * 0.4));
    root.style.left = `${left}px`;
    root.style.top = `${topY}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    if (caption) {
      caption.style.left = `${Math.max(side, left)}px`;
      caption.style.width = `${Math.min(availW, w)}px`;
    }
    offX = pad;
    offY = pad;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > 4200000) dpr = Math.sqrt(4200000 / (w * h));
    pxW = Math.round(w * dpr);
    pxH = Math.round(h * dpr);
    scene.width = pxW;
    scene.height = pxH;
    gl.resize(pxW, pxH);
    const changed = nextL !== L || force;
    L = nextL;
    if (changed) {
      buildLayout();
      if (bootT >= 1.15) {
        if (currentTrack()) setText(fmtTitle(currentTrack(), L.chars));
        const wtext = windowText();
        alpha.forEach((a, i) => {
          a.mask = sixteenMask(wtext[i]);
        });
        [...trackString()].forEach((c, i) => {
          trackDigits[i].mask = sevenMask(c);
        });
        lastSecond = -1;
      }
    }
    drawMask();
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    const k = scale * dpr;
    gl.render({ scene, mesh: Math.max(2.6, 3.4 * k), time: clock, fade: fade * fade * (3 - 2 * fade), filaments: filaments.map((y) => (offY + y * scale) * dpr) });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  let press = null;
  let holdTimer = 0;
  let wheelAcc = 0;
  let wheelTimer = 0;

  const local = (e) => {
    const r = root.getBoundingClientRect();
    return { x: (e.clientX - r.left - offX) / scale, y: (e.clientY - r.top - offY) / scale };
  };

  const onDown = (e) => {
    if (e.button > 0) return;
    root.setPointerCapture?.(e.pointerId);
    press = { x: e.clientX, y: e.clientY, acc: 0, moved: false, held: false, id: e.pointerId };
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      if (!press || press.moved) return;
      press.held = true;
      setSeek(1);
      sound?.click();
      onLive("Fast forward");
    }, 300);
  };

  const onMove = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    if (!press.moved && Math.hypot(dx, e.clientY - press.y) > 10 && !press.held) {
      press.moved = true;
      clearTimeout(holdTimer);
    }
    if (!press.moved) return;
    const step = 56;
    const travel = dx - press.acc;
    if (Math.abs(travel) >= step) {
      const n = Math.trunc(travel / step);
      press.acc += n * step;
      skip(n < 0 ? 1 : -1);
    }
  };

  const onUp = (e) => {
    if (!press || e.pointerId !== press.id) return;
    clearTimeout(holdTimer);
    const p = press;
    press = null;
    if (p.held) {
      setSeek(0);
      onLive("Playing");
      return;
    }
    if (p.moved || e.type === "pointercancel") return;
    const q = local(e);
    if (timeBox && q.x >= timeBox.x && q.x <= timeBox.x + timeBox.w && q.y >= timeBox.y && q.y <= timeBox.y + timeBox.h) {
      remain = !remain;
      sound?.click();
      lastSecond = -1;
      onLive(remain ? "Time remaining" : "Time elapsed");
      return;
    }
    togglePause();
  };

  const onWheel = (e) => {
    if (embedded) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAcc += d;
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => {
      wheelAcc = 0;
    }, 260);
    if (Math.abs(wheelAcc) >= 70) {
      skip(Math.sign(wheelAcc));
      wheelAcc = 0;
    }
  };

  const keyHold = { key: null, timer: 0, held: false };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== root && t !== document.body && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable)) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowLeft") {
      e.preventDefault();
      if (e.repeat || keyHold.key) return;
      keyHold.key = k;
      keyHold.held = false;
      keyHold.timer = window.setTimeout(() => {
        keyHold.held = true;
        setSeek(k === "ArrowRight" ? 1 : -1);
        sound?.click();
      }, 300);
    } else if (k === " " || k === "Enter") {
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (k === "ArrowDown") {
      e.preventDefault();
      skip(1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      skip(-1);
    } else if (k === "r") {
      remain = !remain;
      lastSecond = -1;
    }
  };

  const onKeyUp = (e) => {
    if (e.key !== keyHold.key) return;
    clearTimeout(keyHold.timer);
    const k = keyHold.key;
    keyHold.key = null;
    if (keyHold.held) setSeek(0);
    else skip(k === "ArrowRight" ? 1 : -1);
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  keyTarget.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  const boot = async () => {
    await Promise.race([document.fonts.load(`12px ${FONT}`).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    if (destroyed) return;
    layout(true);
    if (reduced) redrawAll(0);
    ready = true;
    root.dataset.ready = "";
    wake();
  };
  boot();

  return {
    setTracks(list) {
      if (!list?.length) return;
      const same = list.length === tracks.length && list.every((t, i) => t.title === tracks[i]?.title);
      if (same) return;
      tracks = list;
      idx = 0;
      elapsed = 0;
      if (bootT >= 1.15) redrawAll(0);
    },
    async setSound(on) {
      if (on && !sound) sound = createVfdSound();
      if (!sound) return false;
      sound.setPaused(!playing);
      sound.setDucked(Boolean(seek));
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      sleep();
      clearTimeout(holdTimer);
      clearTimeout(wheelTimer);
      clearTimeout(keyHold.timer);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
      keyTarget.removeEventListener("keydown", onKey);
      keyTarget.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
