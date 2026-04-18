"use client";

import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import Book from "./Book";
import { PAGE_HEIGHT, PAGE_WIDTH, PAGE_TONE } from "./pageData";

export default function BookExperience() {
  return (
    <div className="book-stage">
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        orthographic
        camera={{ position: [0, 0, 5], zoom: 1, near: 0.01, far: 20 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[PAGE_TONE]} />
        <CameraFit />

        {/* Flat lighting so rest state reads as DOM. Raking light reveals
            curl geometry only when a page is in motion. */}
        <ambientLight intensity={1.05} />
        <directionalLight position={[-2, 2.2, 3]} intensity={0.55} color="#ffffff" />
        <directionalLight position={[3, -1, 2]} intensity={0.18} color="#d8deea" />

        <Suspense fallback={null}>
          <Book />
        </Suspense>
      </Canvas>
    </div>
  );
}

// One world unit vertical = full viewport. Book scales X by viewport aspect
// so the page spans the viewport exactly.
function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!size.width || !size.height) return;
    camera.zoom = size.height / PAGE_HEIGHT;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}
