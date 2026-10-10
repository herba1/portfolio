"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import useNearViewport from "@/app/experiments/useNearViewport";

import { PHOTOS } from "./scorchPhotos";
import "./scorch.css";

const loadStage = () => import("./ScorchStage");
if (typeof window !== "undefined") loadStage();

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(callback) {
  const list = window.matchMedia(REDUCED_QUERY);
  list.addEventListener("change", callback);
  return () => list.removeEventListener("change", callback);
}

const readReduced = () => window.matchMedia(REDUCED_QUERY).matches;
const readFalse = () => false;

function Plate({ children }) {
  return <div className="scorch-plate scorch-plate--placeholder">{children}</div>;
}

export default function ScorchExperience({ embedded = false }) {
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const printRef = useRef(null);
  const near = useNearViewport(printRef);
  const reducedMotion = useSyncExternalStore(subscribeReduced, readReduced, readFalse);

  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setRevealed(true);
  }, []);

  const handleError = useCallback(() => {
    setFailed(true);
    reveal();
  }, [reveal]);

  const Root = embedded ? "div" : "main";
  const still = PHOTOS[0];

  let stage;
  if (failed) {
    stage = (
      <Plate>
        <div className="scorch-plate__still" role="img" aria-label={still.title} style={{ backgroundImage: `url("${still.src}")` }} />
      </Plate>
    );
  } else if (near) {
    stage = (
      <ClientOnly
        load={loadStage}
        fallback={<Plate />}
        sheets={PHOTOS}
        embedded={embedded}
        reducedMotion={reducedMotion}
        onReady={reveal}
        onError={handleError}
      />
    );
  } else {
    stage = <Plate />;
  }

  return (
    <Root className="scorch" data-embedded={embedded ? "1" : undefined} data-revealed={revealed ? "1" : undefined}>
      <div ref={printRef} className="scorch-print">
        {stage}
      </div>
    </Root>
  );
}
