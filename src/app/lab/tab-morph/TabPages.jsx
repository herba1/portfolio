import { ALBUMS, albumById } from "@/app/lab/_music/catalog";

const pick = (ids) => ids.map((id) => albumById(id));
const SHORTCUTS = pick(["abbey-road", "revolver", "rubber-soul", "let-it-be", "help", "magical-mystery-tour"]);
const JUMP = pick(["sgt-pepper", "white-album", "a-hard-days-night", "beatles-for-sale"]);
const GENRES = [
  { name: "Psychedelic", tint: "#b4246b", album: "sgt-pepper" },
  { name: "Folk rock", tint: "#9a4a1c", album: "rubber-soul" },
  { name: "Merseybeat", tint: "#2457b8", album: "a-hard-days-night" },
  { name: "Mono mixes", tint: "#4a4a4a", album: "revolver" },
  { name: "Live", tint: "#7a5a2a", album: "let-it-be" },
  { name: "1969", tint: "#2c7a6a", album: "abbey-road" },
];
const STATIONS = [
  { name: "Revolver Radio", note: "Based on Taxman", album: "revolver" },
  { name: "Abbey Road Radio", note: "Based on Something", album: "abbey-road" },
  { name: "Help! Radio", note: "Based on Ticket to Ride", album: "help" },
];

function Home() {
  return (
    <>
      <h2 className="tab-morph-h">Good evening</h2>
      <div className="tab-morph-shortcuts">
        {SHORTCUTS.map((a) => (
          <div key={a.id} className="tab-morph-shortcut">
            <img src={a.cover} alt="" draggable={false} data-album={a.id} />
            <span>{a.title}</span>
          </div>
        ))}
      </div>
      <h3 className="tab-morph-h3">Jump back in</h3>
      <div className="tab-morph-shelf">
        {JUMP.map((a) => (
          <div key={a.id} className="tab-morph-tile">
            <img src={a.cover} alt="" draggable={false} data-album={a.id} />
            <span className="tab-morph-tile-title">{a.title}</span>
            <span className="tab-morph-tile-meta">{a.year}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Search() {
  return (
    <>
      <h2 className="tab-morph-h">Search</h2>
      <div className="tab-morph-field">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <span>What do you want to listen to?</span>
      </div>
      <h3 className="tab-morph-h3">Browse all</h3>
      <div className="tab-morph-genres">
        {GENRES.map((g) => (
          <div key={g.name} className="tab-morph-genre" style={{ background: g.tint }}>
            <span>{g.name}</span>
            <img src={albumById(g.album).cover} alt="" draggable={false} data-album={g.album} />
          </div>
        ))}
      </div>
    </>
  );
}

function Library() {
  return (
    <>
      <h2 className="tab-morph-h">Your Library</h2>
      <div className="tab-morph-chips">
        <span data-on="">Albums</span>
        <span>Playlists</span>
        <span>Artists</span>
      </div>
      <ul className="tab-morph-rows">
        {ALBUMS.slice(2, 10).map((a) => (
          <li key={a.id} className="tab-morph-row">
            <img src={a.cover} alt="" draggable={false} data-album={a.id} />
            <span className="tab-morph-row-text">
              <span className="tab-morph-row-title">{a.title}</span>
              <span className="tab-morph-row-meta">
                Album · {a.artist} · {a.year}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Radio() {
  const collage = pick(["sgt-pepper", "abbey-road", "revolver", "let-it-be"]);
  return (
    <>
      <h2 className="tab-morph-h">Radio</h2>
      <div className="tab-morph-station">
        <div className="tab-morph-collage">
          {collage.map((a) => (
            <img key={a.id} src={a.cover} alt="" draggable={false} data-album={a.id} />
          ))}
        </div>
        <div className="tab-morph-station-text">
          <span className="tab-morph-live">
            <i aria-hidden="true" />
            Live
          </span>
          <span className="tab-morph-station-name">The Beatles Radio</span>
          <span className="tab-morph-row-meta">1963–1970, all day</span>
        </div>
      </div>
      <ul className="tab-morph-rows">
        {STATIONS.map((s) => (
          <li key={s.name} className="tab-morph-row">
            <img src={albumById(s.album).cover} alt="" draggable={false} data-round="" data-album={s.album} />
            <span className="tab-morph-row-text">
              <span className="tab-morph-row-title">{s.name}</span>
              <span className="tab-morph-row-meta">{s.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export const PAGES = { home: Home, search: Search, library: Library, radio: Radio };
