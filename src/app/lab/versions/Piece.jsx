"use client";

import { Fragment, useEffect, useRef } from "react";

import { COUNT, VERSIONS } from "./versionsData";
import "./versions.css";

const LABEL =
  "A short note with twelve earlier saves stacked behind it in depth. Drag or scroll up to bring older versions forward, down to return; the arrow keys step one save at a time. On the front card, words that save added are highlighted and a red caret marks where words were removed.";

// Words as spans: runs of added words share one highlight so it reads as a
// single stroke of the marker, and a removal leaves a caret before the word
// that follows it.
function Words({ diff }) {
  const out = [];
  const { tokens, removedAfter } = diff;
  let k = 0;
  while (k < tokens.length) {
    const t = tokens[k];
    // A word swapped for another is already marked by its highlight; the
    // caret is only for words taken out and not replaced.
    const cut = t.removedBefore > 0 && !t.added ? <span className="versions-cut" aria-hidden="true" /> : null;
    if (t.added) {
      let end = k;
      while (end + 1 < tokens.length && tokens[end + 1].added && tokens[end + 1].removedBefore === 0) end += 1;
      out.push(
        <Fragment key={k}>
          {k > 0 ? " " : null}
          {cut}
          <mark className="versions-add">{tokens.slice(k, end + 1).map((x) => x.word).join(" ")}</mark>
        </Fragment>,
      );
      k = end + 1;
    } else {
      out.push(
        <Fragment key={k}>
          {k > 0 ? " " : null}
          {cut}
          {t.word}
        </Fragment>,
      );
      k += 1;
    }
  }
  if (removedAfter > 0) out.push(<span key="end" className="versions-cut" aria-hidden="true" />);
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
    <Root ref={rootRef} className="versions" data-embedded={embedded ? "" : undefined}>
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
