"use client";

const GLYPHS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function RollingNumber({ text, className = "" }) {
  const chars = Array.from(text);
  return (
    <span className={`lsc-roll ${className}`} aria-hidden="true">
      {chars.map((char, index) => {
        const order = chars.length - 1 - index;
        if (!/\d/.test(char)) {
          return (
            <span key={`${char}-${index}`} className="lsc-roll__fixed">
              {char}
            </span>
          );
        }
        return (
          <span key={`d-${index}`} className="lsc-roll__cell">
            <span className="lsc-roll__sizer">{char}</span>
            <span className="lsc-roll__strip" style={{ "--digit": Number(char), "--order": order }}>
              {GLYPHS.map((glyph) => (
                <span key={glyph} className="lsc-roll__glyph">
                  {glyph}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
