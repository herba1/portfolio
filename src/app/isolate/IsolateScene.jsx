"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";
import IsolatedSplatViewer from "./IsolatedSplatViewer";

function LoadWatcher({ onLoaded }) {
  const { progress } = useProgress();
  useEffect(() => {
    if (progress < 100) return;
    const id = setTimeout(onLoaded, 0);
    return () => clearTimeout(id);
  }, [progress, onLoaded]);
  return null;
}

export default function IsolateScene() {
  const [loaded, setLoaded] = useState(false);
  const handleLoaded = useCallback(() => setLoaded(true), []);

  return (
    <div className="isolate-stage" data-loaded={loaded || undefined}>
      <Canvas
        flat
        camera={{ position: [0, 0, 4.2], fov: 34, near: 0.1, far: 100 }}
        gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
        dpr={[1, 1.75]}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <LoadWatcher onLoaded={handleLoaded} />
          <IsolatedSplatViewer />
        </Suspense>
      </Canvas>

      <style>{`
        .isolate-stage {
          width: 100%;
          height: 100%;
          opacity: 0;
          transform: scale(0.985);
          transition:
            opacity var(--duration-800) var(--ease-entrance),
            transform var(--duration-800) var(--ease-entrance);
          touch-action: none;
          cursor: grab;
        }
        .isolate-stage:active {
          cursor: grabbing;
        }
        .isolate-stage[data-loaded] {
          opacity: 1;
          transform: scale(1);
        }
        @media (prefers-reduced-motion: reduce) {
          .isolate-stage {
            transition: opacity var(--duration-250) ease;
            transform: none;
          }
          .isolate-stage[data-loaded] { transform: none; }
        }
      `}</style>
    </div>
  );
}
