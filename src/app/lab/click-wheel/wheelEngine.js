import { createWheelAudio } from "./wheelAudio";
import { LIBRARY_ALBUMS, LIBRARY_SONGS, formatTime, fromTopSong } from "./wheelLibrary";

const DEVICE_W = 390;
const DEVICE_H = 653;
const ROW = 24;
const ROWS = 9;
const DETENT = (Math.PI * 2) / 22;
const SLIDE_MS = 280;
const MODE_MS = 2200;
const WALK_HOME = ["Here Comes the Sun", "Blackbird", "In My Life", "Across the Universe", "Julia", "Because", "Yesterday", "Norwegian Wood", "I'll Follow the Sun", "Here, There and Everywhere", "The Long and Winding Road"];
const NS = "http://www.w3.org/2000/svg";

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const svg = (markup, cls, w, hgt) => {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
  el.setAttribute("width", w);
  el.setAttribute("height", hgt);
  el.setAttribute("aria-hidden", "true");
  if (cls) el.setAttribute("class", cls);
  el.innerHTML = markup;
  return el;
};

const CHEVRON = '<path d="M1.5 1.5 6 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/>';
const PLAY = '<path d="M1 1v10l8.5-5z" fill="currentColor"/>';
const PAUSE = '<path d="M1.5 1h2.6v10H1.5zM6.4 1H9v10H6.4z" fill="currentColor"/>';
const SPEAKER_LO = '<path d="M1 4.5h2.4L6.4 2v8L3.4 7.5H1z" fill="currentColor"/>';
const SPEAKER_HI = '<path d="M1 4.5h2.4L6.4 2v8L3.4 7.5H1z" fill="currentColor"/><path d="M8.4 3.6a3.4 3.4 0 0 1 0 4.8M10.2 2a5.6 5.6 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';

function ringSegment(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

export function createClickWheel(stage, { embedded = false, caption = null, onLive = () => {}, onReady = () => {} } = {}) {
  const audio = createWheelAudio();
  const root = stage.closest(".click-wheel") || stage;
  let destroyed = false;
  let raf = 0;
  let visible = true;
  let clockTimer = 0;
  let backlight = true;
  let topSongs = [];
  let shuffle = false;
  let repeat = "All";

  const player = { queue: [], index: -1, pos: 0, playing: false, startedAt: 0, volume: 0.62, mode: "progress", modeUntil: 0, lastSecond: -1, seekTimer: 0 };

  const device = h("div", "click-wheel-device");
  const face = h("div", "click-wheel-face");
  const windowEl = h("div", "click-wheel-window");
  const screen = h("div", "click-wheel-screen");
  const bar = h("div", "click-wheel-bar");
  const status = h("span", "click-wheel-status");
  const titleBox = h("span", "click-wheel-titles");
  const titleA = h("span", "click-wheel-title", "iPod");
  const titleB = h("span", "click-wheel-title");
  titleB.dataset.off = "";
  titleBox.append(titleA, titleB);
  const battery = svg(
    '<rect x="0.5" y="0.5" width="19" height="9" rx="1.5" fill="#fff" stroke="#3a3a3c"/><rect x="20" y="3" width="2" height="4" rx="0.6" fill="#3a3a3c"/><rect x="2" y="2" width="14" height="6" rx="0.6" fill="url(#cwbat)"/><defs><linearGradient id="cwbat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8f08a"/><stop offset="0.45" stop-color="#6fd23b"/><stop offset="0.55" stop-color="#4fbf1f"/><stop offset="1" stop-color="#3ea814"/></linearGradient></defs>',
    "click-wheel-battery",
    23,
    10,
  );
  bar.append(status, titleBox, battery);
  const view = h("div", "click-wheel-view");
  screen.append(bar, view);
  windowEl.append(screen);

  const wheel = h("div", "click-wheel-wheel");
  const wheelArt = svg(
    [0, 1, 2, 3]
      .map((q) => `<path class="click-wheel-quad" data-q="${q}" d="${ringSegment(122, 122, 50, 121, -Math.PI * 0.75 + (q * Math.PI) / 2, -Math.PI * 0.25 + (q * Math.PI) / 2)}"/>`)
      .join("") +
      '<text x="122" y="43" text-anchor="middle" class="click-wheel-menu">MENU</text>' +
      '<g class="click-wheel-glyph" transform="translate(195 115)"><path d="M0 0v14l9-7zM9 0v14l9-7z"/><rect x="18" y="0" width="2.6" height="14"/></g>' +
      '<g class="click-wheel-glyph" transform="translate(28 115)"><rect x="0" y="0" width="2.6" height="14"/><path d="M11.6 0v14l-9-7zM20.6 0v14l-9-7z"/></g>' +
      '<g class="click-wheel-glyph" transform="translate(112 199)"><path d="M0 0v13l9-6.5z"/><rect x="12" y="0" width="3" height="13"/><rect x="17.6" y="0" width="3" height="13"/></g>',
    "click-wheel-art",
    244,
    244,
  );
  const center = h("div", "click-wheel-center");
  wheel.append(wheelArt, center);
  wheel.setAttribute("aria-hidden", "true");
  face.append(windowEl, wheel);
  device.append(face);
  device.tabIndex = 0;
  device.setAttribute("role", "application");
  device.setAttribute("aria-label", "iPod. Circle the wheel or use the arrow keys to scroll, Enter to select, Escape for Menu, Space to play or pause.");
  stage.append(device);

  const quads = [...wheelArt.querySelectorAll(".click-wheel-quad")];

  const stack = [];
  let titleFlip = false;

  const setTitle = (text) => {
    const on = titleFlip ? titleB : titleA;
    if (on.textContent === text) return;
    const next = titleFlip ? titleA : titleB;
    next.textContent = text;
    delete next.dataset.off;
    on.dataset.off = "";
    titleFlip = !titleFlip;
  };

  const renderStatus = () => {
    status.replaceChildren();
    if (player.index < 0) return;
    status.append(svg(player.playing ? PLAY : PAUSE, "", 11, 12));
  };

  const current = () => stack[stack.length - 1];
  const nowSong = () => player.queue[player.index];
  const songPos = () => (player.playing ? player.pos + (performance.now() - player.startedAt) / 1000 : player.pos);

  const announce = (text) => onLive(text);

  const songsScreen = (title, songs) => ({
    type: "list",
    title,
    items: () => songs.map((s, i) => ({ label: s.title, action: () => playFrom(songs, i) })),
  });

  const albumsScreen = (title, albums) => ({
    type: "list",
    title,
    items: () => albums.map((a) => ({ label: a.title, chevron: true, action: () => push(songsScreen(a.title, a.songs)) })),
  });

  const topSongList = () => topSongs.map(fromTopSong);

  const walkHome = () => WALK_HOME.map((t) => LIBRARY_SONGS.find((s) => s.title === t)).filter(Boolean);

  const musicScreen = () => ({
    type: "list",
    title: "Music",
    items: () => [
      {
        label: "Playlists",
        chevron: true,
        action: () =>
          push({
            type: "list",
            title: "Playlists",
            items: () => [
              { label: "Top 25 Most Played", chevron: true, action: () => push(songsScreen("Top 25 Most Played", topSongList())) },
              { label: "Walk Home", chevron: true, action: () => push(songsScreen("Walk Home", walkHome())) },
            ],
          }),
      },
      {
        label: "Artists",
        chevron: true,
        action: () => {
          const others = new Map();
          for (const s of topSongList()) {
            if (s.artist === "The Beatles") continue;
            if (!others.has(s.artist)) others.set(s.artist, []);
            others.get(s.artist).push(s);
          }
          push({
            type: "list",
            title: "Artists",
            items: () => [
              { label: "The Beatles", chevron: true, action: () => push(albumsScreen("The Beatles", LIBRARY_ALBUMS)) },
              ...[...others].sort((a, b) => a[0].localeCompare(b[0])).map(([name, songs]) => ({ label: name, chevron: true, action: () => push(songsScreen(name, songs)) })),
            ],
          });
        },
      },
      { label: "Albums", chevron: true, action: () => push(albumsScreen("Albums", LIBRARY_ALBUMS)) },
      { label: "Songs", chevron: true, action: () => push(songsScreen("Songs", LIBRARY_SONGS)) },
    ],
  });

  const settingsScreen = () => ({
    type: "list",
    title: "Settings",
    items: () => [
      { label: "About", chevron: true, action: () => push({ type: "about", title: "About" }) },
      {
        label: "Shuffle",
        value: () => (shuffle ? "Songs" : "Off"),
        action: () => {
          shuffle = !shuffle;
          refresh();
        },
      },
      {
        label: "Repeat",
        value: () => repeat,
        action: () => {
          repeat = repeat === "Off" ? "One" : repeat === "One" ? "All" : "Off";
          refresh();
        },
      },
    ],
  });

  const mainScreen = {
    type: "list",
    title: "iPod",
    items: () => {
      const items = [
        { label: "Music", chevron: true, action: () => push(musicScreen()) },
        { label: "Photos", chevron: true, action: () => push({ type: "photos", title: "Photo Library", sel: 0 }) },
        { label: "Extras", chevron: true, action: () => push({ type: "list", title: "Extras", items: () => [{ label: "Clock", chevron: true, action: () => push({ type: "clock", title: "Clock" }) }] }) },
        { label: "Settings", chevron: true, action: () => push(settingsScreen()) },
        {
          label: "Shuffle Songs",
          action: () => {
            const order = LIBRARY_SONGS.map((s) => [Math.random(), s]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
            playFrom(order, 0);
          },
        },
        {
          label: "Backlight",
          action: () => {
            backlight = !backlight;
            screen.toggleAttribute("data-dim", !backlight);
          },
        },
      ];
      if (player.index >= 0) items.push({ label: "Now Playing", chevron: true, action: () => push({ type: "now", title: "Now Playing" }) });
      return items;
    },
  };

  const buildList = (s) => {
    s.list = s.items();
    s.sel = Math.min(s.sel ?? 0, Math.max(0, s.list.length - 1));
    s.top = s.top ?? 0;
    const scroll = s.list.length > ROWS;
    s.el.toggleAttribute("data-scroll", scroll);
    const rows = h("div", "click-wheel-rows");
    s.rows = s.list.map((item, i) => {
      const row = h("div", "click-wheel-row");
      row.dataset.i = i;
      row.append(h("span", "click-wheel-label", item.label));
      if (item.value) row.append(h("span", "click-wheel-value", item.value()));
      if (item.chevron) row.append(svg(CHEVRON, "click-wheel-chevron", 8, 12));
      rows.append(row);
      return row;
    });
    s.rowsEl = rows;
    s.el.replaceChildren(rows);
    if (scroll) {
      const track = h("div", "click-wheel-track");
      const thumb = h("div", "click-wheel-thumb");
      track.append(thumb);
      s.thumb = thumb;
      s.el.append(track);
    } else s.thumb = null;
    s.prevSel = -1;
    updateList(s);
  };

  const updateList = (s) => {
    if (s.sel < s.top) s.top = s.sel;
    if (s.sel > s.top + ROWS - 1) s.top = s.sel - ROWS + 1;
    s.top = Math.max(0, Math.min(s.top, Math.max(0, s.list.length - ROWS)));
    if (s.prevSel >= 0 && s.rows[s.prevSel]) delete s.rows[s.prevSel].dataset.sel;
    if (s.rows[s.sel]) s.rows[s.sel].dataset.sel = "";
    s.prevSel = s.sel;
    s.rowsEl.style.transform = `translate3d(0, ${-s.top * ROW}px, 0)`;
    if (s.thumb) {
      const n = s.list.length;
      const trackH = ROWS * ROW - 4;
      const th = Math.max(14, Math.round((trackH * ROWS) / n));
      const y = Math.round(((trackH - th) * s.top) / Math.max(1, n - ROWS));
      s.thumb.style.height = `${th}px`;
      s.thumb.style.transform = `translate3d(0, ${y + 2}px, 0)`;
    }
  };

  const nowEls = {};
  const buildNow = (s) => {
    const el = s.el;
    el.replaceChildren();
    const count = h("div", "click-wheel-count");
    const art = h("div", "click-wheel-art-box");
    const img = h("img", "click-wheel-cover");
    img.alt = "";
    img.decoding = "async";
    const refl = h("img", "click-wheel-reflection");
    refl.alt = "";
    art.append(img, refl);
    const meta = h("div", "click-wheel-meta");
    const titleWrap = h("div", "click-wheel-np-title-wrap");
    const title = h("div", "click-wheel-np-title");
    titleWrap.append(title);
    const artist = h("div", "click-wheel-np-line");
    const album = h("div", "click-wheel-np-line");
    meta.append(titleWrap, artist, album);
    const progress = h("div", "click-wheel-progress");
    const iconLo = svg(SPEAKER_LO, "click-wheel-vol-icon", 12, 12);
    const iconHi = svg(SPEAKER_HI, "click-wheel-vol-icon", 12, 12);
    const track = h("div", "click-wheel-ptrack");
    const fill = h("div", "click-wheel-pfill");
    const diamond = h("div", "click-wheel-diamond");
    track.append(fill, diamond);
    progress.append(iconLo, track, iconHi);
    const times = h("div", "click-wheel-times");
    const elapsed = h("span", "", "0:00");
    const remain = h("span", "", "-0:00");
    times.append(elapsed, remain);
    el.append(count, art, meta, progress, times);
    Object.assign(nowEls, { el, count, img, refl, title, titleWrap, artist, album, progress, fill, diamond, elapsed, remain, times, songKey: null });
    renderNow(true);
  };

  const renderNow = (full = false) => {
    if (!nowEls.el || !nowEls.el.isConnected) return;
    const song = nowSong();
    if (!song) return;
    const key = `${player.index}:${song.title}`;
    if (full || nowEls.songKey !== key) {
      nowEls.songKey = key;
      nowEls.count.textContent = `${player.index + 1} of ${player.queue.length}`;
      if (song.cover) {
        nowEls.img.src = song.cover;
        nowEls.refl.src = song.cover;
      }
      nowEls.title.textContent = song.title;
      nowEls.artist.textContent = song.artist;
      nowEls.album.textContent = song.album;
      nowEls.title.removeAttribute("data-marquee");
      nowEls.title.style.removeProperty("--click-wheel-shift");
      requestAnimationFrame(() => {
        if (!nowEls.title.isConnected) return;
        const over = nowEls.title.scrollWidth - nowEls.titleWrap.clientWidth;
        if (over > 2) {
          nowEls.title.style.setProperty("--click-wheel-shift", `${-over - 12}px`);
          nowEls.title.style.setProperty("--click-wheel-dur", `${Math.max(6, over / 12 + 4)}s`);
          nowEls.title.dataset.marquee = "";
        }
      });
      player.lastSecond = -1;
    }
    const pos = Math.min(songPos(), song.length);
    const mode = player.mode;
    nowEls.progress.dataset.mode = mode;
    const frac = mode === "volume" ? player.volume : pos / song.length;
    nowEls.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    nowEls.diamond.style.transform = `translate3d(${(frac * 204).toFixed(2)}px, 0, 0) rotate(45deg)`;
    const sec = Math.floor(pos);
    if (sec !== player.lastSecond || full) {
      player.lastSecond = sec;
      nowEls.elapsed.textContent = formatTime(pos);
      nowEls.remain.textContent = `-${formatTime(song.length - sec)}`;
    }
    nowEls.times.toggleAttribute("data-off", mode === "volume");
  };

  const PHOTO_ALBUMS = LIBRARY_ALBUMS;
  const buildPhotos = (s) => {
    const grid = h("div", "click-wheel-grid");
    s.cells = PHOTO_ALBUMS.map((a, i) => {
      const cell = h("div", "click-wheel-cell");
      const img = h("img");
      img.src = a.cover;
      img.alt = "";
      img.decoding = "async";
      cell.append(img);
      cell.dataset.i = i;
      grid.append(cell);
      return cell;
    });
    s.el.replaceChildren(grid);
    updatePhotos(s);
  };
  const updatePhotos = (s) => {
    s.cells.forEach((c, i) => c.toggleAttribute("data-sel", i === s.sel));
  };

  const buildPhoto = (s) => {
    const img = h("img", "click-wheel-photo");
    img.alt = "";
    s.img = img;
    s.el.replaceChildren(img);
    updatePhoto(s);
  };
  const updatePhoto = (s) => {
    s.img.src = PHOTO_ALBUMS[s.index].cover;
    s.title = `${s.index + 1} of ${PHOTO_ALBUMS.length}`;
    if (current() === s) setTitle(s.title);
  };

  const buildAbout = (s) => {
    const box = h("div", "click-wheel-about");
    box.append(h("div", "click-wheel-about-name", "herb’s iPod"));
    const rows = [
      ["Songs", String(LIBRARY_SONGS.length)],
      ["Photos", String(PHOTO_ALBUMS.length)],
      ["Capacity", "27.9 GB"],
      ["Available", "19.4 GB"],
      ["Version", "1.2.1"],
    ];
    for (const [k, v] of rows) {
      const row = h("div", "click-wheel-about-row");
      row.append(h("span", "", k), h("span", "", v));
      box.append(row);
    }
    s.el.replaceChildren(box);
  };

  const clockText = () => {
    const d = new Date();
    return {
      time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      date: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    };
  };
  const buildClock = (s) => {
    const box = h("div", "click-wheel-clock");
    s.time = h("div", "click-wheel-clock-time");
    s.date = h("div", "click-wheel-clock-date");
    box.append(s.time, s.date);
    s.el.replaceChildren(box);
    updateClock(s);
  };
  const updateClock = (s) => {
    const t = clockText();
    s.time.textContent = t.time;
    s.date.textContent = t.date;
  };

  const build = (s) => {
    if (s.type === "list") buildList(s);
    else if (s.type === "now") buildNow(s);
    else if (s.type === "photos") buildPhotos(s);
    else if (s.type === "photo") buildPhoto(s);
    else if (s.type === "about") buildAbout(s);
    else if (s.type === "clock") buildClock(s);
  };

  const refresh = () => {
    const s = current();
    if (s.type === "list") {
      const keepSel = s.sel;
      buildList(s);
      s.sel = Math.min(keepSel, s.list.length - 1);
      updateList(s);
    }
  };

  const place = (s, x, animate) => {
    s.el.style.transition = animate ? `transform ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0.24, 1)` : "none";
    s.el.style.transform = `translate3d(${x}%, 0, 0)`;
  };

  const syncTimers = () => {
    const s = current();
    if (s.type === "clock" && !clockTimer) {
      clockTimer = window.setInterval(() => {
        const c = current();
        if (c.type === "clock") updateClock(c);
      }, 1000);
    } else if (s.type !== "clock" && clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = 0;
    }
    wake();
  };

  const dropLater = (s) => {
    window.setTimeout(() => {
      if (!stack.includes(s)) s.el.remove();
    }, SLIDE_MS + 60);
  };

  const push = (s) => {
    const prev = current();
    s.el = h("div", "click-wheel-panel");
    s.el.dataset.type = s.type;
    view.append(s.el);
    build(s);
    stack.push(s);
    place(s, 100, false);
    if (prev) {
      s.el.getBoundingClientRect();
      place(s, 0, true);
      place(prev, -100, true);
    } else place(s, 0, false);
    setTitle(s.title);
    if (s.type === "list") announce(`${s.title}. ${s.list[s.sel]?.label ?? ""}`);
    else announce(s.title);
    syncTimers();
  };

  const pop = () => {
    if (stack.length < 2) return false;
    const s = stack.pop();
    const prev = current();
    if (prev.type === "list") refresh();
    if (prev.type === "now") renderNow(true);
    place(s, 100, true);
    place(prev, 0, true);
    dropLater(s);
    if (s.type === "now") player.mode = "progress";
    setTitle(prev.title);
    announce(prev.type === "list" ? `${prev.title}. ${prev.list[prev.sel]?.label ?? ""}` : prev.title);
    syncTimers();
    return true;
  };

  const startAudio = () => {
    if (player.playing) audio.play(songPos());
    else audio.pause();
  };

  const startTrack = (i, autoplay = true) => {
    player.index = i;
    player.pos = 0;
    player.playing = autoplay;
    player.startedAt = performance.now();
    player.mode = "progress";
    startAudio();
    renderStatus();
    renderNow(true);
    const song = nowSong();
    if (song) announce(`${song.title}, ${song.artist}`);
    wake();
  };

  const playFrom = (songs, i) => {
    if (!songs.length) return;
    const hadNow = player.index >= 0;
    player.queue = songs.slice();
    startTrack(i);
    if (!hadNow) {
      const main = stack[0];
      if (main && main !== current()) {
        const keep = main.sel;
        buildList(main);
        main.sel = keep;
        updateList(main);
      }
    }
    push({ type: "now", title: "Now Playing" });
  };

  const nextTrack = (auto = false) => {
    if (player.index < 0) return;
    if (auto && repeat === "One") return startTrack(player.index);
    let i = shuffle ? Math.floor(Math.random() * player.queue.length) : player.index + 1;
    if (i >= player.queue.length) {
      if (auto && repeat === "Off") {
        player.pos = 0;
        player.playing = false;
        startAudio();
        renderStatus();
        renderNow(true);
        return undefined;
      }
      i = 0;
    }
    startTrack(i, auto ? true : player.playing || auto);
    return undefined;
  };

  const prevTrack = () => {
    if (player.index < 0) return;
    if (songPos() > 3) {
      const was = player.playing;
      startTrack(player.index, was);
      return;
    }
    startTrack(player.index > 0 ? player.index - 1 : player.queue.length - 1, player.playing);
  };

  const togglePlay = () => {
    if (player.index < 0) {
      playFrom(LIBRARY_ALBUMS[0].songs, 2);
      return;
    }
    player.pos = songPos();
    player.playing = !player.playing;
    player.startedAt = performance.now();
    startAudio();
    renderStatus();
    renderNow();
    wake();
  };

  const setMode = (mode) => {
    player.mode = mode;
    player.modeUntil = performance.now() + MODE_MS;
    renderNow();
    wake();
  };

  const turn = (dir) => {
    const s = current();
    if (s.type === "list") {
      const next = Math.max(0, Math.min(s.list.length - 1, s.sel + dir));
      if (next === s.sel) return;
      s.sel = next;
      updateList(s);
      audio.tick();
      announce(s.list[s.sel].label);
    } else if (s.type === "now") {
      if (player.mode === "scrub") {
        const song = nowSong();
        player.pos = Math.max(0, Math.min(song.length - 0.5, songPos() + dir * 3));
        player.startedAt = performance.now();
        player.modeUntil = performance.now() + MODE_MS;
        audio.tick();
        window.clearTimeout(player.seekTimer);
        player.seekTimer = window.setTimeout(startAudio, 140);
        renderNow();
        return;
      }
      const v = Math.max(0, Math.min(1, Math.round((player.volume + dir / 20) * 20) / 20));
      if (player.mode !== "volume") setMode("volume");
      player.modeUntil = performance.now() + MODE_MS;
      if (v === player.volume) return;
      player.volume = v;
      audio.setVolume(v);
      audio.tick();
      renderNow();
    } else if (s.type === "photos") {
      const next = Math.max(0, Math.min(PHOTO_ALBUMS.length - 1, s.sel + dir));
      if (next === s.sel) return;
      s.sel = next;
      updatePhotos(s);
      audio.tick();
    } else if (s.type === "photo") {
      const next = Math.max(0, Math.min(PHOTO_ALBUMS.length - 1, s.index + dir));
      if (next === s.index) return;
      s.index = next;
      updatePhoto(s);
      audio.tick();
    }
  };

  const select = () => {
    const s = current();
    if (s.type === "list") s.list[s.sel]?.action();
    else if (s.type === "now") setMode(player.mode === "scrub" ? "progress" : "scrub");
    else if (s.type === "photos") push({ type: "photo", title: "", index: s.sel });
  };

  const menu = () => pop();

  const step = () => {
    raf = 0;
    if (destroyed || !visible) return;
    const s = current();
    let again = false;
    if (player.index >= 0 && player.playing) {
      const song = nowSong();
      if (songPos() >= song.length) nextTrack(true);
      again = true;
    }
    if (s.type === "now") {
      if (player.mode !== "progress" && performance.now() > player.modeUntil) player.mode = "progress";
      renderNow();
      again = again || player.mode !== "progress";
    }
    if (again) raf = requestAnimationFrame(step);
  };

  function wake() {
    if (!raf && !destroyed && visible) raf = requestAnimationFrame(step);
  }

  const pressQuad = (q, on) => {
    quads.forEach((p, i) => p.classList.toggle("is-pressed", on && i === q));
  };

  const fireQuad = (q) => {
    audio.press();
    if (q === 0) menu();
    else if (q === 1) nextTrack();
    else if (q === 2) togglePlay();
    else if (q === 3) prevTrack();
  };

  let drag = null;
  const onDown = (e) => {
    if (e.button !== undefined && e.button > 0) return;
    audio.arm();
    device.focus({ preventScroll: true });
    const r = wheel.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const scale = r.width / 244;
    const dist = Math.hypot(dx, dy) / scale;
    if (dist > 124) return;
    e.preventDefault();
    wheel.setPointerCapture(e.pointerId);
    if (dist < 49) {
      center.dataset.pressed = "";
      audio.press();
      drag = { id: e.pointerId, center: true };
      return;
    }
    const angle = Math.atan2(dy, dx);
    const q = ((Math.round((angle + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
    pressQuad(q, true);
    drag = { id: e.pointerId, center: false, cx, cy, last: angle, acc: 0, travel: 0, q, t: performance.now() };
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id || drag.center) return;
    const angle = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
    let d = angle - drag.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    drag.last = angle;
    drag.acc += d;
    drag.travel += Math.abs(d);
    if (drag.travel > 0.12 && drag.q >= 0) {
      pressQuad(-1, false);
      drag.q = -1;
    }
    let guard = 0;
    while (Math.abs(drag.acc) >= DETENT && guard < 6) {
      const dir = Math.sign(drag.acc);
      drag.acc -= dir * DETENT;
      turn(dir);
      guard += 1;
    }
    if (guard >= 6) drag.acc = 0;
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.center) {
      delete center.dataset.pressed;
      audio.press(true);
      select();
      return;
    }
    pressQuad(-1, false);
    if (d.q >= 0 && e.type === "pointerup") fireQuad(d.q);
  };
  wheel.addEventListener("pointerdown", onDown);
  wheel.addEventListener("pointermove", onMove);
  wheel.addEventListener("pointerup", onUp);
  wheel.addEventListener("pointercancel", onUp);

  const onScreenClick = (e) => {
    audio.arm();
    const row = e.target.closest(".click-wheel-row");
    const cell = e.target.closest(".click-wheel-cell");
    const s = current();
    if (row && s.type === "list" && s.el.contains(row)) {
      const i = Number(row.dataset.i);
      if (i !== s.sel) {
        s.sel = i;
        updateList(s);
        audio.tick();
      }
      audio.press();
      s.list[i]?.action();
    } else if (cell && s.type === "photos") {
      s.sel = Number(cell.dataset.i);
      updatePhotos(s);
      audio.press();
      select();
    }
  };
  screen.addEventListener("click", onScreenClick);

  let wheelAcc = 0;
  let wheelReset = 0;
  const onWheel = (e) => {
    e.preventDefault();
    audio.arm();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    wheelAcc += Math.max(-120, Math.min(120, dy));
    window.clearTimeout(wheelReset);
    wheelReset = window.setTimeout(() => {
      wheelAcc = 0;
    }, 220);
    let guard = 0;
    while (Math.abs(wheelAcc) >= 36 && guard < 3) {
      const dir = Math.sign(wheelAcc);
      wheelAcc -= dir * 36;
      turn(dir);
      guard += 1;
    }
  };
  device.addEventListener("wheel", onWheel, { passive: false });

  const onKey = (e) => {
    if (!visible || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== device && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
    let handled = true;
    if (e.key === "ArrowDown") turn(1);
    else if (e.key === "ArrowUp") turn(-1);
    else if (e.key === "Enter" || e.key === "ArrowRight") {
      audio.press();
      select();
    } else if (e.key === "Escape" || e.key === "Backspace" || e.key === "ArrowLeft") {
      audio.press();
      menu();
    } else if (e.key === " ") {
      audio.press();
      togglePlay();
    } else handled = false;
    if (handled) {
      audio.arm();
      e.preventDefault();
    }
  };
  window.addEventListener("keydown", onKey);

  const layout = () => {
    const box = root.getBoundingClientRect();
    const w = box.width;
    const hgt = box.height;
    const wide = w >= 900;
    let top = 24;
    if (caption && !embedded && !wide) top = caption.offsetTop + caption.offsetHeight + 24;
    const availH = hgt - top - 24;
    const k = Math.max(0.3, Math.min(availH / DEVICE_H, (w - 32) / DEVICE_W, 1.1));
    const x = (w - DEVICE_W * k) / 2;
    const y = top + (availH - DEVICE_H * k) / 2;
    device.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${k.toFixed(4)})`;
  };
  const ro = new ResizeObserver(layout);
  ro.observe(root);
  if (caption) ro.observe(caption);

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(root);

  const onVis = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVis);

  push(mainScreen);
  layout();

  const fontsReady = document.fonts?.load ? Promise.all([document.fonts.load('700 15px "Click Wheel Arimo"'), document.fonts.load('400 13px "Click Wheel Arimo"')]) : Promise.resolve();
  const coverReady = new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = LIBRARY_ALBUMS[0].cover;
  });
  Promise.race([Promise.all([fontsReady, coverReady]), new Promise((r) => window.setTimeout(r, 1500))]).then(() => {
    if (destroyed) return;
    layout();
    onReady();
  });

  return {
    async setSound(on) {
      return audio.setEnabled(on);
    },
    setTopSongs(list) {
      topSongs = list || [];
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(clockTimer);
      window.clearTimeout(player.seekTimer);
      window.clearTimeout(wheelReset);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      device.removeEventListener("wheel", onWheel);
      audio.destroy();
      device.remove();
    },
  };
}
