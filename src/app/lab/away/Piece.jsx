"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { createAwayAudio } from "./awayAudio";
import { BUDDIES, IM_OPENERS, IM_REPLIES, PALETTE, PRESET_MESSAGES, SIZES } from "./awayData";
import { BubbleIcon, Caret, DoorIcon, MusicIcon, NoteIcon, SpeakerIcon } from "./awayIcons";
import "./away.css";

const ME = "herb";
const DOOR_MS = 2600;
const COLLAPSE_MS = 240;
const TOGGLERS = ["northbound", "rooftop", "dad", "seaglass", "nina", "juniper"];

const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function messageStyle(f) {
  const size = SIZES.find((s) => s.id === f.size) ?? SIZES[1];
  return {
    color: f.color,
    fontWeight: f.bold ? "var(--font-weight-bold)" : "var(--font-weight-normal)",
    fontStyle: f.italic ? "italic" : "normal",
    textDecoration: f.underline ? "underline" : "none",
    fontSize: `${size.px}px`,
    lineHeight: `${size.lh}px`,
  };
}

function Titlebar({ icon, children }) {
  return (
    <div className="away-titlebar">
      {icon}
      <span className="away-titletext">{children}</span>
    </div>
  );
}

function AwayCard({ name, status, message, style, listening, since }) {
  return (
    <div className="away-card">
      <div className="away-card-head">
        <span className="away-card-name">{name}</span>
        <span className="away-card-since">{since}</span>
      </div>
      <div className="away-card-body">
        {message ? (
          <p className="away-card-message" style={style}>
            {message}
          </p>
        ) : (
          <p className="away-card-empty">{status === "offline" ? `${name} is signed off.` : `${name} is here. No away message.`}</p>
        )}
        {listening ? (
          <p className="away-card-listening">
            <MusicIcon />
            <span>listening to: {listening}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const audioRef = useRef(null);
  const visibleRef = useRef(true);
  const timers = useRef(new Set());
  const imTimer = useRef(0);
  const imLogRef = useRef(null);
  const replyCount = useRef(0);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [label, setLabel] = useState(PRESET_MESSAGES[0].label);
  const [text, setText] = useState(PRESET_MESSAGES[0].text);
  const [format, setFormat] = useState({ color: PRESET_MESSAGES[0].color, bold: false, italic: false, underline: false, size: "normal" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showSong, setShowSong] = useState(true);
  const [songIndex, setSongIndex] = useState(0);
  const [away, setAway] = useState(null);
  const [buddies, setBuddies] = useState(() => BUDDIES.map((b) => ({ ...b, door: null, phase: null })));
  const [selected, setSelected] = useState("littlewing");
  const [openGroups, setOpenGroups] = useState({ Buddies: true, Family: true, Offline: false });
  const [im, setIm] = useState(null);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState("composer");
  const [live, setLive] = useState("");
  const buddiesRef = useRef(buddies);
  const { tracks } = useTopSongs(12);

  const songs = useMemo(() => {
    const list = [{ title: "Here Comes the Sun", artist: "The Beatles" }];
    for (const t of tracks) if (!list.some((s) => s.title === t.title)) list.push({ title: t.title, artist: t.artist });
    return list;
  }, [tracks]);
  const song = songs[songIndex % songs.length];
  const listening = showSong ? `${song.title} - ${song.artist}` : null;

  const later = useCallback((fn, ms) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    buddiesRef.current = buddies;
  }, [buddies]);

  useEffect(() => {
    const audio = createAwayAudio();
    audioRef.current = audio;
    const pending = timers.current;
    let alive = true;
    const fonts = document.fonts?.load ? Promise.all([document.fonts.load('13px "Away Arimo"'), document.fonts.load('700 13px "Away Arimo"')]) : Promise.resolve();
    Promise.race([fonts, new Promise((r) => window.setTimeout(r, 1200))]).then(() => {
      if (alive) setReady(true);
    });
    const root = rootRef.current;
    const io = new IntersectionObserver(([e]) => {
      visibleRef.current = e.isIntersecting;
    });
    if (root) io.observe(root);
    return () => {
      alive = false;
      io.disconnect();
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
      audio.destroy();
      audioRef.current = null;
    };
  }, []);

  const signal = useCallback(
    (id, on) => {
      const b = buddiesRef.current.find((x) => x.id === id);
      if (!b) return;
      const pan = (TOGGLERS.indexOf(id) / (TOGGLERS.length - 1)) * 1.2 - 0.6;
      if (on) {
        audioRef.current?.doorOpen(pan);
        setBuddies((list) => list.map((x) => (x.id === id ? { ...x, status: x.message ? "away" : "online", door: "open", phase: "enter", since: 0 } : x)));
        setLive(`${b.name} signed on`);
        later(() => setBuddies((list) => list.map((x) => (x.id === id ? { ...x, door: null, phase: null } : x))), DOOR_MS);
      } else {
        audioRef.current?.doorClose(pan);
        setBuddies((list) => list.map((x) => (x.id === id ? { ...x, door: "closed" } : x)));
        setLive(`${b.name} signed off`);
        later(() => {
          setBuddies((list) => list.map((x) => (x.id === id ? { ...x, phase: "leave" } : x)));
          later(() => setBuddies((list) => list.map((x) => (x.id === id ? { ...x, status: "offline", door: null, phase: null } : x))), COLLAPSE_MS);
        }, DOOR_MS);
      }
    },
    [later],
  );

  useEffect(() => {
    let timer = 0;
    let first = true;
    const tick = () => {
      if (visibleRef.current && !document.hidden) {
        const list = buddiesRef.current;
        let pick;
        if (first) {
          pick = list.find((b) => b.id === "northbound" && b.status === "offline");
          first = false;
        }
        if (!pick) {
          const candidates = list.filter((b) => TOGGLERS.includes(b.id) && !b.door && !b.phase && !(im && b.id === im.buddy));
          const online = candidates.filter((b) => b.status !== "offline");
          const offline = candidates.filter((b) => b.status === "offline");
          const pool = offline.length && (online.length > 4 || Math.random() < 0.5) ? offline : online;
          pick = pool[Math.floor(Math.random() * pool.length)];
        }
        if (pick) signal(pick.id, pick.status === "offline");
      }
      timer = window.setTimeout(tick, 6500 + Math.random() * 5000);
    };
    timer = window.setTimeout(tick, 2200);
    return () => window.clearTimeout(timer);
  }, [signal, im]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setBuddies((list) => list.map((b) => (b.status === "offline" ? b : { ...b, since: (b.since ?? 0) + 1, idle: b.status === "idle" ? (b.idle ?? 0) + 1 : b.idle })));
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = imLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [im]);

  const arm = () => audioRef.current?.arm();

  const toggleAway = () => {
    arm();
    if (away) {
      window.clearTimeout(imTimer.current);
      setAway(null);
      audioRef.current?.away(false);
      setLive("You are back.");
      return;
    }
    const snapshot = { text: text.trim() || "away", format: { ...format }, listening, label, at: clock() };
    setAway(snapshot);
    setSelected(ME);
    audioRef.current?.away(true);
    setLive(`Away: ${snapshot.text}`);
    window.clearTimeout(imTimer.current);
    if (!im) {
      imTimer.current = later(() => {
        const online = buddiesRef.current.filter((b) => b.status === "online" && !b.door);
        const opener = IM_OPENERS.find((o) => online.some((b) => b.id === o.from)) ?? IM_OPENERS[0];
        const buddy = BUDDIES.find((b) => b.id === opener.from);
        setIm({
          buddy: buddy.id,
          name: buddy.name,
          lines: [
            { id: 1, who: buddy.name, at: clock(), text: opener.text },
            { id: 2, who: ME, at: clock(), text: snapshot.text, auto: true, style: messageStyle(snapshot.format), listening: snapshot.listening },
          ],
        });
        setActive("im");
        audioRef.current?.imIn();
        setLive(`${buddy.name} says: ${opener.text}`);
      }, 3200);
    }
  };

  const sendReply = (e) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value || !im) return;
    arm();
    setDraft("");
    audioRef.current?.imOut();
    const at = clock();
    setIm((cur) => (cur ? { ...cur, lines: [...cur.lines, { id: cur.lines.length + 1, who: ME, at, text: value }] } : cur));
    const reply = IM_REPLIES[replyCount.current % IM_REPLIES.length];
    replyCount.current += 1;
    later(() => {
      setIm((cur) => (cur ? { ...cur, lines: [...cur.lines, { id: cur.lines.length + 1, who: cur.name, at: clock(), text: reply }] } : cur));
      audioRef.current?.imIn();
    }, 1800);
  };

  const closeIm = () => {
    arm();
    audioRef.current?.click();
    setIm(null);
    setActive("composer");
  };

  const loadPreset = (i) => {
    const p = PRESET_MESSAGES[i];
    setLabel(p.label);
    setText(p.text);
    setFormat((f) => ({ ...f, color: p.color }));
  };

  const toggleSound = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !sound;
    setSound(next);
    const result = await audio.setEnabled(next);
    if (result !== next) setSound(false);
  };

  const tap = (fn) => {
    arm();
    audioRef.current?.click();
    fn();
  };

  const groups = ["Buddies", "Family"].map((g) => {
    const members = buddies.filter((b) => b.group === g && (b.status !== "offline" || b.door));
    return { name: g, members, total: buddies.filter((b) => b.group === g).length, online: members.filter((m) => m.status !== "offline").length };
  });
  const offline = buddies.filter((b) => b.status === "offline" && !b.door);

  const fmt = messageStyle(format);
  const selectedBuddy = buddies.find((b) => b.id === selected);
  const card =
    selected === ME
      ? away
        ? { name: ME, status: "away", message: away.text, style: messageStyle(away.format), listening: away.listening, since: `Away since ${away.at}` }
        : { name: ME, status: "online", message: text.trim() || null, style: fmt, listening, since: "Preview" }
      : selectedBuddy
        ? {
            name: selectedBuddy.name,
            status: selectedBuddy.status,
            message: selectedBuddy.status === "away" ? selectedBuddy.message : null,
            style: messageStyle({ color: selectedBuddy.color ?? "#000000", italic: selectedBuddy.italic, size: "normal" }),
            listening: selectedBuddy.status === "offline" ? null : selectedBuddy.listening ? `${selectedBuddy.listening} - The Beatles` : null,
            since:
              selectedBuddy.status === "offline"
                ? "Signed off"
                : selectedBuddy.status === "idle"
                  ? `Idle ${selectedBuddy.idle} min`
                  : `${selectedBuddy.status === "away" ? "Away" : "Online"} ${selectedBuddy.since ?? 0} min`,
          }
        : null;

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="away" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined} onPointerDown={arm}>
      {embedded ? null : (
        <header className="away-caption">
          <div className="away-caption-text">
            <h1 className="away-heading">Away</h1>
            <p className="away-hint">Write an away message, then set yourself away. Buddies come and go with the door, and the next one who messages you gets your words back.</p>
          </div>
          <button type="button" className="away-sound" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </header>
      )}
      <div className="away-desk">
        <section className="away-win away-composer" data-active={active === "composer" ? "" : undefined} onPointerDown={() => setActive("composer")} aria-label="Edit away message">
          <Titlebar icon={<NoteIcon />}>Edit Away Message</Titlebar>
          <div className="away-body">
            <div className="away-row">
              <label className="away-label" htmlFor="away-label-input">
                Label
              </label>
              <input id="away-label-input" className="away-field away-label-input" value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} />
              <select className="away-field away-select" aria-label="Saved messages" value="" onChange={(e) => e.target.value !== "" && loadPreset(Number(e.target.value))}>
                <option value="">Saved…</option>
                {PRESET_MESSAGES.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="away-toolbar" role="toolbar" aria-label="Formatting">
              <div className="away-color-wrap">
                <button type="button" className="away-tool away-color" aria-label="Text colour" aria-expanded={paletteOpen} onClick={() => tap(() => setPaletteOpen((o) => !o))}>
                  <span className="away-color-a">A</span>
                  <span className="away-color-bar" style={{ background: format.color }} />
                </button>
                {paletteOpen ? (
                  <div className="away-palette" role="listbox" aria-label="Colours">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="option"
                        aria-selected={format.color === c}
                        aria-label={c}
                        className="away-swatch"
                        style={{ background: c }}
                        onClick={() => tap(() => {
                          setFormat((f) => ({ ...f, color: c }));
                          setPaletteOpen(false);
                        })}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <button type="button" className="away-tool away-tool-b" aria-pressed={format.bold} aria-label="Bold" onClick={() => tap(() => setFormat((f) => ({ ...f, bold: !f.bold })))}>
                B
              </button>
              <button type="button" className="away-tool away-tool-i" aria-pressed={format.italic} aria-label="Italic" onClick={() => tap(() => setFormat((f) => ({ ...f, italic: !f.italic })))}>
                I
              </button>
              <button type="button" className="away-tool away-tool-u" aria-pressed={format.underline} aria-label="Underline" onClick={() => tap(() => setFormat((f) => ({ ...f, underline: !f.underline })))}>
                U
              </button>
              <span className="away-sep" />
              {SIZES.map((s) => (
                <button key={s.id} type="button" className="away-tool away-tool-size" data-size={s.id} aria-pressed={format.size === s.id} aria-label={`${s.label} text`} onClick={() => tap(() => setFormat((f) => ({ ...f, size: s.id })))}>
                  A
                </button>
              ))}
            </div>
            <textarea
              className="away-field away-text"
              value={text}
              maxLength={240}
              spellCheck={false}
              aria-label="Away message"
              style={fmt}
              onChange={(e) => {
                setText(e.target.value);
                audioRef.current?.key();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  toggleAway();
                }
              }}
            />
            <div className="away-song">
              <label className="away-check">
                <input type="checkbox" checked={showSong} onChange={(e) => setShowSong(e.target.checked)} />
                <span>Show what I’m listening to</span>
              </label>
              <div className="away-song-pick" data-off={showSong ? undefined : ""}>
                <button type="button" className="away-tool away-tool-step" aria-label="Previous song" disabled={!showSong} onClick={() => tap(() => setSongIndex((i) => (i - 1 + songs.length) % songs.length))}>
                  ‹
                </button>
                <MusicIcon />
                <span className="away-song-name">
                  {song.title} - {song.artist}
                </span>
                <button type="button" className="away-tool away-tool-step" aria-label="Next song" disabled={!showSong} onClick={() => tap(() => setSongIndex((i) => (i + 1) % songs.length))}>
                  ›
                </button>
              </div>
            </div>
            <div className="away-footer">
              <span className="away-status-note">{away ? `Away since ${away.at}` : "You are available."}</span>
              <button type="button" className="away-btn away-btn-default" onClick={toggleAway}>
                {away ? "I’m Back" : "I’m Away"}
              </button>
            </div>
          </div>
        </section>

        <section className="away-win away-list" data-active={active === "list" ? "" : undefined} onPointerDown={() => setActive("list")} aria-label="Buddy list">
          <Titlebar icon={<BubbleIcon />}>{ME}’s Buddy List</Titlebar>
          <div className="away-list-body">
            <button type="button" className="away-me" data-selected={selected === ME ? "" : undefined} onClick={() => tap(() => setSelected(ME))}>
              <span className="away-me-name">
                {away ? <NoteIcon /> : null}
                {ME}
              </span>
              <span className="away-me-status">{away ? `Away: ${away.label}` : "Available"}</span>
            </button>
            <div className="away-tree" role="tree">
              {[...groups, { name: "Offline", members: offline, total: buddies.length, online: offline.length, offline: true }].map((g) => (
                <div key={g.name} className="away-group" role="group">
                  <button type="button" className="away-group-head" aria-expanded={openGroups[g.name]} onClick={() => tap(() => setOpenGroups((o) => ({ ...o, [g.name]: !o[g.name] })))}>
                    <Caret open={openGroups[g.name]} />
                    <span>{g.offline ? `Offline (${g.members.length})` : `${g.name} (${g.online}/${g.total})`}</span>
                  </button>
                  {openGroups[g.name]
                    ? g.members.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          role="treeitem"
                          aria-selected={selected === b.id}
                          className="away-buddy"
                          data-selected={selected === b.id ? "" : undefined}
                          data-phase={b.phase ?? undefined}
                          data-door={b.door ?? undefined}
                          data-status={b.status}
                          onClick={() => tap(() => setSelected(b.id))}
                        >
                          <span className="away-buddy-icon">{b.door ? <DoorIcon open={b.door === "open"} /> : b.status === "away" ? <NoteIcon /> : null}</span>
                          <span className="away-buddy-name">{b.name}</span>
                          {b.status === "idle" ? <span className="away-buddy-idle">(idle {b.idle})</span> : null}
                        </button>
                      ))
                    : null}
                </div>
              ))}
            </div>
            {card ? (
              <div className="away-info" aria-live="polite">
                <AwayCard {...card} />
              </div>
            ) : null}
          </div>
        </section>

        {im ? (
          <section className="away-win away-im" data-active={active === "im" ? "" : undefined} onPointerDown={() => setActive("im")} aria-label={`Instant message with ${im.name}`}>
            <Titlebar icon={<BubbleIcon />}>{im.name} - Instant Message</Titlebar>
            <button type="button" className="away-close" aria-label="Close" onClick={closeIm}>
              <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true" shapeRendering="crispEdges">
                <path d="M0 0h2l2 2 2-2h2v1L5 4l3 3v1H6L4 6 2 8H0V7l3-3-3-3z" fill="currentColor" />
              </svg>
            </button>
            <div className="away-im-body">
              <div className="away-im-log" ref={imLogRef}>
                {im.lines.map((l) => (
                  <div key={l.id} className="away-im-line">
                    <span className="away-im-who" data-me={l.who === ME ? "" : undefined}>
                      {l.auto ? `Auto response from ${ME}` : l.who} ({l.at}):
                    </span>{" "}
                    <span style={l.style}>{l.text}</span>
                    {l.listening ? (
                      <span className="away-im-listening">
                        <MusicIcon />
                        listening to: {l.listening}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              <form className="away-im-send" onSubmit={sendReply}>
                <input className="away-field away-im-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="" aria-label="Reply" maxLength={160} onKeyDown={(e) => e.key === "Escape" && closeIm()} />
                <button type="submit" className="away-btn">
                  Send
                </button>
              </form>
            </div>
          </section>
        ) : null}
      </div>
      <p className="away-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
