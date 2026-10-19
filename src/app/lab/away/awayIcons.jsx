export function NoteIcon() {
  return (
    <svg className="away-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" shapeRendering="crispEdges">
      <path d="M2 1h6l2 2v8H2z" fill="#fff7c2" stroke="#8a7a2a" />
      <path d="M8 1v2h2" fill="none" stroke="#8a7a2a" />
      <path d="M4 5h4M4 7h4M4 9h3" stroke="#b8a64a" />
    </svg>
  );
}

export function DoorIcon({ open }) {
  return (
    <svg className="away-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" shapeRendering="crispEdges">
      <path d="M2 1h8v10H2z" fill="#3b2a1a" />
      {open ? (
        <>
          <path d="M3 2h6v9H3z" fill="#fff4c8" />
          <path d="M3 2l4 1v8l-4 0z" fill="#a0642c" stroke="#5a3616" strokeWidth="0.6" />
          <path d="M6 6.5h0.8v1H6z" fill="#e8c860" />
        </>
      ) : (
        <>
          <path d="M3 2h6v9H3z" fill="#a0642c" stroke="#5a3616" strokeWidth="0.6" />
          <path d="M7 6.5h1v1H7z" fill="#e8c860" />
        </>
      )}
    </svg>
  );
}

export function MusicIcon() {
  return (
    <svg className="away-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M4.5 2.2 10 1v7.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.5 2.2v7" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <ellipse cx="3.2" cy="9.4" rx="1.6" ry="1.2" fill="currentColor" />
      <ellipse cx="8.7" cy="8.6" rx="1.6" ry="1.2" fill="currentColor" />
    </svg>
  );
}

export function BubbleIcon() {
  return (
    <svg className="away-icon" viewBox="0 0 14 12" width="14" height="12" aria-hidden="true" shapeRendering="crispEdges">
      <path d="M1 1h12v7H6l-3 3V8H1z" fill="#fff" stroke="#1b2f6b" />
      <path d="M3 3h8M3 5h5" stroke="#3a6ea5" />
    </svg>
  );
}

export function Caret({ open }) {
  return (
    <svg className="away-caret" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true" data-open={open ? "" : undefined}>
      <path d="M2 1l4 3-4 3z" fill="currentColor" />
    </svg>
  );
}

export function SpeakerIcon({ on }) {
  return (
    <svg className="away-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}
