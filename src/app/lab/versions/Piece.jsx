"use client";

import { Newsreader } from "next/font/google";
import { Fragment, useEffect, useRef } from "react";

import { COUNT, VERSIONS } from "./versionsData";
import "./versions.css";

const LABEL =
  "A short note with twelve earlier saves stacked behind it in depth. Drag or scroll up to bring older versions forward, down to return; the arrow keys step one save at a time. On the front card, words that save added are set in a serif and a red caret marks where words were removed.";

// Newsreader (Production Type, OFL) for the mark-up: a real optical-size
// axis, so "opsz" 10 sets the sturdy small-text cut beside the grotesk.
const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["italic"], display: "block", variable: "--versions-serif" });

// A caret with no width where words were taken out and not replaced; a word
// swapped for another is already marked by the correction itself.
const Cut = () => <span className="versions-cut" aria-hidden="true" />;

// The text as a proofreader marks it: each run of what this save wrote is
// set in the serif, as one correction, with a caret wherever words went.
function Words({ diff }) {
  const out = [];
  diff.runs.forEach((run, r) => {
    const parts = [];
    run.tokens.forEach((t, k) => {
      if (k > 0) parts.push(" ");
      if (t.removedBefore > 0 && !t.added) parts.push(<Cut key={`c${k}`} />);
      parts.push(t.word);
    });
    out.push(
      <Fragment key={r}>
        {r > 0 ? " " : null}
        {run.added ? <ins className="versions-add">{parts}</ins> : parts}
      </Fragment>,
    );
  });
  if (diff.removedAfter > 0) out.push(<Cut key="end" />);
  return out;
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createVersions } = await import("./versionsEngine");
      if (cancelled) return;
      engine = createVersions(root, { embedded });
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className={`versions ${serif.variable}`} data-embedded={embedded ? "" : undefined}>
      <div className="versions-stage" tabIndex={0} role="application" aria-roledescription="version stack" aria-label={LABEL}>
        <div className="versions-space">
          {VERSIONS.map((v, i) => (
            <article key={i} className="versions-card" data-i={i} aria-hidden={i === 0 ? undefined : "true"}>
              <div className="versions-head">
                <h2 className="versions-title">
                  <Words diff={v.title} />
                </h2>
                <span className="versions-stamp">{v.when}</span>
              </div>
              <p className="versions-body">
                <Words diff={v.body} />
              </p>
            </article>
          ))}
        </div>
      </div>
      <div className="versions-timeline" role="group" aria-label="Saved versions">
        {VERSIONS.map((v, i) => (
          <button key={i} type="button" className="versions-tick" data-i={i} style={{ top: `${(COUNT - 1 - i) * 16}px` }} aria-label={v.when}>
            <span className="versions-when">{v.when}</span>
          </button>
        ))}
      </div>
    </Root>
  );
}
