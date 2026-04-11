export default function MailIcon({ open }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className="nav-toggle-icon"
    >
      <style>{`
        .nav-toggle-icon {
          overflow: visible;
          cursor: pointer;
          display: block;
        }

        /* Horizontal bar (always visible) */
        .nav-toggle-h {
          transition: opacity 150ms ease;
        }

        /* Vertical bar (rotates to hide for minus) */
        .nav-toggle-v {
          transform-box: fill-box;
          transform-origin: center center;
          transition: transform 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
        }

        .nav-toggle-icon.is-open .nav-toggle-v {
          transform: rotate(90deg);
        }

        /* Active: press */
        .nav-toggle-icon:active .nav-toggle-h,
        .nav-toggle-icon:active .nav-toggle-v {
          opacity: 0.5;
          transition: opacity 100ms ease;
        }

        @media (prefers-reduced-motion: reduce) {
          .nav-toggle-v {
            transition: none !important;
          }
        }
      `}</style>

      {/* Hit area */}
      <rect width="14" height="14" fill="transparent" />

      {/* Horizontal bar */}
      <line
        className="nav-toggle-h"
        x1="3" y1="7" x2="11" y2="7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Vertical bar — rotates 90° to become minus */}
      <line
        className={`nav-toggle-v ${open ? "is-open" : ""}`}
        x1="7" y1="3" x2="7" y2="11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        style={open ? { transform: "rotate(90deg)" } : undefined}
      />
    </svg>
  );
}
