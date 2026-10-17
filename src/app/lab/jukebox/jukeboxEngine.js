import { createJukeboxAudio } from "./jukeboxAudio";
import { createRig, SLOT_ANGLE, SLOTS } from "./jukeboxRig";
import { DIM, buildScene } from "./jukeboxScene";
import { CLEAN_FRAGMENT, POST_FRAGMENT, POST_VERTEX } from "./jukeboxShader";
import { SONGS, START_INDEX } from "./jukeboxSongs";

const MAX_DPR = 2;
const FOV = 24;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);

function armSolver() {
  const [ax, az] = DIM.pivot;
  const [cx, cz] = DIM.platter;
  const dx = cx - ax;
  const dz = cz - az;
  const d = Math.hypot(dx, dz);
  const delta = Math.atan2(dz, dx);
  const L = DIM.armLen;
  const yawFor = (r) => {
    const c = clamp((d * d + L * L - r * r) / (2 * d * L), -1, 1);
    return delta + Math.acos(c);
  };
  return {
    rest: (Math.PI * 3) / 2,
    at: (p) => yawFor(0.815 - 0.3 * p),
  };
}

export async function createJukebox({ box, host, insets, embedded, onReady, onFail, onState, onHover }) {
  const THREE = await import("three");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
  } catch {
    onFail?.();
    return { destroy() {}, select() {}, setMuted() {}, unlock() {} };
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "jukebox-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const world = buildScene(THREE, renderer);
  const { scene, records, grip } = world;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 40);

  const depthTexture = new THREE.DepthTexture(4, 4);
  depthTexture.type = THREE.UnsignedIntType;
  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture,
    depthBuffer: true,
  });
  target.texture.generateMipmaps = false;
  target.texture.minFilter = THREE.LinearFilter;
  const clean = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  clean.texture.generateMipmaps = true;
  clean.texture.minFilter = THREE.LinearMipmapLinearFilter;
  clean.texture.magFilter = THREE.LinearFilter;

  const postUniforms = {
    uColor: { value: clean.texture },
    uDepth: { value: depthTexture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uFocus: { value: 8 },
    uAperture: { value: 1.25 },
    uMaxBlur: { value: 10 },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uExposure: { value: 1.05 },
    uView: { value: new THREE.Vector4(1, 0, 0, 0) },
    uDome: { value: 1 },
  };
  const postMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    uniforms: postUniforms,
    depthTest: false,
    depthWrite: false,
  });
  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const postScene = new THREE.Scene();
  const tri = new THREE.Mesh(triGeo, postMat);
  tri.frustumCulled = false;
  postScene.add(tri);
  const cleanMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: POST_VERTEX,
    fragmentShader: CLEAN_FRAGMENT,
    uniforms: { uColor: { value: target.texture } },
    depthTest: false,
    depthWrite: false,
  });
  const cleanScene = new THREE.Scene();
  const cleanTri = new THREE.Mesh(triGeo, cleanMat);
  cleanTri.frustumCulled = false;
  cleanScene.add(cleanTri);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const audio = createJukeboxAudio();
  const armYaw = armSolver();
  const rig = createRig({
    start: START_INDEX,
    armYaw,
    onClick: (intensity) => audio.click(intensity),
    onContact: (down, index) => {
      if (down) audio.needleDown(SONGS[index]?.rate || 1);
      else audio.needleUp();
    },
    onSeat: () => audio.clunk(),
  });
  const s = rig.state;
  s.spin[START_INDEX] = -1.2;
  s.phi = -1.2;
  for (let i = 0; i < SLOTS; i += 1) if (i !== START_INDEX) s.spin[i] = ((i * 2.399) % (Math.PI * 2)) - Math.PI;

  const path = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, DIM.cradleY, DIM.carousel[1] + DIM.ring),
      new THREE.Vector3(0, DIM.cradleY + 0.66, DIM.carousel[1] + DIM.ring + 0.06),
      new THREE.Vector3(0, DIM.cradleY + 0.98, -0.46),
      new THREE.Vector3(0, DIM.platterTop + DIM.half + 0.38, DIM.platter[1]),
      new THREE.Vector3(0, DIM.platterTop + DIM.half, DIM.platter[1]),
    ],
    false,
    "centripetal",
  );

  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const m4 = new THREE.Matrix4();
  const qB0 = new THREE.Quaternion().setFromRotationMatrix(m4.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
  const qRoll = new THREE.Quaternion();
  const qHold = new THREE.Quaternion();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const rr = new THREE.Vector3();
  const tt = new THREE.Vector3();
  const holdPos = new THREE.Vector3();
  const gHold = new THREE.Vector3();
  const nHold = new THREE.Vector3();
  const gDir = new THREE.Vector3();
  const nDir = new THREE.Vector3();
  const bDir = new THREE.Vector3();
  const J = new THREE.Vector3();
  const W = new THREE.Vector3();
  const E = new THREE.Vector3();
  const S = new THREE.Vector3(...DIM.shoulder);
  const pole = new THREE.Vector3(-0.32, 0.9, 0.12).normalize();
  const gripLocal = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
  const normalLocal = new THREE.Vector3(0, 1, 0);
  const jParked = new THREE.Vector3(-1.18, 0.95, 1.9);
  const gParked = new THREE.Vector3(-0.42, 0.72, 0.55).normalize();
  const nParked = new THREE.Vector3(0.78, 0.18, 0.36).normalize();

  function holdFrame(tau) {
    path.getPoint(clamp(tau, 0, 1), holdPos);
    const roll = (Math.PI / 2) * smoother(smooth(0.2, 0.82, tau));
    qRoll.setFromAxisAngle(Z, roll);
    qHold.copy(qRoll).multiply(qB0);
  }

  function placeBone(mesh, from, to) {
    vC.subVectors(to, from);
    const len = vC.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(Y, vC.divideScalar(Math.max(len, 1e-5)));
    mesh.scale.set(1, len, 1);
  }

  function solveElbow(a, b, l1, l2, out) {
    vA.subVectors(b, a);
    const d = clamp(vA.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    vA.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    vB.copy(pole).addScaledVector(vA, -pole.dot(vA)).normalize();
    out.copy(a).addScaledVector(vA, along).addScaledVector(vB, h);
    return out;
  }

  function poseRecords() {
    const theta = s.theta;
    const [cx, cz] = DIM.carousel;
    for (let i = 0; i < SLOTS; i += 1) {
      const rec = records[i];
      if (i === s.out) continue;
      const a = i * SLOT_ANGLE + theta;
      rr.set(Math.sin(a), 0, Math.cos(a));
      tt.set(Math.cos(a), 0, -Math.sin(a));
      rec.group.position.set(cx + rr.x * DIM.ring, DIM.cradleY, cz + rr.z * DIM.ring);
      m4.makeBasis(rr, tt, Y);
      rec.group.quaternion.setFromRotationMatrix(m4);
      rec.spin.rotation.y = s.spin[i];
    }
    world.carousel.rotation.y = theta;
    const phase = SLOTS * (-0.62 - theta - SLOT_ANGLE / 2);
    world.pawlArm.rotation.y = -0.16 * (0.5 + 0.5 * Math.cos(phase));
    holdFrame(s.out === null ? 0 : s.tau);
    if (s.out !== null) {
      const rec = records[s.out];
      rec.group.position.copy(holdPos);
      rec.group.quaternion.copy(qHold);
      rec.spin.rotation.y = s.spin[s.out];
    }
  }

  function poseGripper() {
    gHold.copy(gripLocal).applyQuaternion(qHold);
    nHold.copy(normalLocal).applyQuaternion(qHold);
    const withdraw = (1 - smoother(clamp(s.e, 0, 1))) * 0.34;
    J.copy(holdPos).addScaledVector(gHold, DIM.record + withdraw);
    const gs = smoother(clamp(s.g, 0, 1));
    J.lerpVectors(jParked, J, gs);
    J.y += Math.sin(Math.PI * gs) * 0.42;
    gDir.lerpVectors(gParked, gHold, gs).normalize();
    nDir.lerpVectors(nParked, nHold, gs);
    nDir.addScaledVector(gDir, -nDir.dot(gDir)).normalize();
    bDir.crossVectors(gDir, nDir);
    W.copy(J).addScaledVector(gDir, 0.62);
    solveElbow(S, W, DIM.upper, DIM.fore, E);
    grip.shoulderJoint.position.copy(S);
    grip.elbowJoint.position.copy(E);
    grip.wristJoint.position.copy(W);
    placeBone(grip.upperBone, S, E);
    placeBone(grip.foreBone, E, W);
    vA.copy(J).addScaledVector(gDir, 0.2);
    placeBone(grip.rod, vA, W);
    m4.makeBasis(gDir, nDir, bDir);
    const open = 0.004 + (1 - smoother(clamp(s.e, 0, 1))) * 0.05;
    for (const [mesh, side] of [
      [grip.jawA, 1],
      [grip.jawB, -1],
    ]) {
      mesh.quaternion.setFromRotationMatrix(m4);
      mesh.position.copy(J).addScaledVector(gDir, 0.03).addScaledVector(nDir, side * (DIM.half + open + 0.006));
    }
    grip.jawBlock.quaternion.setFromRotationMatrix(m4);
    grip.jawBlock.position.copy(J).addScaledVector(gDir, 0.15);
  }

  function poseArm() {
    world.platterSpinner.rotation.y = s.phi;
    world.armYawGroup.rotation.y = -s.yaw;
    world.armPitch.rotation.z = s.h * 0.085;
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  const focusPoint = new THREE.Vector3(DIM.platter[0], DIM.platterTop, DIM.platter[1] - 0.2);
  const forward = new THREE.Vector3();

  function frameCamera() {
    const ins = insets();
    const top = clamp(ins.top, 0, height * 0.5);
    const bottom = clamp(ins.bottom, 0, height * 0.6);
    const visH = Math.max(120, height - top - bottom);
    const aspect = width / visH;
    camera.aspect = width / height;
    const tanH = Math.tan(((FOV / 2) * Math.PI) / 180);
    const hwFit = 1.9 + 1.5 * smooth(0.7, 1.9, aspect);
    const hhFit = 1.5;
    const dist = Math.max(hwFit / (tanH * (width / height)), hhFit / (tanH * (visH / height)));
    const look = new THREE.Vector3(-0.08, 0.72, -0.72 + 0.4 * (1 - smooth(0.7, 1.6, aspect)));
    const dir = new THREE.Vector3(0.2, 0.52 + 0.06 * (1 - smooth(0.7, 1.6, aspect)), 1).normalize();
    camera.position.copy(look).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.setViewOffset(width, height, 0, (bottom - top) / 2, width, height);
    camera.updateProjectionMatrix();
    camera.getWorldDirection(forward);
    vA.subVectors(focusPoint, camera.position);
    postUniforms.uFocus.value = vA.dot(forward);
    postUniforms.uView.value.set(1 - top / height, bottom / height, 0, 0);
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const nextDpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (w === width && h === height && nextDpr === dpr) {
      frameCamera();
      requestRender();
      return;
    }
    width = w;
    height = h;
    dpr = nextDpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    target.setSize(pw, ph);
    clean.setSize(pw, ph);
    postUniforms.uRes.value.set(pw, ph);
    postUniforms.uMaxBlur.value = 9 * dpr * clamp(Math.min(w, h) / 700, 0.6, 1.2);
    frameCamera();
    requestRender();
  }

  let lastState = "";
  function emitState() {
    const phase = rig.phase();
    const key = `${s.want}|${s.out}|${phase}`;
    if (key === lastState) return;
    lastState = key;
    onState?.({ want: s.want, out: s.out, phase });
  }

  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let readyFired = false;
  let landed = s.tau >= 0.998;
  let pendingRender = false;
  let time = 0;

  function render() {
    poseRecords();
    poseGripper();
    poseArm();
    postUniforms.uTime.value = time;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(clean);
    renderer.render(cleanScene, postCam);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
    if (!readyFired) {
      readyFired = true;
      onReady?.();
    }
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 0, 1 / 20) : 1 / 60;
    last = now;
    rig.step(dt);
    const onPlatter = s.out !== null && s.tau >= 0.998;
    if (onPlatter && !landed) audio.clunk();
    landed = onPlatter;
    const running = rig.busy();
    if (!reduced && running) time += dt;
    postUniforms.uSeed.value = (postUniforms.uSeed.value + 17.13) % 1000;
    render();
    pendingRender = false;
    emitState();
    if (running) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || destroyed || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function requestRender() {
    pendingRender = true;
    wake();
  }

  function checkVisibility() {
    if (!visible || document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      audio.suspend();
      return;
    }
    audio.resume();
    if (pendingRender || rig.busy()) wake();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const proxies = records.map((r) => r.proxy);
  let hovered = null;

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(proxies, false);
    for (const hit of hits) {
      const index = hit.object.userData.index;
      if (index === s.out && s.tau < 0.998) continue;
      return index;
    }
    return null;
  }

  function select(index) {
    audio.unlock();
    if (index == null || index < 0 || index >= SLOTS) return;
    if (rig.select(index)) {
      emitState();
      wake();
    }
  }

  const handlers = {
    down: (e) => {
      if (e.button > 0) return;
      audio.unlock();
      const index = pick(e);
      if (index !== null) select(index);
    },
    move: (e) => {
      if (e.pointerType !== "mouse") return;
      const index = pick(e);
      if (index === hovered) return;
      hovered = index;
      host.toggleAttribute("data-pointing", index !== null);
      onHover?.(index);
    },
    leave: () => {
      if (hovered === null) return;
      hovered = null;
      host.removeAttribute("data-pointing");
      onHover?.(null);
    },
    visibility: () => checkVisibility(),
    lost: (e) => e.preventDefault(),
  };

  host.addEventListener("pointerdown", handlers.down);
  host.addEventListener("pointermove", handlers.move);
  host.addEventListener("pointerleave", handlers.leave);
  canvas.addEventListener("webglcontextlost", handlers.lost);
  document.addEventListener("visibilitychange", handlers.visibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    checkVisibility();
  });
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);
  resize();
  emitState();
  if (embedded) postUniforms.uDome.value = 0.85;

  return {
    select,
    unlock: () => audio.unlock(),
    setMuted: (value) => audio.setMuted(value),
    relayout: () => resize(),
    debug: () => ({ ...s, spin: undefined, phase: rig.phase(), busy: rig.busy() }),
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", handlers.visibility);
      host.removeEventListener("pointerdown", handlers.down);
      host.removeEventListener("pointermove", handlers.move);
      host.removeEventListener("pointerleave", handlers.leave);
      canvas.removeEventListener("webglcontextlost", handlers.lost);
      audio.destroy();
      world.dispose();
      target.dispose();
      clean.dispose();
      cleanMat.dispose();
      depthTexture.dispose();
      postMat.dispose();
      triGeo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
