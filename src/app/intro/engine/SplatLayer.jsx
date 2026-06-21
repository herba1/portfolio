"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Splat } from "@react-three/drei";

// R3F renderer for a gravity field: each particle is a Gaussian splat. Same
// engine as the DOM layer — it just steps the field from useFrame and maps the
// field's pixel space into world space.
//
// With an orthographic Canvas, R3F's default frustum is ±size/2 in pixels with
// the origin centred and y-up — so world == screen pixels: position is simply
// (x − W/2, H/2 − y). One source is reused across every instance (cheap memory;
// each still depth-sorts per frame, so keep `count` small — ~3–6).
export default function SplatLayer({ field, src, splatScale = 1, maxDelta = 0.04 }) {
  const groups = useRef([]);
  const { size } = useThree();

  // Keep the field's bounds matched to the canvas.
  useEffect(() => {
    field.resize(size.width, size.height);
  }, [field, size.width, size.height]);

  useFrame((_, delta) => {
    field.step(Math.min(delta, maxDelta));
    const { w: W, h: H } = field.bounds();
    for (const p of field.particles) {
      const g = groups.current[p.id];
      if (!g) continue;
      g.visible = p.alive;
      if (!p.alive) continue;
      g.position.set(p.x - W / 2, H / 2 - p.y, p.depth * 60 - 30);
      g.rotation.z = p.rot;
      g.rotation.y = p.rot * 0.35; // a little out-of-plane tumble
      g.scale.setScalar(Math.max(0.0001, p.scale * splatScale * (p.size / 100)));
    }
  });

  return (
    <>
      {field.particles.map((p) => (
        <group key={p.id} ref={(g) => (groups.current[p.id] = g)} visible={false}>
          <Splat src={src} toneMapped={false} chunkSize={25000} />
        </group>
      ))}
    </>
  );
}
