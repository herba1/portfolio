"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const GROUPS = [
  { key: "all", label: "All", test: () => true },
  { key: "photo", label: "Photo and film", tags: ["Photography", "Photo", "Film", "Depth", "Optics", "Light"] },
  { key: "generative", label: "Generative", tags: ["generative"] },
  { key: "type", label: "Type and print", tags: ["Type", "Typography", "Print", "Paper"] },
  { key: "sound", label: "Music and sound", tags: ["Music", "Sound"] },
  { key: "interface", label: "Interface", tags: ["Interface", "Interaction", "Gesture", "Input"] },
];

function inGroup(piece, group) {
  if (group.test) return group.test(piece);
  return piece.tags.some((t) => group.tags.includes(t));
}

function readHash() {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "");
  return h || null;
}

export default function LabIndex({ pieces }) {
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(pieces[0]?.slug ?? null);
  const listRef = useRef(null);

  const visible = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group) ?? GROUPS[0];
    const q = query.trim().toLowerCase();
    return pieces.filter(
      (p) =>
        inGroup(p, g) &&
        (!q || p.title.toLowerCase().includes(q) || p.slug.includes(q) || p.blurb.toLowerCase().includes(q)),
    );
  }, [pieces, group, query]);

  // Start on the piece named in the hash, else the newest.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h && pieces.some((p) => p.slug === h)) setCurrent(h);
    };
    const raf = requestAnimationFrame(onHash);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", onHash);
    };
  }, [pieces]);

  const select = useCallback((slug) => {
    setCurrent(slug);
    if (window.location.hash !== `#${slug}`) history.replaceState(null, "", `#${slug}`);
  }, []);

  const step = useCallback(
    (dir) => {
      if (!visible.length) return;
      const i = visible.findIndex((p) => p.slug === current);
      const next = visible[(i + dir + visible.length) % visible.length];
      select(next.slug);
    },
    [visible, current, select],
  );

  // Arrow keys step through the visible list (not while typing in search).
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Keep the selected row in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-slug="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const piece = pieces.find((p) => p.slug === current);

  return (
    <div
      className="bg-surface text-ink fixed inset-0 z-[1000] flex flex-col md:flex-row"
      style={{
        fontSynthesis: "none",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        textRendering: "optimizeLegibility",
      }}
    >
      <aside className="border-line flex max-h-[40dvh] flex-col border-b md:max-h-none md:w-80 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-ui-lg" style={{ textWrap: "balance" }}>
              Lab
            </h1>
            <span className="text-ui-sm text-ink-secondary tabular-nums">
              {visible.length} of {pieces.length}
            </span>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="text-ui border-line bg-surface rounded-md border px-3 py-2 outline-none focus:border-current"
          />
          <div className="flex flex-wrap gap-x-1.5 gap-y-1">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGroup(g.key)}
                className={`text-ui-sm rounded-full border px-2.5 py-1 transition-colors ${
                  group === g.key ? "border-current" : "border-line text-ink-secondary hover:text-ink"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <ul ref={listRef} className="flex-1 overflow-y-auto px-2 pb-4">
          {visible.map((p) => (
            <li key={p.slug} data-slug={p.slug}>
              <button
                type="button"
                onClick={() => select(p.slug)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                  p.slug === current ? "bg-[var(--color-badge-bg)]" : "hover:bg-[var(--color-badge-bg)]"
                }`}
              >
                <span className="text-ui truncate">{p.title}</span>
                {p.status === "shipped" && <span className="text-ui-xs text-ink-secondary shrink-0">Shipped</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {piece && (
          <header className="border-line flex items-center justify-between gap-4 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-ui-lg truncate">{piece.title}</h2>
              <p className="text-ui-sm text-ink-secondary truncate">{piece.blurb}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={() => step(-1)} className="text-ui border-line rounded-md border px-3 py-1">
                Prev
              </button>
              <button type="button" onClick={() => step(1)} className="text-ui border-line rounded-md border px-3 py-1">
                Next
              </button>
              <a
                href={`/lab/${piece.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-ui border-line rounded-md border px-3 py-1"
              >
                Open
              </a>
            </div>
          </header>
        )}
        {piece ? (
          <iframe
            key={piece.slug}
            title={piece.title}
            src={`/lab/${piece.slug}`}
            className="min-h-0 w-full flex-1 border-0"
            allow="autoplay; fullscreen; clipboard-write"
          />
        ) : (
          <p className="text-ui text-ink-secondary p-4">No pieces match.</p>
        )}
      </main>
    </div>
  );
}
