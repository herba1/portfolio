"use client";

import InkSheet from "./InkSheet";
import "./wet-ink.css";

export default function WetInkExperience({ embedded = false }) {
  const Root = embedded ? "div" : "main";
  return (
    <Root className="wi-root" data-embedded={embedded ? "" : undefined}>
      <InkSheet embedded={embedded} />
    </Root>
  );
}
