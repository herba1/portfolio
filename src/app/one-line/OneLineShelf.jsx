import Image from "next/image";

import { SHELF_SIZE } from "./oneLineShelves";

const SLOTS = Array.from({ length: SHELF_SIZE }, (_, slot) => slot);

function revealWhenReady(image) {
  if (image?.complete && image.naturalWidth > 0) image.setAttribute("data-loaded", "");
}

function revealOnLoad(event) {
  event.currentTarget.setAttribute("data-loaded", "");
}

function sideOf(shelfIndex, active) {
  if (shelfIndex === active) return "on";
  return shelfIndex < active ? "before" : "after";
}

export default function OneLineShelf({ shelves, active }) {
  return (
    <ul className="ol-shelf">
      {SLOTS.map((slot) => (
        <li key={slot} className="ol-song" style={{ "--ol-i": slot }} data-empty={shelves[active][slot] ? undefined : ""}>
          {shelves.map((shelf, shelfIndex) => {
            const track = shelf[slot];
            if (!track) return null;
            const on = shelfIndex === active;
            return (
              <div
                key={shelfIndex}
                className="ol-song__layer"
                data-side={sideOf(shelfIndex, active)}
                aria-hidden={on ? undefined : true}
              >
                <Image
                  ref={revealWhenReady}
                  className="ol-song__cover"
                  src={track.image}
                  alt=""
                  width={72}
                  height={72}
                  crossOrigin="anonymous"
                  draggable={false}
                  onLoad={revealOnLoad}
                />
                <span className="ol-song__text">
                  <span className="ol-song__title text-ui-sm">{track.title}</span>
                  <span className="ol-song__artist text-ui-sm">{track.artist}</span>
                </span>
              </div>
            );
          })}
        </li>
      ))}
    </ul>
  );
}
