import { createLatheAudio } from "./latheAudio";
import { createLatheGL } from "./latheGL";
import {
  A1,
  BETA_REST,
  OMEGA,
  PITCH,
  R_TOP,
  ROWS,
  TAU,
  TURN_SECONDS,
  U_MAX,
  W,
  betaForRadius,
  clearGroove,
  createGroove,
  offsetAt,
  presetTake,
  radiusAt,
  sampleAt,
  stylusAt,
  writeSpan,
} from "./latheCut";

const FULL = [-262, -250, 386, 250];
const TIGHT = [-198, -206, 318, 206];
const CHIP_N = 32;
const HOSE_N = 14;
const SWAP_TIME = 1.7;
const HOSE_END = [384, 250];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod1 = (x) => x - Math.floor(x);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function bezier(a, b, c, d, t) {
  const s = 1 - t;
  return [
    s * s * s * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t * t * t * d[0],
    s * s * s * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t * t * t * d[1],
  ];
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function createLatheEngine({ box, stage, canvas, readout, insets, onSound, onReady, onFail, onAnnounce, onState }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, scale: 1, cx: 0, cy: 0, eye: [0, 0, 1500], quality: 1, rot: 0 };
  const groove = createGroove();
  const audio = createLatheAudio();
  const plat = { phi: 0, w: 0 };
  const hand = { id: null, y0: 0, y: 0, key: 0, keyHeld: false };
  const cut = { u: presetTake(groove), lift: 1, vl: 0, held: false, session: false, w: 0, g: 0, wPrev: 0, depth: 0, full: false };
  const arm = { beta: BETA_REST, vb: 0, lift: 0, vl: 0, stage: "idle", u: 0, start: 0, target: BETA_REST, disp: 0 };
  const lens = { x: radiusAt(cut.u), y: 0, kind: 0 };
  const chip = { start: 0, end: 0, flow: 0, hose: 0 };
  const swap = { t: -1, fromU: 0, swapped: false };
  const chipBuf = new Float32Array(CHIP_N * 4);
  const hoseBuf = new Float32Array(HOSE_N * 4);
  const chipBox = new Float32Array(4);
  const hoseBox = new Float32Array(4);
  const uni = {
    plat: new Float32Array(4),
    cut: new Float32Array(4),
    arm: new Float32Array(4),
    lens: new Float32Array(4),
    groove: new Float32Array([ROWS, W, R_TOP, PITCH]),
    chipInfo: new Float32Array(4),
  };
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let soundState = "off";
  let userMuted = false;
  let readySent = false;
  let readoutText = "";
  let stateKey = "";
  let interval = 16;
  let slowFrames = 0;
  let clock = 0;
  let prevSample = { w: 0, g: 0, depth: 0 };
  let lastSlide = { y: 0, lift: 0 };

  function emitState() {
    const canPlay = groove.first >= 0 && swap.t < 0;
    const playing = arm.stage !== "idle" && arm.stage !== "return";
    const key = `${canPlay}|${playing}|${cut.full}`;
    if (key === stateKey) return;
    stateKey = key;
    onState({ canPlay, playing, full: cut.full });
  }

  function updateReadout() {
    if (!readout) return;
    const cutSec = (groove.samples / W) * TURN_SECONDS;
    const leftSec = Math.max(0, (U_MAX - cut.u) * TURN_SECONDS);
    const text = cut.full ? `${formatTime(cutSec)} cut · side full` : `${formatTime(cutSec)} cut · ${formatTime(leftSec)} left`;
    if (text === readoutText) return;
    readoutText = text;
    readout.textContent = text;
  }

  function setSound(next) {
    if (next === soundState) return;
    soundState = next;
    onSound(next);
  }

  function startAudio() {
    if (userMuted) return;
    if (!audio.started) {
      if (audio.start()) {
        setSound("on");
        onAnnounce("Sound on.");
      }
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
    if (!userMuted) audio.wake();
    setSound(userMuted ? "muted" : "on");
    onAnnounce(userMuted ? "Sound off." : "Sound on.");
    wake();
  }

  function layout() {
    const pad = insets();
    const aw = Math.max(80, view.width - pad.left - pad.right);
    const ah = Math.max(80, view.height - pad.top - pad.bottom);
    view.rot = view.width / view.height < 0.8 ? 1 : 0;
    const turn = (f) => (view.rot ? [-f[3], f[0], -f[1], f[2]] : f);
    const fit = (f) => Math.min(aw / (f[2] - f[0]), ah / (f[3] - f[1]));
    const full = fit(turn(FULL));
    const tight = fit(turn(TIGHT));
    const useTight = view.width < 520 || full * 1.5 < tight;
    const frame = turn(useTight ? TIGHT : FULL);
    const scale = useTight ? tight : full;
    const fw = (frame[2] - frame[0]) * scale;
    const fh = (frame[3] - frame[1]) * scale;
    view.scale = scale;
    view.cx = pad.left + (aw - fw) / 2 - frame[0] * scale;
    view.cy = pad.top + (ah - fh) / 2 - frame[1] * scale;
    view.eye = [...toWorld([(frame[0] + frame[2]) / 2, (frame[1] + frame[3]) / 2]), 1500];
  }

  function toWorld(sp) {
    return view.rot ? [sp[1], -sp[0]] : sp;
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2200000 / Math.max(1, view.width * view.height));
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    applyQuality(view.quality);
    wake();
  }

  function applyQuality(q) {
    view.quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function wRange() {
    return clamp(view.height * 0.2, 80, 200);
  }

  function beginCut() {
    if (swap.t >= 0) return;
    if (arm.stage !== "idle" && arm.stage !== "return") stopPlay(false);
    if (cut.full) {
      onAnnounce("This side is full. Swap in a new blank.");
      return;
    }
    if (!cut.session) {
      let jump = mod1(plat.phi / TAU - cut.u);
      if (jump > 0.999) jump = 0;
      cut.u += jump;
      cut.session = true;
    }
    cut.held = true;
    wake();
  }

  function endCut() {
    cut.held = false;
    wake();
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (hand.id !== null) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture?.(e.pointerId);
    hand.id = e.pointerId;
    hand.y = e.clientY;
    hand.y0 = e.clientY + cut.w * wRange();
    startAudio();
    beginCut();
    stage.style.cursor = "grabbing";
  }

  function onMove(e) {
    if (e.pointerId !== hand.id) return;
    hand.y = e.clientY;
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== hand.id) return;
    hand.id = null;
    endCut();
    stage.style.cursor = "";
  }

  function onKey(e) {
    if (e.target !== stage) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (e.repeat || hand.keyHeld) return;
      hand.keyHeld = true;
      startAudio();
      hand.y = 0;
      hand.y0 = cut.w * wRange();
      beginCut();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      hand.key = e.key === "ArrowUp" ? 1 : -1;
      wake();
    } else if (e.key === "p" || e.key === "P") {
      togglePlay();
    } else if (e.key === "n" || e.key === "N") {
      newBlank();
    } else if (e.key === "m" || e.key === "M") {
      toggleSound();
    }
  }

  function onKeyUp(e) {
    if ((e.key === " " || e.key === "Enter") && hand.keyHeld) {
      hand.keyHeld = false;
      endCut();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      hand.key = 0;
    }
  }

  function onBlur() {
    if (hand.keyHeld) {
      hand.keyHeld = false;
      endCut();
    }
    hand.key = 0;
  }

  function togglePlay() {
    if (arm.stage !== "idle" && arm.stage !== "return") {
      stopPlay(true);
      return;
    }
    if (groove.first < 0 || swap.t >= 0) return;
    if (cut.held) return;
    startAudio();
    arm.stage = "swing";
    arm.start = groove.first;
    arm.target = betaForRadius(radiusAt(groove.first));
    onAnnounce("Needle cueing to the start of the cut.");
    emitState();
    wake();
  }

  function stopPlay(announce) {
    if (arm.stage === "idle") return;
    arm.stage = "return";
    if (announce) onAnnounce("Needle lifted.");
    emitState();
    wake();
  }

  function newBlank() {
    if (swap.t >= 0) return;
    stopPlay(false);
    cut.held = false;
    hand.id = null;
    hand.keyHeld = false;
    swap.t = 0;
    swap.fromU = cut.u;
    swap.swapped = false;
    onAnnounce("Lifting the cut lacquer off. Fresh blank going on.");
    emitState();
    wake();
  }

  function matchU(prev, s) {
    const theta = Math.atan2(s[1], s[0]);
    const target = mod1((plat.phi - theta) / TAU);
    let d = target - mod1(prev);
    d -= Math.round(d);
    return prev + d;
  }

  function springArm(dt, omega) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = omega * omega * (arm.target - arm.beta) - 2 * omega * arm.vb;
      arm.vb += a * h;
      arm.beta += arm.vb * h;
    }
    if (reduced) {
      arm.beta = arm.target;
      arm.vb = 0;
    }
  }

  function liftTo(obj, target, dt, up, down) {
    const omega = target > obj.lift ? up : down;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = omega * omega * (target - obj.lift) - 2 * omega * obj.vl;
      obj.vl += a * h;
      obj.lift += obj.vl * h;
    }
    obj.lift = clamp(obj.lift, 0, 1);
    if (Math.abs(obj.lift - target) < 0.0015 && Math.abs(obj.vl) < 0.01) {
      obj.lift = target;
      obj.vl = 0;
    }
  }

  function stepArm(dt) {
    if (arm.stage === "swing") {
      liftTo(arm, 1, dt, 14, 14);
      if (arm.lift > 0.6) springArm(dt, 6.5);
      const settled = Math.abs(arm.beta - arm.target) < 0.003 && Math.abs(arm.vb) < 0.03;
      if (settled && arm.lift > 0.97 && plat.w > OMEGA * 0.92) {
        arm.stage = "lower";
        arm.u = matchU(arm.start - 0.3, stylusAt(arm.beta));
      }
    } else if (arm.stage === "lower") {
      arm.u = matchU(arm.u, stylusAt(arm.beta));
      arm.target = betaForRadius(radiusAt(arm.u));
      springArm(dt, 10);
      liftTo(arm, 0, dt, 12, 9);
      if (arm.lift <= 0.002) {
        arm.stage = "ride";
        onAnnounce("Playing back the cut.");
      }
    } else if (arm.stage === "ride") {
      arm.u = matchU(arm.u, stylusAt(arm.beta));
      const sample = sampleAt(groove, arm.u);
      arm.disp = sample.depth > 0.01 ? offsetAt(sample, 0) : 0;
      arm.beta = betaForRadius(radiusAt(arm.u) + arm.disp);
      arm.target = arm.beta;
      arm.vb = 0;
      if (arm.u > groove.last + 0.12 || arm.u >= U_MAX) {
        arm.stage = "return";
        onAnnounce("End of the cut. Needle returning.");
        emitState();
      }
    } else if (arm.stage === "return") {
      arm.disp = 0;
      liftTo(arm, arm.beta > BETA_REST + 0.004 || arm.beta < BETA_REST - 0.004 ? 1 : 0, dt, 18, 8);
      arm.target = BETA_REST;
      if (arm.lift > 0.7) springArm(dt, 7);
      if (Math.abs(arm.beta - BETA_REST) < 0.004 && Math.abs(arm.vb) < 0.03) {
        arm.beta = BETA_REST;
        arm.vb = 0;
        if (arm.lift <= 0.002) {
          arm.stage = "idle";
          emitState();
        }
      }
    }
  }

  function stepSwap(dt) {
    if (swap.t < 0) return { y: 0, lift: 0 };
    swap.t += dt / SWAP_TIME;
    const t = swap.t;
    const carry = smoother(clamp(t / 0.85, 0, 1));
    cut.u = swap.fromU * (1 - carry);
    let y = 0;
    let lift = 0;
    if (t < 0.5) {
      const k = clamp(t / 0.5, 0, 1);
      lift = smoother(clamp(k / 0.3, 0, 1));
      const s = clamp((k - 0.18) / 0.82, 0, 1);
      y = 600 * s * s * (3 - 2 * s) * (0.35 + 0.65 * s);
    } else {
      if (!swap.swapped) {
        swap.swapped = true;
        clearGroove(groove);
        cut.full = false;
        cut.session = false;
        if (gl) gl.upload(groove);
      }
      const k = clamp((t - 0.5) / 0.5, 0, 1);
      const s = 1 - Math.pow(1 - k, 3);
      y = 600 * (1 - s);
      lift = 1 - smoother(clamp((k - 0.62) / 0.38, 0, 1));
    }
    if (t >= 1) {
      swap.t = -1;
      cut.u = 0;
      y = 0;
      lift = 0;
      onAnnounce("New blank on the platter.");
      emitState();
    }
    return { y, lift };
  }

  function fillChip(tip, mouth) {
    let n = 0;
    let minx = 1e9;
    let miny = 1e9;
    let maxx = -1e9;
    let maxy = -1e9;
    if (chip.end > chip.start + 0.002) {
      const c1 = [tip[0] - 7, tip[1] + 15];
      const c2 = [mouth[0] - 9, mouth[1] + 12];
      for (let i = 0; i < CHIP_N; i++) {
        const s = chip.start + ((chip.end - chip.start) * i) / (CHIP_N - 1);
        const p = bezier(tip, c1, c2, mouth, s);
        const q = bezier(tip, c1, c2, mouth, Math.min(1, s + 0.01));
        const pq = bezier(tip, c1, c2, mouth, Math.max(0, s - 0.01));
        let tx = q[0] - pq[0];
        let ty = q[1] - pq[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const coil = 0.5 + 1.9 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.7);
        const ph = TAU * (4.2 * s - chip.flow);
        const off = coil * Math.sin(ph);
        const x = p[0] - ty * off;
        const y = p[1] + tx * off;
        const hw = 0.2 + 0.08 * Math.sin(s * 9.0);
        chipBuf[n * 4] = x;
        chipBuf[n * 4 + 1] = y;
        chipBuf[n * 4 + 2] = hw * (s < 0.04 ? s / 0.04 : 1);
        chipBuf[n * 4 + 3] = ph + Math.PI / 2;
        minx = Math.min(minx, x);
        miny = Math.min(miny, y);
        maxx = Math.max(maxx, x);
        maxy = Math.max(maxy, y);
        n += 1;
      }
    }
    chipBox[0] = minx;
    chipBox[1] = miny;
    chipBox[2] = maxx;
    chipBox[3] = maxy;
    return n;
  }

  function fillHose(mouth) {
    const sr = mouth[0] - 5;
    const c1 = [sr + 12, 78];
    const c2 = [sr + 104, 124];
    let len = 0;
    let prev = mouth;
    let minx = 1e9;
    let miny = 1e9;
    let maxx = -1e9;
    let maxy = -1e9;
    for (let i = 0; i < HOSE_N; i++) {
      const t = i / (HOSE_N - 1);
      const p = bezier(mouth, c1, c2, HOSE_END, t);
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      hoseBuf[i * 4] = p[0];
      hoseBuf[i * 4 + 1] = p[1];
      hoseBuf[i * 4 + 2] = len;
      hoseBuf[i * 4 + 3] = 0;
      minx = Math.min(minx, p[0]);
      miny = Math.min(miny, p[1]);
      maxx = Math.max(maxx, p[0]);
      maxy = Math.max(maxy, p[1]);
    }
    hoseBox[0] = minx;
    hoseBox[1] = miny;
    hoseBox[2] = maxx;
    hoseBox[3] = maxy;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0.001, 0.05);
    last = now;
    clock += dt;

    const slide = stepSwap(dt);
    lastSlide = slide;
    const playing = arm.stage === "swing" || arm.stage === "lower" || arm.stage === "ride";
    const motor = (cut.held && !cut.full) || playing;
    if (motor) plat.w += (OMEGA - plat.w) * (1 - Math.exp(-dt / 0.26));
    else plat.w = Math.max(0, plat.w - (plat.w / 0.6 + 0.35) * dt);
    if (Math.abs(plat.w - OMEGA) < 1e-4) plat.w = OMEGA;
    const dPhi = plat.w * dt;
    plat.phi += dPhi;
    if (!motor && plat.w === 0) cut.session = false;

    if (hand.keyHeld && hand.key) hand.y -= hand.key * wRange() * 1.6 * dt;
    let wTarget = cut.w;
    if (cut.held) wTarget = clamp((hand.y0 - hand.y) / wRange(), -1, 1);
    else wTarget = cut.w * Math.exp(-dt / 0.6);
    const wNew = cut.w + (wTarget - cut.w) * (1 - Math.exp(-dt / 0.035));
    const speed = Math.abs(wNew - cut.w) / dt;
    const gTarget = cut.held ? clamp(speed / 2.6, 0, 1) : 0;
    cut.g += (gTarget - cut.g) * (1 - Math.exp(-dt / (gTarget > cut.g ? 0.03 : 0.16)));
    cut.w = wNew;

    const wantDown = cut.held && !cut.full && plat.w > OMEGA * 0.6 && swap.t < 0;
    liftTo(cut, wantDown ? 0 : 1, dt, 30, 15);
    cut.depth = clamp(1 - cut.lift / 0.22, 0, 1);

    if (cut.session && swap.t < 0) {
      const uNew = cut.u + dPhi / TAU;
      const next = { w: cut.w, g: cut.g, depth: cut.depth };
      if (uNew > cut.u) writeSpan(groove, cut.u, uNew, prevSample, next);
      prevSample = next;
      cut.u = uNew;
      if (cut.u >= U_MAX && !cut.full) {
        cut.full = true;
        cut.held = false;
        onAnnounce("This side is full. Swap in a new blank.");
        emitState();
      }
    } else prevSample = { w: cut.w, g: cut.g, depth: 0 };
    if (groove.hi >= groove.lo) gl.upload(groove);

    stepArm(dt);

    const cutting = cut.depth > 0.6 && plat.w > 0.5;
    if (cutting) {
      if (chip.start > 0.02 && chip.end >= 1) {
        chip.start = 0;
        chip.end = 0.02;
      }
      chip.start = Math.max(0, chip.start - dt / 0.12);
      chip.end = Math.min(1, chip.end + dt / 0.28);
    } else if (chip.end > 0) {
      chip.start = Math.min(chip.end, chip.start + dt / 0.32);
      if (chip.start >= chip.end - 0.001) {
        chip.start = 0;
        chip.end = 0;
      }
    }
    if (!reduced) chip.flow += dt * 2.6 * (plat.w / OMEGA);
    chip.hose += ((chip.end > 0 ? 1 : 0) - chip.hose) * (1 - Math.exp(-dt / (chip.end > 0 ? 0.3 : 0.9)));
    if (chip.hose < 0.002) chip.hose = 0;

    const sr = radiusAt(cut.u);
    const tipDisp = cut.depth > 0 ? cut.w * A1 : cut.w * A1 * 0.5;
    const tip = [sr + tipDisp, 0];
    const needleFocus = arm.stage === "lower" || arm.stage === "ride";
    const focus = needleFocus ? stylusAt(arm.beta) : tip;
    const k = reduced ? 1 : 1 - Math.exp(-dt / 0.22);
    const lensKind = needleFocus ? 1 : 0;
    if (lensKind !== lens.kind) lens.kind = lensKind;
    lens.x += (focus[0] - lens.x) * k;
    lens.y += (focus[1] - lens.y) * k;

    const ampAudio = updateAudio();
    if (raw > 0) {
      interval = interval * 0.85 + raw * 0.15;
      if (interval > 30) slowFrames += 1;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 40 && view.quality > 0.6) {
        applyQuality(Math.max(0.6, view.quality * 0.85));
        slowFrames = 0;
      }
    }
    render(dt, slide, sr, tip);
    updateReadout();

    const lensMoving = Math.hypot(focus[0] - lens.x, focus[1] - lens.y) > 0.01;
    const busy =
      plat.w > 0 ||
      cut.held ||
      cut.lift < 1 ||
      Math.abs(cut.w) > 0.002 ||
      cut.g > 0.002 ||
      arm.stage !== "idle" ||
      chip.end > 0 ||
      chip.hose > 0 ||
      swap.t >= 0 ||
      lensMoving ||
      ampAudio > 0.002;
    if (busy) raf = requestAnimationFrame(frame);
    else {
      lens.x = focus[0];
      lens.y = focus[1];
      cut.w = 0;
      cut.g = 0;
      audio.sleep();
    }
  }

  let audioLevel = 0;

  function updateAudio() {
    let freq = 220;
    let amp = 0;
    let noiseAmp = 0;
    let noiseFreq = 2400;
    const speed = plat.w / OMEGA;
    if (arm.stage === "ride") {
      const s = sampleAt(groove, arm.u);
      freq = 220 * Math.pow(2, 1.25 * s.w) * speed;
      amp = s.depth * (0.16 + 0.84 * s.g);
      noiseAmp = 0.5 * speed;
      noiseFreq = 1800;
    } else if (arm.stage === "lower") {
      noiseAmp = 0;
    }
    if (cut.depth > 0.01) {
      freq = 220 * Math.pow(2, 1.25 * cut.w);
      amp = Math.max(amp, cut.depth * (0.1 + 0.4 * cut.g));
      noiseAmp = Math.max(noiseAmp, cut.depth * 0.35);
      noiseFreq = 5200;
    }
    audioLevel += (amp + noiseAmp * 0.2 - audioLevel) * 0.2;
    audio.update({ freq, amp, noiseAmp, noiseFreq });
    return audioLevel;
  }

  function render(dt, slide, sr, tip) {
    if (!gl) return;
    const mouth = [sr + 5, 13];
    const n = fillChip(tip, mouth);
    fillHose(mouth);
    const s = stylusAt(arm.beta);
    uni.plat[0] = plat.phi % TAU;
    uni.plat[1] = plat.w;
    uni.plat[2] = slide.y;
    uni.plat[3] = slide.lift;
    uni.cut[0] = sr;
    uni.cut[1] = cut.lift;
    uni.cut[2] = tip[0] - sr;
    uni.cut[3] = cut.depth;
    uni.arm[0] = arm.beta;
    uni.arm[1] = arm.lift;
    uni.arm[2] = s[0];
    uni.arm[3] = s[1];
    uni.lens[0] = lens.x;
    uni.lens[1] = lens.y;
    uni.lens[2] = lens.kind;
    uni.lens[3] = reduced ? 0 : clamp((plat.w / OMEGA - 0.08) / 0.5, 0, 1);
    uni.chipInfo[0] = n;
    uni.chipInfo[1] = reduced ? 0 : clock;
    uni.chipInfo[2] = chip.hose;
    uni.chipInfo[3] = 0;
    gl.draw({
      dpr: view.dpr * view.quality,
      cx: view.cx,
      cy: view.cy,
      scale: view.scale,
      eye: view.eye,
      rot: view.rot,
      plat: uni.plat,
      cut: uni.cut,
      arm: uni.arm,
      lens: uni.lens,
      groove: uni.groove,
      chip: chipBuf,
      chipInfo: uni.chipInfo,
      chipBox,
      hose: hoseBuf,
      hoseBox,
    });
    if (!readySent) {
      readySent = true;
      onReady();
    }
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createLatheGL(canvas);
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    groove.lo = 0;
    groove.hi = ROWS - 1;
    gl.upload(groove);
    resize();
    emitState();
    updateReadout();
    render(1 / 60, { y: 0, lift: 0 }, radiusAt(cut.u), [radiusAt(cut.u), 0]);
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
    if (gl) render(1 / 60, lastSlide, radiusAt(cut.u), [radiusAt(cut.u) + cut.w * A1 * (cut.depth > 0 ? 1 : 0.5), 0]);
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      audio.sleep();
      if (cut.held) endCut();
      hand.id = null;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);
  stage.addEventListener("blur", onBlur);

  return {
    toggleSound,
    togglePlay,
    newBlank,
    playFromButton() {
      startAudio();
      togglePlay();
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
      audio.destroy();
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
