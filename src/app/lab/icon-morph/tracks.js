export const TRACKS = [
  { title: "I Saw Her Standing There", length: 173, face: "paul" },
  { title: "Misery", length: 109, face: "john" },
  { title: "Anna (Go to Him)", length: 177, face: "john" },
  { title: "Chains", length: 146, face: "george" },
  { title: "Boys", length: 147, face: "paul" },
  { title: "Ask Me Why", length: 147, face: "john" },
  { title: "Please Please Me", length: 120, face: "john" },
  { title: "Love Me Do", length: 142, face: "paul" },
  { title: "P.S. I Love You", length: 124, face: "paul" },
  { title: "Baby It's You", length: 160, face: "john" },
  { title: "Do You Want to Know a Secret", length: 117, face: "george" },
  { title: "A Taste of Honey", length: 124, face: "paul" },
  { title: "There's a Place", length: 111, face: "john" },
  { title: "Twist and Shout", length: 155, face: "john" },
].map((track, i) => ({ ...track, id: `ppm-${i + 1}`, number: i + 1, cover: `/cast/${track.face}.webp` }));

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
