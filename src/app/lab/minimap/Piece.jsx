"use client";

import { useEffect, useRef } from "react";

import { ARTICLE, BLOCKS, DEK_RUNS } from "./minimapArticle";
import { mountMinimap } from "./minimapEngine";
import "./minimap.css";

function Runs({ runs }) {
  return runs.map((run, i) => (run.em ? <em key={i}>{run.value}</em> : run.value));
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const scrollerRef = useRef(null);
  const articleRef = useRef(null);
  const trackRef = useRef(null);
  const labelRef = useRef(null);
  const labelNumberRef = useRef(null);
  const labelTitleRef = useRef(null);
  const tickTopRef = useRef(null);
  const tickBottomRef = useRef(null);
  const stemRef = useRef(null);
  const linesRef = useRef([]);
  const blocksRef = useRef([]);

  useEffect(() => {
    return mountMinimap({
      root: rootRef.current,
      scroller: scrollerRef.current,
      article: articleRef.current,
      track: trackRef.current,
      label: labelRef.current,
      labelNumber: labelNumberRef.current,
      labelTitle: labelTitleRef.current,
      ticks: [tickTopRef.current, tickBottomRef.current],
      stem: stemRef.current,
      lines: linesRef.current,
      blocks: BLOCKS,
      blockEls: blocksRef.current,
      inset: embedded ? 0 : 72,
    });
  }, [embedded]);

  return (
    <div ref={rootRef} className="mm-root" data-embedded={embedded ? "" : undefined} style={{ "--mm-count": BLOCKS.length }}>
      <div ref={scrollerRef} className="mm-scroller" data-scroll-contain tabIndex={0} aria-label={ARTICLE.title}>
        <div className="mm-dock">
          <div className="mm-rail">
            <div
              ref={trackRef}
              className="mm-track"
              role="slider"
              tabIndex={0}
              aria-label="Article minimap"
              aria-orientation="vertical"
              aria-valuemin={1}
              aria-valuemax={BLOCKS.length}
              aria-valuenow={1}
            >
              {BLOCKS.map((block, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    linesRef.current[i] = el;
                  }}
                  className="mm-line"
                  data-kind={block.kind}
                  style={{ "--i": i, "--w": (block.width * 40) / 52 }}
                />
              ))}
              <span ref={stemRef} className="mm-stem" />
              <span ref={tickTopRef} className="mm-tick" />
              <span ref={tickBottomRef} className="mm-tick" />
              <div ref={labelRef} className="mm-label" aria-hidden="true">
                <span ref={labelNumberRef} className="mm-label__number" />
                <span ref={labelTitleRef} className="mm-label__title" />
              </div>
            </div>
          </div>
        </div>
        <article ref={articleRef} className="mm-article">
          <header className="mm-header">
            <p className="mm-kicker">{ARTICLE.kicker}</p>
            <h1 className="mm-title">{ARTICLE.title}</h1>
            <p className="mm-dek">
              <Runs runs={DEK_RUNS} />
            </p>
            <p className="mm-meta">{ARTICLE.meta}</p>
          </header>
          {BLOCKS.map((block, i) =>
            block.kind === "heading" ? (
              <h2
                key={i}
                ref={(el) => {
                  blocksRef.current[i] = el;
                }}
                className="mm-h2"
              >
                <span className="mm-h2__index">{String(block.section + 1).padStart(2, "0")}</span>
                {block.text}
              </h2>
            ) : (
              <p
                key={i}
                ref={(el) => {
                  blocksRef.current[i] = el;
                }}
                className="mm-p"
              >
                <Runs runs={block.runs} />
              </p>
            ),
          )}
          <p className="mm-end">End of notes</p>
        </article>
      </div>
    </div>
  );
}
