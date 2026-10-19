import { albumById } from "@/app/lab/_music/catalog";

import { createCutAudio } from "./maxWidthAudio";

const DURATION = 15;
const MOVE = 0.42;
const TYPED = "abbey roa";
const TYPE_AT = 8.75;
const TYPE_STEP = 0.11;

const SCENES = [
  { name: "Big", start: 0, end: 4 },
  { name: "Card", start: 4, end: 7.5 },
  { name: "Search", start: 7.5, end: 11.5 },
  { name: "Slate", start: 11.5, end: 15 },
];

const EVENTS = [
  [0.5, "swoosh"],
  [1.0, "swoosh"],
  [1.5, "pop"],
  [2.0, "pop"],
  [2.5, "pop"],
  [3.0, "pop"],
  [4.0, "cut"],
  [4.5, "pop"],
  [5.0, "pop"],
  [5.5, "swoosh"],
  [6.0, "pop"],
  [6.25, "pop"],
  [6.5, "pop"],
  [7.0, "pop"],
  [7.5, "cut"],
  [8.0, "pop"],
  [8.5, "swoosh"],
  ...Array.from(TYPED, (_, i) => [Number((TYPE_AT + i * TYPE_STEP).toFixed(2)), "key"]),
  [10.0, "swoosh"],
  [10.25, "pop"],
  [10.5, "pop"],
  [10.75, "save"],
  [11.0, "pop"],
  [11.5, "cut"],
  [11.75, "pop"],
  [12.25, "pop"],
  [12.5, "pop"],
  [13.5, "swoosh"],
  [13.75, "pop"],
  [13.9, "pop"],
];

const TICKS = [...new Set(EVENTS.filter(([, kind]) => kind !== "key").map(([t]) => t).concat([TYPE_AT, 0]))].sort((a, b) => a - b);

function bezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 6; i += 1) {
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= (sx(u) - x) / d;
    }
    u = Math.min(1, Math.max(0, u));
    return sy(u);
  };
}

const ease = bezier(0.7, 0, 0.16, 1);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const prog = (t, t0, d = MOVE) => ease(clamp01((t - t0) / d));
const lerp = (a, b, k) => a + (b - a) * k;

const tracking = (size) => {
  const px = -0.043 * (size - 12);
  return size < 20 ? `${px.toFixed(2)}px` : `${(px / size).toFixed(4)}em`;
};

function el(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

function setT(node, value) {
  if (node._t === value) return;
  node._t = value;
  node.style.transform = value;
}

function setO(node, value) {
  const v = value <= 0.001 ? 0 : value >= 0.999 ? 1 : Number(value.toFixed(3));
  if (node._o === v) return;
  node._o = v;
  node.style.opacity = String(v);
}

function setVis(node, on) {
  if (node._v === on) return;
  node._v = on;
  node.style.visibility = on ? "visible" : "hidden";
}

function line(parent, text, cls = "") {
  const wrap = el("div", `max-width-line ${cls}`.trim(), parent);
  const inner = el("span", "max-width-line-in", wrap, text);
  return { wrap, inner };
}

function reveal(ln, t, tin, tout) {
  let y;
  if (t < tin) y = 108;
  else if (tout != null && t >= tout) y = -108 * prog(t, tout, 0.34);
  else y = 108 * (1 - prog(t, tin, 0.34));
  setT(ln.inner, `translate3d(0,${y.toFixed(2)}%,0)`);
}

function typeStyle(node, size) {
  node.style.fontSize = `${size.toFixed(2)}px`;
  node.style.letterSpacing = tracking(size);
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" fill="currentColor"/></svg>';
const LOOP_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2 12.5 4l-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.2" stroke="currentColor" stroke-width="2.6" fill="none"/><path d="M14.6 14.6 20 20" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const TRI = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1v8l7-4z" fill="currentColor"/></svg>';

const fmt = (t) => {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `0:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

export function createMaxWidth(root, { stage, controls, onReady, onSound }) {
  const abbey = albumById("abbey-road");
  const gridIds = ["abbey-road", "let-it-be", "revolver", "rubber-soul", "help", "sgt-pepper"];
  let destroyed = false;
  let W = 0;
  let H = 0;
  let L = null;
  let t = 0;
  let playing = true;
  let looping = true;
  let scrubbing = false;
  let resumeAfterScrub = false;
  let raf = 0;
  let visible = true;
  let anchor = null;
  let lastRendered = -1;
  let ready = false;
  let audio = null;
  let soundOn = false;
  let family = "sans-serif";

  const film = el("div", "max-width-film", stage);

  const s1 = el("div", "max-width-scene max-width-scene--black", film);
  const row = el("div", "max-width-row", s1);
  const bigs = Array.from({ length: 7 }, () => el("span", "max-width-big", row, "Big"));
  const leftLines = el("div", "max-width-stack", row);
  const lThings = line(leftLines, "things");
  const lCome = line(leftLines, "come");
  const lTogether = line(leftLines, "together");
  const rightLines = el("div", "max-width-stack", row);
  const lOn = line(rightLines, "on Abbey");
  const lRoad = line(rightLines, "Road");

  const s2 = el("div", "max-width-scene max-width-scene--black", film);
  const card = el("div", "max-width-card", s2);
  const cardBg = el("div", "max-width-card-bg", card);
  const coverWrap = el("div", "max-width-card-cover", card);
  const coverImg = el("img", "", coverWrap);
  coverImg.alt = "Abbey Road cover";
  coverImg.decoding = "async";
  coverImg.src = abbey.cover;
  const cardTri = el("span", "max-width-tri", card);
  cardTri.innerHTML = TRI;
  const cardSmall = el("div", "max-width-stack max-width-red", card);
  const lSide = line(cardSmall, "Side two,");
  const lAt = line(cardSmall, "at");
  const cardBig = el("div", "max-width-stack max-width-red max-width-right", card);
  const lMax = line(cardBig, "max.");
  const lWidth = line(cardBig, "width");
  const intro = el("div", "max-width-stack", s2);
  const lIntro = line(intro, "Introducing");
  const lAbbey = line(intro, "Abbey Road", "max-width-red");

  const s3 = el("div", "max-width-scene max-width-scene--white", film);
  const headA = el("div", "max-width-stack max-width-grey", s3);
  const lWith = line(headA, "with the right");
  const lRecord = line(headA, "record");
  const headB = el("div", "max-width-stack max-width-grey", s3);
  const lAtThe = line(headB, "at the");
  const lRight = line(headB, "right time");
  const caretLine = el("div", "max-width-caretline", s3);
  const bar = el("div", "max-width-bar", s3);
  const barBg = el("div", "max-width-bar-bg", bar);
  const barIcon = el("span", "max-width-bar-icon", bar);
  barIcon.innerHTML = SEARCH_ICON;
  const barText = el("span", "max-width-bar-text", bar);
  const barCaret = el("span", "max-width-bar-caret", bar);
  const tiles = gridIds.map((id) => {
    const album = albumById(id);
    const tile = el("div", "max-width-tile", s3);
    const img = el("img", "", tile);
    img.alt = album.title;
    img.decoding = "async";
    img.src = album.cover;
    return tile;
  });
  const savePill = el("span", "max-width-save", tiles[0], "Save");
  const toast = el("div", "max-width-toast", s3);
  el("span", "max-width-toast-dot", toast);
  el("span", "", toast, "saved to Sunday records");

  const s4 = el("div", "max-width-scene max-width-scene--white", film);
  const slate = el("div", "max-width-slate", s4);
  const slateTop = el("div", "max-width-stack", slate);
  const lPut = line(slateTop, "Put on");
  const lSideTwo = line(slateTop, "side two");
  const slateBottom = el("div", "max-width-stack", slate);
  const lAtMax = line(slateBottom, "at max. width");
  const lTonight = line(slateBottom, "tonight");
  const slateTri = el("span", "max-width-tri max-width-tri--white", slate);
  slateTri.innerHTML = TRI;
  const red = el("div", "max-width-redslate", s4);
  const redTop = el("div", "max-width-redword", red, "Abbey Road");
  const redMid = el("div", "max-width-redmid", red, "the beatles, 1969");
  const redBottom = el("div", "max-width-redword", red, "at max.");

  const scenes = [s1, s2, s3, s4];

  const bar1 = el("div", "max-width-ctrl", controls);
  const playBtn = el("button", "max-width-btn", bar1);
  playBtn.type = "button";
  const timeLabel = el("span", "max-width-time", bar1);
  const track = el("div", "max-width-track", bar1);
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", "Timeline");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(DURATION));
  const segRow = el("div", "max-width-segs", track);
  const segs = SCENES.map((s) => {
    const seg = el("span", "max-width-seg", segRow, s.name);
    seg.style.left = `${(s.start / DURATION) * 100}%`;
    seg.style.width = `${((s.end - s.start) / DURATION) * 100}%`;
    return seg;
  });
  const rail = el("div", "max-width-rail", track);
  const fill = el("div", "max-width-fill", rail);
  const tickEls = TICKS.map((tk) => {
    const tick = el("span", "max-width-tick", rail);
    tick.style.left = `${(tk / DURATION) * 100}%`;
    return tick;
  });
  const head = el("div", "max-width-head", track);
  el("span", "max-width-head-knob", head);
  const loopBtn = el("button", "max-width-btn max-width-btn--loop", bar1);
  loopBtn.type = "button";
  loopBtn.innerHTML = LOOP_ICON;
  loopBtn.setAttribute("aria-label", "Loop");

  const measureCanvas = document.createElement("canvas").getContext("2d");
  const measure = (text, size) => {
    measureCanvas.font = `700 ${size}px ${family}`;
    if ("letterSpacing" in measureCanvas) measureCanvas.letterSpacing = size < 20 ? tracking(size) : `${(-0.043 * (size - 12)).toFixed(2)}px`;
    return measureCanvas.measureText(text);
  };

  const layout = () => {
    const rect = stage.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    if (!W || !H) return;
    const aspect = W / H;

    const F = Math.min(H * 1.12, (W * 1.05) / 1.32);
    const mBig = measure("Big", F);
    const ascent = mBig.fontBoundingBoxAscent ?? F * 0.9;
    const descent = mBig.fontBoundingBoxDescent ?? F * 0.22;
    const bo = (F - (ascent + descent)) / 2 + ascent;
    const cap = measure("B", F).actualBoundingBoxAscent || F * 0.7;
    bigs.forEach((b) => {
      typeStyle(b, F);
      b.style.lineHeight = `${F.toFixed(2)}px`;
    });
    const wBig = bigs[0].offsetWidth || mBig.width;
    bigs.forEach((b, i) => {
      b.style.left = `${(i * wBig).toFixed(2)}px`;
    });
    const shiftScale = Math.min(1, (W * 0.5) / wBig, (H * 0.62) / cap);
    const ls = Math.max(13, H * 0.062) / shiftScale;
    for (const stack of [leftLines, rightLines]) typeStyle(stack, ls);
    const lineTop = bo + (H * 0.2) / shiftScale;
    leftLines.style.left = `${(W * 0.02) / shiftScale}px`;
    leftLines.style.top = `${lineTop.toFixed(2)}px`;
    rightLines.style.left = `${(wBig + (W * 0.02) / shiftScale).toFixed(2)}px`;
    rightLines.style.top = `${(lineTop + ls * 0.92).toFixed(2)}px`;
    const smallScale = (H * 0.15) / cap;
    const bigCenterY = bo - cap / 2;

    const ch = H * 0.68;
    const cw = Math.min(ch / 1.42, W * 0.36);
    const cx = W * 0.05;
    const cy = (H - ch) / 2;
    const we = W * 0.9;
    card.style.left = `${cx}px`;
    card.style.top = `${cy}px`;
    card.style.width = `${we}px`;
    card.style.height = `${ch}px`;
    const pad = Math.max(10, ch * 0.06);
    coverWrap.style.width = `${cw}px`;
    coverWrap.style.height = `${cw}px`;
    const triSize = Math.max(8, ch * 0.035);
    for (const tri of [cardTri]) {
      tri.style.width = `${triSize}px`;
      tri.style.height = `${triSize}px`;
      tri.style.left = `${pad * 0.7}px`;
      tri.style.top = `${ch - pad * 0.7 - triSize}px`;
    }
    const smallSize = Math.max(13, H * 0.05);
    typeStyle(cardSmall, smallSize);
    cardSmall.style.left = `${cw + pad}px`;
    cardSmall.style.top = `${pad * 0.8}px`;
    const room = we - cw - pad * 2;
    const widthRatio = measure("width", 100).width / 100;
    const bigSize = Math.min(ch * 0.36, (room * 0.92) / widthRatio);
    typeStyle(cardBig, bigSize);
    cardBig.style.right = `${pad}px`;
    cardBig.style.top = `${ch - pad * 0.7 - bigSize * 2 * 0.92}px`;
    const introSize = Math.max(14, H * 0.07);
    typeStyle(intro, introSize);
    intro.style.left = `${cx}px`;
    intro.style.top = `${cy + pad * 0.6}px`;

    const headSize = Math.max(16, H * 0.085);
    for (const h of [headA, headB]) {
      typeStyle(h, headSize);
      h.style.left = `${W * 0.05}px`;
      h.style.top = `${H * 0.09}px`;
    }
    const barW = Math.min(W * 0.9, H * 1.02);
    const barH = H * 0.13;
    const barX = W * 0.05;
    const barY = H * 0.09 + headSize * 2 * 0.92 + H * 0.08;
    bar.style.left = `${barX}px`;
    bar.style.top = `${barY}px`;
    bar.style.width = `${barW}px`;
    bar.style.height = `${barH}px`;
    bar.style.setProperty("--max-width-r", `${(barH * 0.12).toFixed(1)}px`);
    const iconSize = barH * 0.42;
    barIcon.style.width = `${iconSize}px`;
    barIcon.style.height = `${iconSize}px`;
    barIcon.style.left = `${barH * 0.34}px`;
    barIcon.style.top = `${(barH - iconSize) / 2}px`;
    const barTextSize = barH * 0.5;
    typeStyle(barText, barTextSize);
    barText.style.left = `${barH * 0.34 + iconSize + barH * 0.2}px`;
    barText.style.lineHeight = `${barH}px`;
    const textX = barH * 0.34 + iconSize + barH * 0.2;
    barCaret.style.height = `${barH * 0.52}px`;
    barCaret.style.top = `${barH * 0.24}px`;
    caretLine.style.left = `${barX}px`;
    caretLine.style.top = `${barY}px`;
    caretLine.style.height = `${barH}px`;
    const prefixes = Array.from({ length: TYPED.length + 1 }, (_, i) => measure(TYPED.slice(0, i), barTextSize).width);

    const tile = Math.min(W * 0.17, H * 0.3);
    const gap = Math.max(6, tile * 0.08);
    const gx = W * 0.95 - tile * 2 - gap;
    const smallBarH = barH * ((tile * 2 + gap) / barW);
    const smallBarY = H * 0.07;
    const gridY = smallBarY + smallBarH + gap;
    const tilePos = tiles.map((tileEl, i) => {
      const col = i % 2;
      const r = Math.floor(i / 2);
      const x = gx + col * (tile + gap);
      const y = gridY + r * (tile + gap) + (col ? tile * 0.42 : 0);
      tileEl.style.left = `${x}px`;
      tileEl.style.top = `${y}px`;
      tileEl.style.width = `${tile}px`;
      tileEl.style.height = `${tile}px`;
      return { x, y };
    });
    const pillSize = Math.max(10, tile * 0.075);
    typeStyle(savePill, pillSize);
    const toastSize = Math.max(10, tile * 0.07);
    typeStyle(toast, toastSize);
    toast.style.left = `${gx}px`;
    toast.style.width = `${tile * 2 + gap}px`;
    toast.style.height = `${toastSize * 2.6}px`;
    toast.style.top = `${Math.min(H * 0.86, gridY + tile * 2.2)}px`;

    const sx = W * 0.04;
    const sy = H * 0.06;
    slate.style.left = `${sx}px`;
    slate.style.top = `${sy}px`;
    slate.style.width = `${W - sx * 2}px`;
    slate.style.height = `${H - sy * 2}px`;
    const slateSize = Math.max(15, H * 0.08);
    typeStyle(slateTop, slateSize);
    typeStyle(slateBottom, slateSize);
    const sPad = Math.max(12, H * 0.05);
    slateTop.style.left = `${sPad}px`;
    slateTop.style.top = `${sPad * 0.7}px`;
    const atMaxW = measure("at max. width", slateSize).width;
    slateBottom.style.left = `${Math.max(sPad, W - sx * 2 - sPad - atMaxW)}px`;
    slateBottom.style.top = `${H - sy * 2 - sPad * 0.7 - slateSize * 2 * 0.92}px`;
    slateTri.style.width = `${triSize}px`;
    slateTri.style.height = `${triSize}px`;
    slateTri.style.left = `${sPad * 0.6}px`;
    slateTri.style.top = `${H - sy * 2 - sPad * 0.6 - triSize}px`;

    const redSize = Math.min(H * 0.36, (W * 1.12) / (measure("Abbey Road", 100).width / 100));
    typeStyle(redTop, redSize);
    typeStyle(redBottom, redSize);
    redTop.style.lineHeight = `${redSize}px`;
    redBottom.style.lineHeight = `${redSize}px`;
    const redBo = (redSize - (ascent + descent) * (redSize / F)) / 2 + ascent * (redSize / F);
    redTop.style.top = `${H * 0.2 - redBo}px`;
    redBottom.style.top = `${H * 0.8 + (cap * redSize) / F - redBo}px`;
    const midSize = Math.max(14, H * 0.065);
    typeStyle(redMid, midSize);
    redMid.style.top = `${H * 0.5 - midSize * 0.6}px`;
    redMid.style.lineHeight = `${midSize * 1.2}px`;

    L = { F, bo, cap, wBig, shiftScale, smallScale, bigCenterY, aspect, ch, cw, cx, cy, we, pad, barX, barY, barW, barH, textX, prefixes, tile, gap, gx, gridY, smallBarY, tilePos };
    lastRendered = -1;
    render(t, true);
  };

  const renderBig = (time) => {
    const { bo, cap, wBig, shiftScale, smallScale, bigCenterY } = L;
    const grow = prog(time, 0.5);
    const shift = prog(time, 1.0, 0.5);
    const drift = Math.max(0, time - 1.0) * W * 0.006;
    const scale = lerp(lerp(smallScale, 1, grow), shiftScale, shift);
    const ax = W / 2 - (smallScale * wBig) / 2;
    const ay = H / 2 - smallScale * bigCenterY;
    const bx = Math.max(W * 0.006, W / 2 - wBig / 2);
    const by = H * 0.06 - (bo - cap);
    const cx = W * 0.004;
    const cy = H * (W < H ? 0.52 : 0.44) - bo * shiftScale;
    let x = lerp(ax, bx, grow);
    let y = lerp(ay, by, grow);
    x = lerp(x, cx, shift) - drift;
    y = lerp(y, cy, shift);
    setT(row, `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${scale.toFixed(5)})`);
    const pop = time < 0.5 ? 0.86 + 0.14 * prog(time, 0, 0.3) : 1;
    setT(bigs[0], pop === 1 ? "none" : `scale(${pop.toFixed(4)})`);
    const others = clamp01((time - 0.5) / 0.2);
    for (let i = 1; i < bigs.length; i += 1) setO(bigs[i], time < 0.5 ? 0 : others >= 1 ? 1 : others);
    reveal(lThings, time, 1.5);
    reveal(lCome, time, 2.0);
    reveal(lTogether, time, 2.5);
    reveal(lOn, time, 3.0);
    reveal(lRoad, time, 3.12);
  };

  const renderCard = (time) => {
    const { ch, cw, we, pad } = L;
    const enter = prog(time, 4.0, 0.46);
    setT(card, `translate3d(0,${((1 - enter) * (H - L.cy + 8)).toFixed(2)}px,0)`);
    const grow = prog(time, 5.5, 0.5);
    const width = lerp(cw, we, grow);
    const inset = we - width;
    const r = Math.max(4, ch * 0.022);
    const clip = `inset(0px ${inset.toFixed(2)}px 0px 0px round ${r.toFixed(1)}px)`;
    if (cardBg._c !== clip) {
      cardBg._c = clip;
      cardBg.style.clipPath = clip;
    }
    setT(intro, `translate3d(${(width + pad * 0.9).toFixed(2)}px,${((1 - enter) * (H - L.cy + 8)).toFixed(2)}px,0)`);
    reveal(lIntro, time, 4.5);
    reveal(lAbbey, time, 5.0);
    reveal(lSide, time, 6.0);
    reveal(lAt, time, 6.25);
    reveal(lMax, time, 6.5);
    reveal(lWidth, time, 7.0);
  };

  const renderSearch = (time) => {
    const { barX, barY, barW, barH, textX, prefixes, tile, gap, gx, smallBarY, tilePos } = L;
    reveal(lWith, time, 7.5, 10.0);
    reveal(lRecord, time, 8.0, 10.04);
    reveal(lAtThe, time, 10.25);
    reveal(lRight, time, 10.5);
    const caretOn = time >= 8.25 && time < 8.6;
    setO(caretLine, caretOn ? 1 : 0);
    const open = prog(time, 8.5, 0.36);
    setT(barBg, `scaleX(${Math.max(0.001, open).toFixed(4)})`);
    const content = clamp01((time - 8.62) / 0.12);
    setO(barIcon, content);
    const typed = time < TYPE_AT ? 0 : Math.min(TYPED.length, Math.floor((time - TYPE_AT) / TYPE_STEP) + 1);
    if (barText._n !== typed) {
      barText._n = typed;
      barText.textContent = TYPED.slice(0, typed);
    }
    const caretX = textX + prefixes[typed] + barH * 0.03;
    const typing = time >= TYPE_AT && time < TYPE_AT + TYPED.length * TYPE_STEP + 0.3;
    const blink = typing || Math.floor((time - 8.6) * 2.6) % 2 === 0;
    setO(barCaret, time >= 8.62 && blink ? 1 : 0);
    setT(barCaret, `translate3d(${caretX.toFixed(2)}px,0,0)`);
    const move = prog(time, 10.0, 0.46);
    const s = lerp(1, (tile * 2 + gap) / barW, move);
    const mx = lerp(barX, gx, move);
    const my = lerp(barY, smallBarY, move);
    setT(bar, `translate3d(${(mx - barX).toFixed(2)}px,${(my - barY).toFixed(2)}px,0) scale(${s.toFixed(5)})`);
    tiles.forEach((tileEl, i) => {
      const col = i % 2;
      const at = 10.0 + col * 0.08 + Math.floor(i / 2) * 0.05;
      const k = prog(time, at, 0.5);
      const dy = (1 - k) * (H - tilePos[i].y + tile * 0.2);
      setT(tileEl, `translate3d(0,${dy.toFixed(2)}px,0)`);
    });
    const save = prog(time, 10.75, 0.3);
    setT(savePill, `scale(${(0.5 + 0.5 * save).toFixed(4)})`);
    setO(savePill, save);
    const tk = prog(time, 11.0, 0.36);
    setT(toast, `translate3d(0,${((1 - tk) * H * 0.3).toFixed(2)}px,0)`);
    setO(toast, clamp01((time - 11.0) / 0.12));
  };

  const renderSlate = (time) => {
    const enter = prog(time, 11.5, 0.46);
    setT(slate, `translate3d(0,${((1 - enter) * H * 0.9).toFixed(2)}px,0)`);
    reveal(lPut, time, 11.5);
    reveal(lSideTwo, time, 11.75);
    reveal(lAtMax, time, 12.25);
    reveal(lTonight, time, 12.5);
    const wipe = prog(time, 13.5, 0.46);
    setT(red, `translate3d(0,${((1 - wipe) * (H + 2)).toFixed(2)}px,0)`);
    const top = prog(time, 13.62, 0.5);
    setT(redTop, `translate3d(0,${(-(1 - top) * H * 0.4).toFixed(2)}px,0)`);
    const mid = prog(time, 13.75, 0.34);
    setO(redMid, mid);
    setT(redMid, `translate3d(0,${((1 - mid) * H * 0.04).toFixed(2)}px,0)`);
    const bottom = prog(time, 13.9, 0.5);
    setT(redBottom, `translate3d(0,${((1 - bottom) * H * 0.4).toFixed(2)}px,0)`);
  };

  const renderers = [renderBig, renderCard, renderSearch, renderSlate];

  const render = (time, force = false) => {
    if (!L) return;
    if (!force && time === lastRendered) return;
    lastRendered = time;
    const idx = SCENES.findIndex((s) => time >= s.start && time < s.end);
    const active = idx < 0 ? SCENES.length - 1 : idx;
    scenes.forEach((s, i) => setVis(s, i === active));
    renderers[active](time);
    const frac = time / DURATION;
    setT(head, `translate3d(${(frac * track.clientWidth).toFixed(2)}px,0,0)`);
    setT(fill, `scaleX(${frac.toFixed(5)})`);
    timeLabel.textContent = fmt(time);
    track.setAttribute("aria-valuenow", time.toFixed(2));
    track.setAttribute("aria-valuetext", `${fmt(time)}, ${SCENES[active].name}`);
    segs.forEach((seg, i) => seg.toggleAttribute("data-on", i === active));
    tickEls.forEach((tick, i) => tick.toggleAttribute("data-past", TICKS[i] <= time + 1e-4));
  };

  const fireBetween = (a, b) => {
    if (!audio || !soundOn) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let count = 0;
    for (const [et, kind] of EVENTS) {
      const hit = b >= a ? et > lo && et <= hi : et >= lo && et < hi;
      if (!hit) continue;
      count += 1;
      if (count > 3) break;
      audio.play(kind, (et / DURATION) * 0.8 - 0.4);
    }
    if (b >= a && a > b - 0.5 && lo <= 0 && hi >= 0) audio.play("cut");
  };

  const playClock = () => {
    if (anchor?.audio && audio) return audio.clock();
    return performance.now() / 1000;
  };

  const startAnchor = () => {
    let audioAt = null;
    if (soundOn && audio) audioAt = audio.startBeat(t);
    anchor = audioAt != null ? { t0: t, c0: audioAt, audio: true } : { t0: t, c0: performance.now() / 1000, audio: false };
  };

  const setPlaying = (on) => {
    playing = on;
    playBtn.innerHTML = on ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    root.toggleAttribute("data-playing", on);
    if (on) {
      if (!looping && t >= DURATION - 0.001) t = 0;
      startAnchor();
      wake();
    } else {
      anchor = null;
      audio?.stopBeat();
    }
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    if (playing && anchor && !scrubbing) {
      const elapsed = Math.max(0, playClock() - anchor.c0);
      let next = anchor.t0 + elapsed;
      const prev = t;
      if (next >= DURATION) {
        if (looping) {
          next %= DURATION;
          fireBetween(prev, DURATION);
          fireBetween(-0.001, next);
          if (anchor.audio) anchor = { ...anchor, t0: next, c0: playClock() };
          else anchor = { t0: next, c0: performance.now() / 1000, audio: false };
        } else {
          next = DURATION - 0.0001;
          fireBetween(prev, next);
          t = next;
          render(t);
          setPlaying(false);
          return;
        }
      } else {
        fireBetween(prev, next);
      }
      t = next;
      render(t);
    }
    if (playing && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (raf || destroyed || !visible || document.hidden || !ready) return;
    raf = requestAnimationFrame(frame);
  };

  const seek = (time, sound = true) => {
    const next = Math.min(DURATION - 0.0001, Math.max(0, time));
    if (sound) fireBetween(t, next);
    t = next;
    render(t);
    if (playing && !scrubbing) startAnchor();
  };

  const timeAt = (clientX, snap) => {
    const r = track.getBoundingClientRect();
    const x = Math.min(r.width, Math.max(0, clientX - r.left));
    let time = (x / r.width) * DURATION;
    if (snap) {
      const px = DURATION / r.width;
      let best = null;
      for (const tk of TICKS) if (Math.abs(tk - time) < px * 6 && (best == null || Math.abs(tk - time) < Math.abs(best - time))) best = tk;
      if (best != null) time = best;
    }
    return time;
  };

  const onTrackDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    track.focus({ preventScroll: true });
    scrubbing = true;
    resumeAfterScrub = playing;
    if (playing) {
      anchor = null;
      audio?.stopBeat();
    }
    root.setAttribute("data-scrubbing", "");
    seek(timeAt(e.clientX, true));
  };
  const onTrackMove = (e) => {
    if (!scrubbing) return;
    seek(timeAt(e.clientX, true));
  };
  const onTrackUp = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    root.removeAttribute("data-scrubbing");
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
    if (resumeAfterScrub) {
      startAnchor();
      wake();
    }
  };

  const step = (dir, toKey) => {
    if (playing) setPlaying(false);
    if (toKey) {
      const list = dir > 0 ? TICKS.filter((k) => k > t + 1e-3) : TICKS.filter((k) => k < t - 1e-3).reverse();
      seek(list.length ? list[0] : dir > 0 ? DURATION : 0);
    } else {
      seek(Math.round(t * 30) / 30 + dir / 30);
    }
  };

  const onKey = (e) => {
    if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      setPlaying(!playing);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1, e.shiftKey);
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      if (playing) setPlaying(false);
      seek(DURATION);
    }
  };

  const onPlayClick = () => setPlaying(!playing);
  const onLoopClick = () => {
    looping = !looping;
    loopBtn.setAttribute("aria-pressed", String(looping));
  };
  loopBtn.setAttribute("aria-pressed", "true");

  const onStageClick = () => setPlaying(!playing);

  playBtn.addEventListener("click", onPlayClick);
  loopBtn.addEventListener("click", onLoopClick);
  track.addEventListener("pointerdown", onTrackDown);
  track.addEventListener("pointermove", onTrackMove);
  track.addEventListener("pointerup", onTrackUp);
  track.addEventListener("pointercancel", onTrackUp);
  stage.addEventListener("click", onStageClick);
  root.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => {
    if (ready) layout();
  });
  ro.observe(stage);
  ro.observe(track);

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      if (playing) startAnchor();
      wake();
    } else {
      audio?.stopBeat();
    }
  });
  io.observe(root);

  const onVisibility = () => {
    if (document.hidden) audio?.stopBeat();
    else if (playing) {
      startAnchor();
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  setPlaying(true);

  const boot = async () => {
    family = getComputedStyle(film).fontFamily || "sans-serif";
    try {
      await document.fonts.load(`700 100px ${family}`);
      await document.fonts.ready;
    } catch {
      family = "sans-serif";
    }
    const imgs = [coverImg, ...tiles.map((tl) => tl.firstChild)];
    await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    if (destroyed) return;
    ready = true;
    layout();
    t = 0;
    startAnchor();
    root.setAttribute("data-ready", "");
    onReady?.();
    wake();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !audio) audio = createCutAudio();
      if (!audio) return false;
      const result = await audio.setEnabled(on);
      soundOn = Boolean(result);
      if (soundOn && playing) startAnchor();
      onSound?.(soundOn);
      return soundOn;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      playBtn.removeEventListener("click", onPlayClick);
      loopBtn.removeEventListener("click", onLoopClick);
      track.removeEventListener("pointerdown", onTrackDown);
      track.removeEventListener("pointermove", onTrackMove);
      track.removeEventListener("pointerup", onTrackUp);
      track.removeEventListener("pointercancel", onTrackUp);
      stage.removeEventListener("click", onStageClick);
      root.removeEventListener("keydown", onKey);
      audio?.destroy();
      film.remove();
      bar1.remove();
    },
  };
}
