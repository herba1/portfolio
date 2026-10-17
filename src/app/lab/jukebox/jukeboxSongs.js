export const LETTERS = ["A", "B"];
export const NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

const LABELS = {
  starlite: { name: "Starlite", paper: "#b3262c", ink: "#f4e6c8", rim: "#e8c77a", style: "rays" },
  bluebell: { name: "Bluebell", paper: "#1f3f7a", ink: "#f1ead8", rim: "#c9b37a", style: "rings" },
  corona: { name: "Corona", paper: "#e2b443", ink: "#2a1a12", rim: "#7a2a1c", style: "crown" },
  halcyon: { name: "Halcyon", paper: "#2f6b55", ink: "#f2ecd9", rim: "#d8c58f", style: "rings" },
  meridian: { name: "Meridian", paper: "#e9e1cf", ink: "#7d1f24", rim: "#7d1f24", style: "rays" },
  marquee: { name: "Marquee", paper: "#6a2c5e", ink: "#f6e9d4", rim: "#e6b15e", style: "crown" },
};

const RAW = [
  ["Moonlight on Route 9", "The Velvet Hours", "starlite"],
  ["Cherry Soda Heart", "Dottie Lane", "corona"],
  ["Slow Boat to Baltimore", "Eddie Marsh Band", "bluebell"],
  ["Neon in the Rain", "The Four Coronettes", "meridian"],
  ["Drive-In Darling", "Bobby Vail", "halcyon"],
  ["Blue Formica", "The Starlighters", "marquee"],
  ["Ten Cents a Dance Floor", "Rita Monroe", "starlite"],
  ["Midnight at the Diner", "Sonny Dale Trio", "bluebell"],
  ["Paper Moon Parade", "The Belltones", "corona"],
  ["Hula Hoop Heartache", "June Albright", "meridian"],
  ["Satellite Sweetheart", "The Orbitones", "halcyon"],
  ["Last Bus to Lakeview", "Hank Delray", "starlite"],
  ["Chrome and Cherry Pie", "The Dynamos", "marquee"],
  ["Saturday Static", "Lou Fontaine", "bluebell"],
  ["Wishing Well Waltz", "The Merrill Sisters", "corona"],
  ["Tail Fin Boogie", "Jimmy Rook", "meridian"],
  ["Porch Light Lullaby", "Ella Mae Sutton", "halcyon"],
  ["Bop at the Bowl-a-Rama", "The Kingpins", "starlite"],
  ["Rocket to Your Door", "Del Rayburn", "marquee"],
  ["Goodnight, Juniper", "The Lamplit Four", "bluebell"],
];

export const SONGS = RAW.map(([title, artist, label], i) => {
  const letter = LETTERS[Math.floor(i / 10)];
  const number = NUMBERS[i % 10];
  return {
    index: i,
    code: `${letter}-${number}`,
    letter,
    number,
    title,
    artist,
    label: LABELS[label],
    catalog: `${LABELS[label].name.slice(0, 2)} ${4100 + i * 7}`,
    rate: 0.955 + ((i * 37) % 9) * 0.011,
  };
});

export const SLOT_COUNT = SONGS.length;
export const START_INDEX = 6;

export function songFromCode(letter, number) {
  const li = LETTERS.indexOf(letter);
  const ni = NUMBERS.indexOf(number);
  if (li < 0 || ni < 0) return null;
  return SONGS[li * 10 + ni] || null;
}
