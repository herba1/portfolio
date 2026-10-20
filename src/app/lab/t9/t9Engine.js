import { createT9Sound } from "./t9Audio";
import { candidates, digitsOf, keyFor, lettersFor, PUNCT } from "./t9Dict";
import { createLcdGL } from "./t9GL";
import { charWidth, drawText, measure } from "./pixelFont";

const COLS = 96;
const ROWS = 65;
const TEXT_X = 8;
const TEXT_W = 80;
const LINE_Y = [12, 22, 32, 42];
const COMMIT = 900;
const IDLE = 14000;

const MESSAGES = [
  { to: "jude", text: "hey. still up? i keep your voice on the walk home." },
  { to: "mum", text: "here comes the sun. look outside x" },
  { to: "sam", text: "it will take a while to feel like this again. call me when you land?" },
];

const ICONS = {
  antenna: ["#.#.#", ".###.", "..#..", "..#..", "..#..", "..#.."],
  battery: [".##.", "####", "#..#", "####", "####", "####", "####"],
  pen: [".....##", "....#.#", "...#.#.", "..#.#..", ".#.#...", "##.....", "#......"],
  envelope: ["#############", "##.........##", "#.#.......#.#", "#..#.....#..#", "#...#...#...#", "#....#.#....#", "#.....#.....#", "#...........#", "#############"],
  tick: ["........#", ".......##", "#.....##.", "##...##..", ".##.##...", "..###....", "...#....."],
};

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createT9(stage, { embedded = false, caption = null, input = null, onLive = () => {}, onFail = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "t9-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "A phone screen typing a text message");
  const canvas = document.createElement("canvas");
  canvas.className = "t9-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createLcdGL(canvas, COLS, ROWS);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const rand = seeded(310);
  const tgt = new Uint8Array(COLS * ROWS);
  const cur = new Float32Array(COLS * ROWS);
  const out = new Uint8Array(COLS * ROWS);
  let sound = null;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let gestured = false;

  let screen = "editor";
  let mode = "abc";
  let text = "";
  let pending = null;
  let pendingAt = 0;
  let compose = null;
  let softDown = false;
  let menuSel = 0;
  let recipient = "";
  let phaseAt = 0;
  let lastKeyAt = 0;
  let keyCount = 0;
  let owner = "attract";
  let msgIndex = 0;
  let queue = [];
  let queueEnd = 0;
  let userAt = -Infinity;
  let signal = 4;
  let signalAt = 3000;

  const pendingChars = (key) => (key === "1" ? PUNCT : [...lettersFor(key), key]);

  const commitPending = () => {
    if (!pending) return;
    text += pendingChars(pending.key)[pending.idx];
    pending = null;
  };

  const composeWord = () => {
    if (!compose) return "";
    const list = candidates(compose.digits);
    return list[compose.alt % list.length];
  };

  const commitCompose = () => {
    if (!compose) return;
    text += composeWord();
    compose = null;
  };

  const press = (k) => {
    keyCount += 1;
    sound?.key(keyCount);
    lastKeyAt = clock;
    if (screen !== "editor") return;
    if (k >= "2" && k <= "9") {
      if (mode === "abc") {
        if (pending && pending.key === k) pending.idx = (pending.idx + 1) % pendingChars(k).length;
        else {
          commitPending();
          pending = { key: k, idx: 0 };
        }
        pendingAt = clock;
      } else {
        commitPending();
        compose = compose ? { digits: compose.digits + k, alt: 0 } : { digits: k, alt: 0 };
      }
    } else if (k === "1") {
      commitCompose();
      if (pending && pending.key === "1") pending.idx = (pending.idx + 1) % PUNCT.length;
      else {
        commitPending();
        pending = { key: "1", idx: 0 };
      }
      pendingAt = clock;
    } else if (k === "*") {
      if (compose) compose.alt += 1;
      else if (pending && pending.key === "1") {
        pending.idx = (pending.idx + 1) % PUNCT.length;
        pendingAt = clock;
      }
    } else if (k === "0") {
      commitCompose();
      commitPending();
      text += " ";
    } else if (k === "#") {
      commitCompose();
      commitPending();
      mode = mode === "abc" ? "t9" : "abc";
    } else if (k === "C") {
      if (pending) pending = null;
      else if (compose) {
        const d = compose.digits.slice(0, -1);
        compose = d ? { digits: d, alt: 0 } : null;
      } else text = text.slice(0, -1);
    }
  };

  const at = (delay, fn) => {
    queueEnd = Math.max(queueEnd, clock) + delay;
    queue.push({ at: queueEnd, fn });
  };

  const jitter = (base, spread) => base + (rand() - 0.5) * 2 * spread;

  const typeAbc = (word, fast) => {
    let prevKey = null;
    for (const ch of word) {
      const key = keyFor(ch);
      if (!key) continue;
      const idx = lettersFor(key).indexOf(ch);
      if (prevKey === key) at(fast ? COMMIT + 40 : COMMIT + 140, () => {});
      for (let i = 0; i <= idx; i += 1) {
        const gap = i === 0 ? (fast ? 80 : jitter(250, 50)) : fast ? 70 : jitter(140, 25);
        at(gap, () => press(key));
      }
      prevKey = key;
    }
    return prevKey;
  };

  const typePunct = (ch, fast) => {
    const idx = PUNCT.indexOf(ch);
    for (let i = 0; i <= idx; i += 1) at(i === 0 ? (fast ? 90 : jitter(260, 40)) : fast ? 70 : jitter(170, 30), () => press("1"));
  };

  const typeT9 = (word) => {
    const digits = digitsOf(word);
    const list = candidates(digits);
    const alt = list.indexOf(word);
    if (alt < 0) {
      at(jitter(260, 40), () => press("#"));
      typeAbc(word, false);
      at(COMMIT + 120, () => press("#"));
      return;
    }
    for (const d of digits) at(jitter(170, 40), () => press(d));
    for (let i = 0; i < alt; i += 1) at(i === 0 ? 520 : 460, () => press("*"));
  };

  const scriptMessage = (msg) => {
    const tokens = msg.text.match(/[a-z]+|[^a-z ]| /g) || [];
    let first = true;
    let scriptMode = "abc";
    tokens.forEach((tok) => {
      if (tok === " ") at(jitter(210, 40), () => press("0"));
      else if (/^[a-z]+$/.test(tok)) {
        if (first) {
          typeAbc(tok, false);
          first = false;
        } else {
          if (scriptMode === "abc") {
            at(jitter(420, 40), () => press("#"));
            scriptMode = "t9";
          }
          typeT9(tok);
        }
      } else typePunct(tok, false);
    });
  };

  const scheduleSend = (to, lead = 1100) => {
    at(lead, () => {
      softDown = true;
      sound?.key(7);
    });
    at(170, () => {
      softDown = false;
      commitCompose();
      commitPending();
      screen = "menu";
      menuSel = 0;
    });
    at(650, () => {
      softDown = true;
      sound?.key(3);
    });
    at(150, () => {
      softDown = false;
      screen = "number";
      recipient = "";
      phaseAt = clock;
    });
    [...to].forEach((ch, i) => at(i === 0 ? 300 : 120, () => {
      recipient += ch;
      sound?.key(i + 11);
    }));
    at(520, () => {
      softDown = true;
      sound?.key(5);
    });
    at(150, () => {
      softDown = false;
      screen = "sending";
      phaseAt = clock;
      onLive(`Sending message to ${to}`);
    });
    at(2100, () => {
      screen = "sent";
      phaseAt = clock;
      sound?.sent();
      onLive("Message sent");
    });
    at(1700, () => {
      screen = "editor";
      text = "";
      pending = null;
      compose = null;
      mode = "abc";
      owner = "attract";
    });
  };

  const scheduleAttract = () => {
    const msg = MESSAGES[msgIndex % MESSAGES.length];
    msgIndex += 1;
    owner = "attract";
    at(700, () => {
      mode = "abc";
      onLive(msg.text);
    });
    scriptMessage(msg);
    at(COMMIT + 200, () => {
      commitPending();
      commitCompose();
    });
    scheduleSend(msg.to);
    at(10, () => scheduleAttract());
  };

  const gesture = () => {
    if (gestured) return;
    gestured = true;
    onGesture();
  };

  const takeOver = () => {
    userAt = clock;
    if (owner === "user") return;
    owner = "user";
    queue = [];
    queueEnd = clock;
    softDown = false;
    if (screen !== "editor") {
      screen = "editor";
      text = "";
    }
    pending = null;
    compose = null;
    const n = text.length;
    for (let i = 0; i < n; i += 1) at(28, () => {
      text = text.slice(0, -1);
    });
    if (n) at(0, () => sound?.key(9));
    at(60, () => {
      mode = "abc";
    });
  };

  const userChar = (raw) => {
    const ch = raw.toLowerCase();
    if (ch === " ") {
      takeOver();
      at(90, () => press("0"));
      return true;
    }
    if (keyFor(ch)) {
      takeOver();
      const lastKey = queue.length ? queue[queue.length - 1].key : pending?.key;
      const key = keyFor(ch);
      const idx = lettersFor(key).indexOf(ch);
      if (lastKey === key) at(COMMIT + 40, () => {});
      for (let i = 0; i <= idx; i += 1) {
        at(i === 0 ? 70 : 70, () => press(key));
        queue[queue.length - 1].key = key;
      }
      return true;
    }
    if (ch >= "0" && ch <= "9") {
      takeOver();
      const key = ch === "0" || ch === "1" ? null : ch;
      if (key) {
        const n = lettersFor(key).length;
        for (let i = 0; i <= n; i += 1) at(70, () => press(key));
        at(COMMIT + 40, () => {});
      }
      return true;
    }
    if (PUNCT.includes(ch)) {
      takeOver();
      typePunct(ch, true);
      queue[queue.length - 1].key = "1";
      return true;
    }
    return false;
  };

  const userBack = () => {
    takeOver();
    at(60, () => press("C"));
  };

  const userSend = () => {
    takeOver();
    at(0, () => {
      commitPending();
      commitCompose();
    });
    if (!text.trim() && !pending && !compose && queue.length < 2) return;
    scheduleSend("herb", 900);
    at(10, () => {
      owner = "attract";
      scheduleAttract();
    });
  };

  const plot = (x, y, v = 255) => {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
    tgt[y * COLS + x] = v;
  };
  const clearPx = (x, y) => plot(x, y, 0);
  const fillRect = (x, y, w, h, v = 255) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) plot(xx, yy, v);
  };
  const icon = (name, x, y) => {
    ICONS[name].forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx += 1) if (row[xx] === "#") plot(x + xx, y + yy);
    });
  };
  const textAt = (x, y, s, bold = false) => drawText(plot, x, y, s, bold);
  const centered = (y, s, bold = false) => textAt(Math.round((COLS - measure(s, bold)) / 2), y, s, bold);

  const drawStatus = () => {
    icon("antenna", 0, 0);
    for (let i = 0; i < 5; i += 1) {
      if (i < signal) fillRect(0, 46 - i * 4, 1 + Math.floor(i / 2) + 1, 2);
    }
    icon("battery", 92, 0);
    for (let i = 0; i < 5; i += 1) {
      const w = 1 + Math.floor(i / 2) + 1;
      fillRect(96 - w, 46 - i * 4, w, 2);
    }
  };

  const softkey = (label) => {
    const w = measure(label);
    const x = Math.round((COLS - w) / 2);
    if (softDown) {
      fillRect(x - 3, 55, w + 6, 10);
      drawText(clearPx, x, 56, label);
    } else textAt(x, 56, label);
  };

  const layoutText = () => {
    const chars = [];
    for (const ch of text) chars.push({ ch, kind: 0 });
    if (compose) for (const ch of composeWord()) chars.push({ ch, kind: 1 });
    if (pending) chars.push({ ch: pendingChars(pending.key)[pending.idx], kind: 2 });
    const lines = [[]];
    let width = 0;
    let i = 0;
    const adv = (c) => (c.ch === " " ? 4 : charWidth(c.ch) + 1);
    while (i < chars.length) {
      if (chars[i].ch === " ") {
        lines[lines.length - 1].push(chars[i]);
        width += 4;
        i += 1;
        continue;
      }
      let j = i;
      let ww = 0;
      while (j < chars.length && chars[j].ch !== " ") {
        ww += adv(chars[j]);
        j += 1;
      }
      if (width + ww - 1 > TEXT_W && width > 0) {
        lines.push([]);
        width = 0;
      }
      for (let k = i; k < j; k += 1) {
        const a = adv(chars[k]);
        if (width + a - 1 > TEXT_W && width > 0) {
          lines.push([]);
          width = 0;
        }
        lines[lines.length - 1].push(chars[k]);
        width += a;
      }
      i = j;
    }
    return lines;
  };

  const drawEditor = () => {
    icon("pen", TEXT_X, 1);
    textAt(TEXT_X + 9, 1, mode === "abc" ? "abc" : "T9", mode !== "abc");
    const used = text.length + (compose ? composeWord().length : 0) + (pending ? 1 : 0);
    const count = String(160 - used);
    textAt(TEXT_X + TEXT_W - measure(count), 1, count);
    const lines = layoutText();
    const start = Math.max(0, lines.length - LINE_Y.length);
    let cursor = null;
    lines.slice(start).forEach((line, li) => {
      const y = LINE_Y[li];
      let x = TEXT_X;
      line.forEach((c) => {
        if (c.ch === " ") {
          if (c.kind === 1) fillRect(x - 1, y + 9, 5, 1);
          x += 4;
          return;
        }
        const w = charWidth(c.ch);
        if (c.kind === 2) {
          fillRect(x - 1, y - 1, w + 2, 10);
          drawText(clearPx, x, y, c.ch);
        } else {
          textAt(x, y, c.ch);
          if (c.kind === 1) fillRect(x - 1, y + 9, w + 2, 1);
        }
        x += w + 1;
      });
      cursor = { x, y };
    });
    if (!cursor) cursor = { x: TEXT_X, y: LINE_Y[0] };
    const lastLine = lines[lines.length - 1];
    if (lastLine && lastLine.length === 0 && lines.length > 1) cursor = { x: TEXT_X, y: LINE_Y[Math.min(LINE_Y.length - 1, lines.length - 1 - start)] };
    if (!pending) {
      const solid = clock - lastKeyAt < 500 || compose;
      if (solid || Math.floor((clock - lastKeyAt) / 520) % 2 === 1) fillRect(cursor.x, cursor.y - 1, 1, 10);
    }
    softkey("Options");
  };

  const drawMenu = () => {
    centered(1, "Options", true);
    ["Send", "Save message", "Insert word", "Clear text"].forEach((item, i) => {
      const y = 13 + i * 10;
      if (i === menuSel) {
        fillRect(TEXT_X - 2, y - 1, TEXT_W + 3, 10);
        drawText(clearPx, TEXT_X, y, item);
      } else textAt(TEXT_X, y, item);
    });
    softkey("Select");
  };

  const drawNumber = () => {
    textAt(TEXT_X, 13, "Send to:");
    textAt(TEXT_X, 25, recipient);
    const w = measure(recipient);
    if (Math.floor((clock - phaseAt) / 520) % 2 === 0 || recipient) fillRect(TEXT_X + w + (recipient ? 1 : 0), 24, 1, 10);
    fillRect(TEXT_X, 35, TEXT_W, 1);
    softkey("OK");
  };

  const drawSending = () => {
    const t = (clock - phaseAt) / 1000;
    const loop = (t % 0.9) / 0.9;
    const x = Math.round(14 + loop * 54);
    icon("envelope", x, 14);
    for (let i = 0; i < 3; i += 1) {
      const len = 3 + i * 2;
      fillRect(x - 3 - len, 16 + i * 2, len, 1);
    }
    centered(35, "Sending");
    centered(45, "message");
  };

  const drawSent = () => {
    icon("tick", 43, 15);
    centered(35, "Message");
    centered(45, "sent");
  };

  const renderTarget = () => {
    tgt.fill(0);
    drawStatus();
    if (screen === "editor") drawEditor();
    else if (screen === "menu") drawMenu();
    else if (screen === "number") drawNumber();
    else if (screen === "sending") drawSending();
    else drawSent();
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const dtMs = Math.min(100, Math.max(1, now - last));
    last = now;
    clock += dtMs;
    while (queue.length && queue[0].at <= clock) {
      const q = queue.shift();
      q.fn();
    }
    if (!queue.length) queueEnd = clock;
    if (pending && clock - pendingAt > COMMIT && !queue.some((q) => q.at - clock < 30 && q.key === pending.key)) {
      commitPending();
      lastKeyAt = clock;
    }
    if (owner === "user" && clock - userAt > IDLE && !queue.length && screen === "editor") {
      owner = "attract";
      const n = text.length;
      for (let i = 0; i < n; i += 1) at(28, () => {
        text = text.slice(0, -1);
      });
      at(200, () => {
        pending = null;
        compose = null;
        mode = "abc";
      });
      scheduleAttract();
    }
    if (clock > signalAt) {
      signal = signal === 4 ? 5 : signal === 5 ? 4 : 4;
      signalAt = clock + 2600 + rand() * 4000;
    }
    renderTarget();
    const dt = dtMs / 1000;
    const kOn = 1 - Math.exp(-dt / 0.05);
    const kOff = 1 - Math.exp(-dt / 0.14);
    for (let i = 0; i < cur.length; i += 1) {
      const target = tgt[i] / 255;
      cur[i] += (target - cur[i]) * (target > cur[i] ? kOn : kOff);
      out[i] = Math.round(cur[i] * 255);
    }
    gl.render(out, { dpr, radius: 10 * dpr, glow: 1 });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = narrow ? 16 : 32;
    const bottom = narrow ? 56 : 64;
    if (caption) {
      caption.style.left = `${side}px`;
      caption.style.width = `${sr.width - side * 2}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 24) : side;
    const availW = sr.width - side * 2;
    const availH = Math.max(160, sr.height - top - (caption ? bottom : side));
    const aspect = (COLS + 6) / (ROWS + 6);
    let w = Math.min(availW, availH * aspect, 820);
    w = Math.round(w);
    const h = Math.round(w / aspect);
    const left = Math.round((sr.width - w) / 2);
    const y = narrow ? top + 8 : Math.round(top + Math.max(0, (availH - h) * 0.3));
    if (caption && !narrow) {
      caption.style.left = `${left}px`;
      caption.style.width = `${w}px`;
    }
    root.style.left = `${left}px`;
    root.style.top = `${y}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.resize(Math.round(w * dpr), Math.round(h * dpr));
  };

  const editable = (t) => t && t !== root && t !== document.body && t !== input && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable);

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target === input || editable(e.target)) return;
    if (handleKey(e.key)) e.preventDefault();
  };

  const handleKey = (k) => {
    if (k === "Backspace") {
      gesture();
      userBack();
      return true;
    }
    if (k === "Enter") {
      gesture();
      userSend();
      return true;
    }
    if (k.length === 1 && userChar(k)) {
      gesture();
      return true;
    }
    return false;
  };

  const onInput = (e) => {
    const data = e.data ?? "";
    if (e.inputType === "deleteContentBackward") handleKey("Backspace");
    else for (const ch of data) handleKey(ch);
    input.value = " ";
  };

  const onInputKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleKey("Enter");
    } else if (e.key === "Backspace" && input.value.length <= 1) {
      e.preventDefault();
      handleKey("Backspace");
    }
  };

  const onDown = () => {
    gesture();
    if (input) {
      input.value = " ";
      input.focus({ preventScroll: true });
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  layout(true);
  scheduleAttract();
  renderTarget();
  for (let i = 0; i < cur.length; i += 1) cur[i] = tgt[i] / 255;
  ready = true;
  root.dataset.ready = "";
  wake();

  return {
    async setSound(on) {
      if (on && !sound) sound = createT9Sound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      sleep();
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      keyTarget.removeEventListener("keydown", onKey);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("keydown", onInputKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
