"use client";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function RollingNumber({ value, size = "sm", tone }) {
  const chars = String(value).split("");
  const last = chars.length - 1;
  return (
    <span className="iet-roll" data-size={size} data-tone={tone || undefined} aria-label={String(value)}>
      {chars.map((char, index) => {
        const fromRight = last - index;
        const digit = DIGITS.indexOf(char);
        if (digit < 0) {
          return (
            <span key={`sep-${fromRight}-${char}`} className="iet-roll-static" aria-hidden="true">
              {char}
            </span>
          );
        }
        return (
          <span key={`slot-${fromRight}`} className="iet-roll-slot" aria-hidden="true">
            <span
              className="iet-roll-strip"
              style={{
                transform: `translateY(calc(${-digit} * var(--iet-roll-h)))`,
                transitionDelay: `${Math.min(fromRight, 8) * 26}ms`,
                transitionDuration: `calc(var(--duration-reveal) + ${Math.min(fromRight, 8) * 18}ms)`,
              }}
            >
              {DIGITS.map((d) => (
                <span key={d} className="iet-roll-digit">
                  {d}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
