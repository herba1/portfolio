import { createAudio } from "./selectAudio";

const FAMILY = '"Select Arimo", Arimo, Arial, "Helvetica Neue", sans-serif';
const TEXT = "hello there. it will take a while to feel like this again, so i keep your voice on the walk home and let the streetlights go soft. still here?";
const ANGLES = [4.2, -5.4, 3.6, -4.4, 5.2, -3.2];
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

  const barLayer = el("div", "select-bars", stage);
  const textLayer = el("div", "select-text", stage);
  textLayer.setAttribute("aria-hidden", "true");
  const flyLayer = el("div", "select-fly", stage);
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
  let tipPos = { x: 0, y: 0, ready: false };

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
        k: 150 + hash(i * 9 + 2) * 70,
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
    textLayer.style.setProperty("--select-size", `${F}px`);
    textLayer.style.setProperty("--select-lead", `${LH}px`);
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

  const lineShift = (li) => {
    const range = selLines();
    if (!range) return 0;
    const [la, lb] = range;
    const n = lb - la + 1;
    const total = L * LH * (0.62 * (n - 1) + 1.2);
    let s = 0;
    if (li > la && li <= lb) s = (li - la) * L * LH * 0.62;
    else if (li > lb) s = total;
    return s - total * 0.5;
  };

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
    if (!sel) return [];
    const [la, lb] = selLines();
    const out = [];
    for (let li = la; li <= lb; li += 1) {
      const j = li - la;
      const line = lines[li];
      const x0 = (li === la ? words[sel.a].x : line.left) - 2;
      const x1 = (li === lb ? words[sel.b].x + words[sel.b].w : line.right) + 2;
      const top = line.top + lineShift(li);
      const ang = ANGLES[j % ANGLES.length] * Math.min(1.3, Math.max(0.45, (LH * 7) / Math.max(1, x1 - x0)));
      out.push({
        li,
        j,
        x0,
        width: x1 - x0,
        top,
        cx0: x0 + (x1 - x0) / 2,
        cx: x0 + (x1 - x0) / 2 + L * (j % 2 ? -1 : 1) * F * 0.3,
        cy: top + LH / 2,
        ang,
        theta: L * ang * DEG,
      });
    }
    return out;
  };

  const targets = (geo) => {
    const map = new Map(geo.map((g) => [g.li, g]));
    const count = sel ? sel.b - sel.a + 1 : 0;
    for (const w of words) {
      const g = sel && w.i >= sel.a && w.i <= sel.b ? map.get(w.line) : null;
      if (!g) {
        w.tx = w.x;
        w.ty = lines[w.line].top + lineShift(w.line);
        w.tr = 0;
        w.tk = 0;
        continue;
      }
      const s = Math.sign(g.ang);
      const u = w.x + w.w / 2 - g.cx0;
      let u2 = u + L * s * LH * (0.12 + 0.6 * w.h[0]);
      const maxU = g.width / 2 - w.w / 2 + LH * 0.5;
      u2 = Math.max(-maxU, Math.min(maxU, u2));
      const falls = count > 2 && w.h[1] < 0.32 && w.i !== sel.a;
      const v2 = falls ? L * LH * (0.78 + 0.42 * w.h[2]) : L * LH * 0.08 * w.h[2];
      const c = Math.cos(g.theta);
      const sn = Math.sin(g.theta);
      const rx = u2 * c - v2 * sn;
      const ry = u2 * sn + v2 * c;
      w.tx = Math.max(12, Math.min(W - w.w - 12, g.cx + rx - w.w / 2));
      w.ty = g.cy + ry - LH / 2;
      w.tr = L * (g.ang + (w.h[3] - 0.5) * 7 + (falls ? s * 6 : 0));
      w.tk = -12 * L;
    }
  };

  const springWords = (dt) => {
    let moving = false;
    for (const w of words) {
      const k = w.k;
      const c = 2 * Math.sqrt(k) * 0.86;
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
    }
  };

  const wordTransform = (w) => `translate3d(${w.px.toFixed(2)}px, ${w.py.toFixed(2)}px, 0) rotate(${w.pr.toFixed(3)}deg) skewX(${w.pk.toFixed(3)}deg)`;

  const placeTip = (geo) => {
    if (!geo.length || mode === "hidden") {
      tip.dataset.show = "false";
      return false;
    }
    const g = geo[0];
    const ax = g.cx + Math.sin(g.theta) * (LH / 2);
    const ay = g.cy - Math.cos(g.theta) * (LH / 2);
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

  const render = () => {
    const geo = geometry();
    ensureBars(geo.length);
    geo.forEach((g, i) => {
      const bar = bars[i];
      if (Math.abs(bar.w - g.width) > 0.2) {
        bar.w = g.width;
        bar.node.style.width = `${g.width.toFixed(1)}px`;
        bar.node.style.height = `${LH}px`;
      }
      bar.node.style.transform = `translate3d(${(g.cx - g.width / 2).toFixed(2)}px, ${g.top.toFixed(2)}px, 0) rotate(${(g.theta / DEG).toFixed(3)}deg)`;
    });
    for (const w of words) w.node.style.transform = wordTransform(w);
    if (geo.length) {
      const first = geo[0];
      const lastG = geo[geo.length - 1];
      startHandle.style.transform = `translate3d(${first.cx.toFixed(2)}px, ${first.cy.toFixed(2)}px, 0) rotate(${(first.theta / DEG).toFixed(3)}deg) translate(${(-first.width / 2 - 1).toFixed(2)}px, ${(-LH / 2).toFixed(2)}px)`;
      endHandle.style.transform = `translate3d(${lastG.cx.toFixed(2)}px, ${lastG.cy.toFixed(2)}px, 0) rotate(${(lastG.theta / DEG).toFixed(3)}deg) translate(${(lastG.width / 2 - 1).toFixed(2)}px, ${(-LH / 2).toFixed(2)}px)`;
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
      const k = 70;
      const c = 2 * Math.sqrt(k) * (LT > L ? 1 : 0.78);
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
    if (moving || drag || tipMoving) wake();
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
    if (target > 0.3 && !lifted) {
      lifted = true;
      audio.lift(0);
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
    sel = { a, b };
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

  const showChip = (label, text) => {
    clearTimeout(chipTimer);
    chipLabel.textContent = label;
    const clean = text.replace(/[.,?!]+$/, "");
    chipText.textContent = `“${clean.length > 44 ? `${clean.slice(0, 42).trim()}…` : clean}”`;
    chip.dataset.show = "true";
    chipTimer = setTimeout(() => {
      chip.dataset.show = "false";
    }, 2600);
  };

  const fly = (label) => {
    if (!sel) return;
    const text = selectedText();
    navigator.clipboard?.writeText(text)?.catch(() => {});
    const box = stage.getBoundingClientRect();
    const cb = chip.getBoundingClientRect();
    const tx = cb.left - box.left + cb.width / 2;
    const ty = cb.top - box.top + cb.height / 2 - 8;
    audio.whoosh();
    const picked = words.slice(sel.a, sel.b + 1);
    picked.forEach((w, n) => {
      const clone = el("span", "select-word select-word-fly", flyLayer);
      clone.textContent = w.text;
      clone.style.setProperty("--select-size", `${F}px`);
      clone.style.setProperty("--select-lead", `${LH}px`);
      const from = wordTransform(w);
      const midX = w.px + (tx - w.px) * 0.35 - w.w / 4;
      const midY = w.py + (ty - w.py) * 0.3 - LH * 0.7;
      const to = `translate3d(${(tx - w.w * 0.15).toFixed(1)}px, ${(ty - LH * 0.15).toFixed(1)}px, 0) rotate(0deg) skewX(0deg) scale(0.3)`;
      const anim = clone.animate(
        [
          { transform: from, opacity: 1 },
          { transform: `translate3d(${midX.toFixed(1)}px, ${midY.toFixed(1)}px, 0) rotate(${(w.h[3] - 0.5) * 16}deg) skewX(-8deg) scale(0.8)`, opacity: 1, offset: 0.45 },
          { transform: to.replace("scale(0.3)", "scale(0.36)"), opacity: 1, offset: 0.86 },
          { transform: to, opacity: 0 },
        ],
        { duration: 640, delay: n * 34, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "both" },
      );
      anim.onfinish = () => clone.remove();
    });
    setTimeout(
      () => {
        if (destroyed) return;
        showChip(label, text);
        audio.pop();
      },
      picked.length * 34 + 420,
    );
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
      startHandle.remove();
      endHandle.remove();
      tip.remove();
      chip.remove();
    },
  };
}
