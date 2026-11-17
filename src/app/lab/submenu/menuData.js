// Real content for one album side and the context menu each track opens.

export const ALBUM = {
  title: "Abbey Road",
  artist: "The Beatles",
  year: 1969,
  cover: "/tierlist/images/image-mqobr6yd.webp",
};

const LENNON_MCCARTNEY = [
  { name: "John Lennon", role: "Writer" },
  { name: "Paul McCartney", role: "Writer" },
];

export const TRACKS = [
  { n: 5, title: "Octopus's Garden", time: "2:51", writers: [{ name: "Richard Starkey", role: "Writer" }] },
  { n: 6, title: "I Want You (She's So Heavy)", time: "7:47", writers: LENNON_MCCARTNEY },
  { n: 7, title: "Here Comes the Sun", time: "3:05", writers: [{ name: "George Harrison", role: "Writer" }] },
  { n: 8, title: "Because", time: "2:45", writers: LENNON_MCCARTNEY },
  { n: 9, title: "You Never Give Me Your Money", time: "4:02", writers: LENNON_MCCARTNEY },
];

// 20px-box stroke icons.
export const ICONS = {
  next: "M5 4.5v11l8-5.5zM15.5 4.5v11",
  queue: "M3.5 5.5h9M3.5 10h9M3.5 14.5h5M14.5 12v6M11.5 15h6",
  playlist: "M3.5 5.5h13M3.5 10h13M3.5 14.5h7M15 12.5v5M12.5 15h5",
  list: "M3.5 6h13M3.5 10h13M3.5 14h9",
  share: "M10 3v9.5M6.5 6.5 10 3l3.5 3.5M5 10H4.5v6.5h11V10H15",
  goto: "M6.5 13.5l7-7M8 6.5h5.5V12",
  heart: "M10 16s-6.5-3.7-6.5-8.1a3.5 3.5 0 0 1 6.5-1.8 3.5 3.5 0 0 1 6.5 1.8c0 4.4-6.5 8.1-6.5 8.1z",
  info: "M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 9.25v4.25M10 6.6v.05",
  trash: "M4 6h12M8 6V4.5h4V6M5.5 6l.75 9.5h7.5L14.5 6",
  plus: "M10 4.5v11M4.5 10h11",
  folder: "M3.5 5.5h4.25l1.5 1.75h7.25v8.25h-13z",
  link: "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1",
  clock: "M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 6.5V10l2.5 1.5",
  message: "M4 5.5h12v8H9l-3.5 3v-3H4z",
  mail: "M3.5 5.5h13v9h-13zM3.5 6l6.5 5 6.5-5",
  code: "M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4",
  album: "M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 11.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
  artist: "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4.5 16.5a5.5 5.5 0 0 1 11 0",
  credits: "M5.5 3.5h6l3 3v10h-9zM11.5 3.5v3h3M8 10.5h4M8 13.5h4",
  radio: "M10 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM7 13a4.25 4.25 0 0 1 0-6M13 7a4.25 4.25 0 0 1 0 6M4.9 15.1a7.25 7.25 0 0 1 0-10.2M15.1 4.9a7.25 7.25 0 0 1 0 10.2",
  studio: "M10 3.5v8M7.5 6v3a2.5 2.5 0 0 0 5 0V6a2.5 2.5 0 0 0-5 0zM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v2.5M7.5 16.5h5",
};

const SEP = { sep: true };

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const playlist = (name, count) => ({ id: slug(name), label: name, meta: String(count) });

const folder = (name, lists) => ({ id: slug(name), label: name, icon: ICONS.folder, children: lists.map(([n, c]) => playlist(n, c)) });

const person = (name) => ({ id: slug(name), label: name, avatar: name[0] });

export function menuFor(track) {
  return [
    { id: "play-next", label: "Play Next", icon: ICONS.next },
    { id: "play-last", label: "Play Last", icon: ICONS.queue },
    SEP,
    { id: "love", label: "Love", icon: ICONS.heart, kbd: ["cmd", "L"] },
    { id: "info", label: "Get Info", icon: ICONS.info, kbd: ["cmd", "I"] },
    SEP,
    {
      id: "playlist",
      label: "Add to Playlist",
      icon: ICONS.playlist,
      children: [
        { id: "new-playlist", label: "New Playlist…", icon: ICONS.plus },
        SEP,
        { ...playlist("Late Night Drive", 48), icon: ICONS.list },
        { ...playlist("Sunday Morning", 31), icon: ICONS.list },
        { ...playlist("Deep Focus", 112), icon: ICONS.list },
        SEP,
        folder("Seasons", [
          ["Spring Cleaning", 22],
          ["First Warm Day", 17],
          ["Long Summer", 64],
          ["October Light", 29],
          ["Snow Day", 12],
        ]),
        folder("Moods", [
          ["Slow Burn", 40],
          ["Rainy Afternoon", 26],
          ["Kitchen Dancing", 27],
          ["Night Swim", 19],
        ]),
        folder("Mixtapes", [
          ["For Maya", 14],
          ["Road Trip ’24", 64],
          ["Wedding Set", 88],
          ["Running 5K", 21],
        ]),
      ],
    },
    {
      id: "share",
      label: "Share",
      icon: ICONS.share,
      children: [
        { id: "copy-link", label: "Copy Link", icon: ICONS.link },
        { id: "copy-at", label: "Copy Link at 1:12", icon: ICONS.clock },
        SEP,
        {
          id: "messages",
          label: "Messages",
          icon: ICONS.message,
          children: ["Maya Lin", "Jonah Reyes", "Priya Shah", "Dad"].map(person),
        },
        { id: "mail", label: "Mail", icon: ICONS.mail },
        SEP,
        { id: "embed", label: "Copy Embed Code", icon: ICONS.code },
      ],
    },
    {
      id: "goto",
      label: "Go to",
      icon: ICONS.goto,
      children: [
        { id: "album", label: ALBUM.title, meta: "Album", icon: ICONS.album },
        { id: "artist", label: ALBUM.artist, meta: "Artist", icon: ICONS.artist },
        {
          id: "credits",
          label: "Credits",
          icon: ICONS.credits,
          children: [
            ...track.writers.map((w) => ({ ...person(w.name), meta: w.role })),
            { ...person("George Martin"), meta: "Producer" },
            { ...person("Geoff Emerick"), meta: "Engineer" },
            SEP,
            { id: "emi", label: "EMI Studios, London", icon: ICONS.studio },
          ],
        },
        SEP,
        { id: "radio", label: "Song Radio", icon: ICONS.radio },
      ],
    },
    SEP,
    { id: "remove", label: "Remove from Library", icon: ICONS.trash, kbd: ["cmd", "del"] },
  ];
}
