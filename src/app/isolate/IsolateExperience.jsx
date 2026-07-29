"use client";

import ClientOnly from "@/app/ui/ClientOnly";

export default function IsolateExperience() {
  return (
    <main className="isolate-page">
      <div className="isolate-canvas">
        <ClientOnly
          load={() => import("./IsolateScene")}
          fallback={<div style={{ width: "100%", height: "100%" }} />}
        />
      </div>

      <p className="isolate-note">Drag to turn him around.</p>

      <style>{`
        .isolate-page {
          position: relative;
          min-height: 100lvh;
          background: var(--color-surface);
          display: grid;
          grid-template-rows: 1fr auto;
          place-items: center;
          padding: 0 24px 40px;
        }
        .isolate-canvas {
          width: min(78vmin, 720px);
          height: min(78vmin, 720px);
          justify-self: center;
          align-self: center;
        }
        .isolate-note {
          color: var(--color-ink);
          font-size: var(--text-ui);
          line-height: var(--text-ui--line-height);
          letter-spacing: var(--text-ui--letter-spacing);
          font-weight: var(--text-ui--font-weight);
          margin: 0;
        }
        @media (max-width: 768px) {
          .isolate-canvas {
            width: min(92vw, 560px);
            height: min(92vw, 560px);
          }
        }
      `}</style>
    </main>
  );
}
