import { notFound } from "next/navigation";
import { pieceData, pieceDataFrom } from "@/app/experiments/layouts/pieceData";
import ReelStage from "./ReelStage";

// Dev-only recording stage for tools/showreel: one experiment, mounted the
// way its experiments-page tile mounts it (embedded: no title, hints or
// chrome), filling the whole viewport, with the same server props the tile
// gets. Never served in production.
export const metadata = { robots: { index: false, follow: false } };

const LIVE = "https://herb.art/api/spotify/recent";

async function propsFor(slug) {
  let data = await pieceData();
  if (data[slug] && !Object.values(data[slug]).some((v) => Array.isArray(v) && v.length)) {
    // No Spotify keys on this machine: borrow the live site's listening.
    const live = await fetch(LIVE, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (live?.tracks?.length) data = pieceDataFrom(live.tracks);
  }
  return data[slug] ?? null;
}

export default async function ReelPage({ searchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { p } = await searchParams;
  if (!p) notFound();
  return <ReelStage slug={p} data={await propsFor(p)} />;
}
