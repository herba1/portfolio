import fs from "fs/promises";
import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import {
  PROFILE_DIR,
  consistency,
  listManifests,
  readNotes,
  readSeed,
  readTasteSkill,
  readVotes,
  reasonAffinity,
  tasteVersionOf,
} from "@/lib/taste/store";

export async function GET() {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  const [votes, notes, manifests, skill, seed] = await Promise.all([
    readVotes(),
    readNotes(),
    listManifests(),
    readTasteSkill(),
    readSeed(),
  ]);
  let history = [];
  try {
    history = (await fs.readdir(PROFILE_DIR)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    history = [];
  }
  const live = votes.filter((v) => !v.undone);
  const verdicts = live.filter((v) => v.kind === "verdict");
  const byVerdict = {};
  for (const v of verdicts) byVerdict[v.verdict] = (byVerdict[v.verdict] || 0) + 1;
  const titles = Object.fromEntries(manifests.map((m) => [m.slug, m.title]));
  const decideTimes = verdicts.map((v) => v.msToDecide).filter((ms) => Number.isFinite(ms));
  const medianMs = decideTimes.length ? decideTimes.sort((a, b) => a - b)[Math.floor(decideTimes.length / 2)] : null;

  return NextResponse.json({
    tasteVersion: tasteVersionOf(skill),
    skill,
    history,
    counts: {
      verdicts: verdicts.length,
      points: live.filter((v) => v.kind === "point").length,
      notes: notes.length,
      byVerdict,
      seed: { loved: seed.loved.length, hated: seed.hated.length },
      byStatus: manifests.reduce((acc, m) => ({ ...acc, [m.status]: (acc[m.status] || 0) + 1 }), {}),
    },
    affinity: reasonAffinity(live),
    consistency: consistency(votes),
    medianMs,
    recentPoints: live
      .filter((v) => v.kind === "point")
      .slice(-20)
      .reverse()
      .map((v) => ({ ...v, title: titles[v.slug] || v.slug })),
    recentVerdicts: verdicts
      .slice(-30)
      .reverse()
      .map((v) => ({ ...v, title: titles[v.slug] || v.slug })),
    notes: notes.slice(-20).reverse(),
    seed,
  });
}
