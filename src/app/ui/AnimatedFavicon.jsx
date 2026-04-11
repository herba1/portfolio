"use client";

import { useEffect, useRef } from "react";

// Frames spell "herbart" (herb.art) — 32x32 pixel art letters, rounded corners, white bg.
// Inlined as data URIs to avoid network requests per frame.
const FRAMES = [
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA3klEQVR42u2XwQrDIAyGE+nBY3rz/V/Oo3rzpLtM2aqDRTRu0EChLdj/I/2TKOac4RLNi8mBrw9KWLzRUMLijZbaIP4GoTaJVwjFXXGe51QCNoD3Hrz3+wBmBwsAEfcCbM/ACk8cowtLNRRxIgIAgJQShBAYhciIZ8/IRFTve5cx5utvHqNp7wyxatIY41oPOOc+ZZPti/+pgpJeIqqGu/vADfCzAByjTgUYmQlsAK311N0SG8BaK++BFRsR1jjuDR5RAMZoH/oFuLENoOodGKXEryZEafFeFaCkOADAAxLhoITJTpIwAAAAAElFTkSuQmCC", // h
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABMklEQVR42tVXsbKEIAxMmGuoJKWl//9RdloS/QBzzemcykBQTt7LTMY5QTbI7uZEEYFDnG4UDvz+YR4GP2GYh8FPWKYC+K4IUwl8K8JA5cguABGjyczlC2BmICIgouTcruugbVt1AS/txOPOnHPBMWYG59x2TbNAEdM0yYesW3rvt/Hj2JqaQAlY4XcQ0W6HsemIGNrgdQ4cSZVaTER0r/2OCqrLMBV938M4jrsjLKKCkBJiR6F9JkrCEKku+W2EO/+XA957EBFVFuNAarE/oYKiBTjndkTUqmBZFmDmLS+rINeK15jnGZqmqaMCIlKDq7uh9z7aDe90xOQR3DEmzdKvXO2nvH0YBrDWlv9HtKoi1W6ttVktOesIfuUDWBEfTeiD8Snwow/g0+AhI8InwQEA3tCcY2Q7WkJUAAAAAElFTkSuQmCC", // e
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAm0lEQVR42u2XQQ6AIAwEdxsfAP//ZH9QTxoFDqhN8dDeIIGZdAkEmhma6iaci9eBBMM7hgTDO5YsgN8kZBH8lBCvnVQVJEHy0bpt+ug2G5vZY9ioXneg1urSuekOlFKgqreWH/OfLgUb3ESzMRxRLInAA/5ZwKNSIAVSIAVSIAVSYEPw+//LCLiQTxl9GKPgbQSMho/OACPhALADYl4lRC23hW4AAAAASUVORK5CYII=", // r
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7ElEQVR42u1XQRKDMAgEPhC8+f8PRj8gPcVBY6aYidB2yowHDXFX3AVFEYFTVBcGB+oTcgavMMgZvMKiAPADCQoC30kQBMctAogIiBhHILwCfwIAAOu6xhLYtu0gSH1M03S/L8vFMGg5wBI5Z2BmHwJ6q1433rJfhCJSgbTIDCeQc+5a+w0bvistM+8CtL4GE4Fir5TSLYUPI7AsC1jzSq7VCd+lAf2EHzmMHmvFZ0W3tpS8xzphaTT6y0gPo55mRJayFn8zM8zz3KxMj0XNw8hiSzcCo12AgfhIVz+MXuBnEaI3+JUL0BMcAOAFeNtf6nCjlisAAAAASUVORK5CYII=", // b
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABFUlEQVR42sVXyw6EIAxsiR/QHv3/D6whHjzZvWyMj255LEITDiJmhrYzIKoq3OIx0Tjw/BA6gz8wQmfwB1YYAH4hEQaBHyQCDI5iAohoDmauIjDlLJrnGbZtc9fEGA8SIlJQhESIiBKRfnsla4iI5gaq4UT3lFd1l+o7PaCq5ihKey6B8+6JyN1V6n2zDJSo5W8V1OzoFRn+ilrtVxHY9x1ijJe5ZVn6ETgbTXcrZmYXXEQOOTbPgNXNLZszjAQv8gEiqna7ZjIkoiKVdHXCdV2rVOKehrk9wMyuJ3h9k7TiO4mUx1vf/FUCVXVrb52GJUpJXki8srSQ5PTWTaekBAjjAoP1w9gL/N6E2BvcUgH2BAcA+ACGGuOEAWCOYQAAAABJRU5ErkJggg==", // a
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAoElEQVR42u2XUQrEIAxEJ6EHiPe/pHgA7dfarrpQa4j7kYFCK5T3cAIilVLQpFtQDt0/2BjeMdgY3rF4A/xLgjfBq8ShNll0zdZgsH+GZwCfJ4TQrb0Nv/kppVQlVvO4AhFBjBEAkHOu7yKyVl2ZKGy01TN9q1WgBV8W0IgLuIALuIALuIALHNbn/19WQBv5xKMLoxW8rYCs4aMZIEs4AJyjHyiAa4qqYAAAAABJRU5ErkJggg==", // r
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnElEQVR42u2XwQ7AIAhDKdn//zK7bRM4GCEQM7nhpVVfMUJESJVZSC58Gy4WNxpcLG60uEF8MMFN4o8Jpua6QjjjBdpJ01S1n8B+BgAMR9/GgDah+1km9rsCETG789ZKYuiZOzE8Bv5nYDV+IQOZo/gw0G4AskiRx0H7KF6BkyPxi0Yw5TXMmAPoZJC9D2OVuGYA1eIehKgUJyK6AfHSNDQ5XnbFAAAAAElFTkSuQmCC", // t
];

const FRAME_MS = 300;
const PAUSE_MS = 2000;

export default function AnimatedFavicon() {
  const indexRef = useRef(0);

  useEffect(() => {
    // Remove all existing favicon links to avoid conflicts with Next.js auto-generated ones
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((el) => el.remove());

    // Create our own
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href = FRAMES[0];
    document.head.appendChild(link);

    let timeout;
    function step() {
      if (document.visibilityState === "hidden") {
        timeout = setTimeout(step, 500);
        return;
      }
      const i = indexRef.current % FRAMES.length;
      link.href = FRAMES[i];
      indexRef.current++;
      timeout = setTimeout(step, i === 0 && indexRef.current > 1 ? PAUSE_MS : FRAME_MS);
    }

    // Start after a short delay to let Next.js finish injecting its favicon
    timeout = setTimeout(step, 100);

    const onVisChange = () => {
      if (document.visibilityState === "visible" && !timeout) {
        step();
      }
    };
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, []);

  return null;
}
