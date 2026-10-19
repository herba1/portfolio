import { BANDS, createSkinAudio } from "./skinAudio";
import { activity, renderSong } from "./skinChip";
import { arrange } from "./skinSongs";
import { drawDigit, drawText, fitText, textWidth } from "./skinFont";

const C = {
  edge: "#0d0d14",
  base: "#2d2d40",
  baseHi: "#38384f",
  light: "#5d5d7e",
  lighter: "#8080a4",
  dark: "#18182a",
  black: "#000000",
  lcd: "#22e83c",
  lcdHi: "#a8ffb4",
  lcdDim: "#0d3a14",
  lcdGhost: "#030d05",
  text: "#cfd0e8",
  textDim: "#8a8aac",
  select: "#1a1ab0",
  white: "#ffffff",
};

const SIZES = { main: [275, 116], eq: [275, 116], pl: [275, 232] };
const SNAP = 10;
const ROW_H = 8;
const PL_ROWS = 21;
const BAR_N = 19;
const FFT_N = 1024;
const OSC_GAIN = 2.4;
const PRESETS = [
  ["Smile", 0, [4, 3, 1, -1, -2, -1, 1, 3, 4, 5]],
  ["Flat", 0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["Rock", -1, [5, 3, -2, -4, -1, 2, 5, 6, 6, 6]],
  ["Pop", 0, [-1, 3, 5, 5, 3, -1, -1, -1, -1, -1]],
  ["Full Bass", -3, [8, 8, 7, 4, 1, -3, -6, -8, -9, -9]],
  ["Live", 0, [-3, 0, 3, 4, 4, 4, 3, 2, 2, 2]],
  ["Classical", 0, [0, 0, 0, 0, 0, 0, -5, -5, -5, -7]],
  ["Treble", -2, [-6, -6, -6, -3, 1, 6, 9, 10, 10, 11]],
];
const BAND_LABELS = ["60", "170", "310", "600", "1K", "3K", "6K", "12K", "14K", "16K"];

const fmt = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const fmtLong = (s) => {
  const t = Math.floor(s);
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  return `${hh}:${String(mm).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

const songCache = new Map();
const songFor = (t) => {
  const key = `${t.title}|${t.artist}`;
  if (!songCache.has(key)) songCache.set(key, arrange(t.title, t.artist));
  return songCache.get(key);
};

function buildTracks(list) {
  return list.map((t) => {
    const song = songFor(t);
    return { artist: t.artist || "Unknown", title: t.title, album: t.album || "", length: song.length, song };
  });
}

function levelColor(v) {
  const stops = [
    [0, [24, 168, 32]],
    [0.45, [120, 220, 40]],
    [0.7, [232, 220, 40]],
    [0.85, [240, 140, 24]],
    [1, [232, 48, 24]],
  ];
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i += 1) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (x - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
    }
  }
  return "rgb(232,48,24)";
}
const SPECTRUM = Array.from({ length: 16 }, (_, i) => levelColor(i / 15));

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function createSkin(stage, { embedded = false, caption = null, songs = [], onReady = () => {}, onLive = () => {} } = {}) {
  const audio = createSkinAudio();
  const root = stage.closest(".skin") || stage;
  let tracks = buildTracks(songs);
  let totalLength = tracks.reduce((s, t) => s + t.length, 0);
  let destroyed = false;
  let raf = 0;
  let visible = true;
  let lastT = performance.now();
  let pcm = null;
  let pcmRate = 32000;
  let pcmSong = null;
  let rendering = null;
  const chanLevels = new Float32Array(4);
  let winRate = 0;
  let winLive = false;
  const chanShown = new Float32Array(4);
  const win = new Float32Array(FFT_N);

  const player = { index: 0, pos: 6, playing: true, startedAt: performance.now(), paused: false, shuffle: false, repeat: true };
  const ui = { timeMode: "elapsed", vis: "spectrum", volume: 0.72, balance: 0, eqOn: true, pre: 0, bands: PRESETS[0][2].slice(), target: PRESETS[0][2].slice(), preTarget: 0, preset: 0, pressed: null, seekDrag: null, notice: null, noticeUntil: 0, marquee: 0, playlistSel: 0, playlistTop: 0 };
  const bars = new Float32Array(BAR_N);
  const peaks = new Float32Array(BAR_N);
  const peakHold = new Float32Array(BAR_N);
  const re = new Float32Array(FFT_N);
  const im = new Float32Array(FFT_N);
  const hann = Float32Array.from({ length: FFT_N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1)));
  const barRanges = Array.from({ length: BAR_N }, (_, i) => {
    const f0 = 45 * Math.pow(16000 / 45, i / BAR_N);
    const f1 = 45 * Math.pow(16000 / 45, (i + 1) / BAR_N);
    return [f0, f1, Math.sqrt(f0 * f1)];
  });

  const desk = document.createElement("div");
  desk.className = "skin-desk";
  stage.append(desk);

  const wins = {};
  for (const id of ["main", "eq", "pl"]) {
    const [w, h] = SIZES[id];
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.className = "skin-win";
    canvas.dataset.win = id;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    desk.append(canvas);
    wins[id] = { id, x: 0, y: 0, w, h, visible: true, canvas, ctx, dirty: true };
  }
  wins.main.canvas.setAttribute("aria-label", "Player. Z previous, X play, C pause, V stop, B next.");
  wins.main.canvas.setAttribute("role", "img");

  const songPos = () => (player.playing && !player.paused ? player.pos + (performance.now() - player.startedAt) / 1000 : player.pos);
  const current = () => tracks[player.index];

  const mark = (...ids) => {
    for (const id of ids) wins[id].dirty = true;
    wake();
  };

  const notice = (text, ms = 1400) => {
    ui.notice = text;
    ui.noticeUntil = performance.now() + ms;
    mark("main");
  };

  const syncAudio = () => {
    audio.setSong(current().song);
    if (player.playing && !player.paused) audio.play(songPos());
    else audio.stop();
  };

  const startTrack = (i, play = true) => {
    player.index = (i + tracks.length) % tracks.length;
    player.pos = 0;
    player.playing = play;
    player.paused = false;
    player.startedAt = performance.now();
    ui.marquee = 0;
    syncAudio();
    const t = current();
    onLive(`${t.artist}, ${t.title}`);
    ensureVisible(player.index);
    mark("main", "pl");
  };

  const ensureVisible = (i) => {
    if (i < ui.playlistTop) ui.playlistTop = i;
    if (i >= ui.playlistTop + PL_ROWS) ui.playlistTop = i - PL_ROWS + 1;
  };

  const actions = {
    prev: () => startTrack(songPos() > 4 ? player.index : player.index - 1, player.playing),
    next: () => startTrack(player.shuffle ? Math.floor(Math.random() * tracks.length) : player.index + 1, player.playing),
    play: () => {
      if (player.playing && !player.paused) startTrack(player.index);
      else if (player.paused) {
        player.paused = false;
        player.startedAt = performance.now();
        syncAudio();
        mark("main");
      } else startTrack(player.index);
    },
    pause: () => {
      if (!player.playing) return;
      if (player.paused) {
        player.paused = false;
        player.startedAt = performance.now();
      } else {
        player.pos = songPos();
        player.paused = true;
      }
      syncAudio();
      mark("main");
    },
    stop: () => {
      player.playing = false;
      player.paused = false;
      player.pos = 0;
      syncAudio();
      mark("main");
    },
    shuffle: () => {
      player.shuffle = !player.shuffle;
      notice(`SHUFFLE: ${player.shuffle ? "ON" : "OFF"}`);
    },
    repeat: () => {
      player.repeat = !player.repeat;
      notice(`REPEAT: ${player.repeat ? "ON" : "OFF"}`);
    },
    eqbtn: () => toggleWin("eq"),
    plbtn: () => toggleWin("pl"),
    vis: () => {
      ui.vis = ui.vis === "spectrum" ? "osc" : ui.vis === "osc" ? "off" : "spectrum";
      bars.fill(0);
      peaks.fill(0);
      mark("main");
    },
    time: () => {
      ui.timeMode = ui.timeMode === "elapsed" ? "remaining" : "elapsed";
      mark("main");
    },
    eqon: () => {
      ui.eqOn = !ui.eqOn;
      pushEq();
      notice(`EQUALIZER: ${ui.eqOn ? "ON" : "OFF"}`);
      mark("eq");
    },
    presets: () => {
      ui.preset = (ui.preset + 1) % PRESETS.length;
      const [name, pre, bands] = PRESETS[ui.preset];
      ui.target = bands.slice();
      ui.preTarget = pre;
      notice(`EQ PRESET: ${name}`, 1800);
      mark("eq");
    },
  };

  const toggleWin = (id) => {
    const w = wins[id];
    w.visible = !w.visible;
    w.canvas.toggleAttribute("data-hidden", !w.visible);
    mark("main");
  };

  const pushEq = () => audio.setEq({ on: ui.eqOn, pre: ui.pre, bands: ui.bands });

  const CONTROLS = {
    main: [
      { id: "prev", r: [16, 86, 23, 18], kind: "button" },
      { id: "play", r: [39, 86, 23, 18], kind: "button" },
      { id: "pause", r: [62, 86, 23, 18], kind: "button" },
      { id: "stop", r: [85, 86, 23, 18], kind: "button" },
      { id: "next", r: [108, 86, 22, 18], kind: "button" },
      { id: "shuffle", r: [140, 87, 47, 15], kind: "button" },
      { id: "repeat", r: [190, 87, 34, 15], kind: "button" },
      { id: "eqbtn", r: [221, 54, 22, 10], kind: "button" },
      { id: "plbtn", r: [244, 54, 22, 10], kind: "button" },
      { id: "volume", r: [109, 53, 68, 11], kind: "slider" },
      { id: "balance", r: [180, 53, 38, 11], kind: "slider" },
      { id: "seek", r: [16, 69, 248, 12], kind: "slider" },
      { id: "time", r: [18, 20, 82, 20], kind: "tap" },
      { id: "vis", r: [18, 41, 84, 19], kind: "tap" },
    ],
    eq: [
      { id: "eqon", r: [14, 18, 26, 11], kind: "button" },
      { id: "presets", r: [217, 18, 44, 11], kind: "button" },
      { id: "band-pre", r: [19, 36, 18, 67], kind: "slider" },
      ...BANDS.map((_, i) => ({ id: `band-${i}`, r: [76 + i * 18, 36, 18, 67], kind: "slider" })),
    ],
    pl: [
      { id: "list", r: [12, 20, 243, 174], kind: "list" },
      { id: "scroll", r: [256, 20, 12, 174], kind: "slider" },
    ],
  };

  const hit = (win, x, y) => CONTROLS[win].find((c) => x >= c.r[0] && x < c.r[0] + c.r[2] && y >= c.r[1] && y < c.r[1] + c.r[3]);

  const panel = (c, x, y, w, h, fill, raised = true) => {
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
    c.fillStyle = raised ? C.light : C.edge;
    c.fillRect(x, y, w, 1);
    c.fillRect(x, y, 1, h);
    c.fillStyle = raised ? C.edge : C.light;
    c.fillRect(x, y + h - 1, w, 1);
    c.fillRect(x + w - 1, y, 1, h);
  };

  const inset = (c, x, y, w, h, fill = C.black) => {
    c.fillStyle = C.edge;
    c.fillRect(x - 1, y - 1, w + 2, 1);
    c.fillRect(x - 1, y - 1, 1, h + 2);
    c.fillStyle = C.light;
    c.fillRect(x - 1, y + h, w + 2, 1);
    c.fillRect(x + w, y - 1, 1, h + 2);
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
  };

  const frame = (c, w, h, title) => {
    c.fillStyle = C.edge;
    c.fillRect(0, 0, w, h);
    c.fillStyle = C.base;
    c.fillRect(1, 1, w - 2, h - 2);
    c.fillStyle = C.light;
    c.fillRect(1, 1, w - 2, 1);
    c.fillRect(1, 1, 1, h - 2);
    c.fillStyle = C.dark;
    c.fillRect(1, h - 2, w - 2, 1);
    c.fillRect(w - 2, 1, 1, h - 2);
    for (let y = 4; y <= 10; y += 2) {
      c.fillStyle = C.lighter;
      c.fillRect(6, y, w - 12, 1);
      c.fillStyle = C.dark;
      c.fillRect(6, y + 1, w - 12, 1);
    }
    const tw = textWidth(title);
    const tx = Math.round((w - tw) / 2);
    c.fillStyle = C.base;
    c.fillRect(tx - 6, 3, tw + 12, 9);
    drawText(c, title, tx, 5, C.text);
  };

  const button = (c, r, pressed, label) => {
    const [x, y, w, h] = r;
    if (pressed) {
      c.fillStyle = C.dark;
      c.fillRect(x, y, w, h);
      c.fillStyle = C.edge;
      c.fillRect(x, y, w, 1);
      c.fillRect(x, y, 1, h);
      c.fillStyle = C.base;
      c.fillRect(x, y + h - 1, w, 1);
      c.fillRect(x + w - 1, y, 1, h);
    } else {
      panel(c, x, y, w, h, C.baseHi);
      c.fillStyle = C.base;
      c.fillRect(x + 1, y + Math.floor(h / 2), w - 2, Math.ceil(h / 2) - 1);
    }
    if (label) label(x + (pressed ? 1 : 0), y + (pressed ? 1 : 0));
  };

  const led = (c, x, y, on) => {
    c.fillStyle = on ? C.lcd : C.lcdDim;
    c.fillRect(x, y, 3, 3);
    if (on) {
      c.fillStyle = C.lcdHi;
      c.fillRect(x, y, 1, 1);
    }
  };

  const glyph = (c, x, y, kind, color) => {
    c.fillStyle = color;
    const tri = (tx, ty, dir) => {
      for (let i = 0; i < 4; i += 1) {
        const hh = 7 - i * 2;
        c.fillRect(dir > 0 ? tx + i : tx - i, ty + i, 1, hh);
      }
    };
    if (kind === "play") tri(x + 9, y + 5, 1);
    else if (kind === "pause") {
      c.fillRect(x + 8, y + 5, 2, 7);
      c.fillRect(x + 12, y + 5, 2, 7);
    } else if (kind === "stop") c.fillRect(x + 8, y + 6, 6, 6);
    else if (kind === "prev") {
      c.fillRect(x + 6, y + 5, 1, 7);
      tri(x + 10, y + 5, -1);
      tri(x + 14, y + 5, -1);
    } else if (kind === "next") {
      tri(x + 6, y + 5, 1);
      tri(x + 10, y + 5, 1);
      c.fillRect(x + 14, y + 5, 1, 7);
    }
  };

  const hslider = (c, x, y, w, frac, thumbW, color, fromCenter = false) => {
    inset(c, x + 1, y + 3, w - 2, 4, C.dark);
    const tx = Math.round(x + frac * (w - thumbW));
    if (fromCenter) {
      const cx = x + Math.round((w - thumbW) / 2) + thumbW / 2;
      const px = tx + thumbW / 2;
      c.fillStyle = color;
      c.fillRect(Math.min(cx, px), y + 4, Math.abs(px - cx), 2);
    } else {
      c.fillStyle = color;
      c.fillRect(x + 1, y + 4, tx - x, 2);
    }
    panel(c, tx, y, thumbW, 9, C.light);
    c.fillStyle = C.lighter;
    c.fillRect(tx + 1, y + 1, thumbW - 2, 1);
    c.fillStyle = C.base;
    c.fillRect(tx + Math.floor(thumbW / 2) - 2, y + 3, 1, 3);
    c.fillRect(tx + Math.floor(thumbW / 2), y + 3, 1, 3);
    c.fillRect(tx + Math.floor(thumbW / 2) + 2, y + 3, 1, 3);
  };

  const drawVis = (c) => {
    const x0 = 24;
    const y0 = 43;
    if (ui.vis === "spectrum") {
      for (let i = 0; i < BAR_N; i += 1) {
        const hgt = Math.round(bars[i]);
        const bx = x0 + i * 4;
        for (let k = 0; k < hgt; k += 1) {
          c.fillStyle = SPECTRUM[k];
          c.fillRect(bx, y0 + 15 - k, 3, 1);
        }
        const p = Math.round(peaks[i]);
        if (p > 0) {
          c.fillStyle = "#b8b8c8";
          c.fillRect(bx, y0 + 15 - p, 3, 1);
        }
      }
    } else if (ui.vis === "osc" && winRate > 0) {
      const stride = Math.max(2, Math.round(winRate / 8000));
      const span = 76 * stride;
      let start = FFT_N - span - 1;
      for (let i = FFT_N - span - 1; i > 1; i -= 1) {
        if (win[i - 1] < 0 && win[i] >= 0) {
          start = i;
          break;
        }
      }
      let prev = null;
      for (let i = 0; i < 76; i += 1) {
        const s = win[start + i * stride] * OSC_GAIN;
        const y = Math.max(0, Math.min(15, Math.round(7.5 - s * 8)));
        const lo = prev == null ? y : Math.min(prev, y);
        const hi = prev == null ? y : Math.max(prev, y);
        c.fillStyle = levelColor(0.25 + Math.abs(y - 7.5) / 9);
        c.fillRect(x0 + i, y0 + lo, 1, hi - lo + 1);
        prev = y;
      }
    } else if (ui.vis === "osc") {
      c.fillStyle = C.lcdDim;
      c.fillRect(x0, y0 + 8, 76, 1);
    }
  };

  const drawMain = (now) => {
    const w = wins.main;
    const c = w.ctx;
    frame(c, w.w, w.h, "NOW PLAYING");
    inset(c, 9, 18, 93, 44);
    const t = current();
    const pos = ui.seekDrag != null ? ui.seekDrag * t.length : Math.min(songPos(), t.length);
    const running = player.playing && !player.paused;
    c.fillStyle = C.lcd;
    if (running) for (let i = 0; i < 4; i += 1) c.fillRect(13 + i, 24 + i, 1, 7 - i * 2);
    else if (player.paused) {
      c.fillRect(13, 24, 2, 7);
      c.fillRect(16, 24, 2, 7);
    } else c.fillRect(13, 25, 5, 5);
    const blinkOff = player.paused && Math.floor(now / 500) % 2 === 1;
    const shown = ui.timeMode === "remaining" ? t.length - pos : pos;
    const s = Math.floor(shown);
    const m = Math.min(9, Math.floor(s / 60));
    const on = blinkOff || !player.playing ? (player.playing ? C.lcdGhost : C.lcdDim) : C.lcd;
    const showDigits = player.playing || ui.seekDrag != null;
    c.fillStyle = ui.timeMode === "remaining" && showDigits ? on : C.lcdGhost;
    c.fillRect(26, 29, 5, 2);
    drawDigit(c, showDigits ? String(m) : " ", 36, 24, on, C.lcdGhost);
    c.fillStyle = showDigits ? on : C.lcdGhost;
    c.fillRect(48, 28, 2, 2);
    c.fillRect(48, 33, 2, 2);
    drawDigit(c, showDigits ? String(Math.floor((s % 60) / 10)) : " ", 53, 24, on, C.lcdGhost);
    drawDigit(c, showDigits ? String(s % 10) : " ", 65, 24, on, C.lcdGhost);
    drawVis(c);

    inset(c, 109, 22, 157, 11);
    c.save();
    c.beginPath();
    c.rect(110, 22, 155, 11);
    c.clip();
    if (ui.notice && now < ui.noticeUntil) {
      drawText(c, fitText(ui.notice, 150), 112, 25, C.lcd);
    } else {
      ui.notice = null;
      const msg = `${player.index + 1}. ${t.artist} - ${t.title} (8-BIT) (${fmt(t.length)})  ***  `;
      const mw = textWidth(msg) + 4;
      const off = Math.floor(ui.marquee) % mw;
      drawText(c, msg, 112 - off, 25, C.lcd);
      drawText(c, msg, 112 - off + mw, 25, C.lcd);
    }
    c.restore();

    ["SQ1", "SQ2", "TRI", "NOI"].forEach((label, i) => {
      const bx = 110 + i * 39;
      inset(c, bx, 38, 36, 9);
      const lvl = chanShown[i];
      drawText(c, label, bx + 2, 40, lvl > 0.05 ? C.lcd : C.lcdDim);
      for (let k = 0; k < 4; k += 1) {
        const on = lvl > 0.05 && lvl * 4 > k;
        c.fillStyle = on ? SPECTRUM[Math.min(15, 2 + k * 4)] : C.lcdGhost;
        c.fillRect(bx + 17 + k * 4, 40, 3, 5);
      }
    });

    hslider(c, 109, 54, 68, ui.volume, 14, levelColor(ui.volume * 0.9));
    hslider(c, 180, 54, 38, (ui.balance + 1) / 2, 14, levelColor(0.3 + Math.abs(ui.balance) * 0.6), true);
    for (const [id, label, win] of [
      ["eqbtn", "EQ", "eq"],
      ["plbtn", "PL", "pl"],
    ]) {
      const r = CONTROLS.main.find((k) => k.id === id).r;
      button(c, r, ui.pressed === id, (x, y) => {
        led(c, x + 3, y + 3, wins[win].visible);
        drawText(c, label, x + 9, y + 3, C.text);
      });
    }

    inset(c, 17, 72, 246, 6, C.dark);
    const frac = pos / t.length;
    c.fillStyle = "#24244a";
    c.fillRect(17, 73, Math.round(frac * 246), 4);
    const sx = Math.round(16 + frac * (248 - 29));
    panel(c, sx, 70, 29, 10, C.light);
    c.fillStyle = C.lighter;
    c.fillRect(sx + 1, 71, 27, 1);
    c.fillStyle = C.base;
    for (let i = 0; i < 4; i += 1) c.fillRect(sx + 10 + i * 3, 73, 1, 4);

    for (const id of ["prev", "play", "pause", "stop", "next"]) {
      const r = CONTROLS.main.find((k) => k.id === id).r;
      button(c, r, ui.pressed === id, (x, y) => glyph(c, x, y, id, C.text));
    }
    button(c, CONTROLS.main.find((k) => k.id === "shuffle").r, ui.pressed === "shuffle", (x, y) => {
      led(c, x + 5, y + 6, player.shuffle);
      drawText(c, "SHUFFLE", x + 12, y + 5, C.text);
    });
    button(c, CONTROLS.main.find((k) => k.id === "repeat").r, ui.pressed === "repeat", (x, y) => {
      led(c, x + 4, y + 6, player.repeat);
      drawText(c, "REP", x + 11, y + 5, C.text);
    });
    drawText(c, "HERB.ART", 231, 93, C.textDim);
  };

  const bandColor = (db) => levelColor(0.5 + db / 24);

  const drawEq = () => {
    const w = wins.eq;
    const c = w.ctx;
    frame(c, w.w, w.h, "EQUALIZER");
    button(c, [14, 18, 26, 11], ui.pressed === "eqon", (x, y) => {
      led(c, x + 4, y + 4, ui.eqOn);
      drawText(c, "ON", x + 11, y + 3, C.text);
    });
    button(c, [217, 18, 44, 11], ui.pressed === "presets", (x, y) => drawText(c, "PRESETS", x + 8, y + 3, C.text));
    inset(c, 86, 17, 113, 19);
    c.fillStyle = C.lcdGhost;
    c.fillRect(86, 26, 113, 1);
    const preY = Math.round(26 - (ui.pre / 12) * 8);
    c.fillStyle = "#30304a";
    c.fillRect(86, preY, 113, 1);
    const pts = ui.bands.map((db, i) => [88 + i * 12, db]);
    let prevY = null;
    for (let x = 86; x < 199; x += 1) {
      let db;
      if (x <= pts[0][0]) db = pts[0][1];
      else if (x >= pts[9][0]) db = pts[9][1];
      else {
        const k = Math.floor((x - 88) / 12);
        const t = (x - pts[k][0]) / 12;
        const s = t * t * (3 - 2 * t);
        db = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * s;
      }
      const y = Math.round(26 - (db / 12) * 8);
      const lo = prevY == null ? y : Math.min(prevY, y);
      const hi = prevY == null ? y : Math.max(prevY, y);
      c.fillStyle = ui.eqOn ? bandColor(db) : C.lcdDim;
      c.fillRect(x, lo, 1, hi - lo + 1);
      prevY = y;
    }
    drawText(c, "+12", 50, 39, C.textDim);
    drawText(c, "0", 58, 66, C.textDim);
    drawText(c, "-12", 50, 95, C.textDim);
    const vslider = (x, db, label) => {
      inset(c, x + 5, 39, 4, 61, C.dark);
      const ty = Math.round(38 + ((12 - db) / 24) * (63 - 11));
      const cy = Math.round(38 + 0.5 * (63 - 11)) + 5;
      c.fillStyle = ui.eqOn ? bandColor(db) : C.lcdDim;
      const yA = Math.min(cy, ty + 5);
      c.fillRect(x + 6, yA, 2, Math.abs(ty + 5 - cy) + 1);
      panel(c, x + 1, ty, 12, 11, C.light);
      c.fillStyle = C.lighter;
      c.fillRect(x + 2, ty + 1, 10, 1);
      c.fillStyle = C.base;
      c.fillRect(x + 3, ty + 4, 8, 1);
      c.fillRect(x + 3, ty + 6, 8, 1);
      const lw = textWidth(label);
      drawText(c, label, x + 7 - Math.floor(lw / 2), 105, C.textDim);
    };
    vslider(21, ui.pre, "PRE");
    ui.bands.forEach((db, i) => vslider(78 + i * 18, db, BAND_LABELS[i]));
  };

  const drawPl = () => {
    const w = wins.pl;
    const c = w.ctx;
    frame(c, w.w, w.h, "PLAYLIST");
    inset(c, 12, 20, 243, 174);
    const top = ui.playlistTop;
    for (let r = 0; r < PL_ROWS; r += 1) {
      const i = top + r;
      if (i >= tracks.length) break;
      const y = 21 + r * ROW_H;
      if (i === ui.playlistSel) {
        c.fillStyle = C.select;
        c.fillRect(12, y, 243, ROW_H);
      }
      const t = tracks[i];
      const color = i === player.index ? C.white : C.lcd;
      const time = fmt(t.length);
      const tw = textWidth(time);
      drawText(c, fitText(`${i + 1}. ${t.artist} - ${t.title}`, 243 - tw - 12), 15, y + 2, color);
      drawText(c, time, 252 - tw, y + 2, color);
    }
    inset(c, 258, 20, 8, 174, C.dark);
    const max = tracks.length - PL_ROWS;
    const ty = Math.round(20 + (max > 0 ? top / max : 0) * (174 - 18));
    panel(c, 258, ty, 8, 18, C.light);
    c.fillStyle = C.base;
    for (let i = 0; i < 3; i += 1) c.fillRect(260, ty + 6 + i * 2, 4, 1);
    inset(c, 12, 202, 118, 22);
    drawText(c, `${tracks.length} TRACKS`, 16, 206, C.lcd);
    drawText(c, `TOTAL ${fmtLong(totalLength)}`, 16, 215, C.lcd);
    inset(c, 138, 202, 128, 22);
    const t = current();
    drawText(c, fitText(`${player.index + 1}. ${t.title}`, 120), 142, 206, C.lcd);
    drawText(c, `${fmt(Math.min(songPos(), t.length))} / ${fmt(t.length)}`, 142, 215, C.lcdHi);
  };

  const requestRender = (song) => {
    if (rendering === song || destroyed) return;
    rendering = song;
    const full = song.loopStart + song.loopLen;
    const take = (r) => {
      if (destroyed || rendering !== song || !r) return false;
      pcm = r.pcm;
      pcmRate = r.rate;
      pcmSong = song;
      wake();
      ready();
      return true;
    };
    renderSong(song, Math.min(full, songPos() + 8))
      .then((r) => (take(r) && full > songPos() + 8 ? renderSong(song, full) : null))
      .then((r) => {
        take(r);
        if (rendering === song) rendering = null;
      })
      .catch(() => {
        if (rendering === song) rendering = null;
        ready();
      });
  };

  const fillWindow = () => {
    if (!player.playing || player.paused) return 0;
    if (audio.live()) {
      const rate = audio.read(win);
      let peak = 0;
      for (let i = 0; i < FFT_N; i += 8) peak = Math.max(peak, Math.abs(win[i]));
      if (peak > 1e-4) {
        winLive = true;
        return rate;
      }
    }
    winLive = false;
    const song = current().song;
    if (!pcm || pcmSong !== song) {
      requestRender(song);
      return 0;
    }
    const s = songPos();
    const vis = s < song.loopStart + song.loopLen ? s : song.loopStart + ((s - song.loopStart) % song.loopLen);
    const end = Math.floor(vis * pcmRate);
    const len = pcm.length;
    for (let i = 0; i < FFT_N; i += 1) {
      const k = end - FFT_N + i;
      win[i] = k >= 0 && k < len ? pcm[k] : 0;
    }
    return pcmRate;
  };

  const computeSpectrum = (dt) => {
    const running = winRate > 0 && ui.vis === "spectrum";
    const fall = 46 * dt;
    if (running) {
      for (let i = 0; i < FFT_N; i += 1) {
        re[i] = win[i] * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      const binHz = winRate / FFT_N;
      for (let b = 0; b < BAR_N; b += 1) {
        const [f0, f1, fc] = barRanges[b];
        const k0 = Math.max(1, Math.floor(f0 / binHz));
        const k1 = Math.max(k0, Math.min(FFT_N / 2 - 1, Math.ceil(f1 / binHz)));
        let m = 0;
        for (let k = k0; k <= k1; k += 1) m = Math.max(m, Math.hypot(re[k], im[k]));
        let db = 20 * Math.log10(m / (FFT_N / 4) + 1e-6);
        if (!winLive) db += (ui.eqOn ? ui.pre + eqAt(fc) : 0) - 4;
        db += b * 2.1;
        const level = Math.max(0, Math.min(16, ((db + 48) / 52) * 16));
        bars[b] = level > bars[b] ? level : Math.max(level, bars[b] - fall);
        if (bars[b] >= peaks[b]) {
          peaks[b] = bars[b];
          peakHold[b] = 0.35;
        } else if (peakHold[b] > 0) peakHold[b] -= dt;
        else peaks[b] = Math.max(0, peaks[b] - 14 * dt);
      }
      return true;
    }
    let any = false;
    for (let b = 0; b < BAR_N; b += 1) {
      bars[b] = Math.max(0, bars[b] - fall);
      if (peakHold[b] > 0) peakHold[b] -= dt;
      else peaks[b] = Math.max(0, peaks[b] - 14 * dt);
      if (bars[b] > 0 || peaks[b] > 0) any = true;
    }
    return any;
  };

  const eqAt = (f) => {
    const lf = Math.log2(f);
    let sum = 0;
    BANDS.forEach((bf, i) => {
      const d = lf - Math.log2(bf);
      sum += ui.bands[i] * Math.exp(-d * d * 1.4);
    });
    return sum * 0.85;
  };

  const step = (now) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let again = false;
    if (player.playing && !player.paused) {
      const t = current();
      if (songPos() >= t.length) {
        if (player.index === tracks.length - 1 && !player.repeat && !player.shuffle) actions.stop();
        else actions.next();
      }
      again = true;
    }
    if (player.playing || player.paused) again = true;
    let glide = false;
    for (let i = 0; i < 10; i += 1) {
      const d = ui.target[i] - ui.bands[i];
      if (Math.abs(d) > 0.01) {
        ui.bands[i] += d * Math.min(1, dt * 12);
        glide = true;
      } else ui.bands[i] = ui.target[i];
    }
    const dp = ui.preTarget - ui.pre;
    if (Math.abs(dp) > 0.01) {
      ui.pre += dp * Math.min(1, dt * 12);
      glide = true;
    } else ui.pre = ui.preTarget;
    if (glide) {
      pushEq();
      wins.eq.dirty = true;
      again = true;
    }
    winRate = fillWindow();
    activity(player.playing ? current().song : null, songPos(), chanLevels);
    for (let i = 0; i < 4; i += 1) {
      const target = player.playing && !player.paused ? chanLevels[i] : 0;
      chanShown[i] = target > chanShown[i] ? target : Math.max(target, chanShown[i] - dt * 5);
    }
    if (computeSpectrum(dt)) again = true;
    ui.marquee += dt * 22;
    again = true;
    if (ui.notice) again = true;
    wins.main.dirty = true;
    if (player.playing && Math.floor(songPos()) !== wins.pl.lastSec) {
      wins.pl.lastSec = Math.floor(songPos());
      wins.pl.dirty = true;
    }
    if (wins.main.dirty) drawMain(now);
    if (wins.eq.dirty) drawEq();
    if (wins.pl.dirty) drawPl();
    wins.main.dirty = wins.eq.dirty = wins.pl.dirty = false;
    if (again) raf = requestAnimationFrame(step);
  };

  function wake() {
    if (!raf && !destroyed && visible && !document.hidden) {
      lastT = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  let scale = 1;
  let mode = null;
  const placeWin = (w) => {
    w.canvas.style.transform = `translate3d(${w.x}px, ${w.y}px, 0)`;
  };

  const layout = () => {
    const rect = root.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wide = W >= 760;
    let top = 24;
    if (caption && !embedded) top = wide && W >= 1100 ? caption.offsetTop + caption.offsetHeight + 32 : caption.offsetTop + caption.offsetHeight + 24;
    const gw = wide ? 550 : 275;
    const gh = wide ? 232 : 464;
    const availW = W - 32;
    const availH = H - top - 24;
    const m = Math.max(0.5, Math.min(availW / gw, availH / gh, 3));
    const snapped = Math.floor(m * dpr) / dpr;
    scale = snapped >= m * 0.82 ? snapped : m;
    desk.style.transform = `scale(${scale})`;
    desk.style.width = `${W / scale}px`;
    desk.style.height = `${H / scale}px`;
    const nextMode = wide ? "wide" : "narrow";
    const ox = Math.round((W / scale - gw) / 2);
    const oy = Math.round(top / scale + (availH / scale - gh) / 2);
    if (mode !== nextMode) {
      mode = nextMode;
      const pos = wide ? { main: [0, 0], eq: [0, 116], pl: [275, 0] } : { main: [0, 0], eq: [0, 116], pl: [0, 232] };
      for (const id of Object.keys(wins)) {
        wins[id].x = ox + pos[id][0];
        wins[id].y = oy + pos[id][1];
      }
    }
    const dw = W / scale;
    const dh = H / scale;
    for (const w of Object.values(wins)) {
      w.x = Math.round(Math.max(-w.w + 40, Math.min(dw - 40, w.x)));
      w.y = Math.round(Math.max(0, Math.min(dh - 14, w.y)));
      placeWin(w);
    }
  };

  const touching = (a, b) => {
    const vOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
    const hOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
    return (vOverlap && (a.x + a.w === b.x || b.x + b.w === a.x)) || (hOverlap && (a.y + a.h === b.y || b.y + b.h === a.y));
  };

  const dockedGroup = (start) => {
    const group = [start];
    if (start.id !== "main") return group;
    for (let i = 0; i < group.length; i += 1) {
      for (const o of Object.values(wins)) if (o.visible && !group.includes(o) && touching(group[i], o)) group.push(o);
    }
    return group;
  };

  const snapDelta = (group, dx, dy) => {
    const others = Object.values(wins).filter((o) => o.visible && !group.includes(o));
    const dw = parseFloat(desk.style.width);
    const dh = parseFloat(desk.style.height);
    let bestX = null;
    let bestY = null;
    const consider = (best, d) => (Math.abs(d) <= SNAP && (best == null || Math.abs(d) < Math.abs(best)) ? d : best);
    for (const w of group) {
      const x = w.start[0] + dx;
      const y = w.start[1] + dy;
      for (const o of others) {
        if (y < o.y + o.h + SNAP && y + w.h > o.y - SNAP) {
          bestX = consider(bestX, o.x + o.w - x);
          bestX = consider(bestX, o.x - (x + w.w));
          bestX = consider(bestX, o.x - x);
          bestX = consider(bestX, o.x + o.w - (x + w.w));
        }
        if (x < o.x + o.w + SNAP && x + w.w > o.x - SNAP) {
          bestY = consider(bestY, o.y + o.h - y);
          bestY = consider(bestY, o.y - (y + w.h));
          bestY = consider(bestY, o.y - y);
          bestY = consider(bestY, o.y + o.h - (y + w.h));
        }
      }
      bestX = consider(bestX, -x + 8);
      bestX = consider(bestX, dw - 8 - (x + w.w));
      bestY = consider(bestY, dh - 8 - (y + w.h));
    }
    return [Math.round(dx + (bestX ?? 0)), Math.round(dy + (bestY ?? 0)), bestX != null || bestY != null];
  };

  const sliderSet = (id, lx, ly) => {
    if (id === "volume") {
      ui.volume = Math.max(0, Math.min(1, (lx - 109 - 7) / (68 - 14)));
      audio.setVolume(ui.volume);
      notice(`VOLUME: ${Math.round(ui.volume * 100)}%`);
    } else if (id === "balance") {
      let b = Math.max(-1, Math.min(1, ((lx - 180 - 7) / (38 - 14)) * 2 - 1));
      if (Math.abs(b) < 0.08) b = 0;
      ui.balance = b;
      audio.setBalance(b);
      notice(b === 0 ? "BALANCE: CENTER" : `BALANCE: ${Math.round(Math.abs(b) * 100)}% ${b < 0 ? "LEFT" : "RIGHT"}`);
    } else if (id === "seek") {
      ui.seekDrag = Math.max(0, Math.min(1, (lx - 16 - 14) / (248 - 29)));
      const t = current();
      notice(`SEEK TO: ${fmt(ui.seekDrag * t.length)}/${fmt(t.length)} (${Math.round(ui.seekDrag * 100)}%)`);
    } else if (id.startsWith("band-")) {
      let db = Math.max(-12, Math.min(12, 12 - ((ly - 38 - 5.5) / (63 - 11)) * 24));
      if (Math.abs(db) < 0.7) db = 0;
      const key = id.slice(5);
      if (key === "pre") {
        ui.pre = ui.preTarget = db;
        notice(`EQ: PREAMP: ${db >= 0 ? "+" : ""}${db.toFixed(1)} DB`);
      } else {
        const i = Number(key);
        ui.bands[i] = ui.target[i] = db;
        notice(`EQ: ${BAND_LABELS[i]}HZ: ${db >= 0 ? "+" : ""}${db.toFixed(1)} DB`);
      }
      pushEq();
      mark("eq");
    } else if (id === "scroll") {
      const max = Math.max(0, tracks.length - PL_ROWS);
      ui.playlistTop = Math.round(Math.max(0, Math.min(1, (ly - 20 - 9) / (174 - 18))) * max);
      mark("pl");
    }
    mark("main");
  };

  let lastNotch = null;
  const notchOf = (id) => {
    if (id === "volume") return Math.round(ui.volume * 20);
    if (id === "balance") return Math.round(ui.balance * 10);
    if (id === "seek") return Math.round((ui.seekDrag ?? 0) * 40);
    if (id === "band-pre") return Math.round(ui.pre);
    if (id.startsWith("band-")) return Math.round(ui.bands[Number(id.slice(5))]);
    if (id === "scroll") return ui.playlistTop;
    return 0;
  };

  let drag = null;
  let lastListClick = { t: 0, i: -1 };
  const local = (w, e) => {
    const r = w.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * w.w, ((e.clientY - r.top) / r.height) * w.h];
  };

  let zTop = 1;
  const raise = (w) => {
    zTop += 1;
    w.canvas.style.zIndex = String(zTop);
  };

  const onDown = (e) => {
    const id = e.currentTarget.dataset.win;
    const w = wins[id];
    if (!w.visible || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    audio.arm(songPos);
    w.canvas.setPointerCapture(e.pointerId);
    raise(w);
    const [lx, ly] = local(w, e);
    const ctl = ly >= 14 ? hit(id, lx, ly) : null;
    if (ctl?.kind === "button") {
      ui.pressed = ctl.id;
      audio.click("button");
      drag = { type: "button", win: w, ctl, id: e.pointerId };
      mark(id);
    } else if (ctl?.kind === "slider") {
      lastNotch = null;
      drag = { type: "slider", win: w, ctl, id: e.pointerId };
      sliderSet(ctl.id, lx, ly);
      lastNotch = notchOf(ctl.id);
      audio.click("notch");
    } else if (ctl?.kind === "tap") {
      audio.click("toggle");
      actions[ctl.id]();
      drag = null;
    } else if (ctl?.kind === "list") {
      const i = ui.playlistTop + Math.floor((ly - 21) / ROW_H);
      if (i >= 0 && i < tracks.length) {
        const now = performance.now();
        ui.playlistSel = i;
        if (lastListClick.i === i && now - lastListClick.t < 420) {
          audio.click("toggle");
          startTrack(i);
          lastListClick = { t: 0, i: -1 };
        } else {
          audio.click("notch");
          lastListClick = { t: now, i };
        }
        mark("pl");
      }
    } else {
      const group = dockedGroup(w);
      for (const g of group) g.start = [g.x, g.y];
      drag = { type: "move", win: w, group, sx: e.clientX, sy: e.clientY, id: e.pointerId, snapped: true };
      w.canvas.dataset.moving = "";
    }
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const w = drag.win;
    if (drag.type === "move") {
      const dx = (e.clientX - drag.sx) / scale;
      const dy = (e.clientY - drag.sy) / scale;
      const [sx, sy, snapped] = snapDelta(drag.group, dx, dy);
      if (snapped && !drag.snapped) audio.click("snap");
      drag.snapped = snapped;
      for (const g of drag.group) {
        g.x = g.start[0] + sx;
        g.y = g.start[1] + sy;
        placeWin(g);
      }
    } else if (drag.type === "slider") {
      const [lx, ly] = local(w, e);
      sliderSet(drag.ctl.id, lx, ly);
      const n = notchOf(drag.ctl.id);
      if (n !== lastNotch) {
        lastNotch = n;
        audio.click("notch");
      }
    } else if (drag.type === "button") {
      const [lx, ly] = local(w, e);
      const r = drag.ctl.r;
      const inside = lx >= r[0] && lx < r[0] + r[2] && ly >= r[1] && ly < r[1] + r[3];
      const next = inside ? drag.ctl.id : null;
      if (next !== ui.pressed) {
        ui.pressed = next;
        mark(w.id);
      }
    }
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.type === "button") {
      const fire = ui.pressed === d.ctl.id && e.type === "pointerup";
      ui.pressed = null;
      audio.click("release");
      if (fire) actions[d.ctl.id]();
      mark(d.win.id);
    } else if (d.type === "slider") {
      if (d.ctl.id === "seek" && ui.seekDrag != null) {
        const t = current();
        player.pos = ui.seekDrag * t.length;
        player.startedAt = performance.now();
        ui.seekDrag = null;
        if (!player.playing) {
          player.playing = true;
          player.paused = true;
        }
        syncAudio();
      }
      ui.noticeUntil = Math.min(ui.noticeUntil, performance.now() + 600);
      mark("main");
    } else if (d.type === "move") {
      delete d.win.canvas.dataset.moving;
    }
  };

  const onWheel = (e) => {
    const id = e.currentTarget.dataset.win;
    if (id !== "pl") return;
    e.preventDefault();
    const n = Math.sign(e.deltaY) * Math.max(1, Math.min(4, Math.round(Math.abs(e.deltaY) / 30)));
    const max = tracks.length - PL_ROWS;
    const next = Math.max(0, Math.min(max, ui.playlistTop + n));
    if (next !== ui.playlistTop) {
      ui.playlistTop = next;
      audio.click("notch");
      mark("pl");
    }
  };

  for (const w of Object.values(wins)) {
    w.canvas.addEventListener("pointerdown", onDown);
    w.canvas.addEventListener("pointermove", onMove);
    w.canvas.addEventListener("pointerup", onUp);
    w.canvas.addEventListener("pointercancel", onUp);
    w.canvas.addEventListener("wheel", onWheel, { passive: false });
  }

  const onKey = (e) => {
    if (!visible || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    const map = { z: "prev", x: "play", c: "pause", v: "stop", b: "next" };
    let handled = true;
    if (map[k]) {
      audio.arm(songPos);
      audio.click("button");
      actions[map[k]]();
    } else if (k === " ") {
      audio.arm(songPos);
      audio.click("button");
      if (player.playing) actions.pause();
      else actions.play();
    } else if (k === "arrowdown" || k === "arrowup") {
      ui.playlistSel = Math.max(0, Math.min(tracks.length - 1, ui.playlistSel + (k === "arrowdown" ? 1 : -1)));
      ensureVisible(ui.playlistSel);
      audio.click("notch");
      mark("pl");
    } else if (k === "enter") {
      audio.arm(songPos);
      audio.click("toggle");
      startTrack(ui.playlistSel);
    } else if (k === "arrowleft" || k === "arrowright") {
      const tr = current();
      player.pos = Math.max(0, Math.min(tr.length - 1, songPos() + (k === "arrowright" ? 5 : -5)));
      player.startedAt = performance.now();
      syncAudio();
      mark("main");
    } else handled = false;
    if (handled) e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(layout);
  ro.observe(root);
  if (caption) ro.observe(caption);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(root);
  const onVis = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVis);

  layout();
  drawMain(performance.now());
  drawEq();
  drawPl();

  let readied = false;
  function ready() {
    if (readied || destroyed) return;
    readied = true;
    onReady();
  }
  const readyTimer = window.setTimeout(ready, 1400);
  audio.setSong(current().song);
  requestRender(current().song);
  player.startedAt = performance.now();
  syncAudio();
  onLive(`${current().artist}, ${current().title}`);
  pushEq();
  wake();

  return {
    async setSound(on) {
      const ok = await audio.setEnabled(on, songPos);
      if (on && ok && player.playing && !player.paused && !audio.live()) audio.play(songPos());
      return ok;
    },
    setTracks(list) {
      if (!list?.length) return;
      const next = buildTracks(list);
      const same = next.length === tracks.length && next.every((t, i) => t.song === tracks[i].song);
      if (same) return;
      tracks = next;
      totalLength = tracks.reduce((s, t) => s + t.length, 0);
      ui.playlistSel = 0;
      ui.playlistTop = 0;
      startTrack(0, player.playing && !player.paused);
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(readyTimer);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      audio.destroy();
      desk.remove();
    },
  };
}
