import { getRecentTracks } from "@/lib/spotifyRecent";
import Deck from "./Deck";
import PieceBox from "@/app/experiments/PieceBox";
import { ExperimentHeading, ExperimentJsonLd, experimentMetadata } from "@/app/experiments/seo";

export const metadata = experimentMetadata("/deck");

// The Spotify read uses `cache: "no-store"` (the token exchange has to), which
// makes this page dynamic — no `revalidate` here, since it would be ignored.
// Fine for a sandbox route; the covers themselves are CDN-cached by Spotify.
export default async function DeckPage() {
  const { tracks } = await getRecentTracks();
  return (
    <>
      <ExperimentJsonLd slug="/deck" />
      <ExperimentHeading slug="/deck" />
      <PieceBox viewport>
        <Deck tracks={tracks} />
      </PieceBox>
    </>
  );
}
