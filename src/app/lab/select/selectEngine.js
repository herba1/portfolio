import { createAudio } from "./selectAudio";

const FAMILY = '"Select Arimo", Arimo, Arial, "Helvetica Neue", sans-serif';
const TEXT = "hello there. it will take a while to feel like this again, so i keep your voice on the walk home and let the streetlights go soft. still here?";
const ANGLES = [-3, -2.2, -3.4, -2.6, -3.1, -2.3];
const TILT_X = [-7, 6, -6, 7, -5, 6];
const TILT_Y = [17, -15, 18, -16, 15, -18];
const LIFT_Z = [120, 112, 126, 116, 122, 114];
const PLANE_X = 14;
const PLANE_Y = 5;
const DEPTH = 640;
const DIGITS = 28;
const SINK = 70;
const DEG = Math.PI / 180;

const WORDS = {
  hello: "used as a greeting, or to start a conversation.",
  there: "in, at or to that place.",
  while: "a stretch of time, usually a fairly long one.",
  feel: "to be aware of an emotion or a sensation.",
  again: "once more; another time.",
  keep: "to hold on to something and not give it up.",
  voice: "the sound a person makes when they speak or sing.",
  walk: "to move along on foot at an easy pace.",
  home: "the place where you live, and go back to.",
  streetlights: "lamps along a street, lit from dusk until morning.",
  soft: "quiet and gentle; not sharp, loud or bright.",
  still: "even now; continuing as before.",
  here: "in, at or to this place.",
  take: "to need a certain amount of time.",
  like: "in the same way as; similar to.",
  will: "used to talk about what is going to happen.",
  let: "to allow something to happen.",
  go: "to move away, or to become a certain way.",
  this: "the one that is here, or happening now.",
  your: "belonging to the person you are talking to.",
  on: "touching and held up by a surface.",
  so: "for that reason; and so.",
  and: "used to join words or parts of a sentence.",
  the: "used before a thing you both already know.",
};

function hash(n) {
  const x = Math.sin(n * 78.233 + 4.719) * 43758.5453;
  return x - Math.floor(x);
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

export function createSelect(root, refs, { onCopy } = {}) {
  const stage = refs.stage;
  const audio = createAudio();
  const meter = document.createElement("canvas").getContext("2d");

  const shadowLayer = el("div", "select-shadows", stage);
  const barLayer = el("div", "select-bars", stage);
  const flyLayer = el("div", "select-fly", stage);
  const textLayer = el("div", "select-text", stage);
  textLayer.setAttribute("aria-hidden", "true");
  const startHandle = el("div", "select-handle", stage);
  startHandle.dataset.side = "start";
  el("span", "select-handle-knob", startHandle);
  const endHandle = el("div", "select-handle", stage);
  endHandle.dataset.side = "end";
  el("span", "select-handle-knob", endHandle);

  const tip = el("div", "select-tip", stage);
  tip.setAttribute("role", "toolbar");
  tip.setAttribute("aria-label", "Selection");
  const tipBody = el("div", "select-tip-body", tip);
  const hello = el("span", "select-tip-hello", tipBody);
  hello.textContent = "hello there!";
  const menu = el("div", "select-tip-menu", tipBody);
  const makeItem = (label, action) => {
    const b = el("button", "select-tip-item", menu);
    b.type = "button";
    b.textContent = label;
    b.dataset.action = action;
    return b;
  };
  makeItem("Copy", "copy");
  el("span", "select-tip-sep", menu);
  makeItem("Look Up", "look");
  el("span", "select-tip-sep", menu);
  makeItem("Share", "share");
  const card = el("div", "select-tip-card", tipBody);
  const cardWord = el("strong", "select-tip-word", card);
  const cardDef = el("span", "select-tip-def", card);
  const arrow = el("span", "select-tip-arrow", tip);

  const chip = el("div", "select-chip", root);
  chip.setAttribute("role", "status");
  const chipIcon = el("span", "select-chip-icon", chip);
  chipIcon.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const chipLabel = el("span", "select-chip-label", chip);
  const chipText = el("span", "select-chip-text", chip);

  let W = 0;
  let H = 0;
  let F = 44;
  let LH = 56;
  let space = 12;
  let words = [];
  let lines = [];
  let bars = [];
  let sel = null;
  let L = 0;
  let vL = 0;
  let LT = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let drag = null;
  let mode = "hello";
  let tipSize = { hello: [0, 0], menu: [0, 0], card: [0, 0] };
  let avail = { top: 0, bottom: 0 };
  let blockTop = 0;
  let lifted = false;
  let pulseTimer = 0;
  let chipTimer = 0;
  let menuTimer = 0;
  let flyTimer = 0;
  let burstTimer = 0;
  let tipPos = { x: 0, y: 0, ready: false };
  let shifts = [];
  let origin = { x: 0, y: 0 };
  let shadows = [];
  const digitLayer = el("div", "select-digits", stage);
  digitLayer.setAttribute("aria-hidden", "true");
  const digits = [];
  let digitSeed = 0;
  let lastGeo = [];

  const font = (size) => `400 ${size}px ${FAMILY}`;

  const build = () => {
    textLayer.textContent = "";
    words = TEXT.split(" ").map((text, i) => {
      const node = el("span", "select-word", textLayer);
      node.textContent = text;
      return {
        i,
        text,
        node,
        w: 0,
        x: 0,
        line: 0,
        h: [hash(i + 1), hash(i * 3 + 7), hash(i * 5 + 11), hash(i * 7 + 13)],
        px: 0,
        py: 0,
        pr: 0,
        pk: 0,
        vx: 0,
        vy: 0,
        vr: 0,
        vk: 0,
        wl: 0,
        vwl: 0,
        g3: null,
        rest: true,
      };
    });
    const a = words.findIndex((w) => w.text === "it");
    const b = words.findIndex((w) => w.text === "again,");
    sel = { a, b };
  };

  const readInsets = () => {
    const box = root.getBoundingClientRect();
    const top = refs.caption ? refs.caption.getBoundingClientRect().bottom - box.top : 0;
    avail = { top: Math.max(top + 72, 96), bottom: refs.caption ? 120 : 72 };
  };

  const measureTip = () => {
    for (const m of ["hello", "menu", "card"]) {
      const node = m === "hello" ? hello : m === "menu" ? menu : card;
      tipSize[m] = [Math.ceil(node.offsetWidth), Math.ceil(node.offsetHeight)];
    }
  };

  const layout = () => {
    const aw = W - 48;
    F = Math.round(Math.max(22, Math.min(46, aw / 16.5)));
    LH = Math.round((F * 1.26) / 4) * 4;
    stage.style.setProperty("--select-size", `${F}px`);
    stage.style.setProperty("--select-lead", `${LH}px`);
    meter.font = font(F);
    space = meter.measureText(" ").width;
    for (const w of words) w.w = meter.measureText(w.text).width;
    const measure = Math.min(aw - 16, F * 15.5);
    lines = [];
    let row = [];
    let used = 0;
    for (const w of words) {
      const need = row.length ? used + space + w.w : w.w;
      if (row.length && need > measure) {
        lines.push(row);
        row = [w];
        used = w.w;
      } else {
        row.push(w);
        used = need;
      }
    }
    if (row.length) lines.push(row);
    const widths = lines.map((r) => {
      let x = 0;
      r.forEach((w, k) => {
        w.x = x;
        x += w.w + (k < r.length - 1 ? space : 0);
      });
      return x;
    });
    const maxW = Math.max(...widths);
    const left = Math.round((W - maxW) / 2);
    const ah = H - avail.top - avail.bottom;
    blockTop = Math.round(avail.top + Math.max(0, (ah - lines.length * LH) / 2) - LH * 0.4);
    lines = lines.map((r, li) => {
      r.forEach((w) => {
        w.x += left;
        w.line = li;
        w.node.style.width = `${Math.ceil(w.w) + 2}px`;
      });
      return { words: r, left, right: left + widths[li], top: blockTop + li * LH };
    });
    measureTip();
  };

  const selLines = () => (sel ? [words[sel.a].line, words[sel.b].line] : null);

  const depthScale = () => Math.max(0.45, Math.min(1, (W - 280) / 700));

  const baseAngle = (j, width) => ANGLES[j % ANGLES.length] * Math.min(1.2, Math.max(0.4, (LH * 6) / Math.max(1, width)));

  const restSpan = (li, la, lb) => {
    const line = lines[li];
    const x0 = (li === la ? words[sel.a].x : line.left) - 2;
    const x1 = (li === lb ? words[sel.b].x + words[sel.b].w : line.right) + 2;
    return [x0, x1];
  };

  const computeShifts = () => {
    shifts = lines.map(() => 0);
    const range = selLines();
    if (!range || L <= 0.0001) return;
    const [la, lb] = range;
    const gaps = [];
    for (let li = la; li < lb; li += 1) {
      const [a0, a1] = restSpan(li, la, lb);
      const [b0, b1] = restSpan(li + 1, la, lb);
      const ra = Math.abs(Math.sin(baseAngle(li - la, a1 - a0) * DEG)) * (a1 - a0) * 0.5;
      const rb = Math.abs(Math.sin(baseAngle(li + 1 - la, b1 - b0) * DEG)) * (b1 - b0) * 0.5;
      gaps.push(L * (ra + rb + LH * 0.85));
    }
    const [f0, f1] = restSpan(la, la, lb);
    const [e0, e1] = restSpan(lb, la, lb);
    const tiltA = Math.abs(Math.sin(baseAngle(0, f1 - f0) * DEG)) * (f1 - f0) * 0.5;
    const tiltB = Math.abs(Math.sin(baseAngle(lb - la, e1 - e0) * DEG)) * (e1 - e0) * 0.5;
    const zAvg = LIFT_Z[0] * depthScale() * L;
    const grow = DEPTH / Math.max(1, DEPTH - zAvg) - 1;
    const span = (lb - la + 1) * LH + gaps.reduce((s0, g) => s0 + g, 0);
    const lead = L * (LH * 0.62 + Math.max(tiltA, tiltB)) + span * 0.5 * grow + L * LH * 0.3;
    const total = lead * 2 + gaps.reduce((s0, g) => s0 + g, 0);
    let acc = 0;
    lines.forEach((_, li) => {
      if (li < la) shifts[li] = 0;
      else if (li === la) {
        acc = lead;
        shifts[li] = acc;
      } else if (li <= lb) {
        acc += gaps[li - la - 1];
        shifts[li] = acc;
      } else shifts[li] = total;
      shifts[li] -= total * 0.5;
    });
  };

  const lineShift = (li) => shifts[li] || 0;
  const ensureBars = (n) => {
    while (bars.length < n) {
      const node = el("div", "select-bar", barLayer);
      bars.push({ node, w: -1 });
    }
    bars.forEach((b, i) => {
      b.node.style.display = i < n ? "block" : "none";
    });
  };

  const geometry = () => {
    computeShifts();
    if (!sel) return [];
    const [la, lb] = selLines();
    const out = [];
    for (let li = la; li <= lb; li += 1) {
      const j = li - la;
      const [x0, x1] = restSpan(li, la, lb);
      const width = x1 - x0;
      const top = lines[li].top + lineShift(li);
      const ang = baseAngle(j, width);
      const grow = 1 + 0.08 * L;
      out.push({
        li,
        j,
        x0,
        width: width * grow,
        rest: width,
        top,
        restTop: lines[li].top,
        cx0: x0 + width / 2,
        cx: x0 + width / 2 + L * Math.sign(ang) * LH * 0.32,
        cy: top + LH / 2,
        ang,
        theta: L * ang * DEG,
        grow,
        ax: TILT_X[j % TILT_X.length] * depthScale(),
        ay: TILT_Y[j % TILT_Y.length] * depthScale(),
        z: LIFT_Z[j % LIFT_Z.length] * depthScale(),
      });
    }
    if (L > 0.0001) {
      const safe = (W < 600 ? 20 : 24) + 8;
      for (const g of out) {
        for (let pass = 0; pass < 3; pass += 1) {
          const c = Math.cos(g.theta);
          const sn = Math.sin(g.theta);
          const xs = [];
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) xs.push(project(g, g.cx + c * sx * (g.width / 2) - sn * sy * (LH / 2), g.cy + sn * sx * (g.width / 2) + c * sy * (LH / 2)).x);
          const lo = Math.min(...xs);
          const hi = Math.max(...xs);
          let d = 0;
          if (hi - lo > W - safe * 2) {
            const k = (W - safe * 2) / (hi - lo);
            g.grow = Math.max(0.94, g.grow * k);
            g.width = g.rest * g.grow;
            d = W / 2 - (lo + hi) / 2;
          } else if (hi > W - safe) d = W - safe - hi;
          else if (lo < safe) d = safe - lo;
          if (Math.abs(d) < 0.01) break;
          g.cx += d;
        }
      }
    }
    return out;
  };

  const targets = (geo) => {
    const map = new Map(geo.map((g) => [g.li, g]));
    for (const w of words) {
      const g = sel && w.i >= sel.a && w.i <= sel.b ? map.get(w.line) : null;
      w.twl = g ? 1 : 0;
      if (!g) {
        w.tx = w.x;
        w.tf = 0;
        const range = sel ? selLines() : null;
        let shift = lineShift(w.line);
        if (range && w.line === range[0] && w.i < sel.a) {
          shift = lineShift(w.line);
          const first = map.get(range[0]);
          if (first && L > 0.001) {
            const edgeX = Math.min(...[-1, 1].map((sy) => project(first, first.cx - Math.cos(first.theta) * (first.width / 2) - Math.sin(first.theta) * sy * (LH / 2), first.cy - Math.sin(first.theta) * (first.width / 2) + Math.cos(first.theta) * sy * (LH / 2)).x));
            const restEdge = words[sel.a].x - 2;
            const fs = DEPTH / (DEPTH + SINK * L);
            const restScreen = origin.x + (restEdge - origin.x) * fs;
            const want = w.x - Math.max(0, (restScreen - edgeX + space * 0.8 * L) / fs);
            w.tx = Math.max(8, want);
            w.tf = Math.min(1, Math.max(0, 8 - want) / Math.max(1, w.w * 0.5));
          }
        }
        if (range && w.line === range[1] && w.i > sel.b) {
          shift = lineShift(w.line);
          const lastG = map.get(range[1]);
          if (lastG && L > 0.001) {
            const edgeX = Math.max(...[-1, 1].map((sy) => project(lastG, lastG.cx + Math.cos(lastG.theta) * (lastG.width / 2) - Math.sin(lastG.theta) * sy * (LH / 2), lastG.cy + Math.sin(lastG.theta) * (lastG.width / 2) + Math.cos(lastG.theta) * sy * (LH / 2)).x));
            const restEdge = words[sel.b].x + words[sel.b].w + 2;
            const fs = DEPTH / (DEPTH + SINK * L);
            const restScreen = origin.x + (restEdge - origin.x) * fs;
            const want = w.x + Math.max(0, (edgeX - restScreen + space * 0.8 * L) / fs);
            w.tx = Math.min(W - w.w - 8, want);
            w.tf = Math.min(1, Math.max(0, want - (W - w.w - 8)) / Math.max(1, w.w * 0.5));
          }
        }
        w.ty = lines[w.line].top + shift;
        w.tr = 0;
        w.tk = 0;
        continue;
      }
      w.g3 = { cx: g.cx, cy: g.cy, ax: g.ax, ay: g.ay, z: g.z };
      const u = (w.x + w.w / 2 - g.cx0) * g.grow;
      const c = Math.cos(g.theta);
      const sn = Math.sin(g.theta);
      w.tx = g.cx + u * c - w.w / 2;
      w.ty = g.cy + u * sn - LH / 2;
      w.tr = L * (g.ang + (w.h[3] - 0.5) * 2.4);
      w.tk = -11 * L;
    }
  };

  const springWords = (dt) => {
    let moving = false;
    for (const w of words) {
      const k = 190;
      const c = 2 * Math.sqrt(k) * 0.92;
      w.vwl += ((w.twl - w.wl) * 240 - w.vwl * 2 * Math.sqrt(240)) * dt;
      w.wl += w.vwl * dt;
      if (Math.abs(w.twl - w.wl) > 0.001 || Math.abs(w.vwl) > 0.01) moving = true;
      else {
        w.wl = w.twl;
        w.vwl = 0;
      }
      w.vx += ((w.tx - w.px) * k - w.vx * c) * dt;
      w.vy += ((w.ty - w.py) * k - w.vy * c) * dt;
      w.vr += ((w.tr - w.pr) * k - w.vr * c) * dt;
      w.vk += ((w.tk - w.pk) * k - w.vk * c) * dt;
      w.px += w.vx * dt;
      w.py += w.vy * dt;
      w.pr += w.vr * dt;
      w.pk += w.vk * dt;
      if (Math.abs(w.tx - w.px) + Math.abs(w.ty - w.py) > 0.05 || Math.abs(w.tr - w.pr) + Math.abs(w.tk - w.pk) > 0.01 || Math.abs(w.vx) + Math.abs(w.vy) > 0.5) {
        moving = true;
      } else {
        w.px = w.tx;
        w.py = w.ty;
        w.pr = w.tr;
        w.pk = w.tk;
        w.vx = 0;
        w.vy = 0;
        w.vr = 0;
        w.vk = 0;
      }
    }
    return moving;
  };

  const snapWords = () => {
    for (const w of words) {
      w.px = w.tx;
      w.py = w.ty;
      w.pr = w.tr;
      w.pk = w.tk;
      w.vx = 0;
      w.vy = 0;
      w.vr = 0;
      w.vk = 0;
      w.wl = w.twl ?? 0;
      w.vwl = 0;
    }
  };

  const lift3d = (g, amount, sink = 0) => {
    if (!g || amount < 0.0005) return sink ? `translateZ(${(-sink).toFixed(2)}px) ` : "";
    return `translate3d(${g.cx.toFixed(2)}px, ${g.cy.toFixed(2)}px, 0) rotateX(${(g.ax * amount).toFixed(3)}deg) rotateY(${(g.ay * amount).toFixed(3)}deg) translateZ(${(g.z * amount - sink).toFixed(2)}px) translate3d(${(-g.cx).toFixed(2)}px, ${(-g.cy).toFixed(2)}px, 0) `;
  };

  const flatTransform = (w) =>
    `translate3d(${(w.px + w.w / 2).toFixed(2)}px, ${(w.py + LH / 2).toFixed(2)}px, 0) rotate(${w.pr.toFixed(3)}deg) skewX(${w.pk.toFixed(3)}deg) translate(${(-w.w / 2).toFixed(2)}px, ${(-LH / 2).toFixed(2)}px)`;

  const wordTransform = (w) => {
    const amount = L * w.wl;
    return lift3d(w.g3, amount, SINK * L * (1 - w.wl)) + flatTransform(w);
  };

  const rotate = (vx, vy, vz, ay, ax) => {
    const x1 = vx * Math.cos(ay) + vz * Math.sin(ay);
    const z1 = -vx * Math.sin(ay) + vz * Math.cos(ay);
    const y2 = vy * Math.cos(ax) - z1 * Math.sin(ax);
    const z2 = vy * Math.sin(ax) + z1 * Math.cos(ax);
    return [x1, y2, z2];
  };

  const planeAngles = () => [PLANE_X * L * depthScale(), PLANE_Y * L * depthScale()];

  const plane = () => {
    if (L < 0.0005) return "";
    const [px, py] = planeAngles();
    return `translate3d(${origin.x.toFixed(2)}px, ${origin.y.toFixed(2)}px, 0) rotateX(${px.toFixed(3)}deg) rotateY(${py.toFixed(3)}deg) translate3d(${(-origin.x).toFixed(2)}px, ${(-origin.y).toFixed(2)}px, 0) `;
  };

  const world = (g, px, py) => {
    const a = L;
    const [vx, vy, vz] = rotate(px - g.cx, py - g.cy, g.z * a, g.ay * a * DEG, g.ax * a * DEG);
    const [pxd, pyd] = planeAngles();
    const [qx, qy, qz] = rotate(g.cx + vx - origin.x, g.cy + vy - origin.y, vz, pyd * DEG, pxd * DEG);
    return { x: origin.x + qx, y: origin.y + qy, z: qz };
  };

  const project = (g, px, py) => {
    const p = world(g, px, py);
    const f = DEPTH / Math.max(1, DEPTH - p.z);
    return { x: origin.x + (p.x - origin.x) * f, y: origin.y + (p.y - origin.y) * f };
  };

  const spawnDigits = (g, side, n) => {
    if (!g || L < 0.2) return;
    const c = Math.cos(g.theta);
    const sn = Math.sin(g.theta);
    const ex = g.cx + c * side * (g.width / 2);
    const ey = g.cy + sn * side * (g.width / 2);
    for (let k = 0; k < n; k += 1) {
      digitSeed += 1;
      let d = digits.find((q) => q.age >= q.life);
      if (!d) {
        if (digits.length >= DIGITS) break;
        d = { node: el("span", "select-digit", digitLayer), age: 1, life: 0 };
        digits.push(d);
      }
      const h0 = hash(digitSeed * 1.7);
      const h1 = hash(digitSeed * 2.3 + 5);
      const h2 = hash(digitSeed * 3.1 + 9);
      const p = world(g, ex + sn * LH * 0.5, ey - c * LH * 0.5 + (h0 - 0.5) * LH * 0.3);
      d.node.textContent = h1 > 0.5 ? "1" : "0";
      d.x = p.x + side * 6;
      d.y = p.y;
      d.z = p.z;
      d.vx = side * (90 + h0 * 120);
      d.vy = -170 - h1 * 100;
      d.vz = 120 + h2 * 150;
      d.rx = 0;
      d.ry = 0;
      d.rz = (h2 - 0.5) * 30;
      d.vrx = (h1 - 0.5) * 220;
      d.vry = side * (40 + h0 * 90);
      d.vrz = (h0 - 0.5) * 160;
      d.age = 0;
      d.life = 1.4 + h2 * 0.6;
    }
    wake();
  };

  const stepDigits = (dt) => {
    let alive = false;
    const zMax = DEPTH * 0.6;
    for (const d of digits) {
      if (d.age >= d.life) {
        if (d.node.style.opacity !== "0") d.node.style.opacity = "0";
        continue;
      }
      alive = true;
      d.age += dt;
      d.vy += 170 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z = Math.min(zMax, d.z + d.vz * dt);
      d.rx += d.vrx * dt;
      d.ry += d.vry * dt;
      d.rz += d.vrz * dt;
      const t = Math.min(1, d.age / d.life);
      const near = Math.max(0, (d.z - zMax * 0.7) / (zMax * 0.3));
      const o = Math.min(1, d.age / 0.08) * (1 - t * t) * (1 - near);
      d.node.style.opacity = Math.max(0, o).toFixed(3);
      d.node.style.transform = `translate3d(${d.x.toFixed(2)}px, ${d.y.toFixed(2)}px, ${d.z.toFixed(2)}px) rotateX(${d.rx.toFixed(2)}deg) rotateY(${d.ry.toFixed(2)}deg) rotateZ(${d.rz.toFixed(2)}deg) skewX(-12deg) translate(-50%, -50%)`;
    }
    return alive;
  };

  const placeTip = (geo) => {
    if (!geo.length || mode === "hidden") {
      tip.dataset.show = "false";
      return false;
    }
    const g = geo[0];
    const top = project(g, g.cx + Math.sin(g.theta) * (LH / 2), g.cy - Math.cos(g.theta) * (LH / 2));
    const ax = top.x;
    const ay = top.y;
    const size = tipSize[mode] || tipSize.hello;
    const half = size[0] / 2 + 12;
    const x = Math.max(half + 8, Math.min(W - half - 8, ax));
    const y = ay - 14 - LH * 0.12;
    if (!tipPos.ready) {
      tipPos = { x, y, ready: true };
    } else {
      tipPos.x += (x - tipPos.x) * 0.35;
      tipPos.y += (y - tipPos.y) * 0.35;
    }
    tip.dataset.show = "true";
    tip.style.transform = `translate3d(${tipPos.x.toFixed(1)}px, ${tipPos.y.toFixed(1)}px, 0)`;
    arrow.style.transform = `translateX(${(ax - x).toFixed(1)}px) rotate(45deg)`;
    return Math.abs(x - tipPos.x) + Math.abs(y - tipPos.y) > 0.3;
  };

  const sizeTip = () => {
    const size = tipSize[mode] || tipSize.hello;
    tipBody.style.width = `${size[0]}px`;
    tipBody.style.height = `${size[1]}px`;
    tip.dataset.mode = mode;
  };

  const ensureShadows = (n) => {
    while (shadows.length < n) {
      const node = el("div", "select-shadow", shadowLayer);
      shadows.push({ node, w: -1 });
    }
    shadows.forEach((sh, i) => {
      sh.node.style.display = i < n ? "block" : "none";
    });
  };

  const render = () => {
    const geo = geometry();
    lastGeo = geo;
    ensureBars(geo.length);
    ensureShadows(geo.length);
    geo.forEach((g, i) => {
      const bar = bars[i];
      if (Math.abs(bar.w - g.width) > 0.2) {
        bar.w = g.width;
        bar.node.style.width = `${g.width.toFixed(1)}px`;
        bar.node.style.height = `${LH}px`;
      }
      bar.node.style.transform = `${plane()}${lift3d(g, L)}translate3d(${g.cx.toFixed(2)}px, ${g.cy.toFixed(2)}px, 0) rotate(${(g.theta / DEG).toFixed(3)}deg) translate(${(-g.width / 2).toFixed(2)}px, ${(-LH / 2).toFixed(2)}px)`;
      const sh = shadows[i];
      if (Math.abs(sh.w - g.width) > 0.2) {
        sh.w = g.width;
        sh.node.style.width = `${g.width.toFixed(1)}px`;
        sh.node.style.height = `${LH}px`;
      }
      sh.node.style.transform = `${plane()}translate3d(${(g.cx - g.width / 2 + L * g.ay * 0.9).toFixed(2)}px, ${(g.top + L * (10 + g.z * 0.22)).toFixed(2)}px, 0) rotate(${((g.theta / DEG) * 0.5).toFixed(3)}deg) scale(${(1 - L * 0.04).toFixed(4)}, ${(1 - L * 0.18).toFixed(4)})`;
      sh.node.style.opacity = (Math.min(1, L) * 0.5).toFixed(3);
    });
    const pl = plane();
    for (const w of words) {
      w.node.style.transform = pl + wordTransform(w);
      const o = (1 - (w.tf || 0) * Math.min(1, L)).toFixed(3);
      if (w.op !== o) {
        w.op = o;
        w.node.style.opacity = o;
      }
    }
    if (geo.length) {
      const first = geo[0];
      const lastG = geo[geo.length - 1];
      startHandle.style.transform = `${pl}${lift3d(first, L)}translate3d(${first.cx.toFixed(2)}px, ${first.cy.toFixed(2)}px, 0) rotate(${(first.theta / DEG).toFixed(3)}deg) translate(${(-first.width / 2 - 1).toFixed(2)}px, ${(-LH / 2).toFixed(2)}px)`;
      endHandle.style.transform = `${pl}${lift3d(lastG, L)}translate3d(${lastG.cx.toFixed(2)}px, ${lastG.cy.toFixed(2)}px, 0) rotate(${(lastG.theta / DEG).toFixed(3)}deg) translate(${(lastG.width / 2 - 1).toFixed(2)}px, ${(-LH / 2).toFixed(2)}px)`;
      startHandle.style.height = `${LH}px`;
      endHandle.style.height = `${LH}px`;
      root.setAttribute("data-selection", "");
    } else {
      root.removeAttribute("data-selection");
    }
    return placeTip(geo);
  };

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    let moving = false;
    const sub = 2;
    for (let s = 0; s < sub; s += 1) {
      const h = dt / sub;
      const k = LT > L ? 80 : 96;
      const c = 2 * Math.sqrt(k) * (LT > L ? 1 : 0.94);
      vL += ((LT - L) * k - vL * c) * h;
      L += vL * h;
      targets(geometry());
      moving = springWords(h) || moving;
    }
    if (Math.abs(LT - L) > 0.0008 || Math.abs(vL) > 0.002) moving = true;
    else {
      L = LT;
      vL = 0;
    }
    const tipMoving = render();
    const flying = stepDigits(dt);
    if (moving || drag || tipMoving || flying) wake();
    else last = 0;
  };

  function wake() {
    if (raf || destroyed || !visible || document.hidden || !W) return;
    raf = requestAnimationFrame(frame);
  }

  const setMode = (next, delay = 0) => {
    clearTimeout(menuTimer);
    const apply = () => {
      if (mode === next) return;
      mode = next;
      sizeTip();
      wake();
    };
    if (delay) menuTimer = setTimeout(apply, delay);
    else apply();
  };

  const setLift = (target) => {
    if (target > 0 && L < 0.02 && sel) {
      const range = selLines();
      const top = lines[range[0]].top;
      const bottom = lines[range[1]].top + LH;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (let li = range[0]; li <= range[1]; li += 1) {
        const [a0, a1] = restSpan(li, range[0], range[1]);
        x0 = Math.min(x0, a0);
        x1 = Math.max(x1, a1);
      }
      origin = { x: (x0 + x1) / 2, y: (top + bottom) / 2 };
      stage.style.setProperty("--select-ox", `${origin.x.toFixed(1)}px`);
      stage.style.setProperty("--select-oy", `${origin.y.toFixed(1)}px`);
    }
    if (target > 0.3 && !lifted) {
      lifted = true;
      audio.lift(0);
      clearTimeout(burstTimer);
      burstTimer = setTimeout(() => {
        if (lifted && lastGeo.length) spawnDigits(lastGeo[lastGeo.length - 1], 1, 7);
      }, 180);
    }
    if (target === 0 && lifted) {
      lifted = false;
      setTimeout(() => {
        if (!lifted) audio.settle(0);
      }, 260);
    }
    LT = target;
    wake();
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    readInsets();
    layout();
    sizeTip();
    targets(geometry());
    snapWords();
    tipPos.ready = false;
    render();
    wake();
  };

  const local = (e) => {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const lineAt = (y) => {
    let best = 0;
    let bd = Infinity;
    lines.forEach((line, li) => {
      const mid = line.top + lineShift(li) + LH / 2;
      const d = Math.abs(y - mid);
      if (d < bd) {
        bd = d;
        best = li;
      }
    });
    return { li: best, d: bd };
  };

  const wordAt = (p, strict) => {
    const { li, d } = lineAt(p.y);
    if (strict && d > LH * 0.62) return -1;
    const row = lines[li].words;
    let best = row[0];
    let bd = Infinity;
    for (const w of row) {
      const dx = p.x < w.x ? w.x - p.x : p.x > w.x + w.w ? p.x - w.x - w.w : 0;
      if (dx < bd) {
        bd = dx;
        best = w;
      }
    }
    if (strict && bd > space * 0.8) return -1;
    return best.i;
  };

  const setSel = (a, b) => {
    const changed = !sel || sel.a !== a || sel.b !== b;
    const prevA = sel ? sel.a : a;
    sel = { a, b };
    if (changed && drag && L > 0.3 && lastGeo.length) {
      const moved = drag.kind === "start" || (sel && a !== prevA) ? -1 : 1;
      spawnDigits(moved < 0 ? lastGeo[0] : lastGeo[lastGeo.length - 1], moved, 2);
    }
    if (changed) {
      const w = words[b];
      audio.tick(((w.x + w.w / 2) / W) * 1.4 - 0.7);
      wake();
    }
  };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".select-tip")) return;
    audio.unlock();
    const p = local(e);
    const handle = e.target.closest(".select-handle");
    if (handle && sel) {
      e.preventDefault();
      stage.setPointerCapture?.(e.pointerId);
      drag = { id: e.pointerId, kind: handle.dataset.side, x0: p.x, y0: p.y, dist: 0, lx: p.x, ly: p.y };
      root.setAttribute("data-dragging", "");
      setMode("hello");
      wake();
      return;
    }
    const i = wordAt(p, true);
    if (i < 0) {
      drag = { id: e.pointerId, kind: "none", x0: p.x, y0: p.y, dist: 0, lx: p.x, ly: p.y };
      return;
    }
    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);
    drag = { id: e.pointerId, kind: "range", anchor: i, x0: p.x, y0: p.y, dist: 0, lx: p.x, ly: p.y, fresh: !sel || i < sel.a || i > sel.b };
    root.setAttribute("data-dragging", "");
    setMode("hello");
    wake();
  };

  const onMove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = local(e);
    drag.dist += Math.hypot(p.x - drag.lx, p.y - drag.ly);
    drag.lx = p.x;
    drag.ly = p.y;
    if (drag.kind === "none") return;
    if (drag.kind === "range" && drag.dist < 6) return;
    const i = wordAt({ x: p.x, y: p.y - (drag.kind === "range" ? 0 : 0) }, false);
    if (drag.kind === "end") setSel(sel.a, Math.max(sel.a, i));
    else if (drag.kind === "start") setSel(Math.min(sel.b, i), sel.b);
    else if (drag.kind === "range") setSel(Math.min(drag.anchor, i), Math.max(drag.anchor, i));
    setLift(Math.min(1, drag.dist / 64));
  };

  const onUp = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    root.removeAttribute("data-dragging");
    if (d.kind === "none") {
      if (d.dist < 8 && e.type === "pointerup" && sel) {
        sel = null;
        setMode("hidden");
        audio.tick(0);
      }
      wake();
      return;
    }
    if (d.kind === "range" && d.dist < 6) {
      setSel(d.anchor, d.anchor);
      setLift(0.42);
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => setLift(0), 140);
      setMode("menu", 260);
      return;
    }
    setLift(0);
    setMode("menu", 200);
  };

  const selectedText = () => (sel ? words.slice(sel.a, sel.b + 1).map((w) => w.text).join(" ") : "");

  const fillChip = (label, text) => {
    chipLabel.textContent = label;
    const clean = text.replace(/[.,?!]+$/, "");
    chipText.textContent = `“${clean.length > 44 ? `${clean.slice(0, 42).trim()}…` : clean}”`;
  };

  const showChip = () => {
    clearTimeout(chipTimer);
    chip.dataset.show = "true";
    [chipIcon, chipLabel, chipText].forEach((node, i) => {
      node.animate(
        [
          { opacity: 0, transform: "translateY(4px)", filter: "blur(3px)" },
          { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
        ],
        { duration: 280, delay: 40 + i * 50, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
      );
    });
    chipTimer = setTimeout(() => {
      chip.dataset.show = "false";
    }, 2600);
  };

  const fly = (label) => {
    if (!sel) return;
    const text = selectedText();
    navigator.clipboard?.writeText(text)?.catch(() => {});
    clearTimeout(chipTimer);
    chip.dataset.show = "false";
    fillChip(label, text);
    const box = stage.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const cw = chip.offsetWidth;
    const ch = chip.offsetHeight;
    const cx = rootBox.left - box.left + chip.offsetLeft;
    const cy = rootBox.top - box.top + chip.offsetTop;
    const endLeft = cx - cw / 2;
    const geo = geometry();
    audio.whoosh();
    const duration = 620;
    const anims = [];
    for (const node of flyLayer.querySelectorAll(".select-pill")) node.remove();
    geo.forEach((g) => {
      const pill = el("div", "select-pill", flyLayer);
      const x0 = g.cx - g.width / 2;
      pill.style.width = `${g.width}px`;
      pill.style.height = `${LH}px`;
      const start = `translate3d(${x0.toFixed(1)}px, ${g.top.toFixed(1)}px, 0)`;
      const end = `translate3d(${endLeft.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      const anim = pill.animate(
        [
          { transform: start, width: `${g.width}px`, height: `${LH}px`, borderRadius: "2px", backgroundColor: "var(--select-wash)", offset: 0 },
          { backgroundColor: "var(--select-wash)", offset: 0.55 },
          { transform: end, width: `${cw}px`, height: `${ch}px`, borderRadius: `${ch / 2}px`, backgroundColor: "var(--select-tip)", offset: 1 },
        ],
        { duration, delay: 0, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
      );
      anims.push(anim);
    });
    clearTimeout(flyTimer);
    flyTimer = setTimeout(() => {
      if (destroyed) return;
      chip.dataset.instant = "true";
      showChip();
      audio.pop();
      requestAnimationFrame(() => {
        for (const node of flyLayer.querySelectorAll(".select-pill")) node.remove();
        anims.forEach((anim) => anim.cancel());
        requestAnimationFrame(() => {
          delete chip.dataset.instant;
        });
      });
    }, duration);
    setMode("hidden");
    onCopy?.(text);
  };

  const lookUp = () => {
    if (!sel) return;
    const picked = words.slice(sel.a, sel.b + 1).map((w) => w.text.toLowerCase().replace(/[^a-z’']/g, ""));
    const known = picked.filter((t) => WORDS[t]).sort((x, y) => y.length - x.length)[0];
    cardWord.textContent = known || picked.join(" ");
    cardDef.textContent = known ? WORDS[known] : "No definition found.";
    measureTip();
    setMode("card");
    audio.tick(0);
  };

  const share = async () => {
    const text = selectedText();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        setMode("hidden");
        return;
      } catch {
        return;
      }
    }
    fly("Ready to share");
  };

  const onTipClick = (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    audio.unlock();
    if (b.dataset.action === "copy") fly("Copied");
    else if (b.dataset.action === "look") lookUp();
    else if (b.dataset.action === "share") share();
  };

  const nudge = () => {
    setLift(0.55);
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => setLift(0), 180);
  };

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      if (sel) {
        e.preventDefault();
        fly("Copied");
      }
      return;
    }
    if (e.key === "Escape") {
      sel = null;
      setMode("hidden");
      wake();
      return;
    }
    const n = words.length;
    if (!sel && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      setSel(0, 0);
      setMode("hello");
      nudge();
      return;
    }
    if (!sel) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      audio.unlock();
      const d = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) setSel(sel.a, Math.max(sel.a, Math.min(n - 1, sel.b + d)));
      else {
        const len = sel.b - sel.a;
        const a = Math.max(0, Math.min(n - 1 - len, sel.a + d));
        setSel(a, a + len);
      }
      setMode("hello");
      nudge();
      setMode("menu", 420);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setMode(mode === "menu" ? "hello" : "menu");
    }
  };

  const onVisibility = () => {
    if (!document.hidden) wake();
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  tip.addEventListener("click", onTipClick);
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(root);
  const ro = new ResizeObserver(() => resize());

  const start = () => {
    if (destroyed) return;
    build();
    ro.observe(stage);
    resize();
    root.setAttribute("data-ready", "");
  };

  const fontReady = document.fonts ? document.fonts.load(font(40), "a").catch(() => null) : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))]).then(start);

  return {
    setSound(on) {
      return audio.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(pulseTimer);
      clearTimeout(chipTimer);
      clearTimeout(menuTimer);
      clearTimeout(flyTimer);
      clearTimeout(burstTimer);
      io.disconnect();
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      tip.removeEventListener("click", onTipClick);
      document.removeEventListener("visibilitychange", onVisibility);
      audio.destroy();
      barLayer.remove();
      textLayer.remove();
      flyLayer.remove();
      digitLayer.remove();
      shadowLayer.remove();
      startHandle.remove();
      endHandle.remove();
      tip.remove();
      chip.remove();
    },
  };
}
