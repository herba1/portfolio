"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { INK_FRAGMENT, INK_VERTEX } from "./inkShader";

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
        texture,
        width: image.naturalWidth,
        height: image.naturalHeight,
        aspect: image.naturalWidth / image.naturalHeight,
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
    uBrightness: { value: 0 },
    uContrast: { value: 1 },
    uGamma: { value: 1 },
    uInvert: { value: 0 },
    uAngle: { value: 0 },
    uLineCount: { value: 60 },
    uWeight: { value: 1 },
    uBleed: { value: 0.05 },
    uWaver: { value: 0 },
    uWaverScale: { value: 3 },
    uRagged: { value: 0 },
    uRaggedScale: { value: 100 },
    uBreakup: { value: 0 },
    uBreakScale: { value: 20 },
    uDry: { value: 0 },
    uDryScale: { value: 500 },
    uPressure: { value: 0 },
    uPressureScale: { value: 2 },
    uFibre: { value: 0 },
    uFibreScale: { value: 200 },
    uTooth: { value: 0 },
    uPaperGrain: { value: 0 },
    uHalo: { value: 0 },
    uHaloBlur: { value: 4 },
    uSheen: { value: 0 },
    uPaper: { value: new THREE.Color(1, 1, 1) },
    uInk: { value: new THREE.Color(0, 0, 0) },
    uSeed: { value: 1 },
    uSuper: { value: 1 },
  };
}

function InkPlate({ params, imageSrc, onReady, onSource }) {
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
        vertexShader: INK_VERTEX,
        fragmentShader: INK_FRAGMENT,
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
    const pixelWidth = Math.max(1, size.width * viewport.dpr);
    const pixelHeight = Math.max(1, size.height * viewport.dpr);
    const canvasAspect = size.width / Math.max(size.height, 1);
    const imageAspect = ready ? source.aspect : 1;

    uniforms.uImage.value = ready ? source.texture : null;
    uniforms.uHasImage.value = ready ? 1 : 0;
    uniforms.uResolution.value.set(pixelWidth, pixelHeight);
    uniforms.uAspect.value = canvasAspect;

    const wide = imageAspect > canvasAspect;
    if (params.fill === 1 ? !wide : wide) {
      uniforms.uFit.value.set(1, canvasAspect / imageAspect);
    } else {
      uniforms.uFit.value.set(imageAspect / canvasAspect, 1);
    }

    uniforms.uOffset.value.set(params.offsetX, params.offsetY);
    uniforms.uZoom.value = params.zoom;

    uniforms.uBrightness.value = params.brightness;
    uniforms.uContrast.value = params.contrast;
    uniforms.uGamma.value = params.gamma;
    uniforms.uInvert.value = params.invert;

    uniforms.uAngle.value = (params.angle * Math.PI) / 180;
    uniforms.uLineCount.value = params.lineCount;
    uniforms.uWeight.value = params.weight;
    uniforms.uBleed.value = params.bleed;

    uniforms.uWaver.value = params.waver;
    uniforms.uWaverScale.value = params.waverScale;
    uniforms.uRagged.value = params.ragged;
    uniforms.uRaggedScale.value = params.raggedScale;
    uniforms.uBreakup.value = params.breakup;
    uniforms.uBreakScale.value = params.breakScale;
    uniforms.uDry.value = params.dry;
    uniforms.uDryScale.value = params.dryScale;

    uniforms.uPressure.value = params.pressure;
    uniforms.uPressureScale.value = params.pressureScale;
    uniforms.uFibre.value = params.fibre;
    uniforms.uFibreScale.value = params.fibreScale;
    uniforms.uTooth.value = params.tooth;
    uniforms.uPaperGrain.value = params.paperGrain;
    uniforms.uHalo.value = params.halo;
    uniforms.uHaloBlur.value = params.haloBlur;
    uniforms.uSheen.value = params.sheen;

    uniforms.uPaper.value.setStyle(params.paper, THREE.LinearSRGBColorSpace);
    uniforms.uInk.value.setStyle(params.ink, THREE.LinearSRGBColorSpace);

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

export default function InkScene({ params, imageSrc, onReady, onSource }) {
  return (
    <Canvas
      flat
      frameloop="never"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: false, alpha: false }}
    >
      <InkPlate params={params} imageSrc={imageSrc} onReady={onReady} onSource={onSource} />
    </Canvas>
  );
}
