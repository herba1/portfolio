// Eight pages, laid out at a real phone width (390px) with the site's own
// type scale, then shown scaled down as tab thumbnails, the way Safari shows
// a live page rather than a picture of one.

export const PAGE_W = 390;

function Article() {
  return (
    <div className="pg pg-article">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">Field Notes</span>
      </div>
      <p className="t-ui pg-ink2 pg-kicker">Essay · 9 min read</p>
      <h1 className="t-title-lg pg-h">The long take, returned to the cinema</h1>
      <p className="t-body-lg pg-ink2 pg-dek">
        After a decade of cutting faster, a handful of directors are letting the camera sit still again.
      </p>
      <p className="t-ui pg-byline">
        <span className="pg-avatar" />
        Ines Marlow · <span className="pg-ink2">November 4</span>
      </p>
      <p className="t-body pg-p">
        The shot begins on an empty platform and does not end for eleven minutes. Nobody in the
        audience checks a phone. It is the most suspenseful thing in the film, and nothing happens
        in it except the light changing on the far wall.
      </p>
      <p className="t-body pg-p">
        What a cut gives you is permission to look away. Take it away and the viewer has to stay.
      </p>
    </div>
  );
}

const RECORDS = [
  ["Low Tide Hymns", "The Harbour Choir", "24", "#2f4a3f", "L"],
  ["Paper Rooms", "Mira Sato", "31", "#b8452c", "P"],
  ["Night Bus to Ostend", "Calder Trio", "19", "#1f2a44", "N"],
  ["Wire & Wool", "Ada Fenn", "27", "#d9b45a", "W"],
  ["Slow Signal", "Hollis", "22", "#6d5a8a", "S"],
];

function Records() {
  return (
    <div className="pg pg-records">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">Second Hand</span>
      </div>
      <h1 className="t-title pg-h">New in this week</h1>
      <p className="t-ui pg-ink2 pg-sub">Used vinyl, graded and cleaned. 48 records.</p>
      <ul className="pg-rec-list">
        {RECORDS.map(([title, artist, price, color, letter]) => (
          <li key={title} className="pg-rec">
            <span className="pg-sleeve" style={{ background: color }}>
              <span className="t-title-sm">{letter}</span>
            </span>
            <span className="pg-rec-text">
              <span className="t-heading-sm">{title}</span>
              <span className="t-ui pg-ink2">{artist} · VG+</span>
            </span>
            <span className="t-ui-lg pg-price">£{price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapPage() {
  return (
    <div className="pg pg-map">
      <svg className="pg-map-svg" viewBox="0 0 390 520" aria-hidden="true">
        <rect width="390" height="520" fill="#ebe7dd" />
        <path d="M-20 340 C 80 300, 140 330, 230 280 S 360 220, 420 240 L 420 520 L -20 520 Z" fill="#cfdccf" />
        <path d="M250 -10 C 238 60, 268 120, 250 190 S 262 300, 300 360 S 330 460, 318 540" fill="none" stroke="#b9cfdc" strokeWidth="22" />
        <g stroke="#fbfaf6" strokeLinecap="round">
          <path d="M-10 96 L 400 132" strokeWidth="14" />
          <path d="M-10 236 L 400 196" strokeWidth="10" />
          <path d="M70 -10 L 120 540" strokeWidth="10" />
          <path d="M180 -10 L 166 540" strokeWidth="14" />
          <path d="M-10 420 L 400 380" strokeWidth="8" />
          <path d="M330 -10 L 352 540" strokeWidth="8" />
          <path d="M-10 168 L 180 160" strokeWidth="6" />
          <path d="M120 300 L 400 292" strokeWidth="6" />
        </g>
        <path d="M118 380 L 170 150 L 210 128" fill="none" stroke="#2f6bd8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="118" cy="380" r="8" fill="#fff" stroke="#2f6bd8" strokeWidth="4" />
        <circle cx="210" cy="128" r="12" fill="#c8402b" />
        <circle cx="210" cy="128" r="4.5" fill="#fff" />
      </svg>
      <div className="pg-sheet">
        <span className="pg-grab" />
        <p className="t-heading">Saturday Market</p>
        <p className="t-ui pg-ink2">8 min walk · Open until 4 pm</p>
        <div className="pg-sheet-row">
          <span className="pg-btn t-ui-sm">Directions</span>
          <span className="pg-btn pg-btn-soft t-ui-sm">Save</span>
        </div>
      </div>
    </div>
  );
}

const DEPARTURES = [
  ["14:02", "Ostend", "4", "On time"],
  ["14:09", "Ghent St Peter", "2", "On time"],
  ["14:16", "Antwerp Central", "6", "+3"],
  ["14:24", "Bruges", "4", "On time"],
  ["14:31", "Leuven", "1", "On time"],
  ["14:38", "Liège", "3", "+1"],
  ["14:45", "Namur", "5", "On time"],
];

function Departures() {
  return (
    <div className="pg pg-dep">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">Departures</span>
      </div>
      <h1 className="t-title pg-h">Brussels Midi</h1>
      <div className="pg-dep-head t-ui-xs">
        <span>Time</span>
        <span>Destination</span>
        <span>Platform</span>
      </div>
      <ul className="pg-dep-list">
        {DEPARTURES.map(([time, dest, plat, state]) => (
          <li key={time} className="pg-dep-row">
            <span className="t-heading-sm pg-num">{time}</span>
            <span className="pg-dep-dest">
              <span className="t-ui-lg">{dest}</span>
              <span className={`t-ui-xs ${state === "On time" ? "pg-ok" : "pg-late"}`}>{state}</span>
            </span>
            <span className="t-heading-sm pg-num pg-plat">{plat}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Recipe() {
  return (
    <div className="pg pg-recipe">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">Small Kitchen</span>
      </div>
      <div className="pg-plate">
        <span className="pg-tomato a" />
        <span className="pg-tomato b" />
        <span className="pg-tomato c" />
        <span className="pg-tomato d" />
      </div>
      <h1 className="t-title pg-h">Brown butter tomatoes on toast</h1>
      <p className="t-ui pg-ink2 pg-sub">Serves 2 · 15 minutes</p>
      <ul className="pg-ingr">
        {[
          ["400 g", "ripe tomatoes, halved"],
          ["40 g", "salted butter"],
          ["2", "thick slices sourdough"],
          ["1 tsp", "flaky salt"],
        ].map(([q, what]) => (
          <li key={what} className="t-ui-lg">
            <span className="pg-num pg-q">{q}</span>
            <span>{what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Calendar() {
  const days = [];
  for (let i = 0; i < 35; i++) days.push(i - 5);
  const events = new Set([6, 11, 14, 20, 21, 27]);
  return (
    <div className="pg pg-cal">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">Calendar</span>
      </div>
      <h1 className="t-title-lg pg-h">November</h1>
      <div className="pg-cal-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="t-ui-xs pg-ink2 pg-cal-dow">{d}</span>
        ))}
        {days.map((d) => (
          <span
            key={d}
            className={`t-ui-lg pg-num pg-cal-day${d === 6 ? " is-today" : ""}${d < 1 || d > 30 ? " is-out" : ""}`}
          >
            {d < 1 ? 31 + d : d > 30 ? d - 30 : d}
            {events.has(d) && <i />}
          </span>
        ))}
      </div>
      <div className="pg-cal-event">
        <span className="pg-cal-rule" />
        <span>
          <span className="t-heading-sm">Print studio, open evening</span>
          <span className="t-ui pg-ink2">18:30 – 21:00 · Thursday</span>
        </span>
      </div>
    </div>
  );
}

function Docs() {
  return (
    <div className="pg pg-docs">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">motion / docs</span>
      </div>
      <p className="t-ui pg-ink2 pg-kicker">Animation</p>
      <h1 className="t-title pg-h">Springs</h1>
      <p className="t-body pg-p">
        A spring has no duration. Give it a response and a damping ratio, and it finishes when it
        settles, starting from whatever velocity it already had.
      </p>
      <pre className="pg-code">
        <code>
          <span className="c-k">const</span> card = spring({"{"}{"\n"}
          {"  "}response: <span className="c-n">0.42</span>,{"\n"}
          {"  "}damping: <span className="c-n">0.86</span>,{"\n"}
          {"  "}velocity: release.x,{"\n"}
          {"}"});
        </code>
      </pre>
      <p className="t-body pg-p">Interrupt it and the new target inherits the motion.</p>
    </div>
  );
}

function Specimen() {
  return (
    <div className="pg pg-spec">
      <div className="pg-bar">
        <span className="t-ui-sm pg-strong">Type Specimens</span>
      </div>
      <p className="pg-spec-glyph">Rg</p>
      <div className="pg-spec-meta">
        <span className="t-heading">Geist</span>
        <span className="t-ui pg-ink2">Variable, 100–900</span>
      </div>
      <p className="t-title-sm pg-spec-line">Sphinx of black quartz, judge my vow.</p>
      <p className="t-body pg-ink2 pg-spec-line">The quick brown fox jumps over the lazy dog, twice.</p>
    </div>
  );
}

export const PAGES = [
  { key: "article", title: "The long take, returned", host: "F", tint: "#1a1814", Page: Article },
  { key: "records", title: "Second Hand Records", host: "S", tint: "#b8452c", Page: Records },
  { key: "map", title: "Saturday Market", host: "M", tint: "#2f6bd8", Page: MapPage },
  { key: "dep", title: "Departures, Brussels Midi", host: "D", tint: "#e7b53c", Page: Departures },
  { key: "recipe", title: "Brown butter tomatoes", host: "K", tint: "#5d7a3a", Page: Recipe },
  { key: "cal", title: "November", host: "C", tint: "#c8402b", Page: Calendar },
  { key: "docs", title: "Springs · motion docs", host: "m", tint: "#3d3a8f", Page: Docs },
  { key: "spec", title: "Geist specimen", host: "T", tint: "#1a1814", Page: Specimen },
];
