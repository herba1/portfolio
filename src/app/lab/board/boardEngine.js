import { albumById } from "@/app/lab/_music/catalog";

import { createBoardAudio } from "./boardAudio";

const ITEMS = [
  { kind: "cover", id: "abbey-road" },
  { kind: "type", tone: "black", album: "abbey-road", lines: ["Big things", "come together"], play: true },
  { kind: "cover", id: "revolver" },
  { kind: "type", tone: "grey", album: "rubber-soul", lines: ["with the right", "record"] },
  { kind: "cover", id: "rubber-soul" },
  { kind: "cover", id: "let-it-be" },
  { kind: "type", tone: "search", album: "abbey-road", query: "here comes the su" },
  { kind: "cover", id: "sgt-pepper" },
  { kind: "type", tone: "red", album: "help", lines: ["at max.", "width"], play: true },
  { kind: "cover", id: "help" },
  { kind: "cover", id: "white-album" },
  { kind: "type", tone: "grey", album: "a-hard-days-night", lines: ["at the", "right time"] },
  { kind: "cover", id: "a-hard-days-night" },
  { kind: "type", tone: "pill", album: "let-it-be", text: "saved to Sunday records" },
  { kind: "cover", id: "magical-mystery-tour" },
  { kind: "type", tone: "black", album: "revolver", lines: ["Introducing", "side two"], red: 1, play: true },
  { kind: "cover", id: "with-the-beatles" },
  { kind: "cover", id: "beatles-for-sale" },
  { kind: "type", tone: "grey", album: "white-album", lines: ["one long", "night of it"] },
  { kind: "cover", id: "please-please-me" },
];

const TONE_BG = { black: [0, 0, 0], red: [184, 0, 31], grey: [255, 255, 255], search: [255, 255, 255], pill: [255, 255, 255], cover: [255, 255, 255] };
const STIFF = 170;
const DAMP = 2 * Math.sqrt(STIFF);
const STAGGER = 0.32;

const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.2" stroke="currentColor" stroke-width="2.6" fill="none"/><path d="M14.6 14.6 20 20" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const TRI = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1v8l7-4z" fill="currentColor"/></svg>';
const BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M9.8 3.5 5.3 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => {
  const x = clamp01(v);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const lerp = (a, b, k) => a + (b - a) * k;

const tracking = (size) => {
  const px = -0.043 * (size - 12);
  return size < 20 ? `${px.toFixed(2)}px` : `${(px / size).toFixed(4)}em`;
};

function el(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

function setT(node, value) {
  if (node._t === value) return;
  node._t = value;
  node.style.transform = value;
}

function setO(node, value) {
  const v = value <= 0.002 ? 0 : value >= 0.998 ? 1 : Number(value.toFixed(3));
  if (node._o === v) return;
  node._o = v;
  node.style.opacity = String(v);
}

export function createBoard(root, { frame, embedded, onSound, onReady }) {
  let destroyed = false;
  let W = 0;
  let H = 0;
  let cols = 4;
  let raf = 0;
  let visible = true;
  let audio = null;
  let soundOn = false;
  let family = "sans-serif";

  let p = 0;
  let v = 0;
  let target = 0;
  let lastTime = 0;
  let active = null;
  let pushed = false;
  let geometry = null;
  let settledAt = 0;

  const scroller = el("div", "board-scroll", frame);
  scroller.setAttribute("data-scroll-contain", "");
  const content = el("div", "board-content", scroller);

  const cards = ITEMS.map((item, index) => {
    const albumId = item.kind === "cover" ? item.id : item.album;
    const album = albumById(albumId);
    const btn = el("button", `board-card board-card--${item.kind === "cover" ? "cover" : item.tone}`, content);
    btn.type = "button";
    btn.dataset.index = String(index);
    let media = null;
    let caption = null;
    if (item.kind === "cover") {
      btn.setAttribute("aria-label", `${album.title}, ${album.year}`);
      media = el("span", "board-media", btn);
      const img = el("img", "", media);
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.src = album.cover;
      el("span", "board-shade", media);
      el("span", "board-save", media, "Save");
      caption = el("span", "board-cap", btn);
      el("span", "board-cap-title", caption, album.title);
      el("span", "board-cap-meta", caption, `${album.year}`);
    } else {
      btn.setAttribute("aria-label", `Open ${album.title}`);
      media = el("span", "board-type", btn);
      if (item.tone === "search") {
        const bar = el("span", "board-search", media);
        const icon = el("span", "board-search-icon", bar);
        icon.innerHTML = SEARCH_ICON;
        el("span", "board-search-text", bar, item.query);
        el("span", "board-search-caret", bar);
      } else if (item.tone === "pill") {
        const pill = el("span", "board-pill", media);
        el("span", "board-pill-dot", pill);
        el("span", "", pill, item.text);
      } else {
        item.lines.forEach((ln, i) => el("span", `board-type-line${item.red === i ? " board-type-line--red" : ""}`, media, ln));
        if (item.play) {
          const tri = el("span", "board-tri", media);
          tri.innerHTML = TRI;
        }
      }
    }
    return { item, album, btn, media, caption, x: 0, y: 0, w: 0, h: 0 };
  });

  const sheet = el("div", "board-sheet", frame);
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-hidden", "true");
  const sheetGhost = el("div", "board-ghost", sheet);
  const sheetCover = el("div", "board-sheet-cover", sheet);
  const sheetImg = el("img", "", sheetCover);
  sheetImg.alt = "";
  sheetImg.decoding = "async";
  const sheetText = el("div", "board-sheet-text", sheet);
  const sheetTitle = el("h2", "board-sheet-title", sheetText);
  const sheetMeta = el("p", "board-sheet-meta", sheetText);
  const sheetList = el("ol", "board-sheet-list", sheetText);
  const sheetActions = el("div", "board-sheet-actions", sheetText);
  const saveBtn = el("button", "board-sheet-save", sheetActions, "Save");
  saveBtn.type = "button";
  const backBtn = el("button", "board-back", sheet);
  backBtn.type = "button";
  backBtn.innerHTML = `${BACK}<span>Back</span>`;
  backBtn.setAttribute("aria-label", "Back to the board");

  const measureCanvas = document.createElement("canvas").getContext("2d");
  const textWidth = (text, size) => {
    measureCanvas.font = `700 ${size}px ${family}`;
    return measureCanvas.measureText(text).width * (1 + (-0.043 * (size - 12)) / size / 1.9);
  };

  const fitTitle = (title, maxW, maxH) => {
    const words = title.split(" ");
    let size = Math.min(maxH, 160);
    for (; size > 18; size -= 2) {
      if (Math.max(...words.map((w) => textWidth(w, size))) > maxW) continue;
      let linesCount = 1;
      let lineW = 0;
      const space = textWidth(" ", size);
      for (const w of words) {
        const ww = textWidth(w, size);
        if (lineW && lineW + space + ww > maxW) {
          linesCount += 1;
          lineW = ww;
        } else lineW += (lineW ? space : 0) + ww;
      }
      if (linesCount * size * 0.92 <= maxH) break;
    }
    return size;
  };

  const layoutBoard = () => {
    const rect = frame.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    if (!W || !H) return;
    cols = W >= 1040 ? 5 : W >= 760 ? 4 : W >= 500 ? 3 : 2;
    const pad = W < 500 ? 12 : 20;
    const gap = W < 500 ? 8 : 16;
    const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    root.style.setProperty("--board-col", `${cw.toFixed(2)}px`);
    const heights = new Array(cols).fill(pad);
    cards.forEach((c) => {
      c.btn.style.width = `${cw}px`;
    });
    cards.forEach((c) => {
      const h = c.btn.offsetHeight;
      let col = 0;
      for (let i = 1; i < cols; i += 1) if (heights[i] < heights[col] - 1) col = i;
      c.x = pad + col * (cw + gap);
      c.y = heights[col];
      c.w = cw;
      c.h = h;
      c.mediaH = c.media.offsetHeight;
      c.btn.style.left = `${c.x.toFixed(2)}px`;
      c.btn.style.top = `${c.y.toFixed(2)}px`;
      heights[col] += h + gap;
    });
    content.style.height = `${Math.max(...heights) - gap + pad}px`;
  };

  const layoutSheet = () => {
    if (!active) return;
    const { album } = active;
    const portrait = W < 640 || W / H < 1.05;
    const pad = W < 500 ? 16 : 28;
    let S;
    let tx;
    let ty;
    let tw;
    if (portrait) {
      S = Math.min(W - pad * 2, H * 0.36);
      tx = pad;
      ty = pad + S + 20;
      tw = W - pad * 2;
    } else {
      S = Math.min(H - pad * 2, W * 0.46);
      tx = pad + S + Math.max(28, W * 0.035);
      ty = pad;
      tw = W - tx - pad - 72;
    }
    const coverRect = { x: pad, y: pad, w: S, h: S };
    sheetCover.style.left = `${coverRect.x}px`;
    sheetCover.style.top = `${coverRect.y}px`;
    sheetCover.style.width = `${S}px`;
    sheetCover.style.height = `${S}px`;
    sheetText.style.left = `${tx}px`;
    sheetText.style.top = `${ty}px`;
    sheetText.style.width = `${tw}px`;
    sheetText.style.height = `${H - ty - pad}px`;
    const titleMaxH = portrait ? Math.min(H * 0.2, 120) : H * 0.42;
    const size = fitTitle(album.title, tw, titleMaxH);
    sheetTitle.style.fontSize = `${size}px`;
    sheetTitle.style.letterSpacing = tracking(size);
    sheetTitle.style.lineHeight = `${Math.round((size * 0.92) / 4) * 4 || 4}px`;
    sheet.classList.toggle("board-sheet--portrait", portrait);
    geometry = { coverRect, S, portrait };
  };

  const fillSheet = (card) => {
    const { album, item } = card;
    sheetImg.src = album.cover;
    sheetImg.alt = `${album.title} cover`;
    sheetTitle.textContent = album.title;
    sheetMeta.textContent = `The Beatles · ${album.year} · ${album.tracks.length} songs`;
    sheetList.replaceChildren();
    album.tracks.forEach((track, i) => {
      const li = el("li", "board-track", sheetList);
      el("span", "board-track-n", li, String(i + 1).padStart(2, "0"));
      el("span", "board-track-t", li, track);
    });
    saveBtn.textContent = "Save";
    saveBtn.removeAttribute("data-saved");
    sheetGhost.replaceChildren();
    if (item.kind !== "cover") {
      const clone = card.media.cloneNode(true);
      clone.style.width = `${card.w}px`;
      clone.style.height = `${card.mediaH}px`;
      sheetGhost.appendChild(clone);
    }
  };

  const cardRect = (card) => {
    const fr = frame.getBoundingClientRect();
    const mr = card.media.getBoundingClientRect();
    return { x: mr.left - fr.left, y: mr.top - fr.top, w: mr.width, h: mr.height };
  };

  const prepPush = () => {
    const from = active.from;
    const cx = from.x + from.w / 2;
    const cy = from.y + from.h / 2;
    const scrollTop = scroller.scrollTop;
    let maxD = 1;
    const reach = Math.hypot(W, H) * 0.9;
    cards.forEach((c) => {
      if (c === active) return;
      const ix = c.x + c.w / 2;
      const iy = c.y - scrollTop + c.h / 2;
      let dx = ix - cx;
      let dy = (iy - cy) * 0.6;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) dx = 1;
      const len = Math.hypot(dx, dy) || 1;
      c.dx = (dx / len) * reach;
      c.dy = (dy / len) * reach;
      c.dist = Math.hypot(ix - cx, iy - cy);
      maxD = Math.max(maxD, c.dist);
      const onScreen = iy + c.h / 2 > -40 && iy - c.h / 2 < H + 40;
      c.onScreen = onScreen;
    });
    cards.forEach((c) => {
      if (c === active) return;
      c.delay = (c.dist / maxD) * STAGGER;
    });
  };

  const applyBg = (k) => {
    const from = TONE_BG[active.item.kind === "cover" ? "cover" : active.item.tone];
    const c = from.map((ch) => Math.round(lerp(ch, 255, k)));
    const value = `rgb(${c[0]} ${c[1]} ${c[2]})`;
    if (sheet._bg !== value) {
      sheet._bg = value;
      sheet.style.backgroundColor = value;
    }
  };

  const render = () => {
    if (!active) return;
    const from = active.from;
    const k = clamp01(p);
    const top = lerp(from.y, 0, k);
    const left = lerp(from.x, 0, k);
    const right = lerp(W - from.x - from.w, 0, k);
    const bottom = lerp(H - from.y - from.h, 0, k);
    const r = lerp(12, 0, k);
    const clip = `inset(${top.toFixed(2)}px ${right.toFixed(2)}px ${bottom.toFixed(2)}px ${left.toFixed(2)}px round ${r.toFixed(2)}px)`;
    if (sheet._c !== clip) {
      sheet._c = clip;
      sheet.style.clipPath = clip;
    }
    const isCover = active.item.kind === "cover";
    applyBg(isCover ? 1 : smooth(k / 0.5));
    const cr = geometry.coverRect;
    const s0 = from.w / cr.w;
    const coverK = k;
    const sc = lerp(s0, 1, coverK);
    const ox = lerp(from.x, cr.x, coverK) - cr.x;
    const oy = lerp(from.y + (isCover ? 0 : (from.h - from.w) / 2), cr.y, coverK) - cr.y;
    setT(sheetCover, `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0) scale(${sc.toFixed(5)})`);
    setO(sheetCover, isCover ? 1 : smooth(k / 0.45));
    setT(sheetGhost, `translate3d(${from.x.toFixed(2)}px,${from.y.toFixed(2)}px,0)`);
    setO(sheetGhost, isCover ? 0 : 1 - smooth(k / 0.3));
    const tk = smooth((k - 0.45) / 0.55);
    setO(sheetText, tk);
    setT(sheetText, `translate3d(0,${((1 - tk) * 24).toFixed(2)}px,0)`);
    setO(backBtn, smooth((k - 0.55) / 0.45));
    const capK = 1 - smooth(k / 0.2);
    if (active.caption) setO(active.caption, capK);
    setO(active.media, k > 0.001 ? 0 : 1);
    cards.forEach((c) => {
      if (c === active) return;
      if (!c.onScreen) {
        setO(c.btn, k > 0.02 ? 0 : 1);
        return;
      }
      const ck = smooth((k - c.delay) / (1 - STAGGER));
      setT(c.btn, ck > 0 ? `translate3d(${(c.dx * ck).toFixed(2)}px,${(c.dy * ck).toFixed(2)}px,0)` : "none");
    });
  };

  const resetCards = () => {
    cards.forEach((c) => {
      setT(c.btn, "none");
      setO(c.btn, 1);
      setO(c.media, 1);
      if (c.caption) setO(c.caption, 1);
    });
  };

  const frameLoop = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.033, lastTime ? (now - lastTime) / 1000 : 0.016);
    lastTime = now;
    const a = -STIFF * (p - target) - DAMP * v;
    v += a * dt;
    p += v * dt;
    if (target === 0 && p < 0) {
      p = 0;
      v = 0;
    }
    if (target === 1 && p > 1) {
      p = 1;
      v = 0;
    }
    const done = Math.abs(p - target) < 0.0008 && Math.abs(v) < 0.002;
    if (done) {
      p = target;
      v = 0;
    }
    render();
    if (done) {
      if (target === 0) finishClose();
      else if (settledAt !== 1) {
        settledAt = 1;
        audio?.play("settle");
      }
      lastTime = 0;
      return;
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frameLoop);
    else lastTime = 0;
  };

  const wake = () => {
    if (raf || destroyed || !visible || document.hidden) return;
    lastTime = 0;
    raf = requestAnimationFrame(frameLoop);
  };

  const finishClose = () => {
    const card = active;
    root.removeAttribute("data-open");
    sheet.setAttribute("aria-hidden", "true");
    sheet.style.visibility = "hidden";
    scroller.style.overflowY = "";
    resetCards();
    active = null;
    settledAt = 0;
    cards.forEach((c) => c.btn.removeAttribute("tabindex"));
    if (card && root.contains(document.activeElement) === false) return;
    card?.btn.focus({ preventScroll: true });
  };

  const open = (card) => {
    if (active && active !== card) return;
    if (!active) {
      active = card;
      active.from = cardRect(card);
      fillSheet(card);
      layoutSheet();
      prepPush();
      sheet._bg = null;
      sheet.style.visibility = "visible";
      sheet.setAttribute("aria-hidden", "false");
      sheet.setAttribute("aria-label", card.album.title);
      root.setAttribute("data-open", "");
      scroller.style.overflowY = "hidden";
      cards.forEach((c) => c.btn.setAttribute("tabindex", "-1"));
      if (!embedded) {
        try {
          history.pushState({ ...(history.state || {}), board: card.album.id }, "");
          pushed = true;
        } catch {
          pushed = false;
        }
      }
    }
    target = 1;
    settledAt = 0;
    audio?.play("open");
    wake();
    requestAnimationFrame(() => backBtn.focus({ preventScroll: true }));
  };

  const close = (fromHistory = false) => {
    if (!active || target === 0) return;
    target = 0;
    settledAt = 0;
    audio?.play("close");
    if (pushed && !fromHistory) {
      pushed = false;
      try {
        history.back();
      } catch {
        pushed = false;
      }
    } else if (fromHistory) pushed = false;
    wake();
  };

  const onCardClick = (e) => {
    const btn = e.target.closest(".board-card");
    if (!btn) return;
    const card = cards[Number(btn.dataset.index)];
    if (active === card && target === 0) {
      target = 1;
      audio?.play("open");
      if (!embedded) {
        try {
          history.pushState({ ...(history.state || {}), board: card.album.id }, "");
          pushed = true;
        } catch {
          pushed = false;
        }
      }
      wake();
      return;
    }
    open(card);
  };

  const onSheetClick = (e) => {
    if (target === 0 && active) {
      target = 1;
      audio?.play("open");
      if (!embedded) {
        try {
          history.pushState({ ...(history.state || {}), board: active.album.id }, "");
          pushed = true;
        } catch {
          pushed = false;
        }
      }
      wake();
      return;
    }
    if (e.target.closest(".board-back")) close();
    else if (e.target.closest(".board-sheet-save")) {
      const saved = saveBtn.toggleAttribute("data-saved");
      saveBtn.textContent = saved ? "Saved" : "Save";
      audio?.play("save");
    }
  };

  const onKey = (e) => {
    if (e.key === "Escape" && active && target === 1) {
      e.preventDefault();
      close();
    }
  };

  const onPop = () => {
    if (active && target === 1) close(true);
  };

  let lastHover = null;
  const onOver = (e) => {
    if (e.pointerType !== "mouse") return;
    const btn = e.target.closest?.(".board-card");
    if (!btn || btn === lastHover || active) return;
    lastHover = btn;
    const card = cards[Number(btn.dataset.index)];
    audio?.play("tick", ((card.x + card.w / 2) / W) * 1.2 - 0.6);
  };

  content.addEventListener("click", onCardClick);
  content.addEventListener("pointerover", onOver);
  sheet.addEventListener("click", onSheetClick);
  root.addEventListener("keydown", onKey);
  window.addEventListener("popstate", onPop);

  const relayout = () => {
    layoutBoard();
    if (active) {
      layoutSheet();
      active.from = { x: active.x, y: active.y - scroller.scrollTop, w: active.w, h: active.mediaH };
      prepPush();
      render();
    }
  };

  const ro = new ResizeObserver(() => {
    if (W === 0 && H === 0) return;
    relayout();
  });

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && active && p !== target) wake();
  });
  io.observe(root);
  const onVisibility = () => {
    if (!document.hidden && active && p !== target) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const boot = async () => {
    family = getComputedStyle(frame).fontFamily || "sans-serif";
    try {
      await document.fonts.load(`700 100px ${family}`);
      await document.fonts.ready;
    } catch {
      family = "sans-serif";
    }
    const imgs = [...frame.querySelectorAll("img")].filter((img) => img.src);
    await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    if (destroyed) return;
    layoutBoard();
    ro.observe(frame);
    root.setAttribute("data-ready", "");
    onReady?.();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !audio) audio = createBoardAudio();
      if (!audio) return false;
      const result = await audio.setEnabled(on);
      soundOn = Boolean(result);
      onSound?.(soundOn);
      return soundOn;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      content.removeEventListener("click", onCardClick);
      content.removeEventListener("pointerover", onOver);
      sheet.removeEventListener("click", onSheetClick);
      root.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      audio?.destroy();
      scroller.remove();
      sheet.remove();
    },
  };
}
