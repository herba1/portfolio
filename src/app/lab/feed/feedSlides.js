export const FONTS = {
  arimo: '"Feed Arimo", Arial, Helvetica, sans-serif',
  tinos: '"Feed Tinos", "Times New Roman", serif',
  pixel: '"Feed Pixel", monospace',
  hand: '"Feed Hand", cursive',
};

export const tracking = (size) => {
  const px = -0.043 * (size - 12);
  return size < 20 ? `${px.toFixed(2)}px` : `${(px / size).toFixed(4)}em`;
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const easeIn = (v) => Math.pow(clamp01(v), 3);

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
  const v = value <= 0.002 ? 0 : value >= 0.998 ? 1 : Number(value.toFixed(3));
  if (node._o === v) return;
  node._o = v;
  node.style.opacity = String(v);
}

function canvasFor(parent, cls) {
  const c = el("canvas", cls, parent);
  c.setAttribute("aria-hidden", "true");
  return c;
}

function coverDraw(ctx, img, w, h, focusX = 0.5, focusY = 0.5) {
  const ir = img.naturalWidth / img.naturalHeight;
  const r = w / h;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (ir > r) sw = sh * r;
  else sh = sw / r;
  const sx = (img.naturalWidth - sw) * focusX;
  const sy = (img.naturalHeight - sh) * focusY;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function nightSlide(host, { photo }) {
  const root = el("div", "feed-art feed-art--night", host);
  const canvas = canvasFor(root, "feed-night-photo");
  const block = el("div", "feed-night-block", root);
  const phrases = [
    [["we", "can", "stay"], ["out", "till", "the"], ["streetlights"], ["go", "soft"]],
    [["you", "don't"], ["have", "to", "be"], ["anyone"], ["tonight"]],
  ];
  const phraseEls = phrases.map((lines) => {
    const ph = el("div", "feed-night-phrase", block);
    const words = [];
    lines.forEach((ln) => {
      const row = el("div", "feed-night-line", ph);
      if (ln.length === 1) row.setAttribute("data-single", "");
      ln.forEach((w) => words.push(el("span", "feed-night-word", row, w)));
    });
    return { ph, words };
  });
  let img = null;
  let W = 0;
  let H = 0;
  const STEP = 0.5;
  const HOLD = 1.6;
  const durations = phraseEls.map((p) => 0.4 + p.words.length * STEP + HOLD);
  const cycle = durations.reduce((a, b) => a + b, 0);

  return {
    theme: "dark",
    grain: 0.16,
    async load() {
      img = await loadImage(photo);
    },
    build(w, h, dpr) {
      W = w;
      H = h;
      const over = 1.1;
      const cw = Math.round(w * over * dpr);
      const ch = Math.round(h * over * dpr);
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${w * over}px`;
      canvas.style.height = `${h * over}px`;
      canvas.style.left = `${(-w * (over - 1)) / 2}px`;
      canvas.style.top = `${(-h * (over - 1)) / 2}px`;
      const ctx = canvas.getContext("2d");
      if (!img) {
        ctx.fillStyle = "#0b0a09";
        ctx.fillRect(0, 0, cw, ch);
      } else {
        const low = document.createElement("canvas");
        low.width = Math.round(cw * 0.56);
        low.height = Math.round(ch * 0.56);
        const lx = low.getContext("2d");
        lx.filter = "brightness(0.8) contrast(1.14) saturate(0.78) sepia(0.16)";
        coverDraw(lx, img, low.width, low.height, 0.42, 0.5);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(low, 0, 0, cw, ch);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.42;
        ctx.filter = `blur(${Math.round(9 * dpr)}px) brightness(0.9) contrast(1.6)`;
        ctx.drawImage(low, 0, 0, cw, ch);
        ctx.filter = "none";
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      const g = ctx.createRadialGradient(cw / 2, ch * 0.5, Math.min(cw, ch) * 0.25, cw / 2, ch * 0.5, Math.max(cw, ch) * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.55, "rgba(0,0,0,0.12)");
      g.addColorStop(0.8, "rgba(0,0,0,0.36)");
      g.addColorStop(1, "rgba(0,0,0,0.62)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      const size = w * 0.078;
      block.style.fontSize = `${size}px`;
      block.style.letterSpacing = tracking(size);
      block.style.lineHeight = `${size * 1.08}px`;
      block.style.width = `${w * 0.6}px`;
      block.style.left = `${w * 0.13}px`;
      block.style.top = `${h * 0.4}px`;
    },
    render(lt) {
      const dx = Math.sin(lt * 0.71) * 0.006 + Math.sin(lt * 1.93 + 1.2) * 0.0025;
      const dy = Math.sin(lt * 0.53 + 2.1) * 0.005 + Math.sin(lt * 2.31) * 0.002;
      const rot = Math.sin(lt * 0.41 + 0.6) * 0.35;
      setT(canvas, `translate3d(${(dx * W).toFixed(2)}px,${(dy * H).toFixed(2)}px,0) rotate(${rot.toFixed(3)}deg)`);
      let t = lt % cycle;
      let current = 0;
      while (t > durations[current]) {
        t -= durations[current];
        current += 1;
      }
      let popped = -1;
      phraseEls.forEach((p, pi) => {
        p.ph.style.display = pi === current ? "" : "none";
        if (pi !== current) return;
        p.words.forEach((wd, wi) => {
          const at = 0.4 + wi * STEP;
          const k = clamp01((t - at) / 0.06);
          setO(wd, k);
          if (k > 0 && wd._seen !== true) {
            wd._seen = true;
            popped = wi;
          }
          if (k === 0) wd._seen = false;
        });
      });
      return popped >= 0 ? "pop" : null;
    },
    reset() {
      phraseEls.forEach((p) => p.words.forEach((wd) => (wd._seen = false)));
    },
  };
}

export function smearSlide(host) {
  const root = el("div", "feed-art feed-art--smear", host);
  const block = el("div", "feed-smear-block", root);
  const lines = [
    "it's been a while since",
    "the street was this quiet",
    "i keep your voice",
    "on the walk home",
    "the lights go soft and",
    "the bus is late again",
    "and i don't mind it",
    "not tonight",
    "i still think of the record",
    "you left on, side two",
    "the one that ends slow",
    "it will take a while",
    "to feel like this again",
    "nothing good comes easy",
    "but it comes",
    "still here",
  ];
  const words = [];
  lines.forEach((ln, li) => {
    const row = el("div", "feed-smear-line", block);
    ln.split(" ").forEach((w, wi) => {
      const span = el("span", "feed-smear-word", row, w);
      words.push({ span, at: 0.25 + li * 0.27 + wi * 0.05, out: 7.6 + (lines.length - li) * 0.04 + wi * 0.02 });
    });
  });
  let W = 0;
  const CYCLE = 9.4;
  const ghost = (d) => {
    if (Math.abs(d) < 0.5) return "none";
    const g = Math.abs(d) * 0.24;
    return [0.55, 0.36, 0.22, 0.1].map((a, i) => `${(g * (i + 1)).toFixed(1)}px 0 0 rgba(255,255,255,${a})`).join(",");
  };
  return {
    theme: "dark",
    grain: 0.14,
    build(w, h) {
      W = w;
      const size = Math.max(11, w * 0.039);
      block.style.fontSize = `${size}px`;
      block.style.letterSpacing = tracking(size);
      block.style.lineHeight = `${Math.round(size * 1.28)}px`;
      block.style.width = `${w * 0.74}px`;
      block.style.left = `${w * 0.07}px`;
      block.style.top = `${h * 0.14}px`;
    },
    render(lt) {
      const t = lt % CYCLE;
      let arrived = false;
      for (const wd of words) {
        let d = 0;
        let o = 1;
        if (t < wd.at) {
          o = 0;
          d = W * 0.4;
        } else if (t < wd.at + 0.45) {
          const k = (t - wd.at) / 0.45;
          d = (1 - easeOut(k)) * W * 0.4;
          if (!wd.hit) {
            wd.hit = true;
            arrived = true;
          }
        } else if (t > wd.out) {
          const k = clamp01((t - wd.out) / 0.5);
          d = -easeIn(k) * W * 0.5;
          o = 1 - clamp01((k - 0.6) / 0.4);
        }
        if (t < wd.at) wd.hit = false;
        setO(wd.span, o);
        setT(wd.span, d === 0 ? "none" : `translate3d(${d.toFixed(1)}px,0,0)`);
        const sh = ghost(d);
        if (wd.span._sh !== sh) {
          wd.span._sh = sh;
          wd.span.style.textShadow = sh;
        }
      }
      return arrived ? "smear" : null;
    },
    reset() {
      words.forEach((wd) => (wd.hit = false));
    },
  };
}

export function decaySlide(host) {
  const root = el("div", "feed-art feed-art--decay", host);
  const canvas = canvasFor(root, "feed-fill");
  const ctx = canvas.getContext("2d");
  let pixels = [];
  let cols = 0;
  let cell = 0;
  let ox = 0;
  let oy = 0;
  let lineGap = 0;
  let dpr = 1;
  let lastKey = "";
  const BASE = [0, 0.07, 0.27, 0.5];
  const build = (w, h, d) => {
    dpr = d;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = document.createElement("canvas");
    const gx = g.getContext("2d", { willReadFrequently: true });
    const text = "how are you?";
    const U = 10;
    const S = U * 10;
    gx.font = `400 ${S}px ${FONTS.pixel}`;
    const gwPx = Math.ceil(gx.measureText(text).width / U) * U + U * 2;
    g.width = gwPx;
    g.height = S * 1.5;
    gx.font = `400 ${S}px ${FONTS.pixel}`;
    gx.textBaseline = "alphabetic";
    gx.fillStyle = "#000";
    gx.fillText(text, U, S);
    const data = gx.getImageData(0, 0, g.width, g.height).data;
    const gridW = g.width / U;
    const gridH = Math.floor(g.height / U);
    const base = [];
    let minY = 99;
    let maxY = 0;
    for (let y = 0; y < gridH; y += 1) {
      for (let x = 0; x < gridW; x += 1) {
        const px = x * U + U / 2;
        const py = y * U + U / 2;
        if (data[(py * g.width + px) * 4 + 3] > 128) {
          base.push([x, y]);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    cols = gridW;
    cell = (w * 0.9 - 56) / (cols - 2);
    ox = w * 0.06 - cell;
    lineGap = (maxY - minY + 3) * cell;
    oy = h * 0.26 - minY * cell;
    const rand = rng(4090);
    pixels = [];
    for (let li = 0; li < 4; li += 1) {
      for (const [x, y] of base) {
        const dir = Math.floor(rand() * 4);
        pixels.push({ li, x, y, r1: rand(), r2: rand(), r3: rand(), r4: rand(), dx: dir === 0 ? 1 : dir === 1 ? -1 : 0, dy: dir === 2 ? 1 : dir === 3 ? -1 : 0 });
      }
    }
    lastKey = "";
  };
  return {
    theme: "light",
    top: "light",
    grain: 0.08,
    build,
    render(lt) {
      const step = Math.floor(lt / 0.16);
      const reveal = [0, 1, 2, 3].map((li) => Math.min(4, Math.max(0, Math.floor((lt - 0.3 - li * 0.42) / 0.09) + 1)));
      const key = `${step}|${reveal.join(",")}`;
      if (key === lastKey) return null;
      const grew = lastKey && reveal.join(",") !== lastKey.split("|")[1];
      lastKey = key;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#e4e4e4";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#0b18ff";
      const wobble = [0, 0.015, 0.05, 0.08];
      for (const p of pixels) {
        const rv = reveal[p.li];
        if (rv <= 0 || p.r3 > rv / 4) continue;
        const flick = (Math.sin(step * 12.9898 + p.r4 * 78.233) * 43758.5453) % 1;
        const decay = BASE[p.li] + wobble[p.li] * Math.abs(flick);
        if (p.r1 < decay) continue;
        const shift = p.r2 < decay * 0.75;
        const x = ox + (p.x + (shift ? p.dx : 0)) * cell;
        const y = oy + p.li * lineGap + (p.y + (shift ? p.dy : 0)) * cell;
        const x0 = Math.round(x * dpr);
        const y0 = Math.round(y * dpr);
        ctx.fillRect(x0 / dpr, y0 / dpr, (Math.round((x + cell) * dpr) - x0) / dpr, (Math.round((y + cell) * dpr) - y0) / dpr);
      }
      return grew ? "tick" : null;
    },
    reset() {
      lastKey = "";
    },
  };
}

export function cutoutSlide(host, { photo }) {
  const root = el("div", "feed-art feed-art--cutout", host);
  const canvas = canvasFor(root, "feed-fill");
  const strips = [
    { text: "it must be out there.", y: 0.3, x: 0.46, rot: -1.2, at: 0.5 },
    { text: "so i keep looking up.", y: 0.385, x: 0.52, rot: 1.6, at: 2.1 },
  ].map((s, i) => {
    const outer = el("div", "feed-strip", root);
    const inner = el("div", "feed-strip-paper", outer, s.text);
    const rand = rng(39 + i * 7);
    const pts = [];
    const n = 9;
    for (let k = 0; k <= n; k += 1) pts.push(`${((k / n) * 100).toFixed(1)}% ${(rand() * 6).toFixed(1)}%`);
    for (let k = 0; k <= 3; k += 1) pts.push(`${(100 - rand() * 1.2).toFixed(1)}% ${((k / 3) * 100).toFixed(1)}%`);
    for (let k = n; k >= 0; k -= 1) pts.push(`${((k / n) * 100).toFixed(1)}% ${(100 - rand() * 6).toFixed(1)}%`);
    for (let k = 3; k >= 0; k -= 1) pts.push(`${(rand() * 1.2).toFixed(1)}% ${((k / 3) * 100).toFixed(1)}%`);
    inner.style.clipPath = `polygon(${pts.join(",")})`;
    return { ...s, outer, inner, landed: false };
  });
  let img = null;
  let H = 0;
  return {
    theme: "dark",
    top: "light",
    grain: 0.16,
    async load() {
      img = await loadImage(photo);
    },
    build(w, h, dpr) {
      H = h;
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (img) {
        ctx.filter = "saturate(0.86) contrast(0.94) brightness(1.04)";
        coverDraw(ctx, img, cw, ch, 0.5, 0.5);
        ctx.filter = "none";
      } else {
        ctx.fillStyle = "#79b4dc";
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.strokeStyle = "rgba(28,30,38,0.78)";
      ctx.lineCap = "round";
      const wires = [
        [-0.1, 0.05, 1.1, 0.13, 0.05],
        [-0.1, 0.085, 1.1, 0.19, 0.06],
        [-0.1, 0.11, 1.1, 0.25, 0.07],
      ];
      wires.forEach(([x0, y0, x1, y1, sag], i) => {
        ctx.lineWidth = (0.9 + i * 0.2) * dpr;
        ctx.beginPath();
        ctx.moveTo(x0 * cw, y0 * ch);
        ctx.quadraticCurveTo(0.5 * cw, ((y0 + y1) / 2 + sag) * ch, x1 * cw, y1 * ch);
        ctx.stroke();
      });
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(0.98 * cw, 0);
      ctx.quadraticCurveTo(0.9 * cw, 0.3 * ch, 0.86 * cw, 0.5 * ch);
      ctx.stroke();
      const id = ctx.getImageData(0, 0, cw, ch);
      const d = id.data;
      const cell = 2.6 * dpr;
      const ang = Math.PI / 4;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const rand = rng(1039);
      const k2 = (Math.PI * 2) / cell;
      for (let y = 0; y < ch; y += 1) {
        for (let x = 0; x < cw; x += 1) {
          const i = (y * cw + x) * 4;
          const u = (x * ca + y * sa) * k2;
          const v = (-x * sa + y * ca) * k2;
          const s = (Math.cos(u) + Math.cos(v)) * 0.25 + 0.5;
          const m = 0.84 + 0.3 * s;
          const n = (rand() - 0.5) * 14;
          d[i] = Math.min(255, d[i] * m * 0.96 + 12 + n);
          d[i + 1] = Math.min(255, d[i + 1] * m * 0.95 + 10 + n);
          d[i + 2] = Math.min(255, d[i + 2] * m * 0.9 + 6 + n);
        }
      }
      ctx.putImageData(id, 0, 0);
      const size = w * 0.066;
      strips.forEach((s) => {
        s.inner.style.fontSize = `${size}px`;
        s.inner.style.letterSpacing = tracking(size);
        s.inner.style.lineHeight = `${Math.round(size * 1.15)}px`;
        s.outer.style.left = `${w * s.x}px`;
        s.outer.style.top = `${h * s.y}px`;
      });
    },
    render(lt) {
      let landed = null;
      strips.forEach((s) => {
        const k = clamp01((lt - s.at) / 0.42);
        if (k <= 0) {
          setO(s.outer, 0);
          s.landed = false;
          return;
        }
        const e = easeOut(k);
        setO(s.outer, clamp01(k / 0.25));
        const scale = 1.16 - 0.16 * e;
        const y = -(1 - e) * H * 0.03;
        const rot = s.rot - (1 - e) * 5;
        setT(s.outer, `translate3d(-50%,${y.toFixed(2)}px,0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`);
        s.outer.style.setProperty("--feed-lift", (1 - e).toFixed(3));
        if (k >= 1 && !s.landed) {
          s.landed = true;
          landed = "paper";
        }
      });
      return landed;
    },
    reset() {
      strips.forEach((s) => (s.landed = false));
    },
  };
}

export function crayonSlide(host) {
  const root = el("div", "feed-art feed-art--crayon", host);
  const paper = canvasFor(root, "feed-fill");
  const ink = canvasFor(root, "feed-fill");
  const ictx = ink.getContext("2d");
  const lines = ["THE WHOLE POINT", "IS NOT KNOWING", "AND GOING", "ANYWAY."];
  let letters = [];
  let dpr = 1;
  let lastKey = "";

  const buildPaper = (w, h) => {
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    paper.width = cw;
    paper.height = ch;
    const ctx = paper.getContext("2d");
    ctx.fillStyle = "#16449a";
    ctx.fillRect(0, 0, cw, ch);
    const rand = rng(7463);
    const low = document.createElement("canvas");
    low.width = 36;
    low.height = 78;
    const lx = low.getContext("2d");
    const ld = lx.createImageData(low.width, low.height);
    for (let i = 0; i < ld.data.length; i += 4) {
      const v = rand();
      ld.data[i] = 10 + v * 30;
      ld.data[i + 1] = 40 + v * 50;
      ld.data[i + 2] = 110 + v * 70;
      ld.data[i + 3] = 150;
    }
    lx.putImageData(ld, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.filter = `blur(${Math.round(10 * dpr)}px)`;
    ctx.drawImage(low, -20, -20, cw + 40, ch + 40);
    ctx.filter = "none";
    ctx.strokeStyle = "rgba(190,215,255,0.07)";
    for (let i = 0; i < 520; i += 1) {
      const x = rand() * cw;
      const y = rand() * ch;
      const a = rand() * Math.PI;
      const l = (4 + rand() * 18) * dpr;
      ctx.lineWidth = (0.5 + rand()) * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(220,235,255,0.5)";
    for (let i = 0; i < 160; i += 1) {
      const r = (0.4 + rand() * 0.9) * dpr;
      ctx.beginPath();
      ctx.arc(rand() * cw, rand() * ch, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const id = ctx.getImageData(0, 0, cw, ch);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = (rand() - 0.5) * 22;
      id.data[i] += n;
      id.data[i + 1] += n;
      id.data[i + 2] += n;
    }
    ctx.putImageData(id, 0, 0);
    const oranges = [
      [0.92, 0.07, 0.17],
      [0.05, 0.62, 0.13],
      [0.62, 0.95, 0.11],
      [1.02, 0.78, 0.09],
    ];
    oranges.forEach(([ox, oy, or]) => {
      const x = ox * cw;
      const y = oy * ch;
      const r = or * cw * 1.4;
      ctx.save();
      ctx.shadowColor = "rgba(0,10,40,0.45)";
      ctx.shadowBlur = 18 * dpr;
      ctx.shadowOffsetY = 6 * dpr;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, "#ffc067");
      g.addColorStop(0.45, "#f6911c");
      g.addColorStop(0.85, "#e0700e");
      g.addColorStop(1, "#c85d08");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(120,50,0,0.16)";
      for (let i = 0; i < 260; i += 1) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * r;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, (0.6 + rand()) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  };

  const sprite = (ch, size, variant) => {
    const rand = rng(ch.charCodeAt(0) * 31 + variant * 977);
    const c = document.createElement("canvas");
    const pad = size * 0.3;
    c.width = Math.ceil((size * 1.1 + pad * 2) * dpr);
    c.height = Math.ceil((size * 1.6 + pad * 2) * dpr);
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    x.translate(pad + size * 0.05, pad + size * 1.15);
    x.rotate((rand() - 0.5) * 0.09);
    x.font = `400 ${size}px ${FONTS.hand}`;
    x.fillStyle = "#fbfbf6";
    x.fillText(ch, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2);
    x.lineWidth = size * 0.035;
    x.strokeStyle = "#fbfbf6";
    x.strokeText(ch, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = "destination-out";
    const count = Math.round((c.width * c.height) / (7 * dpr));
    for (let i = 0; i < count; i += 1) {
      x.globalAlpha = 0.5 + rand() * 0.5;
      x.fillRect(Math.floor(rand() * c.width), Math.floor(rand() * c.height), Math.ceil(dpr * (rand() < 0.3 ? 2 : 1)), Math.ceil(dpr));
    }
    return { c, pad };
  };

  return {
    theme: "dark",
    grain: 0.2,
    build(w, h, d) {
      dpr = d;
      buildPaper(w, h);
      ink.width = Math.round(w * dpr);
      ink.height = Math.round(h * dpr);
      const mc = document.createElement("canvas").getContext("2d");
      let size = w * 0.07;
      mc.font = `400 ${size}px ${FONTS.hand}`;
      const widest = Math.max(...lines.map((ln) => [...ln].reduce((a, ch) => a + mc.measureText(ch).width + size * 0.18 + (ch === " " ? size * 0.25 : 0), 0)));
      if (widest > w * 0.78) size *= (w * 0.78) / widest;
      mc.font = `400 ${size}px ${FONTS.hand}`;
      const track = size * 0.18;
      letters = [];
      let idx = 0;
      lines.forEach((ln, li) => {
        let x = w * 0.1 + (li % 2) * size * 0.2;
        const y = h * 0.27 + li * size * 1.75;
        for (const ch of ln) {
          const cwid = mc.measureText(ch).width;
          if (ch !== " ") {
            letters.push({ ch, x, y, at: 0.35 + idx * 0.075, sprites: [0, 1, 2].map((v) => sprite(ch, size, v)), size });
            idx += 1;
          } else idx += 0.6;
          x += cwid + track + (ch === " " ? size * 0.25 : 0);
        }
      });
      lastKey = "";
    },
    render(lt) {
      const boil = Math.floor(lt * 8);
      const shown = letters.filter((l) => lt >= l.at).length;
      const key = `${boil}|${shown}`;
      if (key === lastKey) return null;
      const prevShown = lastKey ? Number(lastKey.split("|")[1]) : shown;
      lastKey = key;
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.clearRect(0, 0, ink.width, ink.height);
      for (let i = 0; i < shown; i += 1) {
        const l = letters[i];
        const s = l.sprites[(boil + i) % 3];
        ictx.drawImage(s.c, Math.round((l.x - s.pad - l.size * 0.05) * dpr), Math.round((l.y - s.pad - l.size * 1.15) * dpr));
      }
      return shown > prevShown ? "scratch" : null;
    },
    reset() {
      lastKey = "";
    },
  };
}
