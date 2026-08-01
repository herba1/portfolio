import { CARD_IMAGES } from "./cards";

/* Server-rendered preload hints. The client warmer (warmImages) also decodes,
   but it cannot run until hydration — these get the bytes moving in the first
   HTML response instead, so by the time a filter is tapped the files are
   already in the HTTP cache. Twelve files, ~1.5MB, all of it needed. */
export default function PreloadScans() {
  return (
    <>
      {CARD_IMAGES.map((src) => (
        <link key={src} rel="preload" as="image" href={src} fetchPriority="high" />
      ))}
    </>
  );
}
