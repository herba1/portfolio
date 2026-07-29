import { getRecentTracks } from "@/lib/spotifyRecent";
import Deck from "./Deck";

export const metadata = {
  title: "Deck",
  description:
    "Fifty album covers on a stack you can run through, and fan out.",
};

// The Spotify read uses `cache: "no-store"` (the token exchange has to), which
// makes this page dynamic — no `revalidate` here, since it would be ignored.
// Fine for a sandbox route; the covers themselves are CDN-cached by Spotify.
export default async function DeckPage() {
  const { tracks } = await getRecentTracks();
  return <Deck tracks={tracks} />;
}
