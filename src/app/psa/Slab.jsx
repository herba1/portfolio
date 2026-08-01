"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { isWarm, subscribeWarm, warmImage } from "./warmImages";

/* ─────────────────────────────────────────────────────────────────────────
   Slab — the card scan.

   Was a drawn graded holder: a bordered shell with a label strip carrying
   the year, set and PSA grade across the top. All of that is gone. The scan
   is a hundred-year-old lithograph and it does not need a frame, a rule or a
   badge to be worth looking at — a border around a picture that already has
   its own printed border is two frames doing one job.

   What is left is the image, cropped to a consistent card ratio and rounded.
   Nothing else.
   ───────────────────────────────────────────────────────────────────────── */

// getServerSnapshot. Also what React uses for the HYDRATION render, which is
// the whole reason this is a store and not a plain read.
const COLD = () => false;

export default function Slab({ card, sizes = "40vw" }) {
  const [broken, setBroken] = useState(false);
  const showImage = card.image && !broken;

  // Belt and braces: the surface warms the whole set at mount, but a Slab
  // rendered from anywhere else still gets its own scan held and decoded.
  // In an effect, not the render body — a decode resolving mid-hydration used
  // to flip `cached` between the server HTML and the client render, and React
  // threw the whole subtree away and re-rendered it client-side.
  useEffect(() => {
    warmImage(card.image);
  }, [card.image]);

  /* Server and hydration both see false, which is what the HTML says. Tiles
     mounted after hydration — every filter and tab switch — read the live set
     on their first render, so they still get decoding="sync" on the element
     at creation time, which is the only moment the attribute matters. */
  const readWarm = useCallback(() => isWarm(card.image), [card.image]);
  const cached = useSyncExternalStore(subscribeWarm, readWarm, COLD);

  return (
    <div className="slab">
      <div className={`slab-face${showImage ? "" : " slab-face--empty"}`}>
        {showImage && (
          /* Plain <img>: these are static public-domain scans of a known
             size, so next/image's resizing pipeline buys nothing here and
             the loader would only add a request hop.

             Never lazy — the whole set is twelve files and it is all warmed
             at mount, so deferring anything only reintroduces the pop this
             is meant to remove. Once warm, decoding="sync" paints the
             already-decoded bitmap in the same frame the tile mounts. */
          <img
            src={card.image}
            alt={`${card.year} ${card.set} ${card.player}`}
            loading="eager"
            decoding={cached ? "sync" : "async"}
            fetchPriority="high"
            sizes={sizes}
            onError={() => setBroken(true)}
          />
        )}
      </div>
    </div>
  );
}
