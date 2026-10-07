"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import ClientOnly from "@/app/ui/ClientOnly";

import CopierPanel from "./CopierPanel";
import CopierTray from "./CopierTray";
import { flyCopy, settleNode } from "./copierFlight";
import { seededJitter } from "./copierMotion";
import { DEFAULT_PRESET, SOURCES, presetValues } from "./copierParams";
import "./copier.css";

const loadStage = () => import("./CopierStage");
if (typeof window !== "undefined") loadStage();

const KEEP_SHEETS = 6;
const KEEP_COPIES = 40;
const THUMB_WIDTH = 384;
const THUMB_HEIGHT = 480;

async function makeThumb(sheet) {
  let picture = sheet;
  try {
    picture = await createImageBitmap(sheet, { resizeWidth: THUMB_WIDTH, resizeHeight: THUMB_HEIGHT, resizeQuality: "high" });
  } catch {
    picture = sheet;
  }
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(picture, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  if (picture !== sheet && typeof picture.close === "function") picture.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/jpeg", 0.88);
}

function makeEntry(id, sheet, gen, fed) {
  return {
    id,
    gen,
    sheet,
    thumb: null,
    fed,
    arrived: false,
    jitterX: (seededJitter(id) - 0.5) * 6,
    jitterY: (seededJitter(id + 31) - 0.5) * 4,
    jitterTurn: (seededJitter(id + 77) - 0.5) * 5,
  };
}

function addEntry(list, entry) {
  return [...list, entry].slice(-KEEP_COPIES).map((copy, index, all) => (index < all.length - KEEP_SHEETS && copy.sheet ? { ...copy, sheet: null } : copy));
}

function downloadSheet(sheet, gen) {
  sheet.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `copier-generation-${gen}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

function isTyping(target) {
  if (!target || !target.closest) return false;
  return Boolean(target.closest("button, input, textarea, select, label, [contenteditable='true']"));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function SheetPlaceholder({ source }) {
  return (
    <div className="copier-sheet" data-phase="idle">
      <div
        className="copier-sheet__fallback"
        style={source.kind === "image" ? { "--copier-original": `url(${source.url})` } : undefined}
        aria-hidden="true"
      />
    </div>
  );
}

export default function CopierExperience() {
  const [source, setSource] = useState(() => ({ ...SOURCES[0], autoplay: true }));
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [params, setParams] = useState(() => presetValues(DEFAULT_PRESET));
  const [phase, setPhase] = useState("idle");
  const [copies, setCopies] = useState([]);
  const [fanned, setFanned] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const [note, setNote] = useState("");

  const apiRef = useRef(null);
  const pileRef = useRef(null);
  const rootRef = useRef(null);
  const nextIdRef = useRef(1);
  const landingRef = useRef(null);
  const objectUrlRef = useRef(null);
  const actionsRef = useRef(null);
  const thumbUrlsRef = useRef(null);
  const flightsRef = useRef(null);

  const handlePhase = useCallback((next) => {
    setPhase(next);
  }, []);

  const arrive = useCallback((id, thumb) => {
    setCopies((list) => list.map((copy) => (copy.id === id ? { ...copy, thumb, arrived: true } : copy)));
    const pile = pileRef.current;
    if (pile && !prefersReducedMotion()) {
      pile.animate([{ transform: "translateY(0px)" }, { transform: "translateY(4px)" }, { transform: "translateY(0px)" }], {
        duration: 280,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
    }
  }, []);

  const handleCopied = useCallback(
    ({ sheet, gen, rect }) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      const entry = makeEntry(id, sheet, gen, false);
      setFanned(false);
      setCopies((list) => addEntry(list, entry));
      const pile = pileRef.current;
      if (!pile || prefersReducedMotion()) {
        makeThumb(sheet).then((thumb) => arrive(id, thumb));
        return;
      }
      const flight = flyCopy({
        sheet,
        sheetRect: rect,
        pileRect: pile.getBoundingClientRect(),
        direction: "out",
        rotate: entry.jitterTurn,
        nudge: { x: entry.jitterX, y: entry.jitterY },
      });
      if (!flightsRef.current) flightsRef.current = new Set();
      flightsRef.current.add(flight.node);
      flight.finished
        .then((node) => makeThumb(sheet).then((thumb) => [node, thumb]))
        .then(([node, thumb]) => {
          arrive(id, thumb);
          if (flightsRef.current) flightsRef.current.delete(node);
          settleNode(node);
        });
    },
    [arrive],
  );

  const handleReady = useCallback((loaded) => {
    setNote("");
    const landing = landingRef.current;
    if (landing && loaded && landing.token === loaded.token) {
      landingRef.current = null;
      settleNode(landing.node);
    }
  }, []);

  const handleError = useCallback(() => {
    setNote("That picture would not load. Try another.");
  }, []);

  const startCopy = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.wake();
    api.startPass();
  }, []);

  const putBack = useCallback((copy, fromElement, autoStart) => {
    const api = apiRef.current;
    const sheetElement = api ? api.sheet() : null;
    if (!api || !sheetElement || !copy.sheet) return;
    api.wake();
    const token = `copy-${copy.id}-${nextIdRef.current}`;
    nextIdRef.current += 1;
    const next = { id: token, token, kind: "copy", canvas: copy.sheet, gen: copy.gen, autoStart, landed: true, label: `Generation ${copy.gen}` };
    setFanned(false);
    if (prefersReducedMotion() || !fromElement) {
      setSource({ ...next, landed: false });
      return;
    }
    const fromRect = fromElement.getBoundingClientRect();
    const pileRect = pileRef.current ? pileRef.current.getBoundingClientRect() : fromRect;
    const size = { width: pileRect.width, height: pileRect.height };
    const pileLike = {
      left: fromRect.left + fromRect.width / 2 - size.width / 2,
      top: fromRect.top + fromRect.height / 2 - size.height / 2,
      width: size.width,
      height: size.height,
    };
    const flight = flyCopy({
      sheet: copy.sheet,
      sheetRect: sheetElement.getBoundingClientRect(),
      pileRect: pileLike,
      direction: "in",
      rotate: copy.jitterTurn,
    });
    flight.finished.then((node) => {
      if (landingRef.current && landingRef.current.node !== node) settleNode(landingRef.current.node);
      landingRef.current = { node, token };
      setSource(next);
    });
  }, []);

  const feedHeld = useCallback(() => {
    const api = apiRef.current;
    const held = api ? api.takeHeld() : null;
    if (!held) return false;
    api.wake();
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setFanned(false);
    setCopies((list) => addEntry(list, makeEntry(id, held.sheet, held.gen, true)));
    makeThumb(held.sheet).then((thumb) => arrive(id, thumb));
    const token = `fed-${id}`;
    setSource({ id: token, token, kind: "copy", canvas: held.sheet, gen: held.gen, autoStart: true, landed: true, fromHeld: true, label: `Generation ${held.gen}` });
    return true;
  }, [arrive]);

  const copyTheCopy = useCallback(() => {
    if (phase === "pass") return;
    if (phase === "hold" && feedHeld()) return;
    const latest = [...copies].reverse().find((copy) => copy.arrived && copy.sheet);
    if (!latest) return;
    const pile = pileRef.current;
    const top = pile ? pile.querySelector(".copier-copy[data-depth='0']") : null;
    putBack(latest, top, true);
  }, [copies, phase, putBack, feedHeld]);

  const pickSource = useCallback(
    (next) => {
      if (phase === "pass") return;
      if (next.id === source.id && apiRef.current) {
        apiRef.current.recentre();
        return;
      }
      setSource({ ...next, token: `${next.id}-${nextIdRef.current}` });
      nextIdRef.current += 1;
    },
    [phase, source.id],
  );

  const pickFile = useCallback(
    (file) => {
      if (phase === "pass" || !file.type.startsWith("image")) return;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setSource({ id: "own", kind: "image", url, gen: 0, label: file.name, token: `own-${nextIdRef.current}` });
      nextIdRef.current += 1;
    },
    [phase],
  );

  const choosePreset = useCallback((next) => {
    setPreset(next);
    setParams((current) => presetValues(next, current));
  }, []);

  const changeParam = useCallback((key, value) => {
    setParams((current) => ({ ...current, [key]: value }));
  }, []);

  const saveLatest = useCallback(() => {
    const held = phase === "hold" && apiRef.current ? apiRef.current.snapshot() : null;
    if (held) {
      downloadSheet(held.sheet, held.gen);
      return;
    }
    const latest = [...copies].reverse().find((copy) => copy.arrived);
    if (!latest) return;
    if (latest.sheet) {
      downloadSheet(latest.sheet, latest.gen);
      return;
    }
    const link = document.createElement("a");
    link.href = latest.thumb;
    link.download = `copier-generation-${latest.gen}.jpg`;
    link.click();
  }, [copies, phase]);

  useEffect(() => {
    actionsRef.current = { startCopy, copyTheCopy, setFanned };
  }, [startCopy, copyTheCopy]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const actions = actionsRef.current;
      if (!actions) return;
      if (event.key === "Escape") {
        actions.setFanned(false);
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        if (!event.repeat) actions.startCopy();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat) actions.copyTheCopy();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!fanned) return undefined;
    const onDown = (event) => {
      if (pileRef.current && pileRef.current.contains(event.target)) return;
      setFanned(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [fanned]);

  useEffect(() => {
    if (!thumbUrlsRef.current) thumbUrlsRef.current = new Map();
    const urls = thumbUrlsRef.current;
    const live = new Set();
    for (const copy of copies) {
      live.add(copy.id);
      if (copy.thumb && copy.thumb.startsWith("blob:")) urls.set(copy.id, copy.thumb);
    }
    for (const [id, url] of urls) {
      if (live.has(id)) continue;
      URL.revokeObjectURL(url);
      urls.delete(id);
    }
  }, [copies]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (landingRef.current) landingRef.current.node.remove();
      if (flightsRef.current) for (const node of flightsRef.current) node.remove();
      if (thumbUrlsRef.current) for (const url of thumbUrlsRef.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  const onDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) pickFile(file);
  };

  const hasCopy = phase === "hold" || copies.some((copy) => copy.arrived && copy.sheet);
  const canSave = phase === "hold" || copies.some((copy) => copy.arrived);
  const sourceId = source.kind === "copy" ? null : source.id;

  return (
    <main ref={rootRef} className="copier bg-surface text-ink">
      <div className="copier__layout">
        <header className="copier__head">
          <h1 className="text-title-sm">Copier</h1>
          <p className="text-ui-lg text-ink-secondary">Drag the picture while the light passes over it.</p>
        </header>

        <section className="copier__stage" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <ClientOnly
            load={loadStage}
            fallback={<SheetPlaceholder source={source} />}
            source={source}
            params={params}
            preset={preset}
            sound={sound}
            apiRef={apiRef}
            onPhase={handlePhase}
            onCopied={handleCopied}
            onReady={handleReady}
            onError={handleError}
          />
        </section>

        <CopierPanel
          phase={phase}
          generation={(source.gen || 0) + 1}
          hasCopy={hasCopy}
          presetName={preset.name}
          params={params}
          sourceId={sourceId}
          tuneOpen={tuneOpen}
          sound={sound}
          note={note}
          onCopy={startCopy}
          onCopyTheCopy={copyTheCopy}
          onPreset={choosePreset}
          onParam={changeParam}
          onSource={pickSource}
          onFile={pickFile}
          onTune={() => setTuneOpen((open) => !open)}
          onSound={setSound}
        />

        <CopierTray
          copies={copies}
          fanned={fanned}
          pileRef={pileRef}
          busy={phase === "pass"}
          onFan={() => setFanned((open) => !open)}
          onPick={(copy, element) => putBack(copy, element, false)}
          onSave={saveLatest}
          canSave={canSave}
        />
      </div>
    </main>
  );
}
