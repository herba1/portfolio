"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SpriteNodeMaterial, WebGPURenderer } from "three/webgpu";
import {
  Fn,
  color,
  float,
  hash,
  instanceIndex,
  mix,
  mx_noise_vec3,
  oneMinus,
  PI2,
  pow,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";

import { STAR_COUNT } from "./galaxiumParams";

const IDENTITY = new THREE.Matrix4();

function createUniforms(params) {
  return {
    arms: uniform(params.arms),
    twist: uniform(params.twist),
    radius: uniform(params.radius),
    thickness: uniform(params.thickness),
    coreBulge: uniform(params.coreBulge),
    density: uniform(params.density),
    starSize: uniform(params.starSize),
    turbulence: uniform(params.turbulence),
    twinkle: uniform(params.twinkle),
    spin: uniform(params.spin),
    seed: uniform(params.seed),
    colorInner: uniform(color(0xfff2d8)),
    colorOuter: uniform(color(0x6d8dff)),
  };
}

function applyUniforms(uniforms, params) {
  uniforms.arms.value = params.arms;
  uniforms.twist.value = params.twist;
  uniforms.radius.value = params.radius;
  uniforms.thickness.value = params.thickness;
  uniforms.coreBulge.value = params.coreBulge;
  uniforms.density.value = params.density;
  uniforms.starSize.value = params.starSize;
  uniforms.turbulence.value = params.turbulence;
  uniforms.twinkle.value = params.twinkle;
  uniforms.spin.value = params.spin;
  uniforms.seed.value = params.seed;
  uniforms.colorInner.value.setHSL(
    ((params.hue + 300) % 360) / 360,
    0.55,
    0.5 + params.warmth * 0.35,
  );
  uniforms.colorOuter.value.setHSL(
    params.hue / 360,
    0.7,
    0.42 + (1 - params.warmth) * 0.14,
  );
}

function starField(u) {
  const n = float(instanceIndex);
  const r1 = hash(n.add(u.seed));
  const r2 = hash(n.add(u.seed).add(19));
  const r3 = hash(n.add(u.seed).add(53));
  const r4 = hash(n.add(u.seed).add(101));
  const r5 = hash(n.add(u.seed).add(149));

  const radiusT = pow(r1, 1.5);
  const rDist = radiusT.mul(u.radius);

  const armIndex = r2.mul(u.arms).floor();
  const armAngle = armIndex.div(u.arms).mul(PI2);
  const spiralAngle = radiusT.mul(u.twist).mul(PI2);
  const spread = r3.sub(0.5).mul(mix(1.1, 0.12, radiusT)).mul(0.6);
  const spin = time.mul(u.spin);
  const angle = armAngle.add(spiralAngle).add(spread).add(spin);

  const turb = mx_noise_vec3(vec3(rDist.mul(0.35), angle.mul(1.6), time.mul(0.05))).mul(
    u.turbulence,
  );

  const bulge = mix(u.coreBulge, 0.25, smoothstep(0, u.radius.mul(0.5), rDist));
  const height = r4.sub(0.5).mul(u.thickness).mul(bulge).add(turb.y.mul(0.4));

  const x = angle.cos().mul(rDist).add(turb.x);
  const z = angle.sin().mul(rDist).add(turb.z);

  const visible = step(r5, u.density);
  const coreMix = smoothstep(u.radius.mul(0.35), 0, rDist);
  const twinkleWave = sin(time.mul(3).add(r5.mul(PI2).mul(20))).mul(0.5).add(0.5);

  return { x, height, z, radiusT, coreMix, r5, visible, twinkleWave };
}

function buildPosition(u) {
  return Fn(() => {
    const f = starField(u);
    return vec3(f.x, f.height, f.z).mul(f.visible);
  })();
}

function buildScale(u) {
  return Fn(() => {
    const f = starField(u);
    const sizeBase = mix(1.7, 0.55, f.radiusT);
    const twinkleMul = mix(1, f.twinkleWave, u.twinkle);
    const size = u.starSize.mul(sizeBase).mul(twinkleMul).mul(f.visible);
    return vec2(size, size);
  })();
}

function buildColor(u) {
  return Fn(() => {
    const f = starField(u);
    const base = mix(u.colorOuter, u.colorInner, f.coreMix);
    const brightness = mix(0.8, 1.8, f.coreMix).mul(mix(1, f.twinkleWave, u.twinkle.mul(0.6)));
    return base.mul(brightness);
  })();
}

function buildOpacity(u) {
  return Fn(() => {
    const f = starField(u);
    const d = uv().sub(0.5).length().mul(2);
    const mask = oneMinus(smoothstep(0.2, 1, d));
    return mask.mul(f.visible);
  })();
}

function StarField({ params }) {
  const [uniforms] = useState(() => createUniforms(params));
  const meshRef = useRef(null);

  useEffect(() => {
    applyUniforms(uniforms, params);
  }, [uniforms, params]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => {
    const m = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    m.positionNode = buildPosition(uniforms);
    m.scaleNode = buildScale(uniforms);
    m.colorNode = buildColor(uniforms);
    m.opacityNode = buildOpacity(uniforms);
    return m;
  }, [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < STAR_COUNT; i += 1) mesh.setMatrixAt(i, IDENTITY);
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, STAR_COUNT]}
      frustumCulled={false}
    />
  );
}

function createGlowUniforms() {
  return {
    glow: uniform(0),
    tint: uniform(color(0xffe4b0)),
  };
}

function applyGlowUniforms(u, params) {
  u.glow.value = params.coreGlow;
  u.tint.value.setHSL(((params.hue + 300) % 360) / 360, 0.6, 0.55 + params.warmth * 0.3);
}

function buildGlowScale(u) {
  return Fn(() => {
    const s = u.glow.add(0.6).mul(1.6);
    return vec2(s, s);
  })();
}

function buildGlowOpacity(u) {
  return Fn(() => {
    const d = uv().sub(0.5).length().mul(2);
    return oneMinus(smoothstep(0, 1, d)).pow(1.6).mul(u.glow.mul(0.8).add(0.15));
  })();
}

function CoreGlow({ params }) {
  const [uniforms] = useState(() => createGlowUniforms());

  useEffect(() => {
    applyGlowUniforms(uniforms, params);
  }, [uniforms, params]);

  const material = useMemo(() => {
    const m = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    m.scaleNode = buildGlowScale(uniforms);
    m.colorNode = uniforms.tint;
    m.opacityNode = buildGlowOpacity(uniforms);
    return m;
  }, [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  return <sprite material={material} />;
}

function Explorer({ params }) {
  const { camera, gl } = useThree();
  const spherical = useRef({ azimuth: 0.6, polar: 1.15, distance: params.radius * 1.7 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const idleFor = useRef(0);

  useEffect(() => {
    const dom = gl.domElement;

    const onDown = (event) => {
      dragging.current = true;
      idleFor.current = 0;
      last.current = { x: event.clientX, y: event.clientY };
      dom.setPointerCapture(event.pointerId);
    };
    const onMove = (event) => {
      if (!dragging.current) return;
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      last.current = { x: event.clientX, y: event.clientY };
      const s = spherical.current;
      s.azimuth -= dx * 0.0045;
      s.polar = Math.min(Math.max(s.polar - dy * 0.0035, 0.25), Math.PI - 0.25);
    };
    const onUp = (event) => {
      dragging.current = false;
      idleFor.current = 0;
      dom.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event) => {
      event.preventDefault();
      idleFor.current = 0;
      const s = spherical.current;
      const min = params.radius * 0.35;
      const max = params.radius * 3.5;
      s.distance = Math.min(Math.max(s.distance + event.deltaY * 0.01, min), max);
    };

    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
    };
  }, [gl, params.radius]);

  useFrame((_, delta) => {
    const s = spherical.current;
    if (!dragging.current) {
      idleFor.current += delta;
      if (idleFor.current > 0.6) s.azimuth += delta * params.drift * 0.25;
    }
    const x = s.distance * Math.sin(s.polar) * Math.sin(s.azimuth);
    const y = s.distance * Math.cos(s.polar);
    const z = s.distance * Math.sin(s.polar) * Math.cos(s.azimuth);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  });

  return null;
}

async function createGl(props) {
  const renderer = new WebGPURenderer({ ...props, antialias: true, forceWebGL: false });
  await renderer.init();
  return renderer;
}

export default function GalaxiumScene({ params, frameloop, onReady }) {
  return (
    <Canvas
      gl={createGl}
      frameloop={frameloop}
      dpr={[1, 2]}
      camera={{ fov: 55, near: 0.1, far: 200, position: [0, 5, 11] }}
      onCreated={(state) => {
        state.gl.outputColorSpace = THREE.SRGBColorSpace;
        state.gl.toneMapping = THREE.NoToneMapping;
        state.scene.background = new THREE.Color(0x05050b);
        if (onReady) onReady();
      }}
    >
      <StarField params={params} />
      <CoreGlow params={params} />
      <Explorer params={params} />
    </Canvas>
  );
}
