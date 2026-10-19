"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { SPREAD } from "./smearContent";
import "./smear.css";

function Photo({ photo, className = "" }) {
  return (
    <figure
      className={`smear__photo ${className}`.trim()}
      style={{ aspectRatio: photo.ratio }}
      data-smear="photo"
      data-src={photo.src.src}
      data-fx={photo.focus[0]}
      data-fy={photo.focus[1]}
    >
      <img className="smear__img" src={photo.src.src} alt={photo.alt} draggable={false} style={{ objectPosition: `${photo.focus[0] * 100}% ${photo.focus[1] * 100}%` }} />
    </figure>
  );
}

function Line({ line }) {
  return (
    <p className="smear__line" data-size={line.size} data-align={line.align} data-smear="text">
      {line.text}
    </p>
  );
}

function Block({ block }) {
  if (block.kind === "line") return <Line line={block} />;
  if (block.kind === "photo") return <Photo photo={block} className={`smear__photo--${block.layout}`} />;
  if (block.kind === "pair") {
    return (
      <div className="smear__pair">
        {block.photos.map((photo) => (
          <Photo key={photo.id} photo={photo} />
        ))}
      </div>
    );
  }
  return (
    <div className="smear__aside">
      <Photo photo={block.photo} />
      <Line line={block.line} />
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const scrollerRef = useRef(null);
  const contentRef = useRef(null);
  const canvasRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    import("./smearEngine").then(({ createSmear }) => {
      if (cancelled) return;
      engine = createSmear({
        scroller: scrollerRef.current,
        content: contentRef.current,
        canvas: canvasRef.current,
        onReady: () => setPhase("ready"),
        onFail: () => setPhase("failed"),
      });
    });
    return () => {
      cancelled = true;
      engine?.destroy();
    };
  }, [near]);

  return (
    <div ref={rootRef} className="smear" data-ready={phase === "ready" ? "" : undefined} data-failed={phase === "failed" ? "" : undefined} data-embedded={embedded ? "" : undefined}>
      <div ref={scrollerRef} className="smear__scroller" data-scroll-contain="" tabIndex={0} aria-label="Smear, a scrolling photo essay">
        <article ref={contentRef} className="smear__content">
          <div className="smear__layer" aria-hidden="true">
            <canvas ref={canvasRef} className="smear__canvas" />
          </div>
          {embedded ? null : (
            <header className="smear__head">
              <h1 className="smear__title">Smear</h1>
              <p className="smear__lede">
                Scroll slowly and it holds still. Scroll hard and every photo and line <em>smears</em> in uneven bands and burns out, then snaps back.
              </p>
            </header>
          )}
          <div className="smear__spread">
            {SPREAD.map((block) => (
              <Block key={block.id} block={block} />
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
