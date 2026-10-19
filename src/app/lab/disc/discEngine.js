import { createDiscAudio } from "./discAudio";
import { createDiscGL } from "./discGL";
import { ALBUM, paintEtch, paintLabel, trackRadii } from "./discPrint";

const TAU = Math.PI * 2;
const SUB = 1 / 240;
const LID_OPEN = 100;
const MOTOR = 46;
const SPIN_CAP = 26;
const FLIP_HOLD = 0.32;

const SEGMENTS = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
  "-": "g",
  " ": "",
  O: "abcdef",
  P: "abefg",
  E: "adefg",
  n: "ceg",
  o: "cdeg",
  d: "bcdeg",
  I: "ef",
  S: "acdfg",
  c: "deg",
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function spring(s, key, velKey, target, omega, zeta, h) {
  const a = omega * omega * (target - s[key]) - 2 * zeta * omega * s[velKey];
  s[velKey] += a * h;
  s[key] += s[velKey] * h;
}

function wrap(a) {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x < -Math.PI) x += TAU;
  return x;
}

function matrix(pitch, roll, flip) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll + flip);
  const sr = Math.sin(roll + flip);
  const rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const ry = [cr, 0, -sr, 0, 1, 0, sr, 0, cr];
  const o = new Float32Array(9);
  for (let col = 0; col < 3; col += 1) {
    for (let r = 0; r < 3; r += 1) o[col * 3 + r] = rx[r] * ry[col * 3] + rx[3 + r] * ry[col * 3 + 1] + rx[6 + r] * ry[col * 3 + 2];
  }
  return o;
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? " " : ""}${m}${r < 10 ? "0" : ""}${r}`;
}

export function createDisc(root, { embedded = false, onReady, onFail } = {}) {
  const q = (name) => root.querySelector(`[data-disc="${name}"]`);
  const stage = q("stage");
  const canvas = q("canvas");
  const player = q("player");
  const lid = q("lid");
  const flipButton = q("flip");
  const trackLine = q("track");
  const caption = q("caption");
  const digits = [...root.querySelectorAll("[data-disc-digit]")];
  const colon = q("colon");
  const playIcon = q("play-icon");
  const pauseIcon = q("pause-icon");
  const keys = {
    open: q("key-open"),
    prev: q("key-prev"),
    play: q("key-play"),
    next: q("key-next"),
    stop: q("key-stop"),
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const radii = new Float32Array(18);
  trackRadii().forEach((r, i) => {
    radii[i] = r;
  });
  const programEnd = radii[ALBUM.tracks.length - 1];
  const totalSeconds = ALBUM.tracks.reduce((a, [, s]) => a + s, 0);

  const view = { w: 1, h: 1, dpr: 1, left: 0, top: 0 };
  const lay = { R: 120, home: { x: 0, y: 0 }, well: { x: 0, y: 0 }, player: { x: 0, y: 0, w: 0, h: 0 }, wide: true };
  const disc = {
    x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0,
    pitch: 0.16, vpitch: 0, roll: -0.22, vroll: 0, flip: Math.PI, vflip: 0, flipTarget: Math.PI,
    spin: 0.4, omega: 3.2, tx: 0, ty: 0, tz: 0, tp: 0, tr: 0,
  };
  const lidState = { angle: LID_OPEN, vel: 0, target: LID_OPEN, clicked: true };
  const pointer = { id: null, mode: null, x: 0, y: 0, ox: 0, oy: 0, angle: 0, ema: 0, lastT: 0, sx: 0, sy: 0, t0: 0, moved: 0, vx: 0, vy: 0, hover: false, hx: 0, hy: 0 };
  const play = { state: "open", t: 0, track: 0, elapsed: 0, labelUp: false };
  let where = "table";
  let travel = null;
  let lastTap = 0;
  let gl = null;
  let audio = null;
  let soundOn = false;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let alpha = 0;
  let labelReady = 0;
  let introAt = 0;
  let lcdKey = "";
  let trackKey = "";
  let lidLayer = "";
  let frictionLevel = 0;
  let closeAt = 0;

  try {
    gl = createDiscGL(canvas);
  } catch {
    gl = null;
  }
  if (!gl) {
    onFail?.();
    return { destroy() {}, setSound: async () => false };
  }

  function panOf(x) {
    return clamp((x / view.w) * 2 - 1, -1, 1) * 0.6;
  }

  function measure() {
    const rect = stage.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.left = rect.left;
    view.top = rect.top;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(3200000 / Math.max(1, view.w * view.h));
    view.dpr = Math.max(0.75, Math.min(view.dpr, budget));
    gl.resize(Math.round(view.w * view.dpr), Math.round(view.h * view.dpr));
    let top = 24;
    if (caption && !embedded) {
      const c = caption.getBoundingClientRect();
      top = c.bottom - rect.top + 32;
    }
    const bottom = 24;
    const availW = view.w - 48;
    const availH = Math.max(200, view.h - top - bottom);
    const wide = view.w >= 700 && view.w / view.h > 0.95;
    lay.wide = wide;
    let R;
    if (wide) {
      R = Math.min(availW / 5.4, (availH - 48) / 3.62, 230);
      const total = 5.15 * R;
      const x0 = (view.w - total) / 2;
      const ph = 3.02 * R;
      const blockH = 0.5 * R + ph + 48;
      const y0 = top + Math.max(0, (availH - blockH) / 2);
      lay.player = { x: x0 + 2.75 * R, y: y0 + 0.5 * R, w: 2.4 * R, h: ph };
      lay.well = { x: lay.player.x + 1.2 * R, y: lay.player.y + 1.2 * R };
      lay.home = { x: x0 + R, y: lay.well.y };
    } else {
      R = Math.min((view.w - 40) / 2.44, (availH - 108) / 5.42, 200);
      const ph = 3.02 * R;
      const blockH = 2 * R + 56 + 0.42 * R + ph + 40;
      const y0 = top + Math.max(0, (availH - blockH) / 2);
      lay.home = { x: view.w / 2, y: y0 + R };
      lay.player = { x: view.w / 2 - 1.2 * R, y: y0 + 2 * R + 56 + 0.42 * R, w: 2.4 * R, h: ph };
      lay.well = { x: lay.player.x + 1.2 * R, y: lay.player.y + 1.2 * R };
    }
    lay.R = R;
    root.style.setProperty("--disc-r", `${R}px`);
    root.style.setProperty("--disc-player-x", `${lay.player.x}px`);
    root.style.setProperty("--disc-player-y", `${lay.player.y}px`);
    root.style.setProperty("--disc-player-w", `${lay.player.w}px`);
    root.style.setProperty("--disc-player-h", `${lay.player.h}px`);
    root.style.setProperty("--disc-home-x", `${lay.home.x}px`);
    root.style.setProperty("--disc-home-y", `${lay.home.y + R + 16}px`);
    root.style.setProperty("--disc-track-y", `${lay.player.y + lay.player.h + 12}px`);
    if (pointer.mode !== "carry" && !travel) {
      const anchor = where === "well" ? lay.well : lay.home;
      disc.x = anchor.x;
      disc.y = anchor.y;
      disc.tx = anchor.x;
      disc.ty = anchor.y;
    }
    wake();
  }

  function eyeZ() {
    return Math.max(view.w, view.h) * 1.7 + 600;
  }

  function scaleAt(z) {
    const D = eyeZ();
    return D / Math.max(1, D - z);
  }

  function setLCD(track, time, colonOn, icon) {
    const key = `${track}|${time}|${colonOn}|${icon}`;
    if (key === lcdKey) return;
    lcdKey = key;
    const chars = (track + time).split("");
    digits.forEach((el, i) => {
      const on = SEGMENTS[chars[i]] ?? "";
      for (const seg of el.children) seg.toggleAttribute("data-on", on.includes(seg.dataset.seg));
    });
    colon?.toggleAttribute("data-on", colonOn);
    playIcon?.toggleAttribute("data-on", icon === "play");
    pauseIcon?.toggleAttribute("data-on", icon === "pause");
  }

  function setTrackLine(text) {
    if (text === trackKey || !trackLine) return;
    trackKey = text;
    trackLine.textContent = text;
  }

  function seated() {
    return where === "well" && pointer.mode !== "carry" && !travel;
  }

  function updateLCD(now) {
    const blink = Math.floor(now / 500) % 2 === 0;
    const s = play.state;
    if (s === "open") {
      setLCD("  ", "OPEn", false, "");
      setTrackLine(`${ALBUM.title} · ${ALBUM.artist}`);
    } else if (s === "empty") {
      setLCD("  ", "    ", false, "");
    } else if (s === "focus" || s === "spinup") {
      const dash = Math.floor(now / 140) % 4;
      setLCD("--", ["-   ", " -  ", "  - ", "   -"][dash], false, "");
      setTrackLine("Reading");
    } else if (s === "toc" || s === "stopped") {
      setLCD(String(ALBUM.tracks.length), clock(totalSeconds).replace(/^ /, ""), true, "");
      setTrackLine(`${ALBUM.title} · ${ALBUM.tracks.length} tracks`);
    } else if (s === "nodisc") {
      setLCD("no", "dISc", false, "");
      setTrackLine("Label side up");
    } else if (s === "playing" || s === "paused") {
      const n = play.track + 1;
      const time = s === "paused" && !blink ? "    " : clock(play.elapsed);
      setLCD(`${n < 10 ? "0" : ""}${n}`, time, s === "playing" || blink, s === "playing" ? "play" : "pause");
      setTrackLine(`${n}  ${ALBUM.tracks[play.track][0]}`);
    }
  }

  function setState(next) {
    play.state = next;
    play.t = 0;
    wake();
  }

  function openLid() {
    if (lidState.target === LID_OPEN) return;
    lidState.target = LID_OPEN;
    lidState.vel = 380;
    lidState.clicked = false;
    audio?.lidOpen(panOf(lay.well.x));
    if (play.state !== "open") audio?.motorStop();
    setState("open");
  }

  function closeLid() {
    if (lidState.target === 0) return;
    if (pointer.mode === "carry" || travel) return;
    lidState.target = 0;
    lidState.vel = 0;
    lidState.clicked = false;
    wake();
  }

  function toggleLid() {
    if (lidState.target === 0) openLid();
    else closeLid();
  }

  function latched() {
    audio?.lidClose(panOf(lay.well.x));
    if (where === "well") {
      play.labelUp = Math.cos(disc.flip) > 0;
      setState("focus");
      audio?.seek(4);
    } else {
      setState("empty");
      audio?.seek(6);
    }
  }

  function startPlay() {
    if (lidState.target !== 0 || where !== "well") return;
    if (play.state === "stopped") {
      play.elapsed = 0;
      audio?.motorStart(1);
      setState("spinup");
      return;
    }
    if (play.state === "paused") setState("playing");
    else if (play.state === "playing") setState("paused");
  }

  function press(name) {
    audio?.button(panOf(lay.well.x));
    if (name === "open") {
      toggleLid();
      return;
    }
    if (lidState.target !== 0 || where !== "well") return;
    if (name === "play") startPlay();
    else if (name === "stop") {
      if (play.state === "playing" || play.state === "paused") {
        audio?.motorStop();
        setState("stopped");
      }
    } else if (name === "next" || name === "prev") {
      if (play.state !== "playing" && play.state !== "paused") return;
      const count = ALBUM.tracks.length;
      if (name === "next") play.track = (play.track + 1) % count;
      else if (play.elapsed <= 2.5) play.track = (play.track - 1 + count) % count;
      play.elapsed = 0;
      audio?.sled();
      wake();
    }
  }

  function flip() {
    if (where === "well" && lidState.angle < 70) return;
    disc.flipTarget = disc.flipTarget > Math.PI / 2 ? 0 : Math.PI;
    disc.vflip += disc.flipTarget > Math.PI / 2 ? 2 : -2;
    audio?.whoosh(panOf(disc.x));
    flipButton?.setAttribute("aria-pressed", disc.flipTarget > Math.PI / 2 ? "false" : "true");
    wake();
  }

  function sendTo(dest) {
    travel = dest;
    pointer.mode = null;
    disc.tx = dest === "well" ? lay.well.x : lay.home.x;
    disc.ty = dest === "well" ? lay.well.y : lay.home.y;
    where = dest === "well" ? "well" : "table";
    wake();
  }

  function local(e) {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hitDisc(p) {
    const s = scaleAt(disc.z);
    const d = Math.hypot(p.x - disc.x, p.y - disc.y);
    return d < lay.R * s * 1.02 ? d / (lay.R * s) : -1;
  }

  function onDown(e) {
    if (pointer.id !== null) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("[data-disc-noplay]")) return;
    ensureAudio();
    const p = local(e);
    const r = hitDisc(p);
    const underLid = where === "well" && lidState.angle < 70;
    if (r >= 0 && !underLid) {
      e.preventDefault();
      pointer.id = e.pointerId;
      stage.setPointerCapture?.(e.pointerId);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.sx = p.x;
      pointer.sy = p.y;
      pointer.t0 = performance.now();
      pointer.lastT = pointer.t0;
      pointer.moved = 0;
      pointer.vx = 0;
      pointer.vy = 0;
      travel = null;
      closeAt = 0;
      if (where === "well" || r < 0.42) {
        pointer.mode = "carry";
        pointer.ox = p.x - disc.x;
        pointer.oy = p.y - disc.y;
        if (where === "well") {
          where = "table";
          if (play.state !== "open") setState("open");
        }
        audio?.tap(panOf(p.x), 0.5);
      } else {
        pointer.mode = "spin";
        pointer.angle = Math.atan2(p.y - disc.y, p.x - disc.x);
        pointer.ema = 0;
        disc.omega = 0;
      }
      root.setAttribute("data-grab", pointer.mode);
      wake();
      return;
    }
    if (e.target.closest("[data-disc='lid']")) {
      e.preventDefault();
      toggleLid();
      return;
    }
    if (e.target.closest("[data-disc='player']") && where === "table") {
      e.preventDefault();
      if (lidState.target !== LID_OPEN) openLid();
      sendTo("well");
    }
  }

  function onMove(e) {
    const p = local(e);
    if (e.pointerType === "mouse" || pointer.id === e.pointerId) {
      pointer.hover = true;
      pointer.hx = p.x;
      pointer.hy = p.y;
    }
    if (pointer.id !== e.pointerId) {
      if (e.pointerType === "mouse") wake();
      return;
    }
    const now = performance.now();
    const dt = Math.max(1, now - pointer.lastT) / 1000;
    pointer.lastT = now;
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    pointer.moved += Math.hypot(dx, dy);
    pointer.vx = pointer.vx * 0.6 + (dx / dt) * 0.4;
    pointer.vy = pointer.vy * 0.6 + (dy / dt) * 0.4;
    pointer.x = p.x;
    pointer.y = p.y;
    if (pointer.mode === "spin") {
      const a = Math.atan2(p.y - disc.y, p.x - disc.x);
      const da = wrap(a - pointer.angle);
      pointer.angle = a;
      const dist = Math.hypot(p.x - disc.x, p.y - disc.y);
      const grip = clamp(dist / (lay.R * 0.5), 0, 1);
      disc.spin += da * grip;
      pointer.ema = pointer.ema * 0.7 + clamp((da * grip) / dt, -SPIN_CAP, SPIN_CAP) * 0.3;
    }
    wake();
  }

  function onUp(e) {
    if (pointer.id !== e.pointerId) return;
    const mode = pointer.mode;
    pointer.id = null;
    pointer.mode = null;
    root.removeAttribute("data-grab");
    if (e.pointerType !== "mouse") pointer.hover = false;
    const now = performance.now();
    const quick = pointer.moved < 8 && now - pointer.t0 < 320;
    if (mode === "spin") {
      const stale = now - pointer.lastT > 90;
      disc.omega = stale ? 0 : clamp(pointer.ema, -SPIN_CAP, SPIN_CAP);
      if (quick) {
        if (now - lastTap < 360) {
          lastTap = 0;
          flip();
        } else lastTap = now;
      }
    } else if (mode === "carry") {
      const p = { x: disc.x, y: disc.y };
      const overWell = Math.hypot(p.x - lay.well.x, p.y - lay.well.y) < lay.R * 0.75;
      const px = lay.player;
      const overPlayer = p.x > px.x && p.x < px.x + px.w && p.y > px.y && p.y < px.y + px.h;
      if (quick && Math.hypot(p.x - lay.home.x, p.y - lay.home.y) < 4) {
        if (now - lastTap < 360) {
          lastTap = 0;
          flip();
        } else lastTap = now;
        sendTo("home");
      } else if (overWell || overPlayer) {
        if (lidState.target !== LID_OPEN) openLid();
        sendTo("well");
      } else sendTo("home");
    }
    wake();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    if (active && active.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    if (e.key === "f" || e.key === "F") flip();
    else if (e.key === "o" || e.key === "O") press("open");
    else if (e.key === " ") {
      e.preventDefault();
      if (where === "well" && lidState.target === 0) press("play");
      else if (where === "table") {
        if (lidState.target !== LID_OPEN) openLid();
        sendTo("well");
      }
    } else if (e.key === "ArrowRight") {
      if (play.state === "playing" || play.state === "paused") press("next");
      else {
        disc.omega = clamp(disc.omega + 6, -SPIN_CAP, SPIN_CAP);
        wake();
      }
    } else if (e.key === "ArrowLeft") {
      if (play.state === "playing" || play.state === "paused") press("prev");
      else {
        disc.omega = clamp(disc.omega - 6, -SPIN_CAP, SPIN_CAP);
        wake();
      }
    } else if (e.key === "Enter" && where === "well") {
      toggleLid();
    }
  }

  function ensureAudio() {
    if (!soundOn || audio) return;
    audio = createDiscAudio();
  }

  function stepState(dt) {
    play.t += dt;
    const s = play.state;
    if (s === "focus" && play.t > 0.55) {
      audio?.motorStart(play.labelUp ? 1 : 0.45);
      setState("spinup");
    } else if (s === "spinup") {
      if (!play.labelUp && play.t > 0.9) {
        audio?.motorStop();
        setState("nodisc");
      } else if (play.labelUp && play.t > 1.15) {
        audio?.sled();
        setState(play.elapsed > 0 ? "playing" : "toc");
      }
    } else if (s === "toc" && play.t > 1.6) {
      play.track = play.track % ALBUM.tracks.length;
      play.elapsed = 0;
      setState("playing");
    } else if (s === "nodisc" && play.t > 1.9) {
      openLid();
    } else if (s === "playing") {
      play.elapsed += dt;
      if (play.elapsed >= ALBUM.tracks[play.track][1]) {
        play.elapsed = 0;
        play.track += 1;
        if (play.track >= ALBUM.tracks.length) {
          play.track = 0;
          audio?.motorStop();
          setState("stopped");
        }
      }
    }
  }

  function motorTarget() {
    if (where !== "well" || lidState.target !== 0) return null;
    const s = play.state;
    if (s === "spinup") return play.labelUp ? MOTOR : 14;
    if (s === "toc" || s === "playing" || s === "paused") return MOTOR;
    return 0;
  }

  function step(h) {
    const R = lay.R;
    if (pointer.mode === "carry") {
      disc.tx = pointer.x - pointer.ox;
      disc.ty = pointer.y - pointer.oy;
      disc.tz = R * 0.34;
    } else if (travel) {
      const target = travel === "well" ? lay.well : lay.home;
      disc.tx = target.x;
      disc.ty = target.y;
      const d = Math.hypot(disc.x - target.x, disc.y - target.y);
      const waitLid = travel === "well" && lidState.angle < 70;
      disc.tz = d > R * 0.12 || waitLid ? R * 0.3 : 0;
    } else {
      disc.tz = 0;
    }
    const carry = pointer.mode === "carry";
    spring(disc, "x", "vx", disc.tx, carry ? 26 : 11, carry ? 0.92 : 0.86, h);
    spring(disc, "y", "vy", disc.ty, carry ? 26 : 11, carry ? 0.92 : 0.86, h);
    const flipLift = Math.abs(Math.sin(disc.flip)) * R * FLIP_HOLD;
    spring(disc, "z", "vz", disc.tz + flipLift, 14, 0.9, h);
    if (disc.z < 0) {
      disc.z = 0;
      disc.vz = Math.max(0, disc.vz);
    }
    let tp = 0;
    let tr = 0;
    if (pointer.hover && where === "table") {
      const nx = clamp((pointer.hx - disc.x) / (R * 2.4), -1, 1);
      const ny = clamp((pointer.hy - disc.y) / (R * 2.4), -1, 1);
      tp = ny * 0.2;
      tr = -nx * 0.24;
    }
    if (carry || travel) {
      tp += clamp(disc.vy * 0.00045, -0.3, 0.3);
      tr -= clamp(disc.vx * 0.00045, -0.3, 0.3);
    }
    if (where === "well" && !travel && !carry) {
      tp = 0;
      tr = 0;
    }
    if (introAt > 0) {
      const k = Math.max(0, 1 - introAt / 2.6);
      tp += 0.16 * k * k;
      tr += -0.22 * k * k;
    }
    spring(disc, "pitch", "vpitch", tp, 7.5, 0.72, h);
    spring(disc, "roll", "vroll", tr, 7.5, 0.72, h);
    spring(disc, "flip", "vflip", disc.flipTarget, 9.5, 0.8, h);
    const target = motorTarget();
    if (pointer.mode === "spin") {
      disc.omega = 0;
    } else if (target !== null && target > 0) {
      disc.omega += (target - disc.omega) * Math.min(1, h * 1.7);
    } else {
      const drag = where === "well" ? 1.4 : 0.75;
      disc.omega *= Math.exp(-drag * h);
      disc.omega -= Math.sign(disc.omega) * Math.min(Math.abs(disc.omega), 0.25 * h);
    }
    disc.spin += disc.omega * h;
    if (disc.spin > TAU * 64 || disc.spin < -TAU * 64) disc.spin %= TAU;
    if (lidState.target === 0) {
      lidState.vel = Math.min(lidState.vel + 1500 * h, 540);
      lidState.angle -= lidState.vel * h;
      if (lidState.angle <= 0) {
        lidState.angle = 0;
        lidState.vel = 0;
        if (!lidState.clicked) {
          lidState.clicked = true;
          latched();
        }
      }
    } else {
      spring(lidState, "angle", "vel", lidState.target, 16, 0.62, h);
    }
    if (travel) {
      const target2 = travel === "well" ? lay.well : lay.home;
      const d = Math.hypot(disc.x - target2.x, disc.y - target2.y);
      if (d < 0.8 && disc.z < 0.8 && Math.hypot(disc.vx, disc.vy) < 12) {
        if (travel === "well") {
          audio?.seat(panOf(disc.x));
          closeAt = 0.55;
        }
        else audio?.tap(panOf(disc.x), 0.8);
        travel = null;
      }
    }
  }

  function moving() {
    if (pointer.id !== null || travel) return true;
    if (Math.abs(disc.omega) > 0.02) return true;
    if (Math.abs(disc.vx) + Math.abs(disc.vy) + Math.abs(disc.vz) > 0.5) return true;
    if (Math.abs(disc.x - disc.tx) + Math.abs(disc.y - disc.ty) > 0.3) return true;
    if (Math.abs(disc.vpitch) + Math.abs(disc.vroll) + Math.abs(disc.vflip) > 0.002) return true;
    if (Math.abs(disc.flip - disc.flipTarget) > 0.001) return true;
    if (Math.abs(lidState.angle - lidState.target) > 0.05 || Math.abs(lidState.vel) > 0.05) return true;
    if (pointer.hover && where === "table") {
      const nx = clamp((pointer.hx - disc.x) / (lay.R * 2.4), -1, 1);
      const ny = clamp((pointer.hy - disc.y) / (lay.R * 2.4), -1, 1);
      if (Math.abs(disc.pitch - ny * 0.2) + Math.abs(disc.roll + nx * 0.24) > 0.002) return true;
    } else if (Math.abs(disc.pitch) + Math.abs(disc.roll) > 0.002) return true;
    const s = play.state;
    if (s === "focus" || s === "spinup" || s === "toc" || s === "nodisc" || s === "playing" || s === "paused") return true;
    if (alpha < 1 || introAt > 0 || closeAt > 0) return true;
    return false;
  }

  function render() {
    const R = lay.R;
    const D = eyeZ();
    const rot = matrix(disc.pitch, disc.roll, disc.flip);
    const blur = clamp(Math.abs(disc.omega) / 60, 0, 0.9);
    const s = scaleAt(disc.z + R * 0.2);
    const reach = R * s * 1.12 + 24;
    const shift = disc.z * 0.6 + 12;
    const x0 = clamp(disc.x - reach - shift, 0, view.w);
    const x1 = clamp(disc.x + reach + shift, 0, view.w);
    const y0 = clamp(disc.y - reach - shift, 0, view.h);
    const y1 = clamp(disc.y + reach + shift, 0, view.h);
    const box = [Math.floor(x0 * view.dpr), Math.floor((view.h - y1) * view.dpr), Math.ceil((x1 - x0) * view.dpr), Math.ceil((y1 - y0) * view.dpr)];
    gl.draw({
      dpr: view.dpr,
      eye: [view.w / 2, view.h / 2, D],
      center: [disc.x, disc.y, disc.z + 1.5],
      rot,
      radius: R,
      spin: disc.spin,
      blur,
      key: [view.w * 0.22, -view.h * 0.02, 1500],
      fill: [view.w * 1.1, view.h * 0.95, 900],
      alpha,
      labelReady,
      end: programEnd,
      well: where === "well" ? 1 : 0,
      view: [view.w, view.h],
      envShift: [(lay.home.x - view.w / 2) / D, (lay.home.y - view.h / 2) / D],
      box,
    });
  }

  function applyDom() {
    lid.style.setProperty("--disc-lid-angle", `${lidState.angle.toFixed(2)}deg`);
    const layer = where === "well" && lidState.angle < 88 && !travel && pointer.mode !== "carry" ? "over" : "under";
    if (layer !== lidLayer) {
      lidLayer = layer;
      root.setAttribute("data-lid", layer);
    }
    lid.toggleAttribute("data-open", lidState.target === LID_OPEN);
    flipButton?.toggleAttribute("disabled", where === "well" && lidState.target === 0);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (labelReady > 0 && alpha < 1) alpha = reduced ? 1 : Math.min(1, alpha + dt / 0.5);
    if (introAt > 0 && alpha >= 1) introAt = Math.max(0, introAt - dt);
    let acc = dt;
    while (acc > 1e-6) {
      const h = Math.min(SUB, acc);
      step(h);
      acc -= h;
    }
    stepState(dt);
    if (closeAt > 0) {
      closeAt -= dt;
      if (closeAt <= 0) {
        closeAt = 0;
        if (where === "well" && !travel && pointer.mode !== "carry") closeLid();
      }
    }
    if (soundOn && audio) {
      const level = where === "table" && disc.z < 2 ? clamp(Math.abs(disc.omega) / 14, 0, 1) : 0;
      if (Math.abs(level - frictionLevel) > 0.02) {
        frictionLevel = level;
        audio.friction(level);
      }
    }
    updateLCD(now);
    applyDom();
    render();
    if (moving() && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || destroyed || !visible || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  }

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
    else {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(stage);

  const ro = new ResizeObserver(() => measure());
  ro.observe(stage);

  const clicks = Object.entries(keys).map(([name, el]) => {
    const fn = (e) => {
      e.preventDefault();
      ensureAudio();
      press(name);
    };
    el?.addEventListener("click", fn);
    return () => el?.removeEventListener("click", fn);
  });
  const flipClick = (e) => {
    e.preventDefault();
    ensureAudio();
    flip();
  };
  flipButton?.addEventListener("click", flipClick);
  const lidKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      ensureAudio();
      toggleLid();
    }
  };
  lid.addEventListener("keydown", lidKey);
  const leave = (e) => {
    if (e.pointerType === "mouse") {
      pointer.hover = false;
      wake();
    }
  };
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", leave);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);

  measure();
  disc.x = lay.home.x;
  disc.y = lay.home.y;
  disc.tx = disc.x;
  disc.ty = disc.y;
  introAt = reduced ? 0 : 2.6;
  if (reduced) {
    disc.omega = 0;
    disc.pitch = 0;
    disc.roll = 0;
  }
  updateLCD(0);
  applyDom();
  render();

  const font = document.fonts?.load ? Promise.all([document.fonts.load("700 24px disc-arimo"), document.fonts.load("400 24px disc-arimo")]).catch(() => {}) : Promise.resolve();
  const cover = new Image();
  cover.decoding = "async";
  cover.src = ALBUM.cover;
  Promise.all([cover.decode(), font])
    .then(() => {
      if (destroyed) return;
      const size = Math.min(2048, Math.max(1024, 2 ** Math.ceil(Math.log2(lay.R * 2 * view.dpr * 1.6))));
      gl.setLabel(paintLabel(cover, size));
      gl.setEtch(paintEtch(size, Array.from(radii.subarray(0, ALBUM.tracks.length))));
      labelReady = 1;
      onReady?.();
      wake();
    })
    .catch(() => {
      if (destroyed) return;
      gl.setEtch(paintEtch(1024, Array.from(radii.subarray(0, ALBUM.tracks.length))));
      labelReady = 0.001;
      onReady?.();
      wake();
    });

  return {
    async setSound(on) {
      soundOn = on;
      if (on) {
        if (!audio) audio = createDiscAudio();
        if (!audio) return false;
        const ok = await audio.setEnabled(true);
        if (ok && (play.state === "playing" || play.state === "paused" || play.state === "toc") && where === "well") audio.motorStart(1);
        return ok;
      }
      frictionLevel = 0;
      if (audio) await audio.setEnabled(false);
      return false;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      clicks.forEach((off) => off());
      flipButton?.removeEventListener("click", flipClick);
      lid.removeEventListener("keydown", lidKey);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      audio?.destroy();
      gl.destroy();
    },
  };
}
