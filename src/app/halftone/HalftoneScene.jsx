"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { HALFTONE_FRAGMENT, HALFTONE_VERTEX } from "./halftoneShader";

function measureLevels(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, 64, 64);
    const { data } = ctx.getImageData(0, 0, 64, 64);
    const lum = new Float32Array(64 * 64);
    for (let i = 0; i < lum.length; i++) {
      const o = i * 4;
      lum[i] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    }
    lum.sort();
    const at = (q) => lum[Math.floor(q * (lum.length - 1))];
    const black = Math.max(0, at(0.02) - 0.02);
    const white = Math.min(1, Math.max(black + 0.12, at(0.97) + 0.28));
    return { black: Number(black.toFixed(3)), white: Number(white.toFixed(3)) };
  } catch {
    return null;
  }
}

function useSourceTexture(src) {
  const [source, setSource] = useState({ status: "loading" });
  const textureRef = useRef(null);

  useEffect(() => {
    if (!src) {
      setSource({ status: "empty" });
      return undefined;
    }

    let cancelled = false;
    setSource({ status: "loading" });

    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      if (textureRef.current) textureRef.current.dispose();
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      textureRef.current = texture;
      setSource({
        status: "ready",
        src,
        texture,
        width: image.naturalWidth,
        height: image.naturalHeight,
        aspect: image.naturalWidth / image.naturalHeight,
        levels: measureLevels(image),
      });
    };

    image.onerror = () => {
      if (!cancelled) setSource({ status: "failed" });
    };

    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => () => {
    if (textureRef.current) textureRef.current.dispose();
  }, []);

  return source;
}

function makeUniforms() {
  return {
    uImage: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFit: { value: new THREE.Vector2(1, 1) },
    uOffset: { value: new THREE.Vector2(0, 0) },
    uZoom: { value: 1 },
    uAspect: { value: 1 },
    uHasImage: { value: 0 },
    uTile: { value: 1 },
    uChroma: { value: 0.55 },
    uWarpCentre: { value: new THREE.Vector2(0.5, 0.5) },
    uCurve: { value: 1 },
    uTiltX: { value: 0 },
    uTiltY: { value: 0 },
    uSpin: { value: 0 },
    uCell: { value: 40 },
    uCellAspect: { value: 1 },
    uCellPower: { value: 3 },
    uDotScale: { value: 1 },
    uDotGamma: { value: 1 },
    uBlack: { value: 0 },
    uWhite: { value: 1 },
    uGamma: { value: 1 },
    uPaper: { value: new THREE.Color(1, 1, 1) },
    uInkA: { value: new THREE.Color(1, 0, 0) },
    uInkB: { value: new THREE.Color(0, 0, 1) },
    uInkC: { value: new THREE.Color(1, 1, 0) },
    uAngles: { value: new THREE.Vector3(0, 0, 0) },
    uGains: { value: new THREE.Vector3(1, 1, 1) },
    uSlips: { value: new THREE.Vector3(0, 0, 0) },
    uGrain: { value: 0 },
    uGrainChroma: { value: 0 },
    uBloom: { value: 0 },
    uSeed: { value: 1 },
    uSuper: { value: 1 },
  };
}

const RAD = Math.PI / 180;

function HalftonePlate({ params, imageSrc, onReady, onSource }) {
  const source = useSourceTexture(imageSrc);
  const { size, viewport, gl, scene, camera } = useThree();

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    return geo;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HALFTONE_VERTEX,
        fragmentShader: HALFTONE_FRAGMENT,
        uniforms: makeUniforms(),
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  const uniforms = material.uniforms;

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (onSource) onSource(source);
  }, [onSource, source]);

  useLayoutEffect(() => {
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    gl.toneMapping = THREE.NoToneMapping;
    gl.debug.onShaderError = (ctx, program, vertexShader, fragmentShader) => {
      const log =
        ctx.getShaderInfoLog(fragmentShader) ||
        ctx.getShaderInfoLog(vertexShader) ||
        ctx.getProgramInfoLog(program);
      if (onSource) onSource({ status: "shader", message: String(log).slice(0, 300) });
    };

    const ready = source.status === "ready";
    const canvasAspect = size.width / Math.max(size.height, 1);
    const imageAspect = ready ? source.aspect : 1;

    uniforms.uImage.value = ready ? source.texture : null;
    uniforms.uHasImage.value = ready ? 1 : 0;
    uniforms.uResolution.value.set(
      Math.max(1, size.width * viewport.dpr),
      Math.max(1, size.height * viewport.dpr),
    );
    uniforms.uAspect.value = canvasAspect;

    const wide = imageAspect > canvasAspect;
    if (params.fill === 1 ? !wide : wide) {
      uniforms.uFit.value.set(1, canvasAspect / imageAspect);
    } else {
      uniforms.uFit.value.set(imageAspect / canvasAspect, 1);
    }

    uniforms.uOffset.value.set(params.offsetX, params.offsetY);
    uniforms.uZoom.value = params.zoom;
    uniforms.uTile.value = params.tile;
    uniforms.uChroma.value = params.chroma;

    uniforms.uWarpCentre.value.set(params.warpX, params.warpY);
    uniforms.uCurve.value = params.curve;
    uniforms.uTiltX.value = params.tiltX;
    uniforms.uTiltY.value = params.tiltY;
    uniforms.uSpin.value = params.spin * RAD;

    uniforms.uCell.value = params.cell;
    uniforms.uCellAspect.value = params.cellAspect;
    uniforms.uCellPower.value = params.cellPower;
    uniforms.uDotScale.value = params.dotScale;
    uniforms.uDotGamma.value = params.dotGamma;

    uniforms.uBlack.value = params.black;
    uniforms.uWhite.value = params.white;
    uniforms.uGamma.value = params.gamma;

    uniforms.uPaper.value.setStyle(params.paper, THREE.LinearSRGBColorSpace);
    uniforms.uInkA.value.setStyle(params.inkA, THREE.LinearSRGBColorSpace);
    uniforms.uInkB.value.setStyle(params.inkB, THREE.LinearSRGBColorSpace);
    uniforms.uInkC.value.setStyle(params.inkC, THREE.LinearSRGBColorSpace);

    uniforms.uAngles.value.set(params.angleA * RAD, params.angleB * RAD, params.angleC * RAD);
    uniforms.uGains.value.set(params.gainA, params.gainB, params.gainC);
    uniforms.uSlips.value.set(params.slipA, params.slipB, params.slipC);

    uniforms.uGrain.value = params.grain;
    uniforms.uGrainChroma.value = params.grainChroma;
    uniforms.uBloom.value = params.bloom;
    uniforms.uSeed.value = params.seed;
    uniforms.uSuper.value = params.supersample;

    gl.render(scene, camera);
    const raf = requestAnimationFrame(() => gl.render(scene, camera));
    return () => cancelAnimationFrame(raf);
  }, [params, source, size, viewport.dpr, uniforms, gl, scene, camera, onSource]);

  useEffect(() => {
    if (!onReady) return undefined;
    onReady(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });
    return () => onReady(null);
  }, [onReady, gl, scene, camera]);

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}

export default function HalftoneScene({ params, imageSrc, onReady, onSource }) {
  return (
    <Canvas
      flat
      frameloop="never"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: false, alpha: false }}
    >
      <HalftonePlate
        params={params}
        imageSrc={imageSrc}
        onReady={onReady}
        onSource={onSource}
      />
    </Canvas>
  );
}
