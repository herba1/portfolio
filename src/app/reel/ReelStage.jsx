"use client";

import { Suspense } from "react";
import { lazyPiece } from "@/app/experiments/layouts/pieceLoaders";

export default function ReelStage({ slug, data }) {
  const Piece = lazyPiece(slug);
  if (!Piece) return <p>No piece at {slug}</p>;
  return (
    <div data-reel-stage="" style={{ position: "fixed", inset: 0, containerType: "size", overflow: "hidden" }}>
      <Suspense fallback={null}>
        <Piece embedded {...(data ?? {})} />
      </Suspense>
    </div>
  );
}
