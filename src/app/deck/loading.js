// The Spotify read in page.js is `no-store`, so /deck is a dynamic route: a
// soft navigation blocks on the whole token-exchange + recent-tracks
// waterfall (~1s) before anything paints. A loading boundary lets the router
// commit the navigation immediately and stream the deck in when it's ready.
export default function Loading() {
  return <div className="bg-surface min-h-dvh" />;
}
