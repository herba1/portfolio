"use client";

function ReelDigit({ digit }) {
  return (
    <span className="rotary__reel">
      <span
        className="rotary__reel-strip"
        style={{ transform: `translateY(${-digit}em)` }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="rotary__reel-digit">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function RotaryOdometer({ value }) {
  const digits = String(value).padStart(3, "0").split("");

  return (
    <span className="rotary__odometer-wrap">
      <span className="rotary__odometer" aria-hidden="true">
        {digits.map((char, index) => (
          <ReelDigit key={digits.length - index} digit={Number(char)} />
        ))}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
