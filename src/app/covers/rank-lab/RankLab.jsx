"use client";

import Waveform from "@/app/ui/Waveform";
import { useArtPalette } from "../lib/artPalette";
import "../covers.css";
import "./rank-lab.css";

const COPY_OPTIONS = [
  { key: "current", name: "Number + label", note: "What's there now.", parts: (rank) => [rank, "Most played"] },
  { key: "no", name: "No. only", note: "Chart shorthand. Shortest, assumes the page title explains it.", parts: (rank) => [`No. ${rank}`] },
  { key: "window", name: "With the time window", note: "Says what the ranking covers. Spotify's short-term range is about 4 weeks.", parts: (rank) => [rank, "this month"] },
  { key: "repeat", name: "On repeat", note: "Warmer, more personal. Reads like a habit, not a statistic.", parts: (rank) => [rank, "On repeat"] },
  { key: "ordinal", name: "Ordinal", note: "Spells out the position. Very plain.", parts: (rank) => [ordinal(rank), "most played"] },
  { key: "top-only", name: "Top song, then rank", note: "Number one gets a name, everything else gets a number.", parts: (rank) => (rank === 1 ? ["Top song"] : [`No. ${rank}`]) },
  { key: "of-total", name: "Out of 50", note: "Gives the scale. Makes a low rank feel like part of a set.", parts: (rank, total) => [rank, `of ${total}`] },
  { key: "possessive", name: "First person", note: "In your voice. Makes it clear whose listening this is.", parts: (rank) => [`My No. ${rank}`] },
];

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

const MOCK_PEAKS = Array.from({ length: 40 }, (_, i) => 0.45 + 0.4 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));

export default function RankLab({ tracks, mode, total }) {
  const period = mode === "recent" ? "Recently played" : "Most played";
  return (
    <main className="rl-page">
      <header className="rl-head">
        <h1>Ink pill, colours from the cover</h1>
        <p>
          Both colours are real pixel values pulled from each cover. The fill is the most common colour that can carry
          7:1 text, and the text is the lightest colour in the cover against it. Nothing is shifted or tinted.
        </p>
      </header>
      <h2 className="rl-section">Copy</h2>
      <div className="rl-copy-list">
        {COPY_OPTIONS.map((option) => (
          <section key={option.key} className="rl-copy">
            <div className="rl-copy-label">
              <h3>{option.name}</h3>
              <p>{option.note}</p>
            </div>
            <div className="rl-copy-row">
              {tracks.slice(0, 4).map((track) => (
                <CopyTile key={track.id || track.title} track={track} parts={option.parts(track.rank, total)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <h2 className="rl-section">Mobile</h2>
      <div className="rl-row">
        {tracks.map((track) => (
          <PlayerMock key={track.id || track.title} track={track} rank={track.rank} period={period} />
        ))}
      </div>
      <h2 className="rl-section">Desktop</h2>
      <div className="rl-desk-list">
        {tracks.map((track) => (
          <DesktopMock key={track.id || track.title} track={track} rank={track.rank} period={period} />
        ))}
      </div>
    </main>
  );
}

function CopyTile({ track, parts }) {
  const palette = useArtPalette(track.image);
  const [lead, rest] = parts;
  return (
    <div className="rl-copy-art" style={track.image ? { backgroundImage: `url(${track.image})` } : undefined}>
      <span
        className="rl-badge rl-ink-pill"
        style={palette ? { background: palette.bg, color: palette.fg } : undefined}
      >
        <span className="rl-num">{lead}</span>
        {rest ? <span>{rest}</span> : null}
      </span>
    </div>
  );
}

function InkPill({ palette, rank, period }) {
  return (
    <span
      className="rl-badge rl-ink-pill"
      aria-label={`${period}, number ${rank}`}
      style={palette ? { background: palette.bg, color: palette.fg } : undefined}
    >
      <span className="rl-num">{rank}</span>
      <span>{period}</span>
    </span>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

const LYRIC_WIDTHS = [62, 48, 84, 70, 56, 88, 64, 40];

function DesktopMock({ track, rank, period }) {
  const art = track.imageLarge || track.image;
  const palette = useArtPalette(track.image);
  return (
    <div className="rl-desk">
      <div className="rl-desk-art" style={art ? { backgroundImage: `url(${art})` } : undefined}>
        <InkPill palette={palette} rank={rank} period={period} />
      </div>
      <div className="rl-desk-panel">
        <div className="rl-text">
          <h3 className="cv-music-title">{track.title}</h3>
          <p className="cv-music-artist">
            {track.artistImage ? <span className="rl-avatar" style={{ backgroundImage: `url(${track.artistImage})` }} /> : null}
            <span>{track.artist}</span>
          </p>
        </div>
        <div className="rl-controls">
          <button type="button" className="cv-play-btn" aria-label="Play">
            <PlayIcon />
          </button>
          <div className="rl-wave">
            <Waveform peaks={MOCK_PEAKS} progress={0.08} duration={30} barCount={24} barGap={4} height={40} />
          </div>
          <span className="rl-time">0:02 / 0:30</span>
        </div>
        <div className="rl-lyrics" aria-hidden="true">
          {LYRIC_WIDTHS.map((width, i) => (
            <span key={i} style={{ width: `${width}%` }} />
          ))}
        </div>
        <div className="rl-actions">
          <span className="rl-spotify">Spotify</span>
        </div>
      </div>
    </div>
  );
}

function PlayerMock({ track, rank, period }) {
  const art = track.imageLarge || track.image;
  const palette = useArtPalette(track.image);
  return (
    <div className="rl-cell">
      <div className="rl-card">
        <div className="rl-handle">
          <span />
        </div>
        <div className="rl-art" style={art ? { backgroundImage: `url(${art})` } : undefined}>
          <InkPill palette={palette} rank={rank} period={period} />
        </div>

        <div className="rl-info">
          <div className="rl-text">
            <h3 className="cv-music-title rl-title">{track.title}</h3>
            <p className="cv-music-artist">
              {track.artistImage ? <span className="rl-avatar" style={{ backgroundImage: `url(${track.artistImage})` }} /> : null}
              <span>{track.artist}</span>
            </p>
          </div>
        </div>

        <div className="rl-controls">
          <button type="button" className="cv-play-btn" aria-label="Play">
            <PlayIcon />
          </button>
          <div className="rl-wave">
            <Waveform peaks={MOCK_PEAKS} progress={0.08} duration={30} barCount={24} barGap={4} height={40} />
          </div>
          <span className="rl-time">0:02 / 0:30</span>
        </div>

        <div className="rl-actions">
          <span className="rl-spotify">Spotify</span>
        </div>
      </div>

      {palette ? (
        <div className="rl-proof">
          <p>
            Fill <code>{palette.bg}</code> · text <code>{palette.fg}</code> · {palette.ratio.toFixed(1)}:1
          </p>
          <div className="rl-swatches">
            {palette.swatches.map((hex) => (
              <span
                key={hex}
                className={hex === palette.bg || hex === palette.fg ? "is-used" : undefined}
                style={{ background: hex }}
                title={hex}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
