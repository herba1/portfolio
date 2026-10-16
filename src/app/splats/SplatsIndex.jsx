"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import Shared from "@/app/ui/transitions/Shared";
import { OPEN_DETAIL } from "@/app/ui/transitions/types";
import SplatAnchor from "./stage/SplatAnchor";
import { preload, setWeight } from "./stage/stage";
import { takeReturn } from "./returnTrip";
import { smoothstep, clamp } from "./stage/motion";

const OPEN = [OPEN_DETAIL];

// How far into the hero→rail scroll each splat waits before it leaves its
// hero slot, as a share of the whole blend. Staggered so the row peels off
// left to right instead of moving as one sheet.
const PEEL = 0.38;

function HeroSlot({ item }) {
  const { hero } = item;
  return (
    <SplatAnchor
      actor={item.id}
      slot="hero"
      weight={1}
      className="splats-hero__slot"
      style={{
        "--x": hero.x,
        "--y": hero.y,
        "--size": hero.size,
        "--mx": hero.mobile?.x ?? hero.x,
        "--my": hero.mobile?.y ?? hero.y,
        "--msize": hero.mobile?.size ?? hero.size,
      }}
    />
  );
}

function Card({ item, index, onFocusCard }) {
  return (
    <li className="splats-card">
      <Link
        href={`/splats/${item.id}`}
        transitionTypes={OPEN}
        className="splats-card__link"
        onFocus={() => onFocusCard(index)}
        onPointerEnter={() => preload(item.id)}
      >
        <SplatAnchor actor={item.id} slot="card" weight={0} interactive className="splats-card__frame" />
        <div className="splats-card__caption">
          <Shared name={`splat-title-${item.id}`} morph="fade" on={OPEN_DETAIL}>
            <span className="splats-card__title">{item.title}</span>
          </Shared>
          <span className="splats-card__kicker">{item.kicker}</span>
        </div>
      </Link>
    </li>
  );
}

// The page scroll position at which the rail shows card `index` centred.
function scrollTopForCard(track, { railTop, shift, travel }, index) {
  const card = track?.children[index];
  if (!card) return window.scrollY;
  const left = card.offsetLeft + card.offsetWidth / 2 - window.innerWidth / 2;
  return railTop + clamp(left / Math.max(1, shift)) * travel;
}

export default function SplatsIndex({ items }) {
  const heroRef = useRef(null);
  const railRef = useRef(null);
  const trackRef = useRef(null);
  const geometry = useRef({ heroHeight: 1, railTop: 0, travel: 0, shift: 0 });

  useLayoutEffect(() => {
    const hero = heroRef.current;
    const rail = railRef.current;
    const track = trackRef.current;
    const ids = items.map((item) => item.id);
    const count = ids.length;

    // Rail height = one viewport + the track's horizontal overflow, so one
    // pixel of vertical scroll moves the track one pixel sideways.
    const measure = () => {
      const vh = window.innerHeight;
      const shift = Math.max(0, track.scrollWidth - window.innerWidth);
      rail.style.height = `${vh + shift}px`;
      geometry.current = {
        heroHeight: hero.offsetHeight,
        railTop: rail.offsetTop,
        travel: Math.max(1, shift),
        shift,
      };
    };

    // Runs inside the scroll event, which the browser dispatches before
    // requestAnimationFrame callbacks. The stage reads anchor rects in its
    // rAF, so writing the track transform and the weights here keeps every
    // splat glued to its card in the same frame — no one-frame swim.
    const update = () => {
      const { heroHeight, railTop, travel, shift } = geometry.current;
      const y = window.scrollY;
      const blend = clamp(y / (heroHeight * 0.92));
      for (let i = 0; i < count; i++) {
        const delay = (i / Math.max(1, count - 1)) * PEEL;
        const b = smoothstep((blend - delay) / (1 - PEEL));
        setWeight(ids[i], "hero", 1 - b);
        setWeight(ids[i], "card", b);
      }
      const progress = clamp((y - railTop) / travel);
      track.style.transform = `translate3d(${-progress * shift}px, 0, 0)`;
    };

    measure();
    const slug = takeReturn();
    const returning = items.findIndex((item) => item.id === slug);
    if (returning >= 0) window.scrollTo(0, scrollTopForCard(track, geometry.current, returning));
    update();

    const onResize = () => {
      measure();
      update();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(track);
    observer.observe(hero);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", onResize);
    };
  }, [items]);

  // Keyboard: tabbing to a card scrolls the page to where the rail shows it.
  const onFocusCard = (index) => {
    window.scrollTo({ top: scrollTopForCard(trackRef.current, geometry.current, index), behavior: "instant" });
  };

  return (
    <main id="content" className="splats">
      <section ref={heroRef} className="splats-hero" aria-labelledby="splats-title">
        <div className="splats-hero__copy">
          <h1 id="splats-title" className="splats-hero__title">
            Splats
          </h1>
          <p className="splats-hero__lede">
            Captured objects, rendered as millions of soft Gaussians. Scroll to line them up; open one to read about it.
          </p>
        </div>
        <div className="splats-hero__field" aria-hidden="true">
          {items.map((item) => (
            <HeroSlot key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section ref={railRef} className="splats-rail" aria-label="All splats">
        <div className="splats-rail__sticky">
          <ol ref={trackRef} className="splats-rail__track">
            {items.map((item, i) => (
              <Card key={item.id} item={item} index={i} onFocusCard={onFocusCard} />
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
