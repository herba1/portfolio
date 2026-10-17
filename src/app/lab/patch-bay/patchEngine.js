import { createPatchAudio } from "./patchAudio";
import { drawCable, drawKnob, drawLed, drawPlug, drawRing, drawVu, knobShadow, makeShadowSprites, shadowDab } from "./patchDraw";
import { CABLES, EFFECT_IDS, MODULES, TILT, computeLayout } from "./patchLayout";
import { drawPanel, makeTextures, vuAngle } from "./patchPanel";
import { createRope, layRope, stepRope } from "./patchRope";

const MAX_DPR = 2;
const STEP = 1 / 240;
const MAX_STEPS = 8;
const TITLES = Object.fromEntries(MODULES.map((m) => [m.id, m.title]));

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function approach(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function createPatchEngine({ box, stage, live, insets, embedded, onSound, onChain, onReady, onAnnounce }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const panel = document.createElement("canvas");
  const shade = document.createElement("canvas");
  const panelCtx = panel.getContext("2d");
  const shadeCtx = shade.getContext("2d");
  const liveCtx = live.getContext("2d", { alpha: false });
  const textures = makeTextures();
  const sprites = makeShadowSprites(14);
  const audio = createPatchAudio();
  const fonts = { sans: "system-ui, sans-serif", mono: "ui-monospace, monospace" };
  const knobValues = {};
  for (const m of MODULES) if (m.knob) knobValues[m.id] = m.knob.value;
  for (const [id, v] of Object.entries(knobValues)) audio.setKnob(id, v);

  let L = null;
  let dpr = 1;
  let cables = [];
  let jackById = new Map();
  let chain = [];
  let raf = 0;
  let last = 0;
  let acc = 0;
  let quiet = 0;
  let visible = true;
  let destroyed = false;
  let sound = "off";
  let topOrder = 10;
  let drag = null;
  let pointer = { x: 0, y: 0, inside: false, type: "mouse" };
  let needle = { angle: vuAngle(-24), vel: 0 };
  let lamp = 0;
  let level = 0;
  let pendingResize = false;
  let assignments = null;
  let ready = false;

  const plugLength = () => L.plug.collar + L.plug.body + L.plug.boot;
  const seatZ = () => L.plug.seat;
  const liftZ = () => L.plug.sleeve + 10 * L.u;

  function readFonts() {
    const cs = getComputedStyle(box);
    const sans = cs.getPropertyValue("--font-sans").trim();
    const mono = cs.getPropertyValue("--font-mono").trim();
    if (sans) fonts.sans = sans;
    if (mono) fonts.mono = mono;
  }

  function env() {
    return {
      gravity: 15000 * L.u,
      damping: reduced ? 0.995 : 0.9972,
      settle: 0.25 * L.u,
      iterations: 12,
      radius: L.d * 0.5,
      plugRadius: L.d * 0.75,
      friction: 0.06,
      floorFriction: 0.25,
      floor: L.height - 1,
      left: 2,
      right: L.width - 2,
      colliders: colliders(),
    };
  }

  let envCache = null;

  function colliders() {
    const list = [];
    for (const k of L.knobs) list.push({ x: k.x, y: k.y, r: k.r * 1.04, h: (k.small ? 14 : 22) * L.u, skip: null });
    for (const j of L.jacks) {
      if (j.plug && (j.plug.state === "seated" || j.plug.state === "gripped")) list.push({ x: j.x, y: j.y, r: L.d * 0.8, h: seatZ() + plugLength() * 0.9, skip: j.plug.cable.rope });
      else list.push({ x: j.x, y: j.y, r: L.nutR * 0.9, h: 3 * L.u, skip: null });
    }
    return list;
  }

  function refreshColliders() {
    if (envCache) envCache.colliders = colliders();
  }

  function endPinned(e) {
    return e.state !== "free";
  }

  function updateEndGeometry(e) {
    const len = plugLength();
    if (e.state === "free") {
      const r = e.cable.rope;
      const i = e.side === 0 ? 0 : r.n - 1;
      const k = e.side === 0 ? 1 : r.n - 2;
      let dx = r.x[i] - r.x[k];
      let dy = r.y[i] - r.y[k];
      let dz = r.z[i] - r.z[k];
      const m = Math.hypot(dx, dy, dz) || 1;
      dx /= m;
      dy /= m;
      dz /= m;
      e.axis[0] = -dx;
      e.axis[1] = -dy;
      e.axis[2] = -dz;
      e.tail[0] = r.x[i];
      e.tail[1] = r.y[i];
      e.tail[2] = r.z[i];
      e.front[0] = r.x[i] + dx * len;
      e.front[1] = r.y[i] + dy * len;
      e.front[2] = Math.max(L.d * 0.6, r.z[i] + dz * len);
      e.reveal = 1;
      return;
    }
    if (e.state === "held" || e.state === "seating") {
      const c = reduced ? 0 : 0.00028;
      let ax = clamp(-e.vel[0] * c, -0.55, 0.55);
      let ay = clamp(-e.vel[1] * c, -0.55, 0.55);
      e.lean[0] = approach(e.lean[0], ax, 18, STEP);
      e.lean[1] = approach(e.lean[1], ay, 18, STEP);
      ax = e.lean[0];
      ay = e.lean[1];
      const m = Math.hypot(ax, ay, 1);
      e.axis[0] = ax / m;
      e.axis[1] = ay / m;
      e.axis[2] = 1 / m;
    } else {
      e.axis[0] = 0;
      e.axis[1] = 0;
      e.axis[2] = 1;
    }
    e.tail[0] = e.front[0] + e.axis[0] * len;
    e.tail[1] = e.front[1] + e.axis[1] * len;
    e.tail[2] = e.front[2] + e.axis[2] * len;
    if (e.state === "seating") e.reveal = clamp((e.front[2] - seatZ()) / L.plug.sleeve, 0, 1);
    else if (e.state === "held") e.reveal = 1;
    else e.reveal = 0;
  }

  function makeEnd(cable, side) {
    return {
      cable,
      side,
      state: "free",
      jack: null,
      front: [0, 0, 0],
      axis: [0, 0, 1],
      tail: [0, 0, 0],
      vel: [0, 0, 0],
      lean: [0, 0],
      target: [0, 0],
      reveal: 0,
      pinned: false,
      grip: null,
      offset: [0, 0],
      contact: false,
    };
  }

  function seat(e, jack, quietly) {
    if (e.jack && e.jack !== jack) e.jack.plug = null;
    e.jack = jack;
    jack.plug = e;
    e.state = "seated";
    e.front[0] = jack.x;
    e.front[1] = jack.y;
    e.front[2] = seatZ();
    e.vel[0] = e.vel[1] = e.vel[2] = 0;
    e.lean[0] = e.lean[1] = 0;
    e.pinned = true;
    updateEndGeometry(e);
    if (!quietly) {
      jack.since = nextStamp();
      updateChain(true);
    }
  }

  let stamp = 0;
  function nextStamp() {
    stamp += 1;
    return stamp;
  }

  function unseat(e) {
    const jack = e.jack;
    if (jack) jack.plug = null;
    e.jack = null;
    return jack;
  }

  function cableLength(spec) {
    if (spec.length) return spec.length * L.modSize;
    const a = jackById.get(spec.from);
    const b = jackById.get(spec.to);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    return dist * spec.slack + 0.16 * L.modSize;
  }

  function build() {
    jackById = new Map(L.jacks.map((j) => [j.id, j]));
    const previous = assignments;
    cables = CABLES.map((spec, index) => {
      const length = cableLength(spec);
      const rope = createRope(length, 8 * L.u);
      const cable = { spec, index, color: spec.color, rope, length, order: index, screenCount: 0, twist: index * 1.7 };
      cable.ends = [makeEnd(cable, 0), makeEnd(cable, 1)];
      const n = rope.n;
      cable.buffers = {
        sx: new Float32Array(n),
        sy: new Float32Array(n),
        ox: new Float32Array(n),
        oy: new Float32Array(n),
        ux: new Float32Array(n),
        uy: new Float32Array(n),
        tx: new Float32Array(n),
        ty: new Float32Array(n),
      };
      return cable;
    });
    for (const cable of cables) {
      const ids = previous ? previous[cable.index] : [cable.spec.from, cable.spec.to];
      cable.ends.forEach((e, side) => {
        const id = ids[side];
        const jack = id ? jackById.get(id) : null;
        if (jack && !jack.plug) seat(e, jack, true);
      });
    }
    for (const cable of cables) {
      for (const e of cable.ends) {
        if (e.state !== "free") continue;
        const spare = L.jacks.find((j) => j.kind === "park" && !j.plug);
        if (spare) seat(e, spare, true);
      }
      const [a, b] = cable.ends;
      if (a.state === "seated" && b.state === "seated") {
        const dist = Math.hypot(a.front[0] - b.front[0], a.front[1] - b.front[1]);
        if (dist > cable.length * 0.94) {
          unseat(b);
          b.state = "free";
          b.pinned = false;
        }
      }
    }
    for (const j of L.jacks) j.glow = j.plug && j.kind === "jack" ? 1 : 0;
    for (const cable of cables) {
      const [a, b] = cable.ends;
      const ta = a.state === "free" ? null : a.tail;
      const tb = b.state === "free" ? null : b.tail;
      const pa = ta || [tb[0] - 4, tb[1] + cable.length * 0.5, tb[2]];
      const pb = tb || [ta[0] + 4, ta[1] + cable.length * 0.5, ta[2]];
      const span = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      const sag = Math.sqrt(Math.max(0, cable.length * cable.length - span * span)) * 0.5;
      layRope(cable.rope, pa, pb, sag);
    }
    for (const k of L.knobs) {
      k.value = knobValues[k.id];
      k.shown = k.value;
    }
    for (const m of L.modules) m.led = chain.includes(m.id) ? 1 : 0;
    const out = L.modules.find((m) => m.kind === "output");
    if (out?.vu) out.vu.angle = needle.angle;
    envCache = env();
    updateChain(false);
    for (let i = 0; i < 1100; i += 1) simulate();
  }

  function captureAssignments() {
    assignments = cables.map((c) => c.ends.map((e) => (e.jack ? e.jack.id : null)));
  }

  function resize() {
    pendingResize = false;
    const rect = box.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    for (const c of [panel, live]) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    shade.width = Math.round(width * dpr * 0.5);
    shade.height = Math.round(height * dpr * 0.5);
    if (cables.length) captureAssignments();
    if (drag) endDrag(false);
    const ins = insets(rect);
    L = computeLayout({ width, height, top: ins.top, side: ins.side, bottom: ins.bottom, embedded });
    build();
    paintPanel();
    render();
    if (!ready) {
      ready = true;
      onReady?.();
    }
    wake();
  }

  function paintPanel() {
    panelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    panelCtx.clearRect(0, 0, L.width, L.height);
    drawPanel(panelCtx, L, textures, fonts);
  }

  function updateChain(announce) {
    const live = new Set();
    for (const j of L.jacks) {
      if (j.kind !== "jack" || !j.plug) continue;
      if (j.plug.state !== "seated" && j.plug.state !== "gripped") continue;
      if (EFFECT_IDS.includes(j.module.id)) live.add(j.module.id);
    }
    const before = chain.join(",");
    chain = chain.filter((id) => live.has(id));
    const fresh = [...live].filter((id) => !chain.includes(id));
    fresh.sort((a, b) => {
      const ja = L.jacks.filter((j) => j.module.id === a && j.plug).map((j) => j.since || 0);
      const jb = L.jacks.filter((j) => j.module.id === b && j.plug).map((j) => j.since || 0);
      return Math.min(...ja) - Math.min(...jb);
    });
    chain.push(...fresh);
    audio.setChain(chain);
    onChain?.(chain.map((id) => TITLES[id]));
    if (announce && before !== chain.join(",")) {
      onAnnounce?.(chain.length ? `Signal runs through ${chain.map((id) => TITLES[id]).join(", then ")}.` : "Dry signal, nothing patched.");
    }
  }

  function heldTarget(e) {
    let tx = pointer.x + e.offset[0];
    let ty = pointer.y + e.offset[1] - TILT * e.front[2];
    if (e.auto) {
      tx = e.auto.x;
      ty = e.auto.y;
    }
    const other = e.cable.ends[1 - e.side];
    if (other.state !== "free") {
      const dx = tx - other.front[0];
      const dy = ty - other.front[1];
      const dist = Math.hypot(dx, dy);
      const reach = e.cable.length * 0.9;
      const give = other.jack && other.jack.kind === "park" ? 26 * L.u : 52 * L.u;
      const parked = other.jack && other.jack.kind === "park";
      if ((!e.auto || parked) && dist > reach + give && (other.state === "seated" || other.state === "seating")) {
        popOut(other, dx / dist, dy / dist);
      } else if (dist > reach) {
        tx = other.front[0] + (dx / dist) * reach;
        ty = other.front[1] + (dy / dist) * reach;
      }
    }
    const snap = nearestJack(tx, ty, e);
    if (snap) {
      const w = Math.pow(1 - snap.dist / snapRadius(), 2) * 0.55;
      tx += (snap.jack.x - tx) * w;
      ty += (snap.jack.y - ty) * w;
    }
    e.target[0] = tx;
    e.target[1] = ty;
    e.hover = snap ? snap.jack : null;
  }

  function snapRadius() {
    return Math.max(28, 42 * L.u);
  }

  function nearestJack(x, y, e) {
    let best = null;
    const limit = snapRadius();
    const other = e.cable.ends[1 - e.side];
    for (const j of L.jacks) {
      if (j.plug && j.plug !== e) continue;
      const dist = Math.hypot(j.x - x, j.y - y);
      if (dist < limit && (!best || dist < best.dist)) best = { jack: j, dist };
    }
    return best;
  }

  function stepEnd(e, h) {
    if (e.state === "held") {
      heldTarget(e);
      e.cable.twist += e.vel[0] * h * 0.004;
      const w = 30;
      for (let k = 0; k < 2; k += 1) {
        const a = w * w * (e.target[k] - e.front[k]) - 2 * w * e.vel[k];
        e.vel[k] += a * h;
        e.front[k] += e.vel[k] * h;
      }
      const wz = 20;
      const az = wz * wz * (liftZ() - e.front[2]) - 2 * wz * e.vel[2];
      e.vel[2] += az * h;
      e.front[2] += e.vel[2] * h;
      if (e.auto) {
        const d = Math.hypot(e.target[0] - e.front[0], e.target[1] - e.front[1]);
        if (d < 2 && Math.hypot(e.vel[0], e.vel[1]) < 60) {
          const j = e.auto.jack;
          e.auto = null;
          if (j && !j.plug) beginSeating(e, j);
          else release(e);
        }
      }
    } else if (e.state === "seating") {
      const j = e.jack;
      const w = 34;
      for (let k = 0; k < 2; k += 1) {
        const target = k === 0 ? j.x : j.y;
        const a = w * w * (target - e.front[k]) - 2 * 0.95 * w * e.vel[k];
        e.vel[k] += a * h;
        e.front[k] += e.vel[k] * h;
      }
      const xyClose = Math.hypot(j.x - e.front[0], j.y - e.front[1]) < 4 * L.u;
      const wz = 30;
      const goal = xyClose ? seatZ() : Math.max(seatZ() + L.plug.sleeve * 0.5, e.front[2]);
      const az = wz * wz * (goal - e.front[2]) - 2 * 0.6 * wz * e.vel[2];
      e.vel[2] += az * h;
      e.front[2] += e.vel[2] * h;
      if (e.front[2] < seatZ() - 1.4 * L.u) {
        e.front[2] = seatZ() - 1.4 * L.u;
        e.vel[2] = Math.abs(e.vel[2]) * 0.2;
      }
      if (!e.contact && e.front[2] < seatZ() + 1.5 * L.u && xyClose) {
        e.contact = true;
        audio.click(1);
        j.since = nextStamp();
        refreshColliders();
      }
      const settled = Math.abs(e.front[2] - seatZ()) < 0.25 && Math.abs(e.vel[2]) < 8 && Math.hypot(j.x - e.front[0], j.y - e.front[1]) < 0.3;
      if (settled) {
        seat(e, j, true);
        updateChain(true);
        refreshColliders();
      }
    } else if (e.state === "gripped") {
      const j = e.jack;
      const dx = pointer.x - e.grip.x;
      const dy = pointer.y - e.grip.y;
      const pull = Math.hypot(dx, dy);
      const strain = Math.min(3 * L.u, pull * 0.08);
      const ux = pull > 0 ? dx / pull : 0;
      const uy = pull > 0 ? dy / pull : 0;
      e.front[0] = approach(e.front[0], j.x + ux * strain, 40, h);
      e.front[1] = approach(e.front[1], j.y + uy * strain, 40, h);
      e.front[2] = approach(e.front[2], seatZ() + Math.min(5 * L.u, pull * 0.12), 40, h);
      if (pull > Math.max(14, 20 * L.u)) yank(e);
    } else if (e.state === "seated" && e.jack) {
      const j = e.jack;
      e.front[0] = approach(e.front[0], j.x, 30, h);
      e.front[1] = approach(e.front[1], j.y, 30, h);
      e.front[2] = approach(e.front[2], seatZ(), 30, h);
    }
    e.pinned = endPinned(e);
    if (e.pinned) updateEndGeometry(e);
  }

  function beginSeating(e, jack) {
    if (e.jack && e.jack !== jack) e.jack.plug = null;
    e.state = "seating";
    e.jack = jack;
    jack.plug = e;
    e.contact = false;
    e.pinned = true;
  }

  function yank(e) {
    const jack = unseat(e);
    e.state = "held";
    e.vel[2] = 260 * L.u;
    e.offset[0] = e.front[0] - pointer.x;
    e.offset[1] = e.front[1] + TILT * e.front[2] - pointer.y;
    e.grip = null;
    audio.click(0.7);
    refreshColliders();
    updateChain(true);
  }

  function popOut(e, dx, dy) {
    const jack = unseat(e);
    const r = e.cable.rope;
    const i = e.side === 0 ? 0 : r.n - 1;
    updateEndGeometry(e);
    const kick = 120 * L.u;
    r.x[i] = e.tail[0];
    r.y[i] = e.tail[1];
    r.z[i] = e.tail[2];
    r.px[i] = e.tail[0] - dx * kick * STEP;
    r.py[i] = e.tail[1] - dy * kick * STEP;
    r.pz[i] = e.tail[2] - kick * 0.4 * STEP;
    e.state = "free";
    e.pinned = false;
    audio.click(0.6);
    refreshColliders();
    if (jack && jack.kind === "jack") updateChain(true);
  }

  function release(e) {
    e.auto = null;
    if (e.state === "gripped") {
      e.state = "seated";
      e.grip = null;
      return;
    }
    if (e.state !== "held") return;
    const snapPlug = nearestJack(e.front[0], e.front[1], e);
    const snapAim = e.target ? nearestJack(e.target[0], e.target[1], e) : null;
    const snap = snapPlug && (!snapAim || snapPlug.dist <= snapAim.dist) ? snapPlug : snapAim;
    if (snap) {
      beginSeating(e, snap.jack);
      return;
    }
    const other = e.cable.ends[1 - e.side];
    if (other.state === "free") {
      let spare = null;
      let best = Infinity;
      for (const j of L.jacks) {
        if (j.kind !== "park" || j.plug) continue;
        const dist = Math.hypot(j.x - e.front[0], j.y - e.front[1]);
        if (dist < best) {
          best = dist;
          spare = j;
        }
      }
      if (spare) {
        e.auto = { x: spare.x, y: spare.y, jack: spare };
        return;
      }
    }
    const r = e.cable.rope;
    const i = e.side === 0 ? 0 : r.n - 1;
    updateEndGeometry(e);
    r.x[i] = e.tail[0];
    r.y[i] = e.tail[1];
    r.z[i] = e.tail[2];
    r.px[i] = e.tail[0] - e.vel[0] * STEP;
    r.py[i] = e.tail[1] - e.vel[1] * STEP;
    r.pz[i] = e.tail[2] - e.vel[2] * STEP * 0.3;
    e.state = "free";
    e.pinned = false;
    if (e.jack) {
      e.jack.plug = null;
      e.jack = null;
    }
  }

  function stepGrab(h) {
    const g = drag && drag.kind === "rope" ? drag : null;
    if (!g) return;
    const r = g.cable.rope;
    const i = g.index;
    const tx = pointer.x + g.offset[0];
    const ty = pointer.y + g.offset[1] - TILT * g.pos[2];
    const w = 28;
    const targets = [tx, ty, g.lift];
    for (let k = 0; k < 3; k += 1) {
      const a = w * w * (targets[k] - g.pos[k]) - 2 * w * g.vel[k];
      g.vel[k] += a * h;
      g.pos[k] += g.vel[k] * h;
    }
    r.px[i] = r.x[i];
    r.py[i] = r.y[i];
    r.pz[i] = r.z[i];
    r.x[i] = g.pos[0];
    r.y[i] = g.pos[1];
    r.z[i] = g.pos[2];
    r.w[i] = 0;
    for (const e of g.cable.ends) {
      if (e.state !== "seated" && e.state !== "seating") continue;
      const along = (e.side === 0 ? i : r.n - 1 - i) * r.seg;
      const dist = Math.hypot(g.pos[0] - e.tail[0], g.pos[1] - e.tail[1], g.pos[2] - e.tail[2]);
      const give = e.jack && e.jack.kind === "park" ? 20 * L.u : 96 * L.u;
      if (dist > along * 1.04 + give) {
        const m = dist || 1;
        popOut(e, (g.pos[0] - e.tail[0]) / m, (g.pos[1] - e.tail[1]) / m);
      }
    }
  }

  function rescueLoose() {
    for (const cable of cables) {
      if (drag && (drag.cable === cable || (drag.e && drag.e.cable === cable))) continue;
      const [a, b] = cable.ends;
      if (a.state !== "free" || b.state !== "free") continue;
      const e = a.front[1] < b.front[1] ? a : b;
      let spot = null;
      let best = Infinity;
      for (const j of L.jacks) {
        if (j.plug) continue;
        const dist = Math.hypot(j.x - e.front[0], j.y - e.front[1]) + (j.kind === "park" ? 0 : 4000);
        if (dist < best) {
          best = dist;
          spot = j;
        }
      }
      if (!spot) continue;
      const r = cable.rope;
      const i = e.side === 0 ? 0 : r.n - 1;
      e.vel[0] = (r.x[i] - r.px[i]) / STEP;
      e.vel[1] = (r.y[i] - r.py[i]) / STEP;
      e.vel[2] = 0;
      e.state = "held";
      e.auto = { x: spot.x, y: spot.y, jack: spot };
    }
  }

  function simulate() {
    if (!envCache) envCache = env();
    stepGrab(STEP);
    let motion = 0;
    for (const cable of cables) {
      for (const e of cable.ends) stepEnd(e, STEP);
      const m = stepRope(cable.rope, envCache, STEP, cable.ends);
      if (m > motion) motion = m;
      for (const e of cable.ends) if (e.state === "free") updateEndGeometry(e);
    }
    return motion;
  }

  function screenOf(cable) {
    const r = cable.rope;
    const b = cable.buffers;
    for (let i = 0; i < r.n; i += 1) {
      b.sx[i] = r.x[i];
      b.sy[i] = r.y[i] + TILT * r.z[i];
    }
    cable.screenCount = r.n;
  }

  function plugCenter(e) {
    const half = plugLength() * 0.5;
    const x = e.front[0] + e.axis[0] * half;
    const y = e.front[1] + e.axis[1] * half;
    const z = e.front[2] + e.axis[2] * half;
    return [x, y + TILT * z];
  }

  function renderShadows() {
    const s = dpr * 0.5;
    shadeCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadeCtx.globalCompositeOperation = "source-over";
    shadeCtx.fillStyle = "#fff";
    shadeCtx.fillRect(0, 0, shade.width, shade.height);
    shadeCtx.setTransform(s, 0, 0, s, 0, 0);
    shadeCtx.globalCompositeOperation = "darken";
    for (const k of L.knobs) knobShadow(shadeCtx, sprites, k, L.u);
    const rad = L.d * 0.5;
    for (const cable of cables) {
      const r = cable.rope;
      const step = rad * 0.7;
      for (let i = 0; i < r.n - 1; i += 1) {
        const dx = r.x[i + 1] - r.x[i];
        const dy = r.y[i + 1] - r.y[i];
        const dz = r.z[i + 1] - r.z[i];
        const len = Math.hypot(dx, dy, dz);
        const count = Math.max(1, Math.ceil(len / step));
        for (let k = 0; k < count; k += 1) {
          const t = k / count;
          const z = r.z[i] + dz * t;
          shadowDab(shadeCtx, sprites, r.x[i] + dx * t, r.y[i] + dy * t, Math.max(0, z - rad * 0.9), rad, 1);
        }
      }
      for (const e of cable.ends) {
        const len = plugLength();
        const from = e.state === "held" || e.state === "free" ? -L.plug.sleeve * e.reveal : 0;
        const steps = 8;
        for (let k = 0; k <= steps; k += 1) {
          const t = from + ((len - from) * k) / steps;
          const x = e.front[0] + e.axis[0] * t;
          const y = e.front[1] + e.axis[1] * t;
          const z = e.front[2] + e.axis[2] * t;
          shadowDab(shadeCtx, sprites, x, y, Math.max(0, z - L.d * 0.6), L.d * (t < L.plug.collar ? 0.78 : 0.62), 0.8);
        }
      }
    }
    shadeCtx.globalCompositeOperation = "source-over";
    shadeCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function render() {
    if (!L) return;
    renderShadows();
    const ctx = liveCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(panel, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(shade, 0, 0, live.width, live.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const k of L.knobs) drawKnob(ctx, k, L.u, k.module.face);
    for (const j of L.jacks) if (j.kind === "jack") drawRing(ctx, j, L.nutR, j.module.face, L.u);
    for (const m of L.modules) {
      if (m.kind === "park") continue;
      const lx = m.x + m.w - Math.max(10, 16 * L.u);
      const ly = m.y + Math.max(12, 18 * L.u);
      drawLed(ctx, lx, ly, Math.max(2, 3 * L.u), m.led, m.face);
      if (m.vu) drawVu(ctx, m.vu, L.u, lamp);
    }
    const seatedEnds = [];
    for (const cable of cables) for (const e of cable.ends) if (e.state === "seated" || e.state === "gripped") seatedEnds.push(e);
    seatedEnds.sort((a, b) => a.front[1] - b.front[1]);
    for (const e of seatedEnds) drawPlug(ctx, e, L.plug, L.d);
    const ordered = cables.slice().sort((a, b) => a.order - b.order);
    for (const cable of ordered) {
      screenOf(cable);
      drawCable(ctx, cable, cable.buffers, L.d, dpr);
      for (const e of cable.ends) if (e.state !== "seated" && e.state !== "gripped") drawPlug(ctx, e, L.plug, L.d);
    }
  }

  function animateUi(dt) {
    let busy = false;
    for (const j of L.jacks) {
      const occupied = j.plug && (j.plug.state === "seated" || j.plug.state === "gripped" || (j.plug.state === "seating" && j.plug.contact));
      const target = occupied && j.kind === "jack" ? 1 : 0;
      const next = approach(j.glow, target, target > j.glow ? 9 : 6, dt);
      if (Math.abs(next - target) > 0.002) busy = true;
      j.glow = Math.abs(next - target) <= 0.002 ? target : next;
    }
    const playing = audio.playing && visible;
    for (const m of L.modules) {
      let target = chain.includes(m.id) ? 1 : 0;
      if (m.kind === "source") target = playing ? clamp(level * 9, 0.08, 1) : 0;
      if (m.kind === "output") target = playing ? 0.85 : 0;
      const rate = m.kind === "source" ? 30 : 8;
      const next = approach(m.led, target, rate, dt);
      if (Math.abs(next - target) > 0.003) busy = true;
      m.led = Math.abs(next - target) <= 0.003 ? target : next;
    }
    for (const k of L.knobs) {
      const next = approach(k.shown, k.value, 26, dt);
      if (Math.abs(next - k.value) > 0.0005) busy = true;
      k.shown = Math.abs(next - k.value) <= 0.0005 ? k.value : next;
    }
    const lampTarget = playing ? 1 : 0;
    lamp = approach(lamp, lampTarget, 4, dt);
    if (Math.abs(lamp - lampTarget) > 0.003) busy = true;
    else lamp = lampTarget;
    const db = level > 0 ? 20 * Math.log10(level * 3.2 + 1e-6) : -40;
    const goal = vuAngle(playing ? clamp(db, -26, 4) : -26);
    const w = 11;
    const steps = Math.max(1, Math.ceil(dt / STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const a = w * w * (goal - needle.angle) - 2 * 0.72 * w * needle.vel;
      needle.vel += a * h;
      needle.angle += needle.vel * h;
    }
    const out = L.modules.find((m) => m.vu);
    if (out) out.vu.angle = needle.angle;
    if (Math.abs(needle.vel) > 0.002 || Math.abs(goal - needle.angle) > 0.002) busy = true;
    return busy || playing;
  }

  function frame(time) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
    last = time;
    if (pendingResize) resize();
    level = audio.playing ? audio.level() : 0;
    acc += dt;
    let steps = 0;
    let motion = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      motion = Math.max(motion, simulate());
      acc -= STEP;
      steps += 1;
    }
    if (steps === MAX_STEPS) acc = 0;
    if (steps) rescueLoose();
    const uiBusy = animateUi(dt);
    render();
    const holding = cables.some((c) => c.ends.some((e) => e.state === "held" || e.state === "seating" || e.state === "gripped"));
    if (motion < 0.012 * Math.max(0.5, L.u) && !holding) quiet += 1;
    else quiet = 0;
    if ((quiet < 40 || uiBusy || holding || drag) && visible && !document.hidden) {
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (!raf) {
      last = 0;
      acc = 0;
    }
  }

  function wake() {
    quiet = 0;
    if (!raf && !destroyed && visible && !document.hidden && L) raf = requestAnimationFrame(frame);
  }

  function local(ev) {
    const rect = box.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }

  function hitPlug(x, y) {
    let best = null;
    const radius = Math.max(22, L.d * 1.5);
    const ordered = cables.slice().sort((a, b) => b.order - a.order);
    for (const cable of ordered) {
      for (const e of cable.ends) {
        const [cx, cy] = plugCenter(e);
        const dist = Math.hypot(cx - x, cy - y);
        if (dist < radius && (!best || dist < best.dist - 4)) best = { e, dist };
      }
    }
    return best ? best.e : null;
  }

  function hitRope(x, y) {
    const limit = Math.max(14, L.d * 1.15);
    const ordered = cables.slice().sort((a, b) => b.order - a.order);
    for (const cable of ordered) {
      const r = cable.rope;
      let best = -1;
      let bestDist = limit;
      for (let i = 2; i < r.n - 2; i += 1) {
        const dist = Math.hypot(r.x[i] - x, r.y[i] + TILT * r.z[i] - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      if (best >= 0) return { cable, index: best };
    }
    return null;
  }

  function hitKnob(x, y) {
    for (const k of L.knobs) {
      const top = k.y + TILT * (k.small ? 14 : 22) * L.u * 0.5;
      if (Math.hypot(k.x - x, top - y) < Math.max(20, k.r * 1.3)) return k;
    }
    return null;
  }

  function onDown(ev) {
    if (!L || drag) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    const [x, y] = local(ev);
    pointer.x = x;
    pointer.y = y;
    pointer.type = ev.pointerType;
    const e = hitPlug(x, y);
    if (e) {
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      drag = { kind: "plug", e, id: ev.pointerId };
      topOrder += 1;
      e.cable.order = topOrder;
      e.auto = null;
      if (e.state === "seated" || e.state === "seating") {
        if (e.state === "seating") {
          e.state = "held";
          unseat(e);
          e.offset[0] = e.front[0] - x;
          e.offset[1] = e.front[1] + TILT * e.front[2] - y;
          updateChain(true);
          refreshColliders();
        } else {
          e.state = "gripped";
          e.grip = { x, y };
        }
      } else {
        if (e.state === "free") {
          const r = e.cable.rope;
          const i = e.side === 0 ? 0 : r.n - 1;
          e.vel[0] = (r.x[i] - r.px[i]) / STEP;
          e.vel[1] = (r.y[i] - r.py[i]) / STEP;
          e.vel[2] = 0;
        }
        e.state = "held";
        e.offset[0] = e.front[0] - x;
        e.offset[1] = e.front[1] + TILT * e.front[2] - y;
      }
      stage.dataset.drag = "plug";
      wake();
      return;
    }
    const rope = hitRope(x, y);
    if (rope) {
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      const r = rope.cable.rope;
      const i = rope.index;
      const pos = [r.x[i], r.y[i], r.z[i]];
      drag = {
        kind: "rope",
        cable: rope.cable,
        index: i,
        id: ev.pointerId,
        pos,
        vel: [(r.x[i] - r.px[i]) / STEP, (r.y[i] - r.py[i]) / STEP, 0],
        offset: [pos[0] - x, pos[1] + TILT * pos[2] - y],
        lift: Math.max(pos[2], L.d * 2.5) + 14 * L.u,
      };
      topOrder += 1;
      rope.cable.order = topOrder;
      stage.dataset.drag = "rope";
      wake();
      return;
    }
    const k = hitKnob(x, y);
    if (k) {
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      drag = { kind: "knob", k, id: ev.pointerId, x, y };
      stage.dataset.drag = "knob";
      wake();
    }
  }

  function setKnob(k, v) {
    k.value = clamp(v, 0, 1);
    knobValues[k.id] = k.value;
    audio.setKnob(k.id, k.value);
    wake();
  }

  function onMove(ev) {
    if (!L) return;
    const [x, y] = local(ev);
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    if (drag && drag.id === ev.pointerId) {
      if (drag.kind === "knob") {
        const dx = x - drag.x;
        const dy = y - drag.y;
        drag.x = x;
        drag.y = y;
        setKnob(drag.k, drag.k.value + (-dy + dx * 0.35) * (ev.shiftKey ? 0.001 : 0.0036));
      }
      wake();
      return;
    }
    if (ev.pointerType === "mouse") {
      const hover = hitPlug(x, y) ? "plug" : hitRope(x, y) ? "plug" : hitKnob(x, y) ? "knob" : "";
      if (stage.dataset.hover !== hover) stage.dataset.hover = hover;
    }
  }

  function endDrag(commit = true) {
    if (!drag) return;
    if (drag.kind === "rope") {
      const r = drag.cable.rope;
      const i = drag.index;
      r.w[i] = 1;
      r.px[i] = r.x[i] - drag.vel[0] * STEP;
      r.py[i] = r.y[i] - drag.vel[1] * STEP;
      r.pz[i] = r.z[i] - drag.vel[2] * STEP;
    }
    if (drag.kind === "plug" && commit) release(drag.e);
    else if (drag.kind === "plug") {
      const e = drag.e;
      if (e.state === "gripped") e.state = "seated";
      else if (e.state === "held") release(e);
    }
    drag = null;
    delete stage.dataset.drag;
    wake();
  }

  function onUp(ev) {
    if (!drag || drag.id !== ev.pointerId) return;
    const [x, y] = local(ev);
    pointer.x = x;
    pointer.y = y;
    endDrag(true);
  }

  function onWheel(ev) {
    if (!L) return;
    const [x, y] = local(ev);
    const k = hitKnob(x, y);
    if (!k) return;
    ev.preventDefault();
    setKnob(k, k.value - ev.deltaY * 0.0012);
  }

  function toggleEffect(id) {
    const jacks = L.jacks.filter((j) => j.module.id === id);
    const plugged = jacks.filter((j) => j.plug);
    if (plugged.length) {
      const j = plugged.sort((a, b) => (b.since || 0) - (a.since || 0))[0];
      const e = j.plug;
      const spare = L.jacks.find((p) => p.kind === "park" && !p.plug);
      unseat(e);
      e.state = "held";
      e.vel[2] = 200 * L.u;
      e.auto = spare ? { x: spare.x, y: spare.y, jack: spare } : { x: j.x, y: j.y + L.modH * 0.3, jack: null };
      topOrder += 1;
      e.cable.order = topOrder;
      refreshColliders();
      updateChain(true);
      wake();
      return;
    }
    const target = jacks.find((j) => !j.plug && j.label === "In") || jacks.find((j) => !j.plug);
    if (!target) return;
    const candidates = [];
    for (const cable of cables) {
      for (const e of cable.ends) {
        if (e.state === "held" || e.state === "seating" || e.state === "gripped") continue;
        if (e.jack && e.jack.kind === "jack") continue;
        const other = cable.ends[1 - e.side];
        const otherParked = other.jack && other.jack.kind === "park";
        if (other.state !== "free" && !otherParked && Math.hypot(target.x - other.front[0], target.y - other.front[1]) > cable.length * 0.9) continue;
        const dist = Math.hypot(target.x - e.front[0], target.y - e.front[1]);
        candidates.push({ e, dist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const pick = candidates[0];
    if (!pick) {
      onAnnounce?.("No spare cable reaches that jack.");
      return;
    }
    const e = pick.e;
    if (e.state === "free") {
      const r = e.cable.rope;
      const i = e.side === 0 ? 0 : r.n - 1;
      e.vel[0] = (r.x[i] - r.px[i]) / STEP;
      e.vel[1] = (r.y[i] - r.py[i]) / STEP;
    }
    unseat(e);
    e.state = "held";
    e.vel[2] = 200 * L.u;
    e.auto = { x: target.x, y: target.y, jack: target };
    topOrder += 1;
    e.cable.order = topOrder;
    refreshColliders();
    updateChain(true);
    wake();
  }

  function toggleSound() {
    if (sound === "off") {
      audio.start();
      audio.setMuted(false);
      sound = "on";
    } else if (sound === "on") {
      audio.setMuted(true);
      sound = "muted";
    } else {
      audio.setMuted(false);
      audio.wake();
      sound = "on";
    }
    onSound?.(sound);
    wake();
  }

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const n = Number(ev.key);
    if (n >= 1 && n <= EFFECT_IDS.length) {
      ev.preventDefault();
      toggleEffect(EFFECT_IDS[n - 1]);
      return;
    }
    if (ev.key === "m" || ev.key === "M") {
      ev.preventDefault();
      toggleSound();
    }
  }

  function checkVisibility() {
    if (document.hidden || !visible) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      audio.sleep();
    } else {
      if (sound === "on") audio.wake();
      wake();
    }
  }

  const onLost = (ev) => ev.preventDefault();
  const onVisibility = () => checkVisibility();
  const onLeave = (ev) => {
    if (ev.pointerType === "mouse") {
      pointer.inside = false;
      if (stage.dataset.hover) stage.dataset.hover = "";
    }
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    checkVisibility();
  });
  io.observe(box);
  const ro = new ResizeObserver(() => {
    if (!L) return;
    pendingResize = true;
    if (raf) return;
    resize();
  });
  ro.observe(box);

  readFonts();
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fontsReady.then(() => {
    if (destroyed) return;
    readFonts();
    resize();
  });
  const onFonts = () => {
    if (!L || destroyed) return;
    paintPanel();
  };
  document.fonts?.addEventListener?.("loadingdone", onFonts);
  live.addEventListener("contextlost", onLost);

  return {
    toggleSound,
    toggleEffect,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      document.fonts?.removeEventListener?.("loadingdone", onFonts);
      live.removeEventListener("contextlost", onLost);
      io.disconnect();
      ro.disconnect();
      audio.destroy();
      for (const c of [panel, shade, live]) {
        c.width = 1;
        c.height = 1;
      }
    },
  };
}
