"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { DEFAULT_MAGNETS, createFilingsEngine } from "./filingsEngine";

const INITIAL_MAGNETS = DEFAULT_MAGNETS.map((magnet) => ({ id: magnet.id, born: true, transform: "" }));

function Magnet({ magnet, register }) {
  const attach = useCallback((element) => register(magnet.id, element), [register, magnet.id]);
  return (
    <div
      ref={attach}
      className="filings-magnet"
      data-magnet-id={magnet.id}
      style={magnet.transform ? { transform: magnet.transform } : undefined}
    >
      <button
        type="button"
        className="filings-magnet__body"
        aria-label="Magnet. Drag or use the arrow keys to move it, press to flip it, R to rotate, Delete to remove."
      >
        <span className="filings-magnet__pole" />
      </button>
    </div>
  );
}

export default function FilingsScene({ sample, look, params, embedded, onReady, onTapEmpty, onCount }) {
  const plateRef = useRef(null);
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const latestRef = useRef({ sample, look, params });
  const callbacksRef = useRef({});
  const [magnetEls] = useState(() => new Map());
  const [magnets, setMagnets] = useState(INITIAL_MAGNETS);

  const register = useCallback(
    (id, element) => {
      if (element) magnetEls.set(id, element);
      else magnetEls.delete(id);
    },
    [magnetEls],
  );

  useLayoutEffect(() => {
    latestRef.current = { sample, look, params };
    callbacksRef.current = { onTapEmpty, onCount, onMagnets: setMagnets };
  }, [sample, look, params, onTapEmpty, onCount]);

  useLayoutEffect(() => {
    const engine = createFilingsEngine({
      plate: plateRef.current,
      host: hostRef.current,
      magnetEls,
      embedded,
      callbacks: callbacksRef,
      initial: latestRef.current,
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [embedded, magnetEls]);

  useEffect(() => {
    engineRef.current?.setLook(look);
  }, [look]);

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    if (sample) engineRef.current?.setCover(sample);
  }, [sample]);

  useEffect(() => {
    if (!onReady) return undefined;
    onReady({
      shake: () => engineRef.current?.shake(),
      capture: () => engineRef.current?.capture() ?? null,
      reset: () => engineRef.current?.resetMagnets(),
    });
    return () => onReady(null);
  }, [onReady]);

  return (
    <div ref={plateRef} className="filings-plate" tabIndex={-1} data-ready={sample ? "true" : undefined}>
      <div ref={hostRef} className="filings-plate__canvas" />
      {sample
        ? magnets.map((magnet) => <Magnet key={magnet.id} magnet={magnet} register={register} />)
        : null}
    </div>
  );
}
