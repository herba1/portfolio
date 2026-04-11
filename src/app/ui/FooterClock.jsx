"use client";

import { useEffect, useState, useRef } from "react";
import { geist } from "@/app/fonts";

function getEST() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
}

function formatTime(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return {
    hours: h,
    minutes: m,
    display: `${h12}:${String(m).padStart(2, "0")} ${ampm}`,
    digits: `${h12}:${String(m).padStart(2, "0")} ${ampm}`.split(""),
  };
}

function AnimatedDigit({ char, index }) {
  const [current, setCurrent] = useState(char);
  const [prev, setPrev] = useState(null);
  const keyRef = useRef(0);

  useEffect(() => {
    if (char !== current) {
      setPrev(current);
      setCurrent(char);
      keyRef.current++;
    }
  }, [char]);

  return (
    <span
      className="clock-digit-wrap"
      style={{ "--digit-i": index }}
    >
      {prev !== null && prev !== current && (
        <span key={`out-${keyRef.current}`} className="clock-digit clock-digit--out">
          {prev}
        </span>
      )}
      <span key={`in-${keyRef.current}`} className="clock-digit clock-digit--in">
        {current}
      </span>
    </span>
  );
}

function ClockIcon({ hours, minutes }) {
  // Hour hand: 360° / 12h = 30° per hour + 0.5° per minute
  const hourAngle = (hours % 12) * 30 + minutes * 0.5;
  // Minute hand: 360° / 60m = 6° per minute
  const minuteAngle = minutes * 6;

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 22 22"
      fill="none"
      className="clock-icon"
      style={{ opacity: 0.85 }}
    >
      <circle
        cx="11"
        cy="11"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="clock-face"
      />
      {/* Hour hand */}
      <line
        x1="11"
        y1="11"
        x2="11"
        y2="6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="clock-hand"
        transform={`rotate(${hourAngle}, 11, 11)`}
      />
      {/* Minute hand */}
      <line
        x1="11"
        y1="11"
        x2="11"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="clock-hand"
        transform={`rotate(${minuteAngle}, 11, 11)`}
      />
    </svg>
  );
}

export default function FooterClock() {
  const [time, setTime] = useState(null);

  useEffect(() => {
    const tick = () => setTime(formatTime(getEST()));
    // Initial render on client
    tick();
    // Sync to the next minute boundary
    const now = getEST();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    let interval;
    const firstTick = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(firstTick);
      clearInterval(interval);
    };
  }, []);

  if (!time) return null;

  return (
    <div className={`footer-clock tracking-body-base text-white text-sm ${geist.className}`}>
      <span className="footer-clock__location">New York, NY</span>
      <span className="footer-clock__sep">/</span>
      <ClockIcon hours={time.hours} minutes={time.minutes} />
      <span className="footer-clock__time">
        {time.digits.map((ch, i) => (
          <AnimatedDigit key={i} char={ch} index={i} />
        ))}
      </span>
    </div>
  );
}
