import { createDeckAudio, grooveTexture, loadBeat } from "./needleAudio";
import { createNeedleGL } from "./needleGL";
import { drawLabel } from "./needleLabel";
import { BETA_REST, GEO, OMEGA, REV, armPose, bandAt, betaForRadius, buildSide, formatTime, grooveTime, radiusAt, stylusAt } from "./needleSide";

const TAU = Math.PI * 2;
const I_PLAT = 1;
const I_REC = 0.35;
const MU = 3;
const T_MAX = 9;
const K_MOTOR = 40;
const BRAKE = 4.2;
const SUB = 1 / 1000;
const W_CAP = OMEGA * 4;
const FULL = [-190 - 22, -176.5 - 22, 263 + 22, 176.5 + 22];
const TIGHT = [-188, -172, 230, 172];
const BETA_MAX = betaForRadius(GEO.label + 3);
const BETA_LOCK = betaForRadius(GEO.lock);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (a) => a - TAU * Math.floor(a / TAU);
const wrapPi = (a) => a - TAU * Math.round(a / TAU);

export function createNeedleEngine({ box, stage, canvas, tag, keyButton, meter, insets, embedded, record, onSound, onReady, onFail, onAnnounce, onBand }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, scale: 1, cx: 0, cy: 0, eye: [0, 0, 1500], quality: 1, rot: 0 };
  let side = buildSide(5);
  let segments = packSegments(side);
  const audio = createDeckAudio();
  const phys = { phiR: 0, wR: reduced ? 0 : OMEGA, phiP: 0, wP: reduced ? 0 : OMEGA, nomA: 0, nomB: 0, motor: !reduced };
  const hand = { id: null, cur: null, prev: null, w: 0, active: false, jog: 0 };
  const play = { t: 0.6, down: true, stuck: false, wAudio: 0 };
  const arm = { beta: betaForRadius(radiusAt(side, 0.6)), vb: 0, target: 0, lift: 0, vl: 0, mode: "play", id: null, grab: 0, cue: null };
  const pointers = new Map();
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let soundState = "off";
  let userMuted = false;
  let press = 0;
  let pressHeld = false;
  let tagText = "";
  let tagShown = false;
  let cursor = "";
  let interval = 16;
  let slowFrames = 0;
  let meterLevels = [0, 0, 0, 0];
  let meterShown = "";
  let readySent = false;
  let lastBand = -2;

  phys.phiR = wrap(Math.atan2(...[...stylusAt(arm.beta)].reverse()) + (TAU * play.t) / REV);

  function packSegments(s) {
    const out = new Float32Array(64);
    s.segments.slice(0, 16).forEach((seg, i) => {
      out[i * 4] = seg.r0;
      out[i * 4 + 1] = seg.pitch === 0 ? 0.001 : seg.pitch;
      out[i * 4 + 2] = seg.t0;
      out[i * 4 + 3] = seg.music ? 1 : 0;
    });
    return out;
  }

  function setSound(next) {
    if (next === soundState) return;
    soundState = next;
    onSound(next);
  }

  function startAudio() {
    if (userMuted) return;
    if (!audio.started) {
      audio.start(play.t);
      setSound("on");
      onAnnounce("Sound on.");
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

  function layout() {
    const pad = insets();
    const ax = pad.left;
    const ay = pad.top;
    const aw = Math.max(80, view.width - pad.left - pad.right);
    const ah = Math.max(80, view.height - pad.top - pad.bottom);
    view.rot = view.width / view.height < 0.8 ? 1 : 0;
    const turn = (f) => (view.rot ? [-f[3], f[0], -f[1], f[2]] : f);
    const fit = (f) => Math.min(aw / (f[2] - f[0]), ah / (f[3] - f[1]));
    const full = fit(turn(FULL));
    const tight = fit(turn(TIGHT));
    const useTight = view.width < 520 || full * 1.16 < tight;
    const frame = turn(useTight ? TIGHT : FULL);
    const scale = useTight ? tight : full;
    const fw = (frame[2] - frame[0]) * scale;
    const fh = (frame[3] - frame[1]) * scale;
    const left = ax + (aw - fw) / 2;
    const top = ay + (ah - fh) / 2;
    view.scale = scale;
    view.cx = left - frame[0] * scale;
    view.cy = top - frame[1] * scale;
    view.eye = [...toWorld([(frame[0] + frame[2]) / 2, (frame[1] + frame[3]) / 2]), 1500];
    placeKey();
  }

  function placeKey() {
    if (!keyButton) return;
    const [kx0, ky0, hw0, hh0] = GEO.key;
    const [kx, ky] = toScreen([kx0, ky0]);
    const hw = view.rot ? hh0 : hw0;
    const hh = view.rot ? hw0 : hh0;
    const s = view.scale;
    keyButton.style.transform = `translate3d(${(view.cx + (kx - hw) * s).toFixed(1)}px, ${(view.cy + (ky - hh) * s).toFixed(1)}px, 0)`;
    keyButton.dataset.rot = view.rot ? "true" : "false";
    keyButton.style.width = `${(hw * 2 * s).toFixed(1)}px`;
    keyButton.style.height = `${(hh * 2 * s).toFixed(1)}px`;
    keyButton.style.setProperty("--needle-legend-gap", `${Math.max(4, Math.round(3 * s / 4) * 4)}px`);
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2000000 / Math.max(1, view.width * view.height));
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

  function toWorld(sp) {
    return view.rot ? [sp[1], -sp[0]] : sp;
  }

  function toScreen(w) {
    return view.rot ? [-w[1], w[0]] : w;
  }

  function segDist(p, a, b) {
    const bx = b[0] - a[0];
    const by = b[1] - a[1];
    const t = clamp(((p[0] - a[0]) * bx + (p[1] - a[1]) * by) / Math.max(1e-6, bx * bx + by * by), 0, 1);
    return Math.hypot(p[0] - a[0] - bx * t, p[1] - a[1] - by * t);
  }

  function hitArm(p, touch) {
    const pose = armPose(arm.beta, arm.lift);
    const slop = Math.max(touch ? 9 : 5, (touch ? 22 : 10) / view.scale);
    const u = [pose.j[0] - pose.p[0], pose.j[1] - pose.p[1]];
    const ul = Math.hypot(u[0], u[1]) || 1;
    const back = [pose.p[0] - (u[0] / ul) * 56, pose.p[1] - (u[1] / ul) * 56];
    const head = [pose.s[0] + pose.h[0] * 9, pose.s[1] + pose.h[1] * 9];
    return (
      segDist(p, pose.p, pose.j) < 4 + slop ||
      segDist(p, pose.j, head) < 9 + slop ||
      segDist(p, pose.p, back) < 15 + slop
    );
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = toMm(e);
    const touch = e.pointerType !== "mouse";
    const r = Math.hypot(p[0], p[1]);
    let role = null;
    if (arm.id === null && hitArm(p, touch)) role = "arm";
    else if (hand.id === null && r < GEO.platter + (touch ? 10 : 2)) role = "record";
    if (!role) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, role);
    startAudio();
    if (role === "arm") grabArm(e.pointerId, p);
    else grabRecord(e.pointerId, p);
    setCursor("grabbing");
    wake();
  }

  function grabArm(id, p) {
    arm.id = id;
    arm.cue = null;
    if (arm.mode === "play") audio.lift();
    arm.mode = "held";
    arm.grab = Math.atan2(p[1] - GEO.pivot[1], p[0] - GEO.pivot[0]) - arm.beta;
    arm.target = arm.beta;
  }

  function grabRecord(id, p) {
    hand.id = id;
    hand.cur = p;
    hand.prev = p;
    hand.active = true;
    hand.w = phys.wR;
  }

  function onMove(e) {
    const role = pointers.get(e.pointerId);
    const p = toMm(e);
    if (!role) {
      if (e.pointerType !== "mouse") return;
      const r = Math.hypot(p[0], p[1]);
      setCursor(hitArm(p, false) || r < GEO.platter + 2 ? "grab" : "");
      return;
    }
    if (role === "arm") {
      const a = Math.atan2(p[1] - GEO.pivot[1], p[0] - GEO.pivot[0]) - arm.grab;
      arm.target = clamp(a, BETA_REST - 0.03, BETA_MAX);
    } else {
      hand.cur = p;
    }
    wake();
  }

  function onUp(e) {
    const role = pointers.get(e.pointerId);
    if (!role) return;
    pointers.delete(e.pointerId);
    if (role === "arm") releaseArm();
    else releaseRecord();
    setCursor("grab");
    wake();
  }

  function releaseRecord() {
    hand.id = null;
    hand.active = false;
    phys.wR = clamp(hand.w, -W_CAP, W_CAP);
  }

  function releaseArm() {
    arm.id = null;
    const s = stylusAt(arm.target);
    const r = Math.hypot(s[0], s[1]);
    if (r > GEO.record - 1) {
      arm.mode = "return";
      arm.target = BETA_REST;
    } else {
      if (r < GEO.lock) arm.target = BETA_LOCK;
      arm.mode = "lower";
    }
  }

  function setCursor(next) {
    if (next === cursor) return;
    cursor = next;
    stage.style.cursor = next;
  }

  function cueBand(dir) {
    const starts = side.bands.map((b) => b.t0);
    const at = arm.mode === "play" ? play.t : dir > 0 ? -1 : Infinity;
    let idx = -1;
    if (dir > 0) idx = starts.findIndex((t0) => t0 > at + 0.5);
    else starts.forEach((t0, i) => {
      if (t0 < at - 2) idx = i;
    });
    if (idx < 0 || idx >= starts.length) return;
    if (arm.mode === "play") audio.lift();
    arm.mode = "cue";
    arm.cue = starts[idx];
    arm.target = betaForRadius(radiusAt(side, starts[idx]) - 0.3);
    onAnnounce(`Cueing ${record.tracks[idx] || `band ${idx + 1}`}.`);
  }

  function cueTrack(idx) {
    const starts = side.bands.map((b) => b.t0);
    if (idx < 0 || idx >= starts.length) return;
    startAudio();
    if (arm.mode === "play") audio.lift();
    arm.mode = "cue";
    arm.cue = starts[idx];
    arm.target = betaForRadius(radiusAt(side, starts[idx]) - 0.3);
    onAnnounce(`Cueing ${record.tracks[idx] || `band ${idx + 1}`}.`);
    wake();
  }

  function onKey(e) {
    if (e.target !== stage) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat) toggleMotor();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      if (!hand.active || hand.jog) {
        startAudio();
        hand.jog = e.key === "ArrowLeft" ? -1 : 1;
        hand.active = true;
        hand.w = phys.wR;
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      startAudio();
      cueBand(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "m" || e.key === "M") {
      toggleSound();
    } else return;
    wake();
  }

  function onKeyUp(e) {
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && hand.jog) {
      hand.jog = 0;
      hand.active = false;
      phys.wR = clamp(hand.w, -W_CAP, W_CAP);
      wake();
    }
  }

  function toggleMotor() {
    startAudio();
    phys.motor = !phys.motor;
    onAnnounce(phys.motor ? "Motor on, spinning up to 33⅓." : "Motor off.");
    keyButton?.setAttribute("aria-pressed", phys.motor ? "true" : "false");
    wake();
  }

  function onKeyPointerDown(e) {
    e.stopPropagation();
    pressHeld = true;
    startAudio();
    wake();
  }

  function onKeyPointerUp() {
    pressHeld = false;
  }

  function stepPhysics(dt) {
    const steps = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const slip = phys.wP - phys.wR;
      const friction = MU * Math.tanh(slip / 0.05);
      let motor;
      if (phys.motor) motor = T_MAX * Math.tanh((K_MOTOR * (OMEGA - phys.wP)) / T_MAX);
      else motor = -BRAKE * Math.tanh(phys.wP / 0.04);
      phys.wP += ((motor - friction - 0.02 * phys.wP) / I_PLAT) * h;
      if (!hand.active) phys.wR += ((friction - 0.01 * phys.wR) / I_REC) * h;
    }
  }

  function updateArm(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (arm.mode === "held" || arm.mode === "return" || arm.mode === "cue" || arm.mode === "lower") {
        const omega = arm.mode === "held" ? 24 : 9;
        const a = omega * omega * (arm.target - arm.beta) - 2 * omega * arm.vb;
        arm.vb += a * h;
        arm.beta += arm.vb * h;
      }
      if (arm.mode === "held" || arm.mode === "return" || arm.mode === "cue") {
        const a = 18 * 18 * (1 - arm.lift) - 2 * 18 * arm.vl;
        arm.vl += a * h;
        arm.lift += arm.vl * h;
      } else if (arm.mode === "lower" || arm.mode === "rest-lower") {
        const speed = 1 / 0.42;
        arm.lift = Math.max(0, arm.lift - speed * h * (0.35 + 0.65 * arm.lift));
        arm.vl = 0;
      }
    }
    if (reduced && arm.mode !== "play" && arm.mode !== "rest") {
      arm.beta = arm.target;
      arm.vb = 0;
    }
    if (arm.mode === "return" && Math.abs(arm.beta - BETA_REST) < 0.004 && Math.abs(arm.vb) < 0.05) arm.mode = "rest-lower";
    if (arm.mode === "cue" && Math.abs(arm.beta - arm.target) < 0.004 && Math.abs(arm.vb) < 0.05 && arm.lift > 0.9) arm.mode = "lower";
    if (arm.mode === "rest-lower" && arm.lift <= 0) {
      arm.mode = "rest";
      arm.beta = BETA_REST;
      arm.vb = 0;
    }
    if (arm.mode === "lower" && arm.lift <= 0 && Math.abs(arm.vb) < 0.2) land();
  }

  function land() {
    const s = stylusAt(arm.beta);
    const r = Math.hypot(s[0], s[1]);
    if (r > GEO.record - 1) {
      arm.mode = "return";
      arm.target = BETA_REST;
      return;
    }
    const theta = Math.atan2(s[1], s[0]);
    const phase = wrap(phys.phiR - theta) / TAU;
    let t;
    if (arm.cue !== null) t = arm.cue;
    else if (r >= GEO.lead) t = 0;
    else t = grooveTime(side, r, phase);
    if (arm.cue !== null) phys.phiR = wrap(theta + (TAU * t) / REV);
    arm.cue = null;
    play.t = t;
    play.down = true;
    arm.mode = "play";
    arm.vb = 0;
    arm.lift = 0;
    audio.drop(t, currentVel());
    onAnnounce(`Needle down at ${formatTime(t)}.`);
  }

  function currentVel() {
    return (hand.active ? hand.w : phys.wR) / OMEGA;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0.001, 0.05);
    last = now;

    let dPhi = 0;
    if (hand.active) {
      if (hand.jog) {
        const target = hand.jog < 0 ? -OMEGA * 1.1 : OMEGA * 2;
        hand.w += (target - hand.w) * (1 - Math.exp(-dt / 0.06));
        dPhi = hand.w * dt;
      } else {
        const a = hand.prev;
        const b = hand.cur;
        const cross = a[0] * b[1] - a[1] * b[0];
        const dot = a[0] * b[0] + a[1] * b[1];
        const ra = Math.hypot(a[0], a[1]);
        const rb = Math.hypot(b[0], b[1]);
        dPhi = Math.min(ra, rb) > 24 ? Math.atan2(cross, dot) : cross / Math.max(ra * rb, 24 * 24);
        hand.prev = b;
        const inst = dPhi / dt;
        hand.w += (inst - hand.w) * (1 - Math.exp(-dt / 0.035));
      }
      phys.wR = hand.w;
      stepPhysics(dt);
    } else {
      stepPhysics(dt);
      dPhi = phys.wR * dt;
    }
    phys.phiR = wrap(phys.phiR + dPhi);
    phys.phiP = wrap(phys.phiP + phys.wP * dt);
    phys.nomA = wrap(phys.nomA + OMEGA * dt);
    phys.nomB = wrap(phys.nomB + ((OMEGA * 108) / 104) * dt);

    if (arm.mode === "play") {
      const next = play.t + (dPhi / TAU) * REV;
      play.stuck = next < 0;
      play.t = Math.max(0, next);
      if (play.t >= side.lockEnd) play.t -= REV;
      arm.beta = betaForRadius(radiusAt(side, play.t));
      arm.target = arm.beta;
    }
    updateArm(dt);

    const vel = play.stuck ? 0 : (hand.active ? hand.w : phys.wR) / OMEGA;
    audio.update(play.t, vel, arm.mode === "play");

    press += ((pressHeld ? 1 : 0) - press) * (1 - Math.exp(-dt / 0.04));
    if (!pressHeld && press < 0.01) press = 0;

    render(dt);
    updateTag();
    const nowBand = arm.mode === "play" ? bandAt(side, play.t) : arm.mode === "cue" && arm.cue !== null ? bandAt(side, arm.cue + 0.02) : lastBand;
    const between = nowBand === -1 && arm.mode === "play" && play.t > side.bands[0].t0 && play.t < side.tEnd;
    if (nowBand !== lastBand && !between) {
      lastBand = nowBand;
      onBand?.(nowBand);
    }
    updateMeter(dt);

    const spinning = phys.motor || Math.abs(phys.wP) > 0.002 || Math.abs(phys.wR) > 0.002;
    const armBusy = arm.mode !== "play" && arm.mode !== "rest";
    const busy = spinning || hand.active || armBusy || press > 0 || meterLevels.some((l) => l > 0.01);
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
    else {
      phys.wP = 0;
      phys.wR = 0;
      audio.sleep();
    }
  }

  function render(dt) {
    const pose = armPose(arm.beta, arm.lift);
    const toC = [-pose.s[0], -pose.s[1]];
    const perp = [-pose.h[1], pose.h[0]];
    const side2 = perp[0] * toC[0] + perp[1] * toC[1] > 0 ? -1 : 1;
    const shutter = Math.min(dt, 1 / 50) * 0.6;
    gl.draw({
      dpr: view.dpr * view.quality,
      cx: view.cx,
      cy: view.cy,
      scale: view.scale,
      eye: view.eye,
      rot: view.rot,
      rec: phys.phiR,
      plat: phys.phiP,
      blurRec: reduced ? 0 : Math.min(Math.abs(phys.wR) * shutter, 0.5),
      blurPlat: reduced ? 0 : Math.min(Math.abs(phys.wP) * shutter, 0.5),
      strobeA: wrapPi(phys.phiP - phys.nomA),
      strobeB: wrapPi(phys.phiP - phys.nomB),
      lamp: 1,
      press,
      arm: { ...pose, side: side2 },
      lift: arm.lift,
      segments,
      loop: side.loop,
      rev: REV,
    });
    if (!readySent && gl.flags.label) {
      readySent = true;
      onReady();
    }
  }

  function updateTag() {
    if (!tag) return;
    let text = "";
    const pose = armPose(arm.beta, arm.lift);
    const r = Math.hypot(pose.s[0], pose.s[1]);
    if (arm.mode === "held" || arm.mode === "cue" || arm.mode === "lower") {
      if (r > GEO.record - 1) text = "Off the record";
      else if (r < GEO.lock) text = "Run-out";
      else text = formatTime(arm.cue !== null && arm.mode !== "held" ? arm.cue : r >= GEO.lead ? 0 : grooveTime(side, r, 0.5));
    } else if (hand.active && arm.mode === "play") {
      text = play.t >= side.tEnd ? "Run-out" : formatTime(play.t);
    }
    const show = Boolean(text);
    if (text && text !== tagText) {
      tag.textContent = text;
      tagText = text;
    }
    if (show !== tagShown) {
      tag.dataset.show = show ? "true" : "false";
      tagShown = show;
    }
    if (show) {
      const ss = toScreen(pose.s);
      const sx = view.cx + ss[0] * view.scale;
      const sy = view.cy + ss[1] * view.scale;
      const away = 26 + 14 * view.scale;
      const [nx, ny] = toScreen(pose.h);
      const x = clamp(sx + nx * away, 8, view.width - 8);
      const y = clamp(sy + ny * away, 8, view.height - 8);
      tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  function updateMeter(dt) {
    if (!meter) return;
    const lvl = audio.level();
    const target = soundState === "on" ? clamp(lvl * 4.2, 0, 1) : 0;
    const k = 1 - Math.exp(-dt / 0.06);
    meterLevels = meterLevels.map((l, i) => {
      const jitter = 0.55 + 0.45 * Math.abs(Math.sin(phys.phiR * (i + 2) * 3.1 + i));
      return l + (target * jitter - l) * k;
    });
    const shown = meterLevels.map((l) => l.toFixed(2)).join(",");
    if (shown === meterShown) return;
    meterShown = shown;
    [...meter.children].forEach((bar, i) => {
      bar.style.transform = `scaleY(${(0.25 + 0.75 * meterLevels[i]).toFixed(3)})`;
    });
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    audio.wake();
    raf = requestAnimationFrame(frame);
  }

  async function init() {
    if (gl || failed) return;
    try {
      gl = createNeedleGL(canvas);
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
    const style = getComputedStyle(box);
    const fonts = {
      sans: style.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
      mono: style.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
      serif: style.getPropertyValue("--needle-serif").trim() || "Georgia, serif",
    };
    drawLabel(record, fonts)
      .then((label) => {
        if (destroyed || !gl) return;
        gl.setLabel(label);
        wake();
        if (!raf) render(1 / 60);
      })
      .catch(() => {
        if (!destroyed) onReady();
      });
    loadBeat("/blog/audio/friday-beat.wav")
      .then((beat) => {
        if (destroyed || !gl) return;
        side = buildSide(beat.pcm.length / beat.rate);
        segments = packSegments(side);
        gl.setGroove(grooveTexture(beat));
        audio.prepare(beat, side);
        wake();
        if (!raf) render(1 / 60);
      })
      .catch(() => {});
    wake();
    if (!raf) render(1 / 60);
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
    if (gl && !raf) render(1 / 60);
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) audio.sleep();
    else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);
  const onBlur = () => {
    if (hand.jog) onKeyUp({ key: "ArrowLeft" });
  };
  stage.addEventListener("blur", onBlur);
  keyButton?.addEventListener("pointerdown", onKeyPointerDown);
  keyButton?.addEventListener("pointerup", onKeyPointerUp);
  keyButton?.addEventListener("pointercancel", onKeyPointerUp);
  keyButton?.addEventListener("pointerleave", onKeyPointerUp);
  const onKeyClick = (e) => {
    toggleMotor();
    if (e.detail !== 0) return;
    pressHeld = true;
    setTimeout(() => {
      pressHeld = false;
      wake();
    }, 120);
  };
  keyButton?.addEventListener("click", onKeyClick);

  return {
    toggleSound,
    toggleMotor,
    cueTrack,
    get motor() {
      return phys.motor;
    },
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
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("keyup", onKeyUp);
      stage.removeEventListener("blur", onBlur);
      keyButton?.removeEventListener("pointerdown", onKeyPointerDown);
      keyButton?.removeEventListener("pointerup", onKeyPointerUp);
      keyButton?.removeEventListener("pointercancel", onKeyPointerUp);
      keyButton?.removeEventListener("pointerleave", onKeyPointerUp);
      keyButton?.removeEventListener("click", onKeyClick);
      audio.destroy();
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
