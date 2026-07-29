'use client';

/* ═══════════════════════════════════════════════════════════════════════════
 * CrowdVolt — the event card, ported from
 *   mono-volt/apps/web/app/components/core/home-explore/EventCard.tsx
 * plus the `RainbowWords` title treatment from
 *   mono-volt/apps/web/app/components/core/ui/rainbow-text.tsx
 *
 * Every duration, easing, radius, opacity and colour is carried over intact —
 * only the plumbing changed: Tailwind classes became plain CSS in the module,
 * next/link + next/image became a role="link" div and a plain <img>, and the
 * real HeartContainer (auth + API + burst) became a local toggle.
 *
 * The shimmer keyframes are NOT redefined here — the skeleton parts wear the
 * global `mv-skeleton` class from ./tokens.css, so this component expects an
 * ancestor carrying `.mv-scope` (which is also where --explore-* comes from;
 * every token read below has a literal fallback so it degrades gracefully).
 * ═══════════════════════════════════════════════════════════════════════════ */

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';

import styles from './EventCard.module.css';

// useLayoutEffect on the client (measure before paint → no rainbow flash on a
// word that turns out to be clipped), useEffect on the server (no SSR warning).
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* ── RainbowWords ─────────────────────────────────────────────────────────
 * Inlined from rainbow-text.tsx. Animated rainbow bg-clip text: the gradient
 * is clipped to the glyphs, pans once on mount and glides on hover. Pure CSS
 * (see the module), respects prefers-reduced-motion.
 * ─────────────────────────────────────────────────────────────────────── */

// Nearest ancestor that clips its overflow (a truncate/ellipsis container, an
// overflow-hidden box, etc.). That's the edge a rainbow word can fall beyond.
function findClipAncestor(el) {
  let node = el.parentElement;
  while (node) {
    const cs = getComputedStyle(node);
    if (
      cs.textOverflow === 'ellipsis' ||
      (cs.overflowX !== 'visible' && cs.overflowX !== '')
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// A single rainbow-ized word. The gradient is bg-clip:text, which paints a
// leaked/partial artifact when the inline box is sliced by an ellipsis. So we
// measure: if the word's right edge sits past the clip container's content
// edge (i.e. it's beyond the ellipsis cutoff), drop the rainbow and render it
// as a plain inherited-color span. Same glyphs → identical width → the state
// can't oscillate, and there's no layout shift either way.
function RainbowWord({ children, className }) {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clip = findClipAncestor(el);
    if (!clip) return;

    const measure = () => {
      const wordRect = el.getBoundingClientRect();
      const clipRect = clip.getBoundingClientRect();
      const padRight = parseFloat(getComputedStyle(clip).paddingRight) || 0;
      // ~1px tolerance so a word ending exactly at the edge stays rainbow.
      setClipped(wordRect.right > clipRect.right - padRight + 1);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(clip);
    // Disconnected on unmount — this grid lazy-mounts and unmounts tiles.
    return () => ro.disconnect();
  }, [children]);

  return (
    <span
      ref={ref}
      className={clipped ? className : `${styles.rainbow} ${className}`}
    >
      {children}
    </span>
  );
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Renders `text`, rainbow-izing every whole-word occurrence of `word`
// (case-insensitive) while leaving the rest untouched. Default targets "pride".
// Each match self-suppresses its rainbow when truncated away by an ellipsis.
function RainbowWords({ text, word = 'pride', className = '' }) {
  // Capturing split keeps the matched words as their own array slots.
  const re = new RegExp(`(\\b${escape(word)}\\b)`, 'i');
  if (!re.test(text)) return <>{text}</>;

  return (
    <>
      {text.split(re).map((part, i) =>
        new RegExp(`^${escape(word)}$`, 'i').test(part) ? (
          <RainbowWord key={i} className={className}>
            {part}
          </RainbowWord>
        ) : (
          part
        ),
      )}
    </>
  );
}

/* ── Heart ────────────────────────────────────────────────────────────────
 * Stands in for HeartContainer's `compact` variant: same 6px padding, same
 * round hit area, same 44×44 tap target via ::before, same 20px glyph. Local
 * `liked` state only — no auth, no API, no burst.
 * ─────────────────────────────────────────────────────────────────────── */
function HeartButton({ liked, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? 'Unlike event' : 'Like event'}
      onClick={(e) => {
        // Stops the card "link" from firing, same as the real card.
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`${styles.heart} ${liked ? styles.heartOn : ''}`}
    >
      <Heart size={20} strokeWidth={2} className={styles.heartIcon} />
    </button>
  );
}

/* ── EventCard ────────────────────────────────────────────────────────────
 * No panel fill, border, or card-level lift — just the cover image over the
 * dark page with the meta below. On hover only the image scales inside its
 * clip; the card itself stays put.
 * ─────────────────────────────────────────────────────────────────────── */
export const EventCard = memo(function EventCard({ event, liked, onToggleLike }) {
  // Fade the cover in once it decodes so a filter swap doesn't flash blank tiles.
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef(null);

  // A cached image can finish before React attaches onLoad, which would leave
  // the cover stuck at opacity 0. Catch that case on mount.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setImgLoaded(true);
  }, []);

  return (
    <div className={styles.card} role="link" tabIndex={0} aria-label={event.name}>
      <div className={styles.imgWrap}>
        <img
          ref={imgRef}
          src={event.image}
          alt={event.name}
          draggable={false}
          onLoad={() => setImgLoaded(true)}
          className={`${styles.img} ${imgLoaded ? styles.imgReady : ''}`}
        />
        {/* Favoriting — top-right over the cover. */}
        <div className={styles.heartWrap}>
          <HeartButton liked={liked} onToggle={onToggleLike} />
        </div>
      </div>
      {/* Meta: event info left, width-hugging price right. */}
      <div className={styles.meta}>
        <div className={styles.info}>
          <div className={styles.title}>
            {/* "Pride" in the title gets an animated rainbow bg-clip treatment. */}
            <RainbowWords text={event.name} />
          </div>
          {event.doors ? <div className={styles.sub}>{event.doors}</div> : null}
          {event.venue ? <div className={styles.sub}>{event.venue}</div> : null}
        </div>
        {event.price ? (
          <div className={styles.price}>
            <span className={styles.pricePrefix}>{event.price.prefix}</span>
            <span className={styles.priceValue}>{event.price.value}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/* ── EventCardSkeleton ────────────────────────────────────────────────────
 * Mirrors the loaded card's meta exactly: three text lines (title + doors +
 * venue) on the left, a price column on the right. Each shimmer bar sits
 * inside a div carrying the SAME text size as the real line (17px / 13px), so
 * it inherits the identical line-box height (strut) and the skeleton reserves
 * the same total height as a populated card — no magic px, no layout shift.
 * `--shimmer-delay` staggers each sweep so they cascade instead of firing in
 * unison. The animation itself lives on the global `mv-skeleton` class.
 * ─────────────────────────────────────────────────────────────────────── */
export function EventCardSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div
        className={`mv-skeleton ${styles.skelImage}`}
        style={{ '--shimmer-delay': '0s' }}
      />
      <div className={styles.meta}>
        <div className={styles.info}>
          <div className={styles.skelLine17}>
            <span
              className={`mv-skeleton ${styles.skelBar} ${styles.skelTitle}`}
              style={{ '--shimmer-delay': '0.12s' }}
            />
          </div>
          <div className={styles.skelLine13}>
            <span
              className={`mv-skeleton ${styles.skelBar} ${styles.skelFaint} ${styles.skelSubA}`}
              style={{ '--shimmer-delay': '0.24s' }}
            />
          </div>
          <div className={styles.skelLine13}>
            <span
              className={`mv-skeleton ${styles.skelBar} ${styles.skelFaint} ${styles.skelSubB}`}
              style={{ '--shimmer-delay': '0.36s' }}
            />
          </div>
        </div>
        <div className={styles.skelPrice}>
          <span
            className={`mv-skeleton ${styles.skelBar} ${styles.skelFaint} ${styles.skelPricePrefix}`}
            style={{ '--shimmer-delay': '0.3s' }}
          />
          <span
            className={`mv-skeleton ${styles.skelBar} ${styles.skelPriceValue}`}
            style={{ '--shimmer-delay': '0.42s' }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── The playground tile ──────────────────────────────────────────────── */

const EVENTS = [
  {
    id: 'cosmos-midnight',
    name: "Cosmo's Midnight",
    doors: 'Doors 10:00 PM',
    venue: 'Brooklyn Steel',
    price: { prefix: 'From', value: '$45' },
    image: '/monovolt/cosmos-midnight.webp',
  },
  {
    id: 'lp-giobbi',
    name: 'LP Giobbi: Pride Party',
    doors: 'Doors 9:00 PM',
    venue: 'Knockdown Center',
    price: { prefix: 'From', value: '$62' },
    image: '/monovolt/lp-giobbi.webp',
  },
  {
    id: 'louis-the-child',
    name: 'Louis The Child',
    doors: 'Doors 8:30 PM',
    venue: 'Avant Gardner',
    price: { prefix: 'Last Sale', value: '$118' },
    image: '/monovolt/louis-the-child.webp',
  },
];

const CYCLE_MS = 5200;   // how long a loaded card holds
const SKELETON_MS = 950; // how long the skeleton shows between events

function EventCardDemo() {
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  // Per-event, so liking one doesn't carry over to the next.
  const [likes, setLikes] = useState(() => ({}));

  // No controls: the card cycles on its own, and it goes through its REAL
  // loading state on every swap rather than cutting straight to the next
  // cover. That is how the card actually arrives on the homepage — skeleton
  // first, shimmer sweeping, then the cover fading in over it — so showing it
  // that way is more honest than a button that fakes the state on demand.
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }

    let swap = null;
    const hold = setInterval(() => {
      setLoading(true);
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % EVENTS.length);
        setLoading(false);
      }, SKELETON_MS);
    }, CYCLE_MS);

    return () => {
      clearInterval(hold);
      if (swap) clearTimeout(swap);
    };
  }, []);

  const event = EVENTS[index];

  return (
    <div className={styles.demo}>
      {loading ? (
        <EventCardSkeleton />
      ) : (
        // Keyed so a new event remounts the card and replays the cover fade-in
        // (and re-measures the rainbow word against the new title).
        <EventCard
          key={event.id}
          event={event}
          liked={!!likes[event.id]}
          onToggleLike={() =>
            setLikes((prev) => ({ ...prev, [event.id]: !prev[event.id] }))
          }
        />
      )}
    </div>
  );
}

export default memo(EventCardDemo);
