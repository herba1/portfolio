// Play Count — one number, every glyph on its own spring.
//
// Two ways a number changes, and they key the glyphs differently:
//   "type"  — appending or deleting a digit keeps the prefix, so glyphs are
//             keyed from the left. Digits keep their identity and the commas
//             are what move (the Family effect).
//   "value" — arrows and drag change the quantity, so glyphs are keyed by
//             place from the right and each column rolls like an odometer.

const MAX_DIGITS = 10;
const MAX_VALUE = 10 ** MAX_DIGITS - 1;
const PITCH = 1.12; // roll strip spacing, in em
const TRACK_K = -0.043; // tracking law, px per px over 12

// Spring presets (stiffness, damping ratio). Slightly under-damped: settles
// with a breath of overshoot, never a bounce.
const X_SPRING = { k: 380, z: 0.9 };
const ROLL_SPRING = { k: 300, z: 0.84 };
const PRESENCE_SPRING = { k: 420, z: 1 };
// A relocating comma's offset from its new slot. Much quicker than the
// figures and critically damped: it is through the figure it crosses and
// riding the new gap while the figures are still parting to open it.
const COMMA_SPRING = { k: 1500, z: 1 };
// Air between the figures' ink and the edges of the roll window, in em.
// Enough that a mid-roll cut lands clearly off the baseline and the cap line,
// so it reads as an aperture rather than a crop along the type.
const WINDOW_AIR = 0.1;

function step(s, target, cfg, dt) {
  const c = 2 * cfg.z * Math.sqrt(cfg.k);
  const a = cfg.k * (target - s.p) - c * s.v;
  s.v += a * dt;
  s.p += s.v * dt;
}

const settled = (s, target, eps) => Math.abs(s.p - target) < eps && Math.abs(s.v) < eps * 10;

let uid = 0;

// Nothing fades. A figure enters or leaves by sliding through the hard edge of
// its own window, like a counter wheel turning a figure into view: `side` is
// the edge it uses, +1 below, -1 above. A comma never leaves the baseline: it
// enters and leaves by width, its advance opening from nothing while the mark
// slides out of the gap.
function makeDigit(digit, x, entering, side = 1) {
  return {
    id: ++uid,
    kind: "d",
    digit,
    side,
    x: { p: x, v: 0 },
    tx: x,
    roll: { p: digit, v: 0 },
    troll: digit,
    pres: { p: entering ? 0 : 1, v: 0 },
    tpres: 1,
    el: null,
    strip: null,
    glyphs: null,
  };
}

// A comma has no position of its own: it lives in the gap after the figure on
// its left (`anchor`), up to the figure on its right (`next`), so it moves with
// the figures by construction. When it changes gap it carries an offset from
// the new one (`off`) that springs to zero: it slides there along the baseline.
function makeComma(anchor, next, entering) {
  return {
    id: ++uid,
    kind: "c",
    anchor,
    next,
    x: { p: 0, v: 0 },
    off: { p: 0, v: 0 },
    pres: { p: entering ? 0 : 1, v: 0 },
    tpres: 1,
    el: null,
    mark: null,
  };
}

export function createPlayCount(root, { stage, input, embedded = false, initial = 1284903, onValue } = {}) {
  const box = root.closest(".piece-box") || root;
  const num = document.createElement("div");
  num.className = "playcount-number";
  num.setAttribute("aria-hidden", "true");
  stage.appendChild(num);

  let value = initial;
  let digits = []; // live columns, left to right
  let commas = []; // live commas, left to right
  let leaving = []; // exiting glyphs
  let metrics = { size: 120, adv: 72, comma: 30, track: -4.6 };
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let frozen = false;

  // ---- layout ---------------------------------------------------------

  // The roll window is set from the face itself: the baseline as the browser
  // places it, and the figures' ink height from the font, each given air.
  const windowEdges = () => {
    const col = document.createElement("span");
    col.className = "playcount-col";
    const glyph = document.createElement("span");
    glyph.className = "playcount-glyph";
    const line = document.createElement("span");
    line.style.display = "block";
    line.textContent = "0";
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    line.appendChild(mark);
    glyph.appendChild(line);
    col.appendChild(glyph);
    num.appendChild(col);
    const cr = col.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(col).fontSize) || 100;
    const base = (mark.getBoundingClientRect().top - (cr.top + cr.height / 2)) / em;
    const cs = getComputedStyle(col);
    col.remove();
    // figure height with overshoot; Geist's is 0.73em, the fallback if the
    // canvas has not resolved the face yet
    let asc = 0.73;
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
      let a = 0;
      for (let i = 0; i < 10; i++) a = Math.max(a, ctx.measureText(String(i)).actualBoundingBoxAscent / 100);
      if (a > 0.6 && a < 0.9) asc = a;
    } catch {}
    if (!(base > 0 && base < 0.5)) return;
    num.style.setProperty("--pc-win-top", `${(asc - base + WINDOW_AIR).toFixed(4)}em`);
    num.style.setProperty("--pc-win-bottom", `${(base + WINDOW_AIR).toFixed(4)}em`);
  };

  const measure = () => {
    const w = box.clientWidth || 800;
    const h = box.clientHeight || 600;
    // Measure the face at 100px, then size so the longest count still fits.
    num.style.setProperty("--pc-size", "100px");
    const probe = document.createElement("span");
    probe.className = "playcount-probe";
    probe.textContent = "0000000000";
    num.appendChild(probe);
    const advEm = probe.getBoundingClientRect().width / 1000;
    probe.textContent = ",,,,,,,,,,";
    const commaEm = probe.getBoundingClientRect().width / 1000;
    probe.remove();
    // widest figure: 10 digits, 3 commas, tracking ~ -0.04em per glyph
    const widestEm = MAX_DIGITS * advEm + 3 * commaEm - 13 * 0.04;
    const size = Math.max(32, Math.round(Math.min((w * 0.74) / widestEm, h * 0.28, 184)));
    num.style.setProperty("--pc-size", `${size}px`);
    const adv = advEm * size;
    const commaRaw = commaEm * size;
    windowEdges();
    const track = TRACK_K * (size - 12);
    metrics = { size, adv: adv + track, comma: commaRaw + track, track };
    num.style.setProperty("--pc-adv", `${metrics.adv}px`);
    num.style.setProperty("--pc-comma", `${metrics.comma}px`);
  };

  // Slots for a digit string: x of each digit's left edge and each comma's
  // left edge, centred on 0.
  const slots = (str) => {
    const n = str.length;
    const nc = Math.floor((n - 1) / 3);
    const width = n * metrics.adv + nc * metrics.comma;
    let x = -width / 2;
    const dx = [];
    const cx = [];
    for (let i = 0; i < n; i++) {
      dx.push(x);
      x += metrics.adv;
      const fromRight = n - 1 - i;
      if (fromRight > 0 && fromRight % 3 === 0) {
        cx.push(x);
        x += metrics.comma;
      }
    }
    return { dx, cx, width, left: -width / 2, right: width / 2 };
  };

  let layout = slots(String(value));

  // The caret rides the right edge on the same spring as the glyphs.
  const caretEl = document.createElement("span");
  caretEl.className = "playcount-caret";
  num.appendChild(caretEl);
  const caret = { x: { p: 0, v: 0 }, tx: 0 };
  const caretX = () => layout.right + metrics.size * 0.06;

  const retire = (g, tx, side) => {
    g.tx = tx;
    if (side) g.side = side;
    g.tpres = 0;
    leaving.push(g);
  };

  // ---- the two change paths -----------------------------------------

  // Where a comma sits with no offset: centred in the gap its figures leave
  // it, which is exactly its slot at rest and narrower while they part.
  const place = (c) => {
    const left = c.anchor.x.p + metrics.adv;
    const gap = c.next ? Math.max(0, Math.min(metrics.comma, c.next.x.p - left)) : metrics.comma;
    return left + (gap - metrics.comma) / 2;
  };

  // Seat comma j of `count` among the figures `nd`: the figure index it
  // follows is fixed by the count of figures to its right.
  const seat = (c, nd, count, j) => {
    const i = nd.length - 1 - 3 * (count - j);
    const anchor = nd[i];
    const next = nd[i + 1] || null;
    if (!c) return makeComma(anchor, next, true);
    if (c.anchor !== anchor || c.next !== next) {
      // keep it exactly where it is now, as an offset from its new gap
      const here = place(c) + c.off.p;
      c.anchor = anchor;
      c.next = next;
      c.off.p = here - place(c);
    }
    return c;
  };

  const retireComma = (c) => {
    c.tpres = 0;
    leaving.push(c);
  };

  const apply = (next, mode) => {
    next = Math.max(0, Math.min(MAX_VALUE, Math.round(next)));
    if (next === value && digits.length) return;
    const prev = value;
    const str = String(next);
    const old = layout;
    const nl = slots(str);
    const n = str.length;
    const nd = [];
    const nc = [];

    if (mode === "type") {
      // Keyed from the left: digits keep identity, commas slide.
      // A new digit starts flush against the number's right edge as it stands
      // now, not in its final slot, and travels in with its neighbours: it
      // can only ever sit beside them, never on top of them.
      const lastOld = digits[digits.length - 1];
      const edge = lastOld ? Math.max(old.right, lastOld.x.p + metrics.adv) : old.right;
      let added = 0;
      for (let i = 0; i < n; i++) {
        let g = digits[i];
        const d = +str[i];
        if (g && g.digit !== d) {
          // only the lone 0 differs: the first typed digit rolls up into it
          g.troll += (d - g.digit + 10) % 10;
          g.digit = d;
        } else if (!g) {
          g = makeDigit(d, edge + added * metrics.adv, true, 1);
          added++;
        }
        g.tx = nl.dx[i];
        nd.push(g);
      }
      for (let i = n; i < digits.length; i++) retire(digits[i], nl.left + (digits[i].tx - old.left), 1);
      // the caret is pushed ahead by the keystroke, as in any text field
      if (added) caret.x.p = Math.max(caret.x.p, edge + added * metrics.adv + metrics.size * 0.06);
      for (let j = 0; j < nl.cx.length; j++) nc.push(seat(commas[j], nd, nl.cx.length, j));
      for (let j = nl.cx.length; j < commas.length; j++) retireComma(commas[j]);
    } else {
      // Keyed by place from the right: columns roll like an odometer.
      const dir = Math.sign(next - prev) || 1;
      const on = digits.length;
      for (let k = 0; k < n; k++) {
        const i = n - 1 - k;
        const d = +str[i];
        let g = digits[on - 1 - k];
        if (g) {
          const delta = dir > 0 ? (d - g.digit + 10) % 10 : -((g.digit - d + 10) % 10);
          g.troll += delta;
          // never wind up more than a turn behind: a whole turn is invisible
          while (g.troll - g.roll.p > 10) g.troll -= 10;
          while (g.roll.p - g.troll > 10) g.troll += 10;
          g.digit = d;
        } else {
          // a new leading digit turns into view from the side the count is
          // coming from, through the same edge as the rolling columns
          g = makeDigit(d, nl.dx[i], true, dir);
        }
        g.tx = nl.dx[i];
        nd[i] = g;
      }
      for (let k = n; k < on; k++) {
        const g = digits[on - 1 - k];
        retire(g, nl.right - (old.right - g.tx), -dir);
      }
      const oc = commas.length;
      const ncount = nl.cx.length;
      for (let k = 0; k < ncount; k++) {
        const j = ncount - 1 - k;
        nc[j] = seat(commas[oc - 1 - k], nd, ncount, j);
      }
      for (let k = ncount; k < oc; k++) retireComma(commas[oc - 1 - k]);
    }

    digits = nd;
    commas = nc;
    layout = nl;
    caret.tx = caretX();
    value = next;
    sync();
    onValue?.(next);
    wake();
  };

  // ---- DOM ------------------------------------------------------------

  const mountDigit = (g) => {
    const el = document.createElement("span");
    el.className = "playcount-col";
    const strip = document.createElement("span");
    strip.className = "playcount-strip";
    g.glyphs = [];
    for (let i = 0; i < 10; i++) {
      const s = document.createElement("span");
      s.className = "playcount-glyph";
      s.textContent = String(i);
      strip.appendChild(s);
      g.glyphs.push(s);
    }
    el.appendChild(strip);
    g.el = el;
    g.strip = strip;
    num.appendChild(el);
  };

  const mountComma = (c) => {
    const el = document.createElement("span");
    el.className = "playcount-comma";
    const mark = document.createElement("span");
    mark.className = "playcount-comma-mark";
    mark.textContent = ",";
    el.appendChild(mark);
    c.el = el;
    c.mark = mark;
    num.appendChild(el);
  };

  const sync = () => {
    for (const g of digits) if (!g.el) mountDigit(g);
    for (const c of commas) if (!c.el) mountComma(c);
  };

  const pitch = () => metrics.size * PITCH;

  // Every visible pixel is full-strength ink. The only things that move are
  // positions on springs and the hard-edged window each glyph is seen through:
  // no opacity, no blur, no scale.
  const render = (g) => {
    const p = Math.max(0, Math.min(1, g.pres.p));
    if (g.kind === "c") g.x.p = place(g) + g.off.p;
    g.el.style.transform = `translate3d(${g.x.p.toFixed(2)}px, 0, 0)`;
    if (g.kind === "c") {
      // A comma stays on the baseline. Entering or leaving, its advance opens
      // or closes on the figures' spring and the mark slides out of, or back
      // into, the edge of the figure on its left. Relocating, it slides along
      // the baseline and passes behind the figure it crosses: its window is
      // cut back to the space between the figures' advances, so ink never
      // touches ink.
      const off = -(1 - p) * metrics.comma;
      g.mark.style.transform = `translate3d(${off.toFixed(2)}px, 0, 0)`;
      // a breath of air past each figure's advance, so a comma cut by the
      // window never reads as glued to the figure it is leaving
      const inset = -metrics.size * 0.02;
      let lo = 0;
      let hi = metrics.comma * 1.6;
      const boxes = [];
      for (const d of digits.concat(leaving)) {
        if (d.kind !== "d" || d.pres.p < 0.3) continue;
        boxes.push(d.x.p - g.x.p + inset);
      }
      boxes.sort((a, b) => a - b);
      for (const a of boxes) {
        const b = a + metrics.adv - 2 * inset;
        if (a <= lo && b > lo) lo = b;
        else if (a < hi && b >= hi) hi = a;
      }
      if (hi < lo) hi = lo;
      g.el.style.setProperty("--pc-gap-l", `${lo.toFixed(2)}px`);
      g.el.style.setProperty("--pc-gap-r", `${hi.toFixed(2)}px`);
      return;
    }
    const P = pitch();
    // entering and leaving are a turn of the wheel through the window's edge
    g.strip.style.transform = `translate3d(0, ${((1 - p) * P * g.side).toFixed(2)}px, 0)`;
    const r = g.roll.p;
    for (let i = 0; i < 10; i++) {
      let off = (((i - r) % 10) + 10) % 10;
      if (off > 5) off -= 10;
      const s = g.glyphs[i];
      // a figure a full pitch away is already past the window's edge
      const far = Math.abs(off) >= 1;
      s.style.visibility = far ? "hidden" : "";
      if (!far) s.style.transform = `translate3d(0, ${(off * P).toFixed(2)}px, 0)`;
    }
  };

  let blinkTimer = 0;
  const restartBlink = () => {
    if (root.dataset.moving === undefined) root.dataset.moving = "";
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => delete root.dataset.moving, 420);
  };

  // ---- frame loop -----------------------------------------------------

  const tick = (dt) => {
    let busy = false;
    const all = digits.concat(commas, leaving);
    for (const g of all) {
      step(g.pres, g.tpres, PRESENCE_SPRING, dt);
      if (!settled(g.pres, g.tpres, 0.002)) busy = true;
      if (g.kind === "c") {
        step(g.off, 0, COMMA_SPRING, dt);
        if (!settled(g.off, 0, 0.05)) busy = true;
        continue;
      }
      step(g.x, g.tx, X_SPRING, dt);
      step(g.roll, g.troll, ROLL_SPRING, dt);
      if (!settled(g.x, g.tx, 0.05) || !settled(g.roll, g.troll, 0.0005)) busy = true;
    }
    leaving = leaving.filter((g) => {
      if (g.pres.p < 0.01 && g.tpres === 0) {
        g.el?.remove();
        return false;
      }
      return true;
    });
    for (const g of digits.concat(commas, leaving)) render(g);
    step(caret.x, caret.tx, X_SPRING, dt);
    if (!settled(caret.x, caret.tx, 0.05)) busy = true;
    caretEl.style.transform = `translate3d(${caret.x.p.toFixed(2)}px, 0, 0)`;
    // the caret holds still while things move, and blinks only at rest
    if (busy) restartBlink();
    return busy;
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed || frozen) return;
    const dt = Math.min(1 / 30, (now - (last || now)) / 1000) || 1 / 120;
    last = now;
    // fixed substeps keep stiff springs stable at any frame rate
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    let busy = false;
    for (let i = 0; i < n; i++) busy = tick(dt / n) || busy;
    if (busy) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (!raf && !destroyed && !frozen) raf = requestAnimationFrame(frame);
  };

  // ---- input ----------------------------------------------------------

  const typeDigit = (d) => {
    if (value === 0) return apply(d, "type");
    if (String(value).length >= MAX_DIGITS) return nudgeLimit();
    apply(value * 10 + d, "type");
  };
  const backspace = () => {
    if (value < 10) return apply(0, value === 0 ? "type" : "value");
    apply(Math.floor(value / 10), "type");
  };

  // A refused keystroke: the number leans and comes back.
  const nudgeLimit = () => {
    for (const g of digits) g.x.v += metrics.size * 0.9;
    wake();
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      typeDigit(+k);
    } else if (k === "Backspace" || k === "Delete") {
      e.preventDefault();
      backspace();
    } else if (k === "ArrowUp" || k === "ArrowRight") {
      e.preventDefault();
      apply(value + (e.shiftKey ? 1000 : 1), "value");
    } else if (k === "ArrowDown" || k === "ArrowLeft") {
      e.preventDefault();
      apply(value - (e.shiftKey ? 1000 : 1), "value");
    } else if (k === "Escape") {
      input.blur();
    }
  };

  // Soft keyboards that don't report keys: read what landed in the input.
  const onInput = () => {
    const v = input.value;
    input.value = "";
    for (const ch of v) if (/[0-9]/.test(ch)) typeDigit(+ch);
  };

  // Drag scrubs multiplicatively: 180px up is ten times the count.
  let drag = null;
  const onDown = (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, y: e.clientY, start: value, moved: false };
    stage.setPointerCapture(e.pointerId);
    root.dataset.dragging = "";
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 3) return;
    drag.moved = true;
    const next = Math.round((drag.start + 1) * Math.pow(10, -dy / 180) - 1);
    apply(next, "value");
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    delete root.dataset.dragging;
    if (!moved) input.focus({ preventScroll: true });
  };

  input.addEventListener("keydown", onKey);
  input.addEventListener("input", onInput);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);

  // ---- boot -----------------------------------------------------------

  let boxW = 0;
  let boxH = 0;
  const relayout = () => {
    if (box.clientWidth === boxW && box.clientHeight === boxH) return;
    boxW = box.clientWidth;
    boxH = box.clientHeight;
    const before = metrics.size;
    measure();
    const s = metrics.size / before;
    layout = slots(String(value));
    // rescale in flight rather than snapping, so a resize never cuts a move
    digits.forEach((g, i) => {
      g.x.p *= s;
      g.tx = layout.dx[i];
    });
    for (const c of commas) c.off.p *= s;
    caret.tx = caretX();
    caret.x.p *= s;
    for (const g of leaving) {
      if (g.kind === "c") {
        g.off.p *= s;
        continue;
      }
      g.x.p *= s;
      g.tx *= s;
    }
    for (const g of digits.concat(commas, leaving)) render(g);
    wake();
  };

  const ro = new ResizeObserver(() => relayout());

  const boot = () => {
    if (destroyed) return;
    measure();
    const str = String(value);
    layout = slots(str);
    digits = [...str].map((ch, i) => makeDigit(+ch, layout.dx[i], false));
    commas = layout.cx.map((_, j) => {
      const c = seat(null, digits, layout.cx.length, j);
      c.pres.p = 1;
      return c;
    });
    sync();
    for (const g of digits.concat(commas)) render(g);
    caret.tx = caretX();
    caret.x.p = caret.tx;
    caretEl.style.transform = `translate3d(${caret.x.p.toFixed(2)}px, 0, 0)`;
    boxW = box.clientWidth;
    boxH = box.clientHeight;
    ro.observe(box);
    root.dataset.ready = "";
  };

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fontsReady.then(boot);

  return {
    ready: fontsReady,
    focus: () => input.focus({ preventScroll: true }),
    get value() {
      return value;
    },
    set: (v, mode = "value") => apply(v, mode),
    type: typeDigit,
    backspace,
    // Hold the motion at a moment: step the springs t seconds, then stop.
    freezeAt: (t) => {
      frozen = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const dt = 1 / 240;
      for (let s = 0; s < t; s += dt) tick(dt);
    },
    destroy: () => {
      destroyed = true;
      clearTimeout(blinkTimer);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("input", onInput);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      num.remove();
    },
  };
}
