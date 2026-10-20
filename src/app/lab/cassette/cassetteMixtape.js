export function mixtapeFrom(tracks) {
  const list = tracks.slice(0, 12);
  const first = list[0] || { title: "Come Together", artist: "The Beatles", album: "Abbey Road" };
  return {
    lead: first,
    title: "Top songs",
    dedication: "for Herb",
    notes: `side A opens with ${first.title}`,
    notes2: "dubbed off the top songs list. Do not tape over!",
    sideA: list.slice(0, 6),
    sideB: list.slice(6, 12),
  };
}
