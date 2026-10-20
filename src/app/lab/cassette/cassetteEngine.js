import { createChatter } from "./cassetteAudio";
import { GROUND, PENCIL, SHELL, buildWorld, setPackTop } from "./cassetteModels";
import { HUBS, SIDE_SECONDS, SLACK_MAX, TOTAL, TAPE_HALF, TAPE_Y, MOUTH, createTape, loopHeightFor, packRadius, stepTape, tapePath } from "./cassetteTape";
import { labelCanvas } from "./cassetteTextures";

const MAX_DPR = 2;
const FOV = 24;
const ELEVATION = (57 * Math.PI) / 180;
const AZIMUTH = (-5 * Math.PI) / 180;
const PIVOT_Y = 7.4;
const INSERT = 6.8;
const HOVER_Y = 15.5;
const CARRY_Y = 26;
const TAP_PX = 7;
const TAP_SECONDS = 0.34;
const MAX_LEAN = 0.36;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t) => t * t * (2.2 * t - 1.2 * t * t);

export async function createCassetteEngine({ box, stage, canvas, insets, embedded, mix, onReady, onFail, onSound, onPencil, onAnnounce }) {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    onFail?.();
    return { destroy() {}, toggleSound() {}, togglePencil() {} };
  }
  renderer.setClearColor(new THREE.Color(GROUND));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.36;
  pmrem.dispose();

  const world = buildWorld(THREE, renderer, mix);
  scene.add(world.root);

  const lamp = new THREE.SpotLight(0xfff0e0, 2.8, 0, 0.6, 0.9, 0);
  lamp.position.set(-230, 430, -200);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 200;
  lamp.shadow.camera.far = 900;
  lamp.shadow.radius = 5;
  lamp.shadow.blurSamples = 16;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.25;
  scene.add(lamp);
  scene.add(lamp.target);
  const hemi = new THREE.HemisphereLight(0xfffaf2, 0xb9b4aa, 0.6);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xdfe7ff, 0.32);
  fill.position.set(300, 200, 260);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 3000);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const planeHit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const Y = new THREE.Vector3(0, 1, 0);

  const tape = createTape(0.38);
  const pathPoints = [];
  const loop = { h: 0, v: 0 };
  let radiusShown = [-1, -1];

  const layout = { portrait: false, rest: { base: new THREE.Vector3(), quat: new THREE.Quaternion(), dir: new THREE.Vector3() } };
  const pencil = {
    mode: "rest",
    hub: -1,
    base: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    target: { base: new THREE.Vector3(), quat: new THREE.Quaternion() },
    offset: 0,
    lean: new THREE.Vector2(),
    leanVel: new THREE.Vector2(),
    leanTarget: new THREE.Vector2(),
    fly: null,
    grab: 60,
    near: 0,
    nearHub: -1,
    carry: new THREE.Vector3(),
    settled: true,
  };
  const press = { id: null, x: 0, y: 0, moved: 0, age: 0, hitPencil: false, hitHub: -1, kind: null };
  const drive = { hub: -1, held: false, target: 0, psi: 0, lastAngle: 0 };
  const view = { width: 1, height: 1 };
  let song = mix.lead;
  const chatter = createChatter("/blog/audio/friday-beat.wav", () => song);
  let soundState = "off";
  let userMuted = false;
  let raf = 0;
  let last = 0;
  let visible = false;
  let destroyed = false;
  let readySent = false;
  let hover = "";
  let keyImpulse = 0;
  let quietFrames = 0;

  function restPoseFor(portrait) {
    const base = portrait ? new THREE.Vector3(-60, PENCIL.inR, -54) : new THREE.Vector3(-58, PENCIL.inR + 0.2, -57);
    const angle = portrait ? (-3 * Math.PI) / 180 : (-4 * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const a = new THREE.Vector3(Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6));
    const b = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Vector3().crossVectors(a, b);
    const A = new THREE.Vector3(0, -1, 0);
    const B = dir.clone();
    const C = new THREE.Vector3().crossVectors(A, B);
    const local = new THREE.Matrix4().makeBasis(a, b, c);
    const worldM = new THREE.Matrix4().makeBasis(A, B, C);
    const m = worldM.multiply(local.transpose());
    const quat = new THREE.Quaternion().setFromRotationMatrix(m);
    return { base, quat, dir };
  }

  function applyLayout() {
    const portrait = view.height > view.width * 1.12;
    layout.portrait = portrait;
    layout.rest = restPoseFor(portrait);
    lamp.target.position.set(portrait ? 0 : 40, 0, portrait ? 40 : 10);
    if (pencil.mode === "rest") {
      pencil.base.copy(layout.rest.base);
      pencil.quat.copy(layout.rest.quat);
    }
  }

  function framePoints() {
    const pts = [];
    const hw = SHELL.w / 2 + 2;
    const hd = SHELL.d / 2;
    for (const x of [-hw, hw]) for (const z of [-hd - 2, hd + 4]) pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, SHELL.h, z));
    const loopH = loopHeightFor(SLACK_MAX);
    const loopZ = MOUTH.z + loopH * 0.9;
    const loopX = MOUTH.x + Math.max(0, loopH - 4) * 0.84;
    pts.push(new THREE.Vector3(-loopX, 0, loopZ), new THREE.Vector3(loopX, 0, loopZ));
    const rest = layout.rest;
    pts.push(rest.base.clone(), rest.base.clone().addScaledVector(rest.dir, PENCIL.length));
    for (const hub of HUBS) pts.push(new THREE.Vector3(hub.x, PENCIL.length + HOVER_Y, hub.z));
    return pts;
  }

  function fitCamera() {
    const pad = insets();
    const w = view.width;
    const h = view.height;
    camera.aspect = w / h;
    camera.fov = FOV;
    camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION));
    const pts = framePoints();
    const target = new THREE.Vector3();
    for (const p of pts) target.add(p);
    target.multiplyScalar(1 / pts.length);
    target.y = 0;
    let dist = 520;
    const x0 = -1 + (2 * pad.left) / w;
    const x1 = 1 - (2 * pad.right) / w;
    const y0 = -1 + (2 * pad.bottom) / h;
    const y1 = 1 - (2 * pad.top) / h;
    const v = new THREE.Vector3();
    for (let it = 0; it < 8; it += 1) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        v.copy(p).project(camera);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
      const scale = Math.max((maxX - minX) / (x1 - x0), (maxY - minY) / (y1 - y0));
      const halfH = Math.tan((FOV * Math.PI) / 360) * dist;
      const halfW = halfH * camera.aspect;
      const offX = (minX + maxX) / 2 - (x0 + x1) / 2;
      const offY = (minY + maxY) / 2 - (y0 + y1) / 2;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const fwd = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
      target.addScaledVector(right, offX * halfW);
      target.addScaledVector(fwd, (offY * halfH) / Math.sin(ELEVATION));
      dist *= 0.35 + 0.65 * scale;
    }
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    view.width = w;
    view.height = h;
    renderer.setPixelRatio(Math.min(MAX_DPR, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    applyLayout();
    fitCamera();
    wake();
  }

  function setNdc(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function hitPlane(y) {
    plane.constant = -y;
    return raycaster.ray.intersectPlane(plane, planeHit) ? planeHit.clone() : null;
  }

  function hitPencil() {
    world.pencil.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(world.pencilHit, false);
    return hits[0] || null;
  }

  function hubAt(point, reach = 14) {
    if (!point) return -1;
    let best = -1;
    let bestD = reach;
    HUBS.forEach((hub, i) => {
      const d = Math.hypot(point.x - hub.x, point.z - hub.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function seatPose(i, out) {
    const hub = HUBS[i];
    const axis = new THREE.Vector3(pencil.lean.x, 1, pencil.lean.y).normalize();
    const tilt = new THREE.Quaternion().setFromUnitVectors(Y, axis);
    const spin = new THREE.Quaternion().setFromAxisAngle(Y, tape.theta[i] + pencil.offset);
    out.quat.copy(tilt).multiply(spin);
    out.base.set(hub.x, PIVOT_Y, hub.z).addScaledVector(axis, -INSERT);
    return out;
  }

  function hoverPose(i, out) {
    const hub = HUBS[i];
    const spin = new THREE.Quaternion().setFromAxisAngle(Y, tape.theta[i] + pencil.offset);
    out.quat.copy(spin);
    out.base.set(hub.x, HOVER_Y, hub.z);
    return out;
  }

  function nearestOffset(i) {
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(pencil.quat);
    const current = Math.atan2(-axis.z, axis.x);
    const step = Math.PI / 3;
    const raw = current - tape.theta[i];
    return Math.round(raw / step) * step;
  }

  function setMode(mode, hub = -1) {
    pencil.mode = mode;
    pencil.hub = hub;
    onPencil?.(mode === "seated" ? (hub === 0 ? "left" : "right") : mode);
  }

  function flyTo(kind, hub = -1) {
    const from = { base: pencil.base.clone(), quat: pencil.quat.clone() };
    let to;
    let dur;
    let lift;
    if (kind === "rest") {
      to = { base: layout.rest.base.clone(), quat: layout.rest.quat.clone() };
      dur = reduced ? 0.2 : 0.58;
      lift = reduced ? 0 : 22;
    } else {
      pencil.offset = nearestOffset(hub);
      to = hoverPose(hub, { base: new THREE.Vector3(), quat: new THREE.Quaternion() });
      const d = from.base.distanceTo(to.base);
      dur = reduced ? 0.16 : clamp(0.28 + d / 420, 0.3, 0.62);
      lift = reduced ? 0 : clamp(d * 0.12, 4, 26);
    }
    pencil.fly = { kind, hub, from, to, t: 0, dur, lift };
    pencil.lean.set(0, 0);
    pencil.leanVel.set(0, 0);
    setMode("fly", hub);
    wake();
  }

  function dropInto(hub) {
    pencil.offset = nearestOffset(hub);
    const from = { base: pencil.base.clone(), quat: pencil.quat.clone() };
    const to = seatPose(hub, { base: new THREE.Vector3(), quat: new THREE.Quaternion() });
    pencil.fly = { kind: "drop", hub, from, to, t: 0, dur: reduced ? 0.08 : 0.2, lift: 0 };
    setMode("fly", hub);
    wake();
  }

  function unseat() {
    if (pencil.mode !== "seated") return;
    drive.held = false;
    drive.hub = -1;
    flyTo("rest");
    onAnnounce?.("Pencil laid down.");
  }

  function seatHub(i) {
    if (pencil.mode === "seated" && pencil.hub === i) return;
    drive.held = false;
    drive.hub = -1;
    flyTo("hub", i);
    onAnnounce?.(`Pencil in the ${i === 0 ? "left" : "right"} hub. Circle to wind.`);
  }

  function setSound(next) {
    if (next === soundState) return;
    soundState = next;
    onSound?.(next);
  }

  function startAudio() {
    if (userMuted) return;
    if (!chatter.started) {
      chatter.start();
      setSound("on");
    } else chatter.wake();
  }

  function toggleSound() {
    if (!chatter.started) {
      userMuted = false;
      startAudio();
      onAnnounce?.("Sound on.");
      return;
    }
    userMuted = soundState === "on";
    chatter.setMuted(userMuted);
    setSound(userMuted ? "muted" : "on");
    onAnnounce?.(userMuted ? "Sound off." : "Sound on.");
  }

  function pointerAngle(i, point) {
    const hub = HUBS[i];
    const dx = point.x - hub.x;
    const dz = point.z - hub.z;
    return { angle: Math.atan2(-dz, dx), r: Math.hypot(dx, dz), dx, dz };
  }

  function beginWind(point) {
    const i = pencil.hub;
    const a = pointerAngle(i, point);
    drive.hub = i;
    drive.held = true;
    drive.target = tape.theta[i];
    drive.lastAngle = a.angle;
    drive.r = a.r;
    updateLean(a);
  }

  function updateLean(a) {
    const k = MAX_LEAN * smoothstep(3, 34, a.r);
    const len = Math.max(1e-3, a.r);
    pencil.leanTarget.set((a.dx / len) * Math.tan(k), (a.dz / len) * Math.tan(k));
  }

  function moveWind(point) {
    const a = pointerAngle(drive.hub, point);
    let d = a.angle - drive.lastAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    const weight = smoothstep(2, 7, a.r);
    drive.target += d * weight;
    drive.lastAngle = a.angle;
    const lag = drive.target - tape.theta[drive.hub];
    if (Math.abs(lag) > 1.4) drive.target = tape.theta[drive.hub] + Math.sign(lag) * 1.4;
    updateLean(a);
  }

  function onDown(e) {
    if (e.button > 0 || press.id !== null) return;
    if (e.target.closest?.("button, a")) return;
    setNdc(e);
    const hit = hitPencil();
    const p12 = hitPlane(SHELL.h);
    press.id = e.pointerId;
    press.x = e.clientX;
    press.y = e.clientY;
    press.moved = 0;
    press.age = 0;
    press.hitPencil = Boolean(hit);
    press.hitHub = hubAt(p12);
    press.kind = null;
    stage.setPointerCapture?.(e.pointerId);
    if (pencil.mode === "seated") {
      press.kind = "wind";
      if (p12) beginWind(p12);
      startAudio();
    } else if (hit && (pencil.mode === "rest" || pencil.mode === "fly")) {
      press.kind = "carry";
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(pencil.quat);
      pencil.grab = clamp(hit.point.clone().sub(pencil.base).dot(axis), 14, PENCIL.length - 14);
      pencil.fly = null;
      pencil.offsetHub = -1;
      setMode("held");
      const carry = hitPlane(CARRY_Y);
      if (carry) pencil.carry.copy(carry);
      box.setAttribute("data-grabbing", "");
    } else if (press.hitHub >= 0) {
      press.kind = "hub";
    } else {
      press.kind = "none";
    }
    wake();
  }

  function onMove(e) {
    if (press.id === null) {
      if (e.pointerType === "mouse") {
        setNdc(e);
        const overPencil = Boolean(hitPencil());
        const p12 = hitPlane(SHELL.h);
        const overHub = hubAt(p12) >= 0;
        let next = "";
        if (pencil.mode === "seated") next = overPencil ? "pencil-seated" : "wind";
        else if (overPencil) next = "pencil";
        else if (overHub) next = "hub";
        if (next !== hover) {
          hover = next;
          if (next) box.setAttribute("data-hover", next);
          else box.removeAttribute("data-hover");
        }
      }
      return;
    }
    if (e.pointerId !== press.id) return;
    press.moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y));
    setNdc(e);
    if (press.kind === "carry" && pencil.mode === "held") {
      const carry = hitPlane(CARRY_Y);
      if (carry) pencil.carry.copy(carry);
    } else if (press.kind === "wind" && drive.held) {
      const p12 = hitPlane(SHELL.h);
      if (p12) moveWind(p12);
    }
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== press.id) return;
    const tap = press.moved < TAP_PX && press.age < TAP_SECONDS;
    const kind = press.kind;
    press.id = null;
    box.removeAttribute("data-grabbing");
    if (kind === "carry" && pencil.mode === "held") {
      if (pencil.near > 0.5 && pencil.nearHub >= 0) {
        dropInto(pencil.nearHub);
        onAnnounce?.(`Pencil in the ${pencil.nearHub === 0 ? "left" : "right"} hub. Circle to wind.`);
      } else if (tap) {
        seatHub(1);
      } else flyTo("rest");
    } else if (kind === "wind") {
      drive.held = false;
      if (tap && press.hitPencil) unseat();
      else if (tap && press.hitHub >= 0 && press.hitHub !== pencil.hub) seatHub(press.hitHub);
    } else if (kind === "hub" && tap && pencil.mode !== "seated") {
      seatHub(press.hitHub);
    }
    wake();
  }

  function onKey(e) {
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      toggleSound();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      togglePencil();
      return;
    }
    if (e.key === "1" || e.key === "2") {
      e.preventDefault();
      seatHub(e.key === "1" ? 0 : 1);
      return;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && pencil.mode === "seated") {
      e.preventDefault();
      keyImpulse += e.key === "ArrowRight" ? -5 : 5;
      startAudio();
      wake();
    }
  }

  function togglePencil() {
    if (pencil.mode === "seated") unseat();
    else seatHub(1);
  }

  function stepPencil(dt) {
    const tgt = pencil.target;
    if (pencil.mode === "seated") {
      const springK = 1 - Math.exp(-dt * 60);
      if (drive.held) pencil.lean.lerp(pencil.leanTarget, 1 - Math.exp(-dt / 0.07));
      else {
        const w = 15;
        const z = 0.72;
        for (const c of ["x", "y"]) {
          const acc = -w * w * pencil.lean[c] - 2 * z * w * pencil.leanVel[c];
          pencil.leanVel[c] += acc * dt;
          pencil.lean[c] += pencil.leanVel[c] * dt;
        }
      }
      seatPose(pencil.hub, tgt);
      pencil.base.lerp(tgt.base, springK);
      pencil.quat.slerp(tgt.quat, springK);
      pencil.settled = !drive.held && pencil.lean.lengthSq() < 1e-7 && pencil.leanVel.lengthSq() < 1e-6;
      return;
    }
    if (pencil.mode === "fly" && pencil.fly) {
      const f = pencil.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.kind === "drop" ? easeIn(f.t) : easeInOut(f.t);
      if (f.kind === "drop") seatPose(f.hub, f.to);
      else if (f.kind === "hub") hoverPose(f.hub, f.to);
      pencil.base.lerpVectors(f.from.base, f.to.base, e);
      pencil.base.y += Math.sin(Math.PI * f.t) * f.lift;
      pencil.quat.slerpQuaternions(f.from.quat, f.to.quat, e);
      if (f.t >= 1) {
        if (f.kind === "rest") {
          pencil.fly = null;
          setMode("rest");
        } else if (f.kind === "hub") {
          dropInto(f.hub);
        } else {
          pencil.fly = null;
          pencil.lean.set(0, 0);
          pencil.leanVel.set(0, -0.05);
          setMode("seated", f.hub);
          chatter.tick(0.5);
        }
      }
      pencil.settled = false;
      return;
    }
    if (pencil.mode === "held") {
      let best = -1;
      let bestD = Infinity;
      HUBS.forEach((hub, i) => {
        const d = Math.hypot(pencil.carry.x - hub.x, pencil.carry.z - hub.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const near = smoothstep(34, 12, bestD);
      pencil.near = near;
      pencil.nearHub = best;
      const rest = layout.rest;
      const carryQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(rest.dir, Y).normalize(), -0.14).multiply(rest.quat);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(carryQuat);
      const farBase = pencil.carry.clone().addScaledVector(axis, -pencil.grab);
      farBase.y = Math.max(farBase.y, 4);
      if (best >= 0) {
        if (pencil.offsetHub !== best) {
          pencil.offset = nearestOffset(best);
          pencil.offsetHub = best;
        }
        hoverPose(best, tgt);
      }
      tgt.base.lerpVectors(farBase, tgt.base, near);
      tgt.quat.slerpQuaternions(carryQuat, tgt.quat, near);
      const kp = 1 - Math.exp(-dt / 0.05);
      const kr = 1 - Math.exp(-dt / 0.075);
      pencil.base.lerp(tgt.base, kp);
      pencil.quat.slerp(tgt.quat, kr);
      pencil.settled = false;
      return;
    }
    pencil.settled = true;
  }

  function placePencil() {
    world.pencil.position.copy(pencil.base);
    world.pencil.quaternion.copy(pencil.quat);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(pencil.quat);
    const flat = 1 - Math.abs(axis.y);
    const mid = pencil.base.clone().addScaledVector(axis, PENCIL.length / 2);
    const height = Math.max(0, mid.y - PENCIL.inR);
    const s = world.pencilShadow;
    s.position.set(mid.x, 0.05, mid.z);
    s.rotation.set(-Math.PI / 2, 0, Math.atan2(-axis.z, axis.x));
    const spread = 1 + height / 30;
    s.scale.set(Math.max(0.08, flat) * (1 + height / 160), spread, 1);
    s.material.opacity = 0.44 * flat * Math.exp(-height / 16);
    s.visible = s.material.opacity > 0.01;
  }

  function updateTape(dt) {
    const rl = packRadius(tape.length[0]);
    const rr = packRadius(tape.length[1]);
    const radii = [rl, rr];
    world.hubs.forEach((h, i) => {
      h.spin.rotation.y = tape.theta[i];
      if (Math.abs(radii[i] - radiusShown[i]) > 0.004) {
        radiusShown[i] = radii[i];
        setPackTop(h.topGeo, 10.95, radii[i]);
        h.side.scale.set(radii[i], 1, radii[i]);
      }
    });
    const want = loopHeightFor(tape.slack);
    const w = 17;
    if (reduced) {
      loop.h = want;
      loop.v = 0;
    } else {
      const acc = w * w * (want - loop.h) - 2 * w * loop.v;
      loop.v += acc * dt;
      loop.h = Math.max(0, loop.h + loop.v * dt);
    }
    tapePath(rl, rr, loop.h, pathPoints);
    writeRibbon();
  }

  function writeRibbon() {
    const pts = pathPoints;
    const n = Math.min(pts.length, world.tapeMax);
    const pos = world.tapeGeo.attributes.position.array;
    const nor = world.tapeGeo.attributes.normal.array;
    const edge = MOUTH.edge;
    for (let i = 0; i < n; i += 1) {
      const [x, z] = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const out = Math.max(0, z - edge + 1);
      const fall = smoothstep(0, 16, out);
      const twist = fall * 1.32 * smoothstep(0, 30, loop.h);
      const nx = -tz;
      const nz = tx;
      const wy = Math.cos(twist);
      const ws = Math.sin(twist);
      const wx = nx * ws;
      const wz = nz * ws;
      const yLow = TAPE_HALF * Math.abs(wy) + 0.08;
      const yc = TAPE_Y + (yLow - TAPE_Y) * fall;
      const k = i * 6;
      pos[k] = x - wx * TAPE_HALF;
      pos[k + 1] = yc - wy * TAPE_HALF;
      pos[k + 2] = z - wz * TAPE_HALF;
      pos[k + 3] = x + wx * TAPE_HALF;
      pos[k + 4] = yc + wy * TAPE_HALF;
      pos[k + 5] = z + wz * TAPE_HALF;
      const cx = wy * tz;
      const cy = wz * tx - wx * tz;
      const cz = -wy * tx;
      nor[k] = cx;
      nor[k + 1] = cy;
      nor[k + 2] = cz;
      nor[k + 3] = cx;
      nor[k + 4] = cy;
      nor[k + 5] = cz;
    }
    world.tapeGeo.attributes.position.needsUpdate = true;
    world.tapeGeo.attributes.normal.needsUpdate = true;
    world.tapeGeo.setDrawRange(0, (n - 1) * 6);
  }

  let speedSmooth = 0;
  function updateAudio(dt) {
    const tapeRate = (tape.speed / TOTAL) * SIDE_SECONDS;
    speedSmooth += (tapeRate - speedSmooth) * (1 - Math.exp(-dt / 0.05));
    const mag = Math.abs(speedSmooth);
    const rate = Math.sign(speedSmooth) * Math.min(5.5, 1.15 * Math.log2(1 + mag / 2.4));
    const gain = smoothstep(0.2, 5, mag) * 0.9;
    chatter.update(rate, gain);
    if (tape.snap > 25) chatter.tick(Math.min(0.9, tape.snap / 260));
    if (tape.stop > 0) chatter.tick(0.7);
  }

  function render() {
    renderer.render(scene, camera);
  }

  function simulate(dt) {
    if (press.id !== null) press.age += dt;
    if (keyImpulse && pencil.mode === "seated") {
      tape.omega[pencil.hub] += keyImpulse;
      keyImpulse = 0;
    }
    const driving = pencil.mode === "seated" && drive.held && drive.hub === pencil.hub ? drive : null;
    stepTape(tape, dt, driving);
    stepPencil(dt);
    placePencil();
    updateTape(dt);
    updateAudio(dt);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(1 / 30, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    if (dt <= 0) {
      raf = requestAnimationFrame(frame);
      return;
    }
    simulate(dt);
    render();
    if (!readySent) {
      readySent = true;
      onReady?.();
    }
    const spinning = Math.abs(tape.omega[0]) > 1e-3 || Math.abs(tape.omega[1]) > 1e-3;
    const loopBusy = Math.abs(loop.h - loopHeightFor(tape.slack)) > 0.01 || Math.abs(loop.v) > 0.01;
    const busy = press.id !== null || spinning || loopBusy || !pencil.settled || pencil.mode === "fly" || pencil.mode === "held" || Math.abs(speedSmooth) > 0.02;
    quietFrames = busy ? 0 : quietFrames + 1;
    if (quietFrames < 3 && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || destroyed || !visible || document.hidden) return;
    last = 0;
    quietFrames = 0;
    raf = requestAnimationFrame(frame);
  }

  function checkVisibility() {
    if (document.hidden || !visible) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      chatter.sleep();
      return;
    }
    if (!userMuted) chatter.wake();
    wake();
  }

  const lost = (e) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", lost);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  const leave = () => {
    if (hover) {
      hover = "";
      box.removeAttribute("data-hover");
    }
  };
  stage.addEventListener("pointerleave", leave);
  const onVisibility = () => checkVisibility();
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    checkVisibility();
  });
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);

  applyLayout();
  pencil.base.copy(layout.rest.base);
  pencil.quat.copy(layout.rest.quat);
  resize();
  stepPencil(1 / 60);
  placePencil();
  updateTape(1 / 60);
  try {
    render();
  } catch (error) {
    console.error(error);
    onFail?.();
  }
  visible = true;
  wake();

  function setMix(next) {
    if (destroyed) return;
    song = next.lead;
    world.labelTex.image = labelCanvas(next);
    world.labelTex.needsUpdate = true;
    wake();
  }

  return {
    toggleSound,
    togglePencil,
    setMix,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", lost);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("pointerleave", leave);
      chatter.destroy();
      world.dispose();
      envTarget.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
