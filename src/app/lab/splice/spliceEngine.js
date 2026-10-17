import { createSpliceAudio, loadBeat, secondReel, waveRows } from "./spliceAudio";
import { createSpliceGL } from "./spliceGL";

const TH = 3.175;
const V0 = 95.25;
const HEAD_X = -94;
const BLOCK_X = 62;
const BLOCK_Y = 15;
const A0 = 2.0;
const B0 = -0.004;
const FULL = [-120, -50, 84, 49];
const TIGHT = [-108, -47, 70, 46];
const RAZOR_REST = [31, 33.5, 0.1];
const PENCIL_REST = [-80, 31, 0.06];
const B_REST = [24, -35.5];
const B_ANCHOR = [320, -76];
const CARD = [-38, -33];
const TAB_ROWS = [-6.2, 0, 6.2];
const TAB_HALF = [12, 2.8];
const PREROLL = 1.5;
const TAIL = 2.4;
const MAX_V = V0 * 4;
const MARK_MAX = 128;
const BINS = 24;
const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapPi = (a) => a - TAU * Math.round(a / TAU);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
const hashN = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function spring(x, v, target, omega, dt) {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  return [(f * x + dt * v + hhoo * target) * det, (v + hoo * (target - x)) * det];
}

function springAngle(a, v, target, omega, dt) {
  const t = a + wrapPi(target - a);
  return spring(a, v, t, omega, dt);
}

function defaultMarks() {
  const a = [
    [-23.55, -2.75, -24.05, 2.7],
    [-53.3, 1.75, -52.15, -1.75],
    [-52.15, -1.75, -50.95, 1.7],
    [-52.75, 0.45, -51.35, 0.42],
  ];
  const b = [
    [11.0, -1.75, 11.05, 1.75],
    [11.0, -1.75, 12.3, -1.65],
    [12.3, -1.65, 12.85, -1.15],
    [12.85, -1.15, 12.65, -0.35],
    [12.65, -0.35, 11.05, -0.05],
    [11.05, -0.05, 12.7, 0.08],
    [12.7, 0.08, 13.15, 0.75],
    [13.15, 0.75, 12.85, 1.5],
    [12.85, 1.5, 11.05, 1.75],
  ];
  return { a, b, strokes: [-23.8] };
}

export function createSpliceEngine({ box, stage, canvas, insets, embedded, onStage, onPlay, onSound, onReady, onFail, onAnnounce }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, scale: 1, cx: 0, cy: 0, rot: 0, quality: 1, bounds: [-120, -50, 84, 49] };
  const audio = createSpliceAudio();
  const marks = defaultMarks();
  const markData = new Float32Array(256 * 4);
  let marksDirty = true;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let readySent = false;
  let waveInfo = [5, A0, B0, 0];
  let soundState = "off";
  let userMuted = false;
  let stageShown = "";
  let playShown = false;
  let cursor = "";
  let jog = 0;
  let interval = 16;
  let slowFrames = 0;

  const S = {
    offA: 0,
    vA: 0,
    tau: 0.42,
    snap: null,
    vSnap: 0,
    cut: null,
    out: null,
    joined: false,
    gap: 0,
    glint: 1,
    fade: 1,
    fadeDir: 0,
    b: { x: B_REST[0], y: B_REST[1], th: 0, vx: 0, vy: 0, vth: 0, lift: 0, vlift: 0, seat: 0, vseat: 0, seated: false, mode: "rest", butted: false },
    tab: { mode: "card", idx: -1, x: 0, y: 0, th: 0, vx: 0, vy: 0, vth: 0, lift: 0, vlift: 0, s: 0, pressed: new Float32Array(BINS), bubbles: [], bonded: false, auto: -1 },
    tabs: [1, 1, 1],
    razor: { x: RAZOR_REST[0], y: RAZOR_REST[1], th: RAZOR_REST[2], fx: 0, fy: 0, fth: 0, vx: 0, vy: 0, vth: 0, press: 0, lift: 0, vlift: 0, mode: "rest", t: 0, align: 0, cutDone: false, slot: null },
    pencil: { x: PENCIL_REST[0], y: PENCIL_REST[1], th: PENCIL_REST[2], vx: 0, vy: 0, vth: 0, lift: 0, vlift: 0, mode: "rest", last: null, stroke: null, touch: false, lean: 0 },
    play: { mode: "idle", t: 0, from: 0, to: 0, dur: 0 },
  };
  S.b.th = Math.atan2(B_ANCHOR[1] - S.b.y, B_ANCHOR[0] - S.b.x);

  const ptr = { id: null, role: null, type: "mouse", cur: [0, 0], prev: null, vel: [0, 0], grab: null, moved: 0 };
  let hover = null;

  const frameData = {
    dpr: 1,
    view: new Float32Array(4),
    a: new Float32Array(4),
    b: new Float32Array(4),
    b2: new Float32Array(4),
    razor: new Float32Array(4),
    razor2: new Float32Array(4),
    pencil: new Float32Array(4),
    tab: new Float32Array(4),
    tab2: new Float32Array(4),
    press: new Float32Array(24),
    bubbles: new Float32Array(40),
    misc: new Float32Array(4),
    waveInfo: new Float32Array(4),
  };

  function setSound(next) {
    if (next === soundState) return;
    soundState = next;
    onSound(next);
  }

  function startAudio() {
    if (userMuted) return;
    if (!audio.started) {
      audio.start();
      setSound("on");
    } else audio.wake();
  }

  function toggleSound() {
    if (!audio.started) {
      userMuted = false;
      startAudio();
      wake();
      return;
    }
    userMuted = soundState === "on";
    audio.setMuted(userMuted);
    setSound(userMuted ? "muted" : "on");
    onAnnounce(userMuted ? "Sound off." : "Sound on.");
    wake();
  }

  function toWorld(sp) {
    return view.rot ? [sp[1], -sp[0]] : sp;
  }

  function toScreen(w) {
    return view.rot ? [-w[1], w[0]] : w;
  }

  function layout() {
    const pad = insets();
    const aw = Math.max(80, view.width - pad.left - pad.right);
    const ah = Math.max(80, view.height - pad.top - pad.bottom);
    view.rot = aw / ah < 0.9 ? 1 : 0;
    const turn = (f) => (view.rot ? [-f[3], f[0], -f[1], f[2]] : f);
    const fit = (f) => Math.min(aw / (f[2] - f[0]), ah / (f[3] - f[1]));
    const full = fit(turn(FULL));
    const tight = fit(turn(TIGHT));
    const useTight = Math.min(view.width, view.height) < 520 || full * 1.12 < tight;
    const frame = turn(useTight ? TIGHT : FULL);
    const scale = useTight ? tight : full;
    const fw = (frame[2] - frame[0]) * scale;
    const fh = (frame[3] - frame[1]) * scale;
    view.scale = scale;
    view.cx = pad.left + (aw - fw) / 2 - frame[0] * scale;
    view.cy = pad.top + (ah - fh) / 2 - frame[1] * scale;
    const corners = [
      [0, 0],
      [view.width, 0],
      [0, view.height],
      [view.width, view.height],
    ].map(([x, y]) => toWorld([(x - view.cx) / scale, (y - view.cy) / scale]));
    view.bounds = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2400000 / Math.max(1, view.width * view.height));
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    applyQuality(view.quality);
    wake();
  }

  function applyQuality(q) {
    view.quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function toMm(e) {
    const rect = box.getBoundingClientRect();
    return toWorld([(e.clientX - rect.left - view.cx) / view.scale, (e.clientY - rect.top - view.cy) / view.scale]);
  }

  function aEnd() {
    return S.cut === null ? Infinity : S.cut + S.offA;
  }

  function bAxis() {
    return [Math.cos(S.b.th), Math.sin(S.b.th)];
  }

  function bLocal(p) {
    const [dx, dy] = bAxis();
    const rx = p[0] - S.b.x;
    const ry = p[1] - S.b.y;
    return [rx * dx + ry * dy, -rx * dy + ry * dx];
  }

  function onA(p, slop) {
    if (Math.abs(p[1]) > TH + slop) return false;
    if (S.cut === null) return true;
    return p[0] - S.offA + p[1] < S.cut + slop;
  }

  function onOut(p, slop) {
    if (!S.out || Math.abs(p[1]) > TH + slop) return false;
    return p[0] - S.out.off + p[1] > S.cut - slop;
  }

  function onB(p, slop) {
    const [s, v] = bLocal(p);
    return Math.abs(v) < TH + slop && s + v > -slop;
  }

  function tabWorld() {
    if (S.tab.mode === "laid") return [S.tab.s + S.offA, 0];
    return [S.tab.x, S.tab.y];
  }

  function onLaidTab(p, slop) {
    if (S.tab.mode !== "laid") return false;
    const [tx] = tabWorld();
    return Math.abs(p[0] - tx) < TAB_HALF[0] + slop && Math.abs(p[1]) < TAB_HALF[1] + slop + 0.6;
  }

  function cardTabAt(p, slop) {
    let best = -1;
    let bestD = Infinity;
    TAB_ROWS.forEach((row, i) => {
      if (!S.tabs[i]) return;
      const dx = Math.abs(p[0] - CARD[0]) - TAB_HALF[0];
      const dy = Math.abs(p[1] - (CARD[1] + row)) - TAB_HALF[1];
      const d = Math.max(dx, dy);
      if (d < Math.min(slop, 0.4) + (slop > 1 ? 0.6 : 0) && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function razorLocal(p) {
    const r = S.razor;
    const c = Math.cos(r.th);
    const s = Math.sin(r.th);
    const rx = p[0] - r.x;
    const ry = p[1] - r.y;
    return [rx * c + ry * s, -rx * s + ry * c];
  }

  function onRazor(p, slop) {
    const [u, v] = razorLocal(p);
    return Math.abs(u) < 19 + slop && Math.abs(v) < 9.5 + slop;
  }

  function onPencil(p, slop) {
    const pc = S.pencil;
    const a = [Math.cos(pc.th), Math.sin(pc.th)];
    const rx = p[0] - pc.x;
    const ry = p[1] - pc.y;
    const u = rx * a[0] + ry * a[1];
    const w = -rx * a[1] + ry * a[0];
    return u > -1 - slop && u < 78 + slop && Math.abs(w) < 4 + slop;
  }

  function busyFade() {
    return S.fadeDir !== 0;
  }

  function roleAt(p, touch) {
    const slop = touch ? 3.2 : 0.8;
    if (busyFade()) return null;
    if (S.razor.mode !== "press" && onRazor(p, slop)) return "razor";
    if (S.pencil.mode === "rest" || S.pencil.mode === "home") {
      if (onPencil(p, slop)) return "pencil";
    }
    if (S.tab.mode === "card" && cardTabAt(p, slop) >= 0) return "tab";
    if (onLaidTab(p, slop)) return S.tab.bonded ? "A" : "burnish";
    if (S.b.mode !== "home" && onB(p, slop)) return S.joined ? "A" : "B";
    if (onA(p, slop)) return "A";
    return null;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (ptr.id !== null) return;
    const p = toMm(e);
    const touch = e.pointerType !== "mouse";
    startAudio();
    let role = null;
    if (S.pencil.mode === "held" || S.pencil.mode === "carry") {
      S.pencil.lean = touch && tapeAt(pencilTarget(p, true)) ? 1 : 0;
      if (tapeAt(touch ? pencilTarget(p, S.pencil.lean > 0) : p)) role = "draw";
      else if (onRazor(p, touch ? 3.2 : 0.8) || roleAt(p, touch) === "tab") {
        pencilHome();
        role = roleAt(p, touch);
      } else {
        pencilHome();
        e.preventDefault();
        wake();
        return;
      }
    } else role = roleAt(p, touch);
    if (!role) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture?.(e.pointerId);
    ptr.id = e.pointerId;
    ptr.role = role;
    ptr.type = e.pointerType;
    ptr.cur = p;
    ptr.prev = p;
    ptr.vel = [0, 0];
    ptr.moved = 0;
    grab(role, p, touch);
    setCursor(role === "draw" ? "none" : "grabbing");
    wake();
  }

  function grab(role, p, touch) {
    if (S.play.mode !== "idle" && S.play.mode !== "motor" && (role === "A" || role === "B")) setPlay("idle");
    if (role === "A") {
      ptr.grab = { x: p[0], off: S.offA };
      S.snap = null;
      S.vA = 0;
    } else if (role === "B") {
      const b = S.b;
      if (b.seated) {
        b.mode = "slide";
        ptr.grab = { x: p[0], y: p[1], bx: b.x };
      } else {
        b.mode = "drag";
        ptr.grab = { dx: p[0] - b.x, dy: p[1] - b.y };
      }
      b.vx = 0;
      b.vy = 0;
      b.butted = false;
    } else if (role === "razor") {
      const r = S.razor;
      r.mode = "drag";
      r.fx = r.x;
      r.fy = r.y;
      r.fth = r.th;
      r.press = 0;
      ptr.grab = { dx: p[0] - r.x, dy: p[1] - r.y };
      if (S.pencil.mode === "held") pencilHome();
    } else if (role === "pencil") {
      S.pencil.mode = "carry";
      S.pencil.touch = touch;
    } else if (role === "draw") {
      S.pencil.mode = "draw";
      S.pencil.touch = touch && S.pencil.lean > 0;
      const tip = pencilTarget(p, S.pencil.touch);
      S.pencil.x = tip[0];
      S.pencil.y = tip[1];
      S.pencil.last = null;
      S.pencil.stroke = { id: null, sum: 0, n: 0, min: Infinity, max: -Infinity };
      drawAt(tip, true);
    } else if (role === "tab") {
      const i = cardTabAt(p, touch ? 3.2 : 0.8);
      const t = S.tab;
      S.tabs[i] = 0;
      t.idx = i;
      t.mode = "carry";
      t.x = CARD[0];
      t.y = CARD[1] + TAB_ROWS[i];
      t.th = 0;
      t.vx = 0;
      t.vy = 0;
      ptr.grab = { dx: p[0] - t.x, dy: p[1] - t.y };
    } else if (role === "burnish") {
      S.tab.auto = -1;
    }
  }

  function onMove(e) {
    const p = toMm(e);
    if (e.pointerId !== ptr.id) {
      if (e.pointerType !== "mouse") return;
      hover = p;
      if (S.pencil.mode === "held") {
        setCursor("none");
        wake();
        return;
      }
      const role = roleAt(p, false);
      setCursor(role ? "grab" : "");
      return;
    }
    ptr.cur = p;
    hover = e.pointerType === "mouse" ? p : null;
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== ptr.id) return;
    const role = ptr.role;
    ptr.id = null;
    ptr.role = null;
    release(role);
    setCursor(S.pencil.mode === "held" && e.pointerType === "mouse" ? "none" : role === "draw" ? "" : "grab");
    wake();
  }

  function release(role) {
    if (role === "A") {
      S.vA = clamp(S.vA, -MAX_V, MAX_V);
      S.tau = 0.42;
      if (Math.abs(S.vA) < 70 && S.cut === null) {
        const near = nearestMark();
        if (near !== null && Math.abs(near) < 2.6) {
          S.snap = S.offA - near;
          S.vSnap = S.vA;
          S.vA = 0;
        }
      }
    } else if (role === "B") releaseB();
    else if (role === "razor") releaseRazor();
    else if (role === "pencil") {
      S.pencil.mode = "held";
    } else if (role === "draw") {
      S.pencil.mode = "held";
      endStroke();
    } else if (role === "tab") releaseTab();
  }

  function nearestMark() {
    let best = null;
    for (const s of marks.strokes) {
      const x = s + S.offA;
      if (best === null || Math.abs(x) < Math.abs(best)) best = x;
    }
    return best;
  }

  function setCursor(next) {
    if (next === cursor) return;
    cursor = next;
    stage.style.cursor = next;
  }

  function canSeat(x, y) {
    if (S.cut === null || S.out || S.joined) return 0;
    if (x < HEAD_X + 20 || x > BLOCK_X + 16) return 0;
    return smooth(11, 3, Math.abs(y));
  }

  function releaseB() {
    const b = S.b;
    if (b.mode === "slide") {
      b.mode = "rest";
      b.vx = clamp(ptr.vel[0], -MAX_V, MAX_V);
      return;
    }
    const w = canSeat(b.x, b.y);
    if (w > 0.25) {
      b.mode = "seat";
      b.seated = true;
      b.x = Math.max(b.x, aEnd());
      b.vx = 0;
      onAnnounce("Reel B lies in the channel.");
      return;
    }
    const overBlock = Math.abs(b.y) < BLOCK_Y + 5 && b.x > HEAD_X - 16 && b.x < BLOCK_X + 6;
    if (overBlock) b.mode = "home";
    else {
      b.mode = "rest";
      b.vx = clamp(ptr.vel[0], -400, 400);
      b.vy = clamp(ptr.vel[1], -400, 400);
    }
  }

  function canCut() {
    return S.cut === null && Math.abs(S.vA) < 1 && S.play.mode !== "spool" && S.play.mode !== "roll";
  }

  function slotPose(fx, fy, fth) {
    const thS = Math.abs(wrapPi(fth + Math.PI / 4)) < Math.abs(wrapPi(fth - (3 * Math.PI) / 4)) ? -Math.PI / 4 : (3 * Math.PI) / 4;
    const vx = -Math.sin(fth);
    const vy = Math.cos(fth);
    const ex = fx + vx * 9.5;
    const ey = fy + vy * 9.5;
    const ux = Math.cos(thS);
    const uy = Math.sin(thS);
    const along = clamp(ex * ux + ey * uy, -5, 5);
    const nvx = -Math.sin(thS);
    const nvy = Math.cos(thS);
    const dn = Math.abs(ex + ey) * Math.SQRT1_2;
    const da = Math.max(0, Math.abs(ex - ey) * Math.SQRT1_2 - 7);
    return { x: ux * along - nvx * 9.5, y: uy * along - nvy * 9.5, th: thS, d: Math.hypot(dn, da) };
  }

  function releaseRazor() {
    const r = S.razor;
    if (r.align > 0.5 && canCut()) {
      r.mode = "press";
      r.t = 0;
      r.cutDone = false;
      r.slot = slotPose(r.fx, r.fy, r.fth);
      return;
    }
    r.mode = "slide";
    r.vx = clamp(ptr.vel[0], -500, 500);
    r.vy = clamp(ptr.vel[1], -500, 500);
  }

  function releaseTab() {
    const t = S.tab;
    if (S.cut !== null && S.b.seated && S.b.mode !== "seat" && !S.joined) {
      const jx = aEnd();
      if (Math.abs(t.x - jx) < 17 && Math.abs(t.y) < 10) {
        layTab();
        return;
      }
    }
    t.mode = "home";
  }

  function layTab() {
    const t = S.tab;
    if (S.b.x - aEnd() > 0.01) S.b.mode = "auto";
    t.mode = "lay";
    t.auto = -1;
  }

  function pencilHeldAngle() {
    const a = 0.92;
    const d = toWorld([Math.cos(a), Math.sin(a)]);
    return Math.atan2(d[1], d[0]);
  }

  function pencilTarget(p, touch) {
    if (!touch) return p;
    const o = toWorld([-10 / view.scale, -20 / view.scale]);
    return [p[0] + o[0], p[1] + o[1]];
  }

  function pencilHome() {
    const pc = S.pencil;
    if (pc.mode === "draw") endStroke();
    pc.mode = "home";
    setCursor("");
  }

  function tapeAt(p) {
    if (S.b.mode !== "home" && onB(p, 0)) {
      const [s, v] = bLocal(p);
      return { id: "b", s, v };
    }
    if (S.tab.mode === "laid" && onLaidTab(p, 0)) return null;
    if (onOut(p, 0)) return { id: "a", s: p[0] - S.out.off, v: p[1] };
    if (onA(p, 0)) return { id: "a", s: p[0] - S.offA, v: p[1] };
    return null;
  }

  function pushMark(id, seg) {
    const list = id === "a" ? marks.a : marks.b;
    list.push(seg);
    if (list.length > MARK_MAX) list.shift();
    marksDirty = true;
  }

  function drawAt(tip, first) {
    const pc = S.pencil;
    const hit = tapeAt(tip);
    if (!hit) {
      pc.last = null;
      return;
    }
    const st = pc.stroke;
    if (st && st.id === null) st.id = hit.id;
    if (st && st.id === hit.id && hit.id === "a") {
      st.sum += hit.s;
      st.n += 1;
      st.min = Math.min(st.min, hit.s);
      st.max = Math.max(st.max, hit.s);
    }
    if (first || !pc.last || pc.last.id !== hit.id) {
      pushMark(hit.id, [hit.s, hit.v, hit.s + 0.01, hit.v]);
      pc.last = hit;
      return;
    }
    const d = Math.hypot(hit.s - pc.last.s, hit.v - pc.last.v);
    if (d > 0.3) {
      pushMark(hit.id, [pc.last.s, pc.last.v, hit.s, hit.v]);
      pc.last = hit;
    }
  }

  function endStroke() {
    const st = S.pencil.stroke;
    if (st && st.id === "a" && st.n > 0 && st.max - st.min < 6) {
      marks.strokes.push(st.sum / st.n);
      if (marks.strokes.length > 24) marks.strokes.shift();
    }
    S.pencil.stroke = null;
    S.pencil.last = null;
  }

  function markAtHead() {
    const s = HEAD_X - S.offA;
    if (S.cut !== null && s + 3 > S.cut) return;
    pushMark("a", [s + 0.25, -2.7, s - 0.25, 2.7]);
    marks.strokes.push(s);
    onAnnounce("Marked at the head.");
  }

  function doCut() {
    S.cut = -S.offA;
    S.out = { off: S.offA, v: 0, t: 0 };
    S.vA = 0;
    S.snap = null;
    S.glint = 0;
    audio.shot("snick");
    onAnnounce("Cut. The offcut winds away.");
  }

  function setPlay(mode) {
    S.play.mode = mode;
    S.play.t = 0;
    const playing = mode !== "idle";
    if (playing !== playShown) {
      playShown = playing;
      onPlay(playing);
    }
  }

  function togglePlay() {
    startAudio();
    if (S.play.mode !== "idle") {
      setPlay("idle");
      S.tau = 0.12;
      onAnnounce("Stopped.");
      wake();
      return;
    }
    S.snap = null;
    if (S.joined) {
      const jx = aEnd();
      const target = HEAD_X + PREROLL * V0;
      const d = target - jx;
      setPlay("spool");
      S.play.from = S.offA;
      S.play.to = S.offA + d;
      S.play.dur = reduced ? 0.01 : clamp(0.38 + Math.abs(d) / 650, 0.38, 1.1);
      onAnnounce("Playing the edit.");
    } else {
      setPlay("motor");
      onAnnounce("Playing.");
    }
    wake();
  }

  function nextStep() {
    startAudio();
    if (busyFade()) return;
    const r = S.razor;
    if (S.cut === null) {
      if (r.mode === "press" || r.mode === "auto") return;
      if (S.play.mode !== "idle") setPlay("idle");
      S.vA = 0;
      r.mode = "auto";
      r.fx = r.x;
      r.fy = r.y;
      r.fth = r.th;
      return;
    }
    if (S.out) return;
    const b = S.b;
    if (!b.seated) {
      b.mode = "auto";
      b.seated = true;
      return;
    }
    if (!S.joined && S.tab.mode !== "lay") {
      if (b.x - aEnd() > 0.05) {
        b.mode = "auto";
        return;
      }
      const i = S.tabs.findIndex((x) => x);
      if (i < 0 || S.tab.mode !== "card") return;
      const t = S.tab;
      S.tabs[i] = 0;
      t.idx = i;
      t.x = CARD[0];
      t.y = CARD[1] + TAB_ROWS[i];
      t.th = 0;
      t.mode = "fly";
      return;
    }
    if (S.joined && !S.tab.bonded) {
      if (S.tab.auto < 0) S.tab.auto = 0;
      return;
    }
    if (S.tab.bonded) togglePlay();
  }

  function newTape() {
    if (busyFade()) return;
    startAudio();
    S.fadeDir = -1;
    setPlay("idle");
    onAnnounce("Fresh tape.");
    wake();
  }

  function resetState() {
    S.offA = 0;
    S.vA = 0;
    S.snap = null;
    S.cut = null;
    S.out = null;
    S.joined = false;
    S.gap = 0;
    S.glint = 1;
    const b = S.b;
    Object.assign(b, { x: B_REST[0], y: B_REST[1], vx: 0, vy: 0, vth: 0, lift: 0, vlift: 0, seat: 0, vseat: 0, seated: false, mode: "rest", butted: false });
    b.th = Math.atan2(B_ANCHOR[1] - b.y, B_ANCHOR[0] - b.x);
    const t = S.tab;
    Object.assign(t, { mode: "card", idx: -1, lift: 0, vlift: 0, bonded: false, auto: -1, bubbles: [] });
    t.pressed.fill(0);
    S.tabs = [1, 1, 1];
    const fresh = defaultMarks();
    marks.a = fresh.a;
    marks.b = fresh.b;
    marks.strokes = fresh.strokes;
    marksDirty = true;
    if (S.razor.mode !== "rest") S.razor.mode = "home";
    if (S.pencil.mode !== "rest") pencilHome();
  }

  function onKey(e) {
    if (e.target !== stage) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) togglePlay();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat) nextStep();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      startAudio();
      const forward = view.rot ? e.key === "ArrowUp" || e.key === "ArrowRight" : e.key === "ArrowRight" || e.key === "ArrowUp";
      jog = (forward ? 1 : -1) * (e.shiftKey ? 1.6 : 0.5);
      S.snap = null;
      if (S.play.mode !== "motor") setPlay("idle");
    } else if (e.key === "m" || e.key === "M") {
      markAtHead();
    } else if (e.key === "r" || e.key === "R") {
      if (!e.metaKey && !e.ctrlKey) newTape();
    } else if (e.key === "s" || e.key === "S") {
      toggleSound();
    } else if (e.key === "Escape") {
      if (S.pencil.mode === "held") pencilHome();
    } else return;
    wake();
  }

  function onKeyUp(e) {
    if (e.key.startsWith("Arrow") && jog) {
      jog = 0;
      S.tau = 0.2;
      wake();
    }
  }

  function updatePointer(dt) {
    if (ptr.id === null) return;
    const dx = ptr.cur[0] - ptr.prev[0];
    const dy = ptr.cur[1] - ptr.prev[1];
    const k = 1 - Math.exp(-dt / 0.045);
    ptr.vel[0] += (dx / dt - ptr.vel[0]) * k;
    ptr.vel[1] += (dy / dt - ptr.vel[1]) * k;
    ptr.moved += Math.hypot(dx, dy);
    ptr.prev = ptr.cur;
  }

  function updateA(dt) {
    const before = S.offA;
    const pm = S.play.mode;
    if (ptr.role === "A") {
      S.offA = ptr.grab.off + (ptr.cur[0] - ptr.grab.x);
    } else if (pm === "spool") {
      S.play.t += dt;
      const k = minJerk(clamp(S.play.t / S.play.dur, 0, 1));
      S.offA = S.play.from + (S.play.to - S.play.from) * k;
      if (S.play.t >= S.play.dur) {
        setPlay("wait");
      }
    } else if (jog) {
      S.vA += (-jog * V0 - S.vA) * (1 - Math.exp(-dt / 0.08));
      S.offA += S.vA * dt;
    } else if (S.snap !== null) {
      const [x, v] = spring(S.offA, S.vSnap, S.snap, reduced ? 60 : 22, dt);
      S.offA = x;
      S.vSnap = v;
      if (Math.abs(S.offA - S.snap) < 0.005 && Math.abs(v) < 0.05) {
        S.offA = S.snap;
        S.snap = null;
        S.vSnap = 0;
      }
    } else {
      if (pm === "motor" || pm === "roll") S.vA += (-V0 - S.vA) * (1 - Math.exp(-dt / 0.13));
      else if (pm === "wait") {
        S.vA = 0;
        S.play.t += dt;
        if (S.play.t > 0.16) setPlay("roll");
      } else {
        S.vA *= Math.exp(-dt / S.tau);
        if (Math.abs(S.vA) < 0.3) S.vA = 0;
      }
      S.offA += S.vA * dt;
    }
    if (pm === "roll" && S.joined && aEnd() < HEAD_X - TAIL * V0) {
      setPlay("idle");
      S.tau = 0.14;
    }
    if (S.cut !== null && !S.joined) {
      const end = aEnd();
      if (S.b.seated && S.b.mode !== "auto" && S.b.x < end) {
        S.b.x = end;
        S.b.vx = Math.max(S.b.vx, S.vA);
      }
      if (S.out && end > S.cut + S.out.off) S.out.off = end - S.cut;
    }
    if (S.joined) S.b.x = aEnd() + S.gap;
    if (ptr.role === "A" || pm === "spool" || S.snap !== null) {
      const inst = (S.offA - before) / dt;
      S.vA += (inst - S.vA) * (ptr.role === "A" ? 1 - Math.exp(-dt / 0.04) : 1);
    }
  }

  function updateOut(dt) {
    const o = S.out;
    if (!o) return;
    o.t += dt;
    if (o.t > (reduced ? 0.05 : 0.32)) {
      o.v = Math.min(o.v + 1700 * dt, 1100);
      o.off += o.v * dt;
    }
    if (S.cut + o.off - TH > view.bounds[2] + 8) {
      S.out = null;
      onAnnounce("Lay reel B into the channel.");
    }
  }

  function updateB(dt) {
    const b = S.b;
    const anchorTh = Math.atan2(B_ANCHOR[1] - b.y, B_ANCHOR[0] - b.x);
    let thT = anchorTh;
    let liftT = 0;
    let seatT = b.seated ? 1 : 0;
    if (b.mode === "drag") {
      const tx = clamp(ptr.cur[0] - ptr.grab.dx, view.bounds[0] - 10, view.bounds[2] + 20);
      const ty = clamp(ptr.cur[1] - ptr.grab.dy, view.bounds[1] - 10, view.bounds[3] - 4);
      b.x = tx;
      b.y = ty;
      const w = canSeat(b.x, b.y);
      thT = anchorTh + wrapPi(0 - anchorTh) * w;
      liftT = 1 - 0.5 * w;
    } else if (b.mode === "slide") {
      let nx = ptr.grab.bx + (ptr.cur[0] - ptr.grab.x);
      nx = Math.max(nx, aEnd());
      b.x = nx;
      thT = 0;
      liftT = 0.12;
      if (Math.abs(ptr.cur[1] - ptr.grab.y) > 7 && !S.joined) {
        b.seated = false;
        b.mode = "drag";
        ptr.grab = { dx: ptr.cur[0] - b.x, dy: ptr.cur[1] - b.y };
        b.butted = false;
      }
      if (b.x - aEnd() < 0.02 && !b.butted) {
        b.butted = true;
        audio.shot("tick");
      }
      if (b.x - aEnd() > 0.3) b.butted = false;
    } else if (b.mode === "seat" || b.mode === "auto") {
      const tx = b.mode === "auto" ? aEnd() : Math.max(b.x, aEnd());
      const om = reduced ? 80 : b.mode === "auto" ? 7 : 16;
      [b.x, b.vx] = spring(b.x, b.vx, tx, om, dt);
      [b.y, b.vy] = spring(b.y, b.vy, 0, om, dt);
      thT = 0;
      liftT = b.mode === "auto" ? clamp(Math.hypot(b.x - tx, b.y) / 12, 0, 1) : 0;
      if (Math.abs(b.y) < 0.02 && Math.abs(b.x - tx) < 0.05 && Math.abs(b.vy) < 0.1) {
        b.y = 0;
        b.x = tx;
        b.vy = 0;
        b.vx = 0;
        if (b.mode === "auto" && !b.butted) {
          b.butted = true;
          audio.shot("tick");
        }
        b.mode = "rest";
      }
    } else if (b.mode === "home") {
      const om = reduced ? 80 : 7;
      [b.x, b.vx] = spring(b.x, b.vx, B_REST[0], om, dt);
      [b.y, b.vy] = spring(b.y, b.vy, B_REST[1], om, dt);
      liftT = clamp(Math.hypot(b.x - B_REST[0], b.y - B_REST[1]) / 20, 0, 0.8);
      if (Math.hypot(b.x - B_REST[0], b.y - B_REST[1]) < 0.02) {
        b.x = B_REST[0];
        b.y = B_REST[1];
        b.mode = "rest";
      }
    } else if (b.seated) {
      thT = 0;
      if (!S.joined) {
        const gap = b.x - aEnd();
        if (gap < 4 && gap > 0.001) {
          [b.x, b.vx] = spring(b.x, b.vx, aEnd(), reduced ? 80 : 26, dt);
          if (b.x - aEnd() < 0.02) {
            b.x = aEnd();
            b.vx = 0;
            if (!b.butted) {
              b.butted = true;
              audio.shot("tick");
              onAnnounce("Butted.");
            }
          }
        } else {
          b.vx *= Math.exp(-dt / 0.18);
          if (Math.abs(b.vx) < 0.3) b.vx = 0;
          b.x = Math.max(aEnd(), b.x + b.vx * dt);
        }
      }
      b.y = 0;
    } else {
      b.vx *= Math.exp(-dt / 0.1);
      b.vy *= Math.exp(-dt / 0.1);
      if (Math.hypot(b.vx, b.vy) < 0.3) {
        b.vx = 0;
        b.vy = 0;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    const om = reduced ? 80 : b.mode === "drag" ? 14 : 12;
    [b.th, b.vth] = springAngle(b.th, b.vth, thT, om, dt);
    [b.lift, b.vlift] = spring(b.lift, b.vlift, liftT, reduced ? 80 : 18, dt);
    [b.seat, b.vseat] = spring(b.seat, b.vseat, seatT, reduced ? 80 : 14, dt);
  }

  function updateRazor(dt) {
    const r = S.razor;
    const om = reduced ? 80 : 9;
    if (r.mode === "drag") {
      r.fx = ptr.cur[0] - ptr.grab.dx;
      r.fy = ptr.cur[1] - ptr.grab.dy;
      const pose = slotPose(r.fx, r.fy, r.fth);
      const target = canCut() ? smooth(15, 5, pose.d) : 0;
      r.align += (target - r.align) * (1 - Math.exp(-dt / 0.05));
      const e = r.align * r.align * (3 - 2 * r.align);
      r.x = r.fx + (pose.x - r.fx) * e;
      r.y = r.fy + (pose.y - r.fy) * e;
      r.th = r.fth + wrapPi(pose.th - r.fth) * e;
      [r.lift, r.vlift] = spring(r.lift, r.vlift, 1 - 0.45 * e, 24, dt);
    } else if (r.mode === "auto") {
      const target = { x: -9.5 * Math.SQRT1_2, y: -9.5 * Math.SQRT1_2, th: -Math.PI / 4 };
      [r.x, r.vx] = spring(r.x, r.vx, target.x, reduced ? 80 : 8, dt);
      [r.y, r.vy] = spring(r.y, r.vy, target.y, reduced ? 80 : 8, dt);
      [r.th, r.vth] = springAngle(r.th, r.vth, target.th, reduced ? 80 : 8, dt);
      [r.lift, r.vlift] = spring(r.lift, r.vlift, 0.6, 18, dt);
      if (Math.hypot(r.x - target.x, r.y - target.y) < 0.08 && Math.abs(wrapPi(r.th - target.th)) < 0.004) {
        r.mode = "press";
        r.t = 0;
        r.cutDone = false;
        r.slot = target;
      }
    } else if (r.mode === "press") {
      r.t += dt;
      const s = r.slot;
      const k = 1 - Math.exp(-dt / 0.04);
      r.x += (s.x - r.x) * k;
      r.y += (s.y - r.y) * k;
      r.th += wrapPi(s.th - r.th) * k;
      const t = r.t;
      const down = 0.17;
      const hold = 0.34;
      const up = 0.56;
      if (t < down) r.press = Math.pow(t / down, 1.6);
      else if (t < hold) r.press = 1;
      else r.press = 1 - minJerk(clamp((t - hold) / (up - hold), 0, 1));
      r.lift = t < hold ? 0.55 * (1 - r.press) : 0.55 * (1 - r.press);
      if (t >= down && !r.cutDone) {
        r.cutDone = true;
        if (canCut()) doCut();
      }
      if (t >= up) {
        r.press = 0;
        r.mode = "home";
        r.vx = 0;
        r.vy = 0;
        r.vth = 0;
      }
    } else if (r.mode === "home") {
      [r.x, r.vx] = spring(r.x, r.vx, RAZOR_REST[0], om, dt);
      [r.y, r.vy] = spring(r.y, r.vy, RAZOR_REST[1], om, dt);
      [r.th, r.vth] = springAngle(r.th, r.vth, RAZOR_REST[2], om, dt);
      const dist = Math.hypot(r.x - RAZOR_REST[0], r.y - RAZOR_REST[1]);
      [r.lift, r.vlift] = spring(r.lift, r.vlift, clamp(dist / 22, 0, 0.7), 16, dt);
      r.align = 0;
      if (dist < 0.02 && Math.abs(wrapPi(r.th - RAZOR_REST[2])) < 0.001 && r.lift < 0.01) {
        r.x = RAZOR_REST[0];
        r.y = RAZOR_REST[1];
        r.th = RAZOR_REST[2];
        r.lift = 0;
        r.mode = "rest";
      }
    } else if (r.mode === "slide") {
      r.vx *= Math.exp(-dt / 0.11);
      r.vy *= Math.exp(-dt / 0.11);
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.x = clamp(r.x, view.bounds[0] + 12, view.bounds[2] - 12);
      r.y = clamp(r.y, view.bounds[1] + 8, view.bounds[3] - 8);
      r.align *= Math.exp(-dt / 0.05);
      [r.lift, r.vlift] = spring(r.lift, r.vlift, 0, 22, dt);
      if (Math.hypot(r.vx, r.vy) < 0.5 && r.lift < 0.01) {
        r.lift = 0;
        const overBlock = Math.abs(r.y) < BLOCK_Y + 11 && r.x > HEAD_X - 34 && r.x < BLOCK_X + 20;
        r.mode = overBlock ? "home" : "rest";
      }
    }
  }

  function updatePencil(dt) {
    const pc = S.pencil;
    const om = reduced ? 80 : 9;
    if (pc.mode === "carry" || pc.mode === "held") {
      const src = pc.mode === "carry" ? ptr.cur : hover;
      if (src) {
        const tgt = pencilTarget(src, pc.touch);
        [pc.x, pc.vx] = spring(pc.x, pc.vx, tgt[0], reduced ? 90 : 34, dt);
        [pc.y, pc.vy] = spring(pc.y, pc.vy, tgt[1], reduced ? 90 : 34, dt);
      }
      [pc.th, pc.vth] = springAngle(pc.th, pc.vth, pencilHeldAngle(), reduced ? 80 : 14, dt);
      [pc.lift, pc.vlift] = spring(pc.lift, pc.vlift, pc.mode === "carry" ? 1 : 0.7, 20, dt);
    } else if (pc.mode === "draw") {
      const tgt = pencilTarget(ptr.cur, pc.touch);
      pc.x = tgt[0];
      pc.y = tgt[1];
      pc.vx = 0;
      pc.vy = 0;
      [pc.th, pc.vth] = springAngle(pc.th, pc.vth, pencilHeldAngle(), 14, dt);
      [pc.lift, pc.vlift] = spring(pc.lift, pc.vlift, 0.06, 40, dt);
      drawAt([pc.x, pc.y], false);
    } else if (pc.mode === "home") {
      [pc.x, pc.vx] = spring(pc.x, pc.vx, PENCIL_REST[0], om, dt);
      [pc.y, pc.vy] = spring(pc.y, pc.vy, PENCIL_REST[1], om, dt);
      [pc.th, pc.vth] = springAngle(pc.th, pc.vth, PENCIL_REST[2], om, dt);
      const dist = Math.hypot(pc.x - PENCIL_REST[0], pc.y - PENCIL_REST[1]);
      [pc.lift, pc.vlift] = spring(pc.lift, pc.vlift, clamp(dist / 25, 0, 0.7), 16, dt);
      if (dist < 0.02 && Math.abs(wrapPi(pc.th - PENCIL_REST[2])) < 0.001 && pc.lift < 0.01) {
        pc.x = PENCIL_REST[0];
        pc.y = PENCIL_REST[1];
        pc.th = PENCIL_REST[2];
        pc.lift = 0;
        pc.mode = "rest";
      }
    }
  }

  function seedBubbles() {
    const list = [];
    for (let i = 0; i < 9; i++) {
      const u = -10 + 20 * ((i + 0.5) / 9) + (hashN(i * 3.1) - 0.5) * 1.6;
      const v = (hashN(i * 7.7 + 1) - 0.5) * 3.0;
      const r = 0.55 + 0.7 * hashN(i * 1.9 + 4);
      list.push({ u, v, r, a: 1 });
    }
    return list;
  }

  function burnish(u, v, du, dt) {
    const t = S.tab;
    if (Math.abs(v) > TAB_HALF[1] + 3) return;
    const reach = 2.6;
    for (let i = 0; i < BINS; i++) {
      const ui = -TAB_HALF[0] + (2 * TAB_HALF[0] * i) / (BINS - 1);
      const w = Math.exp(-(((ui - u) / reach) ** 2));
      t.pressed[i] = Math.min(1, t.pressed[i] + w * dt * 6.5);
    }
    for (const b of t.bubbles) {
      if (b.a <= 0) continue;
      const dx = b.u - u;
      const dy = b.v - v;
      const dist = Math.hypot(dx, dy);
      const zone = b.r + reach;
      if (dist < zone) {
        const push = (1 - dist / zone) * 42 + Math.abs(du) * 0.9;
        const dirU = Math.abs(dx) > 0.05 ? Math.sign(dx) : Math.sign(du || 1);
        b.u += dirU * push * dt;
        b.v += (dist > 0.05 ? dy / dist : 0) * push * dt * 0.35;
        b.r *= Math.exp(-dt * 0.6);
      }
    }
  }

  function updateTab(dt) {
    const t = S.tab;
    if (t.mode === "carry") {
      const tx = ptr.cur[0] - ptr.grab.dx;
      const ty = ptr.cur[1] - ptr.grab.dy;
      [t.x, t.vx] = spring(t.x, t.vx, tx, reduced ? 90 : 40, dt);
      [t.y, t.vy] = spring(t.y, t.vy, ty, reduced ? 90 : 40, dt);
      let thT = 0;
      if (S.b.seated && S.cut !== null) thT = 0;
      [t.th, t.vth] = springAngle(t.th, t.vth, thT + clamp(t.vx * 0.0006, -0.12, 0.12), 14, dt);
      [t.lift, t.vlift] = spring(t.lift, t.vlift, 1, 22, dt);
    } else if (t.mode === "fly") {
      const jx = aEnd();
      [t.x, t.vx] = spring(t.x, t.vx, jx, reduced ? 80 : 8, dt);
      [t.y, t.vy] = spring(t.y, t.vy, 0, reduced ? 80 : 8, dt);
      [t.th, t.vth] = springAngle(t.th, t.vth, 0, 10, dt);
      [t.lift, t.vlift] = spring(t.lift, t.vlift, clamp(Math.hypot(t.x - jx, t.y) / 10, 0, 1), 18, dt);
      if (Math.hypot(t.x - jx, t.y) < 1.2) layTab();
    } else if (t.mode === "lay") {
      const jx = aEnd();
      const om = reduced ? 90 : 20;
      [t.x, t.vx] = spring(t.x, t.vx, jx, om, dt);
      [t.y, t.vy] = spring(t.y, t.vy, 0, om, dt);
      [t.th, t.vth] = springAngle(t.th, t.vth, 0, om, dt);
      [t.lift, t.vlift] = spring(t.lift, t.vlift, 0, om, dt);
      if (Math.abs(t.x - jx) < 0.03 && Math.abs(t.y) < 0.03 && t.lift < 0.012 && S.b.mode !== "auto" && S.b.x - jx < 0.03) {
        t.mode = "laid";
        t.lift = 0;
        t.s = jx - S.offA;
        S.joined = true;
        S.gap = S.b.x - aEnd();
        for (let i = 0; i < BINS; i++) t.pressed[i] = 0.12 + 0.2 * hashN(i * 5.3 + 2);
        t.bubbles = seedBubbles();
        t.bonded = false;
        audio.shot("press");
        onAnnounce("Tab laid over the joint. Rub it down.");
      }
    } else if (t.mode === "home") {
      const hx = CARD[0];
      const hy = CARD[1] + TAB_ROWS[t.idx];
      const om = reduced ? 90 : 9;
      [t.x, t.vx] = spring(t.x, t.vx, hx, om, dt);
      [t.y, t.vy] = spring(t.y, t.vy, hy, om, dt);
      [t.th, t.vth] = springAngle(t.th, t.vth, 0, om, dt);
      const dist = Math.hypot(t.x - hx, t.y - hy);
      [t.lift, t.vlift] = spring(t.lift, t.vlift, clamp(dist / 14, 0, 0.8), 16, dt);
      if (dist < 0.03 && t.lift < 0.012) {
        S.tabs[t.idx] = 1;
        t.mode = "card";
        t.lift = 0;
      }
    } else if (t.mode === "laid" && !t.bonded) {
      const tx = t.s + S.offA;
      if (ptr.role === "burnish") {
        burnish(ptr.cur[0] - tx, ptr.cur[1], ptr.vel[0], dt);
      } else if (t.auto >= 0) {
        t.auto += dt / (reduced ? 0.3 : 1.25);
        const a = clamp(t.auto, 0, 1);
        const u = a < 0.5 ? -3 + 17 * minJerk(a / 0.5) : 3 - 17 * minJerk((a - 0.5) / 0.5);
        burnish(u, 0, a < 0.5 ? 40 : -40, dt);
        if (t.auto >= 1) {
          t.auto = -1;
          t.pressed.fill(1);
          for (const b of t.bubbles) b.a = 0;
        }
      }
      let alive = 0;
      for (const b of t.bubbles) {
        if (b.a <= 0) continue;
        const out = Math.abs(b.u) > TAB_HALF[0] - b.r * 0.2 || Math.abs(b.v) > TAB_HALF[1] - b.r * 0.1 || b.r < 0.12;
        if (out) {
          b.a -= dt / (reduced ? 0.01 : 0.14);
          b.r *= Math.exp(-dt * 6);
        }
        if (b.a > 0) alive++;
        else b.a = 0;
      }
      let min = 1;
      for (let i = 0; i < BINS; i++) min = Math.min(min, t.pressed[i]);
      if (alive === 0 && min > 0.8) {
        t.bonded = true;
        t.auto = -1;
        audio.shot("press");
        onAnnounce("Spliced. Press play to hear the edit.");
      }
    }
  }

  function updateMisc(dt) {
    if (S.glint < 1) S.glint = reduced ? 1 : Math.min(1, S.glint + dt / 0.75);
    if (S.fadeDir < 0) {
      S.fade = Math.max(0, S.fade - dt / (reduced ? 0.05 : 0.2));
      if (S.fade <= 0) {
        resetState();
        S.fadeDir = 1;
      }
    } else if (S.fadeDir > 0) {
      S.fade = Math.min(1, S.fade + dt / (reduced ? 0.05 : 0.32));
      if (S.fade >= 1) S.fadeDir = 0;
    }
  }

  function stageKey() {
    if (S.cut === null) return "scrub";
    if (!S.b.seated || S.out) return "lay";
    if (!S.joined && S.tab.mode !== "lay") return S.b.x - aEnd() > 0.3 ? "butt" : "tab";
    if (!S.tab.bonded) return "rub";
    return "play";
  }

  function sendAudio(now) {
    const gA = (HEAD_X - S.offA) / V0;
    const gB = (HEAD_X - S.b.x) / V0;
    audio.update({
      type: "t",
      t: now / 1000,
      a: gA,
      b: gB,
      cutOn: S.cut !== null,
      cut: S.cut === null ? 0 : S.cut / V0,
      bOn: S.b.seated && S.b.seat > 0.9 && Math.abs(S.b.y) < 0.5,
      lift: S.play.mode === "spool" ? 0.22 : S.fadeDir !== 0 ? 0 : 1,
    });
  }

  function packMarks() {
    markData.fill(0);
    marks.a.forEach((s, i) => markData.set(s, i * 4));
    marks.b.forEach((s, i) => markData.set(s, (128 + i) * 4));
    gl.setMarks(markData);
    marksDirty = false;
  }

  function render() {
    if (marksDirty) packMarks();
    const f = frameData;
    f.dpr = view.dpr * view.quality;
    f.view.set([view.cx, view.cy, view.scale, view.rot]);
    f.a.set([S.offA, S.cut === null ? 1e6 : S.cut, S.out ? S.out.off : 0, S.out ? 1 : 0]);
    const b = S.b;
    f.b.set([b.x, b.y, b.th, b.lift]);
    f.b2.set([1, b.seat, 0, 0]);
    const r = S.razor;
    f.razor.set([r.x, r.y, r.th, r.press]);
    f.razor2.set([r.lift, 0, 0, 0]);
    const pc = S.pencil;
    f.pencil.set([pc.x, pc.y, pc.th, pc.lift]);
    const t = S.tab;
    const modeCode = t.mode === "laid" ? 2 : t.mode === "card" ? 0 : 1;
    f.tab.set([t.mode === "laid" ? t.s : t.x, t.y, t.th, t.lift]);
    f.tab2.set([modeCode, S.tabs[0] + S.tabs[1] * 2 + S.tabs[2] * 4, t.bonded ? 1 : 0, 0]);
    f.press.set(t.pressed);
    f.bubbles.fill(0);
    t.bubbles.slice(0, 10).forEach((bb, i) => f.bubbles.set([bb.u, bb.v, bb.a > 0 ? bb.r : 0, clamp(bb.a, 0, 1)], i * 4));
    f.misc.set([S.glint, S.fade, Math.min(marks.a.length, 128), Math.min(marks.b.length, 128)]);
    f.waveInfo.set(waveInfo);
    gl.draw(f);
    if (!readySent) {
      readySent = true;
      onReady();
    }
  }

  function isBusy() {
    if (ptr.id !== null || jog) return true;
    if (S.play.mode !== "idle") return true;
    if (Math.abs(S.vA) > 0 || S.snap !== null) return true;
    if (S.out || S.glint < 1 || S.fadeDir !== 0) return true;
    const b = S.b;
    if (b.mode !== "rest" || Math.abs(b.vx) > 0 || Math.abs(b.vy) > 0) return true;
    if (Math.abs(b.lift) > 0.002 || Math.abs(b.vlift) > 0.01 || Math.abs(b.vth) > 0.001 || Math.abs(b.seat - (b.seated ? 1 : 0)) > 0.002) return true;
    if (b.seated && !S.joined) {
      const gap = b.x - aEnd();
      if (gap < 4 && gap > 0.001) return true;
    }
    if (!b.seated && b.mode === "rest") {
      const anchorTh = Math.atan2(B_ANCHOR[1] - b.y, B_ANCHOR[0] - b.x);
      if (Math.abs(wrapPi(anchorTh - b.th)) > 0.0015) return true;
    }
    if (S.razor.mode !== "rest") return true;
    const pm = S.pencil.mode;
    if (pm === "home" || pm === "draw" || pm === "carry") return true;
    if (pm === "held") {
      const pc = S.pencil;
      if (Math.hypot(pc.vx, pc.vy) > 0.05 || Math.abs(pc.vlift) > 0.01 || Math.abs(pc.vth) > 0.001) return true;
    }
    const t = S.tab;
    if (t.mode !== "card" && t.mode !== "laid") return true;
    if (t.mode === "laid" && (t.auto >= 0 || t.bubbles.some((x) => x.a > 0 && x.a < 1))) return true;
    return false;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0.001, 0.05);
    last = now;
    updatePointer(dt);
    updateA(dt);
    updateOut(dt);
    updateB(dt);
    updateTab(dt);
    updateRazor(dt);
    updatePencil(dt);
    updateMisc(dt);
    sendAudio(now);
    render();
    const key = stageKey();
    if (key !== stageShown) {
      stageShown = key;
      onStage(key);
    }
    const busy = isBusy();
    if (raw > 0 && busy) {
      interval = interval * 0.85 + raw * 0.15;
      if (interval > 30) slowFrames += 1;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 40 && view.quality > 0.6) {
        applyQuality(Math.max(0.6, view.quality * 0.85));
        slowFrames = 0;
      }
    }
    if (busy) raf = requestAnimationFrame(frame);
    else audio.sleep();
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    audio.wake();
    raf = requestAnimationFrame(frame);
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createSpliceGL(canvas);
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    resize();
    loadBeat("/blog/audio/friday-beat.wav")
      .then((beat) => {
        if (destroyed || !gl) return;
        const second = secondReel(beat);
        gl.setWave(waveRows([beat, second]));
        waveInfo = [beat.pcm.length / beat.rate, A0, B0, 1];
        audio.prepare({ a: beat.pcm, b: second.pcm, rate: beat.rate, offA: A0, offB: B0, half: TH / V0 });
        if (!raf) render();
        wake();
      })
      .catch(() => {});
    if (!raf) render();
    stageShown = stageKey();
    onStage(stageShown);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        init();
        wake();
      } else {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        audio.sleep();
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    resize();
    if (gl && !raf) render();
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) audio.sleep();
    else wake();
  };
  const onLeave = (e) => {
    if (e.pointerType === "mouse" && ptr.id === null && S.pencil.mode !== "held") setCursor("");
  };
  const onBlur = () => {
    if (jog) onKeyUp({ key: "ArrowLeft" });
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);
  stage.addEventListener("blur", onBlur);

  return {
    togglePlay,
    newTape,
    toggleSound,
    nextStep,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("keyup", onKeyUp);
      stage.removeEventListener("blur", onBlur);
      audio.destroy();
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
