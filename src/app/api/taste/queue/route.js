import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import { awaitingJudgement, currentTasteVersion, effectiveVerdicts, listManifests, readVotes } from "@/lib/taste/store";

const RECHECK_AFTER_DAYS = 3;
const RECHECK_COOLDOWN_DAYS = 30;

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

export async function GET() {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  const [manifests, votes, tasteVersion] = await Promise.all([listManifests(), readVotes(), currentTasteVersion()]);
  const verdicts = effectiveVerdicts(votes);

  const fresh = manifests.filter(
    (m) => (m.status === "candidate" || m.status === "liked") && awaitingJudgement(m, verdicts.get(m.slug)),
  );

  const lastRecheck = new Map();
  for (const vote of votes) {
    if (vote.kind === "verdict" && vote.recheck && !vote.undone) lastRecheck.set(vote.slug, vote.ts);
  }
  const recheckPool = manifests.filter((m) => {
    const vote = verdicts.get(m.slug);
    if (!vote || vote.verdict === "skip" || vote.verdict === "iterate") return false;
    if (m.status === "broken") return false;
    if (daysSince(vote.ts) < RECHECK_AFTER_DAYS) return false;
    const last = lastRecheck.get(m.slug);
    return !last || daysSince(last) > RECHECK_COOLDOWN_DAYS;
  });
  const recheck = recheckPool.length ? [{ ...recheckPool[Math.floor(Math.random() * recheckPool.length)], recheck: true }] : [];

  const counts = {
    building: manifests.filter((m) => m.building).length,
    candidates: manifests.filter((m) => m.status === "candidate").length,
    liked: manifests.filter((m) => m.status === "liked").length,
    shipped: manifests.filter((m) => m.status === "shipped").length,
    rejected: manifests.filter((m) => m.status === "rejected").length,
    votes: votes.filter((v) => v.kind === "verdict" && !v.undone).length,
    points: votes.filter((v) => v.kind === "point" && !v.undone).length,
  };

  const bySlug = Object.fromEntries(manifests.map((m) => [m.slug, m]));
  const lineageOf = (m) => {
    const chain = [];
    let node = m;
    const seen = new Set();
    while (node && !seen.has(node.slug) && chain.length < 6) {
      seen.add(node.slug);
      chain.unshift({ slug: node.slug, title: node.title });
      node = node.parentSlug ? bySlug[node.parentSlug] : null;
    }
    return chain;
  };
  const items = [...fresh, ...recheck].map((m) => ({ ...m, lineage: lineageOf(m) }));
  return NextResponse.json({ items, tasteVersion, counts });
}
