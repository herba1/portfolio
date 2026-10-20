export const SETLIST = [
  ["I Saw Her Standing There", "E", 173],
  ["Misery", "C", 109],
  ["Anna (Go to Him)", "D", 177],
  ["Chains", "B♭", 146],
  ["Boys", "E", 147],
  ["Ask Me Why", "E", 147],
  ["Please Please Me", "E", 120],
  ["Love Me Do", "G", 142],
  ["P.S. I Love You", "D", 124],
  ["Baby It's You", "G", 160],
  ["Do You Want to Know a Secret", "E", 117],
  ["A Taste of Honey", "F♯m", 124],
  ["There's a Place", "E", 111],
  ["Twist and Shout", "D", 155],
].map(([title, key, length], i) => ({ id: `song-${i + 1}`, number: i + 1, title, key, length }));

export const OPENED_WITH = ["song-1", "song-2", "song-3"];

export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
