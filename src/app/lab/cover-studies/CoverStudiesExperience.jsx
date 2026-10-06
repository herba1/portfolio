"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import "./cover-studies.css";
import AsciiCover from "./AsciiCover";
import CoverRing from "./CoverRing";
import useCovers from "./useCovers";

const STORE_KEY = "cover-studies-approvals";
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readStore() {
  try {
    return window.localStorage.getItem(STORE_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function readServerStore() {
  return "{}";
}

function writeStore(next) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

const STUDIES = [
  {
    id: "cover-ring",
    name: "Cover ring",
    Component: CoverRing,
    note: "Eight real covers on a wheel you look down onto, each a rounded board with real thickness and an edge coloured from its own artwork, like the deck. Wide gaps, no overlap, and every cover turns to face you, and at the back you see a halftone pattern sampled from its own colours. Drag to spin it, move up and down to change how steeply you look.",
    spec: "DOM 3D cylinder wheel of 8 real covers (perspective 1300px, radius from card width and count with a 1.3x gap so chords never touch, viewed from 28 degrees above so the far side sits clear of the near side); rounded 10px boards with thickness and 5-band sampled edge colour, each counter-rotated 80% toward the camera, easing off over the back third so it turns smoothly to show a back face that is an 8x8 halftone of the cover's own sampled colours (dot size by darkness) on its mid-tone; drag spins with inertia and slow drift; pointer Y changes the viewing angle.",
  },
  {
    id: "ascii-cover",
    name: "ASCII cover",
    Component: AsciiCover,
    note: "A cover redrawn in characters on colour-matched cells. Click and the next cover rolls outward from where you clicked as a soft ripple that swells and cross-fades the characters. Everything is pre-rendered, so the click costs a handful of image draws.",
    spec: "Canvas monospace render at 56 columns on colour-matched cells: edge-aware characters (| - / \\) plus a luminance ramp with contrast-tinted ink, or the song title's letters; each cover is rendered once to an offscreen layer and the next one is pre-built when idle; click sends the next cover outward from the click as a 12-ring ripple (alpha 0.2 each, 12% scale warp tapering to the front, 260px soft edge at 0.9px/ms) with no per-cell drawing.",
  },
];

function Study({ study, items, approved, onVote, onCopy, copied }) {
  const { Component } = study;
  return (
    <section className="cs-card" data-approved={approved === "approve"}>
      <header className="cs-card__head">
        <h2 className="text-title-sm">{study.name}</h2>
              </header>
      <p className="text-body cs-card__note">{study.note}</p>
      <div className="cs-stage">
        <Component items={items} />
      </div>
      <div className="cs-actions">
        {study.built ? null : (
          <>
            <button type="button" className="cs-btn text-ui-lg" data-on={approved === "approve"} onClick={() => onVote(study.id, "approve")}>
              Approve
            </button>
            <button type="button" className="cs-btn text-ui-lg" data-on={approved === "skip"} data-tone="ink" onClick={() => onVote(study.id, "skip")}>
              Skip
            </button>
          </>
        )}
        <span className="cs-grow" />
        <button type="button" className="cs-btn text-ui-lg" onClick={() => onCopy(study)}>
          {copied === study.id ? "Copied" : "Copy spec"}
        </button>
      </div>
    </section>
  );
}

export default function CoverStudiesExperience({ covers }) {
  const items = useCovers(covers);
  const raw = useSyncExternalStore(subscribe, readStore, readServerStore);
  const votes = useMemo(() => JSON.parse(raw), [raw]);
  const [copied, setCopied] = useState("");

  const vote = useCallback(
    (id, value) => {
      writeStore({ ...votes, [id]: votes[id] === value ? null : value });
    },
    [votes],
  );

  const copy = useCallback(async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(label);
    setTimeout(() => setCopied(""), 1100);
  }, []);

  const approvedNew = STUDIES.filter((study) => !study.built && votes[study.id] === "approve");

  return (
    <main className="cs">
      <div className="cs-bar">
        <h1 className="text-title-sm">Cover studies</h1>
        <span className="text-ui-lg cs-count">{approvedNew.length} approved</span>
        <span className="cs-grow" />
        <button
          type="button"
          className="cs-btn text-ui-lg"
          data-tone="ink"
          onClick={() =>
            copy(
              approvedNew.length
                ? `Approved from /lab/cover-studies:\n${approvedNew.map((study) => `- ${study.name} (${study.id}): ${study.spec}`).join("\n")}`
                : "Nothing approved yet.",
              "all",
            )
          }
        >
          {copied === "all" ? "Copied" : "Copy approved"}
        </button>
      </div>
      <p className="text-ui-lg cs-lede">
        Two studies on your real covers. Approve or skip each, then copy the list to me.
      </p>
      {items.length === 0 ? (
        <p className="text-body">Loading covers…</p>
      ) : (
        <div className="cs-grid">
          {STUDIES.map((study) => (
            <Study
              key={study.id}
              study={study}
              items={items}
              approved={votes[study.id]}
              onVote={vote}
              onCopy={(entry) => copy(`${entry.name}: ${entry.spec}`, entry.id)}
              copied={copied}
            />
          ))}
        </div>
      )}
    </main>
  );
}
