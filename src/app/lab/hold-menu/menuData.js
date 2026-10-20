import { FEATURED } from "@/app/lab/_music/catalog";

const icons = {
  next: "M5 4.5v11l8-5.5zM15.5 4.5v11",
  queue: "M3.5 5.5h9M3.5 10h9M3.5 14.5h5M14.5 12v6M11.5 15h6",
  playlist: "M3.5 5.5h13M3.5 10h13M3.5 14.5h7M15 12.5v5M12.5 15h5",
  share: "M10 3v9.5M6.5 6.5 10 3l3.5 3.5M5 10H4.5v6.5h11V10H15",
  album: "M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 11.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
  plus: "M10 4.5v11M4.5 10h11",
  link: "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1",
  message: "M4 5.5h12v8H9l-3.5 3v-3H4z",
  mail: "M3.5 5.5h13v9h-13zM3.5 6l6.5 5 6.5-5",
  code: "M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4",
};

export const PLAYLISTS = [
  { name: "Late Night Drive", count: 48 },
  { name: "Sunday Morning", count: 31 },
  { name: "Deep Focus", count: 112 },
  { name: "Road Trip", count: 64 },
  { name: "Kitchen Dancing", count: 27 },
];

export const CONTACTS = ["Maya Lin", "Jonah Reyes", "Priya Shah", "Dad"];

export function menuFor(record) {
  return [
    { id: "next", label: "Play Next", icon: icons.next, done: `${record.title} plays next` },
    { id: "queue", label: "Add to Queue", icon: icons.queue, done: `${record.title} added to your queue` },
    {
      id: "playlist",
      label: "Add to Playlist",
      icon: icons.playlist,
      children: [
        { id: "new", label: "New Playlist", icon: icons.plus, done: `New playlist started with ${record.title}` },
        ...PLAYLISTS.map((p) => ({ id: `pl-${p.name}`, label: p.name, meta: `${p.count}`, done: `Added to ${p.name}` })),
      ],
    },
    {
      id: "share",
      label: "Share",
      icon: icons.share,
      children: [
        { id: "copy", label: "Copy Link", icon: icons.link, done: `Link to ${record.title} copied`, copy: true },
        {
          id: "messages",
          label: "Messages",
          icon: icons.message,
          children: CONTACTS.map((name) => ({ id: `to-${name}`, label: name, initial: name[0], done: `Sent ${record.title} to ${name.split(" ")[0]}` })),
        },
        { id: "mail", label: "Mail", icon: icons.mail, done: `Draft with ${record.title} opened` },
        { id: "embed", label: "Copy Embed Code", icon: icons.code, done: "Embed code copied", copy: true },
      ],
    },
    { id: "album", label: "Go to Album", icon: icons.album, done: `Opening ${record.title}` },
  ];
}

export function recordsFrom(tracks, live) {
  if (!live) return FEATURED.map((a) => ({ id: a.id, title: a.title, artist: a.artist, cover: a.cover, sub: `${a.artist} · ${a.year}` }));
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const cover = t.imageLarge || t.image;
    if (!cover || seen.has(cover)) continue;
    seen.add(cover);
    out.push({ id: t.id ?? cover, title: t.album || t.title, artist: t.artist, cover, sub: t.year ? `${t.artist} · ${t.year}` : t.artist });
    if (out.length === 8) break;
  }
  return out.length >= 4 ? out : recordsFrom([], false);
}
