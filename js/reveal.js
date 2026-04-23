/* js/reveal.js — Carrusel alternado (avanza SIEMPRE) + commit móvil-friendly
   DOWN:  TOP=current, BOTTOM=next(current)  -> baja para revelar bottom
   UP:    TOP=next(current), BOTTOM=current  -> sube para revelar top
   Commit en release usando clientY (posición real), y por delta desde reposo.
*/

(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    reveal: $("reveal"),
    canvas: $("canvas"),
    topImg: $("topImg"),
    bottomImg: $("bottomImg"),
    slider: $("slider"),
    handle: $("handle"),
    hint: $("hint"),
    edgeFade: $("edgeFade"),
    progress: $("progress")
  };

  let config = {
    images: [],
    startIndex: 0,
    cycle: true,

    initialSepDown: 25,
    initialSepUp: 75,

    clampMinPercent: 3,
    clampMaxPercent: 97,

    commitThresholdPct: 90,
    commitDeltaPct: 16,
    commitCooldownMs: 450,

    maxCanvasWidth: 100,
    maxCanvasHeight: 100
  };

  let currentIndex = 0;
  let phase = "down";
  let lockUntil = 0;

  let currentSep = 25;
  let targetSep = 25;

  let isDragging = false;
  let rafId = null;
  let canvasRect = null;

  const EASE_DRAG = 0.45;
  const EASE_IDLE = 0.18;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  const next = (i) => (i + 1) % config.images.length;

  async function fetchJson(path) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function loadConfigMerged() {
    const base = await fetchJson("config/default.json");
    if (base) config = { ...config, ...base };

    const override = await fetchJson("config.json");
    if (override) config = { ...config, ...override };
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  function updateCanvasRect() {
    canvasRect = el.canvas.getBoundingClientRect();
  }

  function clientYToSep(clientY) {
    if (!canvasRect) updateCanvasRect();
    const y = clientY - canvasRect.top;
    const p = (y / canvasRect.height) * 100;
    return clamp(p, config.clampMinPercent, config.clampMaxPercent);
  }

  function getRestSep() {
    const v = (phase === "down") ? config.initialSepDown : config.initialSepUp;
    return clamp(Number(v), config.clampMinPercent, config.clampMaxPercent);
  }

  function getPair() {
    const cur = config.images[currentIndex];
    const nxt = config.images[next(currentIndex)];
    return (phase === "down")
      ? { top: cur, bottom: nxt }
      : { top: nxt, bottom: cur };
  }

  function applySep(v) {
    currentSep = clamp(v, config.clampMinPercent, config.clampMaxPercent);
    el.reveal.style.setProperty("--sep", currentSep + "%");
  }

  function ensureRAF() {
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  function tick() {
    rafId = null;
    const ease = isDragging ? EASE_DRAG : EASE_IDLE;

    currentSep += (targetSep - currentSep) * ease;
    if (Math.abs(targetSep - currentSep) < 0.02) currentSep = targetSep;

    applySep(currentSep);

    if (isDragging || Math.abs(targetSep - currentSep) > 0.02) {
      rafId = requestAnimationFrame(tick);
    }
  }

  async function layoutCanvasToImage(urlForRatio) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = vw * (Number(config.maxCanvasWidth) / 100);
    const maxH = vh * (Number(config.maxCanvasHeight) / 100);

    const img = new Image();
    img.src = urlForRatio;

    await new Promise((resolve) => {
      if (img.complete && img.naturalWidth) return resolve();
      img.onload = resolve;
      img.onerror = resolve;
    });

    const aspect = (img.naturalWidth && img.naturalHeight)
      ? (img.naturalWidth / img.naturalHeight)
      : (16 / 9);

    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }

    el.canvas.style.width = `${Math.round(w)}px`;
    el.canvas.style.height = `${Math.round(h)}px`;
    updateCanvasRect();
  }

  function updateProgress() {
    if (!el.progress) return;
    const n = config.images.length;
    if (n <= 1) { el.progress.innerHTML = ""; return; }

    if (el.progress.childElementCount !== n) {
      el.progress.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const d = document.createElement("div");
        d.className = "reveal__dot";
        el.progress.appendChild(d);
      }
    }

    // activo = imagen “principal” que estás usando como base (currentIndex)
    [...el.progress.children].forEach((d, i) => {
      d.classList.toggle("is-active", i === currentIndex);
    });
  }

  function updateHint() {
    if (!el.hint) return;
    el.hint.classList.toggle("is-up", phase === "up");
  }

  async function renderPair() {
    const { top, bottom } = getPair();
    await Promise.all([preloadImage(top), preloadImage(bottom)]);

    el.topImg.src = top;
    el.bottomImg.src = bottom;

    el.reveal.style.setProperty("--bg-image", `url("${bottom}")`);

    await layoutCanvasToImage(bottom);
    updateProgress();
    updateHint();
  }

  function canCommit() {
    return now() >= lockUntil;
  }

  function lockCommit() {
    lockUntil = now() + Number(config.commitCooldownMs ?? 450);
  }

  // Commit por delta desde reposo (más fiable en móvil) + fallback por borde
  function shouldCommit(sepAtRelease) {
    const rest = getRestSep();
    const delta = Number(config.commitDeltaPct ?? 16);
    const t = Number(config.commitThresholdPct ?? 90);

    if (phase === "down") {
      const movedEnough = sepAtRelease >= (rest + delta);
      const nearBottom = sepAtRelease >= t;
      return movedEnough || nearBottom;
    } else {
      const movedEnough = sepAtRelease <= (rest - delta);
      const nearTop = sepAtRelease <= (100 - t);
      return movedEnough || nearTop;
    }
  }

  async function commitAdvance() {
    if (!canCommit()) return;
    lockCommit();

    currentIndex = next(currentIndex);
    phase = (phase === "down") ? "up" : "down";

    await renderPair();

    targetSep = getRestSep();
    ensureRAF();
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();

    isDragging = true;
    el.reveal.classList.add("is-dragging");

    updateCanvasRect();
    try { el.reveal.setPointerCapture(e.pointerId); } catch {}

    targetSep = clientYToSep(e.clientY);
    ensureRAF();
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    targetSep = clientYToSep(e.clientY);
    ensureRAF();
  }

  async function onPointerUp(e) {
    if (!isDragging) return;
    e.preventDefault();

    isDragging = false;
    el.reveal.classList.remove("is-dragging");
    try { el.reveal.releasePointerCapture(e.pointerId); } catch {}

    const sepAtRelease = clientYToSep(e.clientY);

    currentSep = sepAtRelease;
    targetSep = sepAtRelease;
    applySep(currentSep);

    if (shouldCommit(sepAtRelease)) {
      await commitAdvance();
    } else {
      targetSep = getRestSep();
      ensureRAF();
    }
  }

  function bind() {
    el.handle.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.slider.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    window.addEventListener("resize", () => renderPair());
    el.reveal.addEventListener("dragstart", (ev) => ev.preventDefault());
  }

  async function init() {
    el.reveal.classList.add("is-loading");

    await loadConfigMerged();

    if (!Array.isArray(config.images) || config.images.length < 2) {
      console.error("Necesitas config.images con al menos 2 imágenes.");
      el.reveal.classList.remove("is-loading");
      return;
    }

    currentIndex = clamp(Number(config.startIndex ?? 0), 0, config.images.length - 1);
    phase = "down";

    currentSep = getRestSep();
    targetSep = currentSep;
    applySep(currentSep);

    await renderPair();

    requestAnimationFrame(() => {
      el.reveal.classList.remove("is-loading");
    });

    bind();
    ensureRAF();
  }

  init();
})();