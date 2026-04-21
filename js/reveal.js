/* js/reveal.js
   - Two images (top/bottom) in a CANVAS that matches contain-rect => slider aligns to image edges.
   - Preload both images => no flash of bottom.
   - Smooth drag (pointer events + rAF).
   - Dynamic hint with smooth crossfade: down <-> up based on separator position.
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
  };

  const DEFAULTS = {
    images: ["images/top.jpg", "images/bottom.jpg"],

    overlayOpacity: 1,
    edgeFade: true,
    fadeSize: 44,

    // Separator inside canvas: 25 => top visible ~75%
    initialSepPercent: 25,

    // Keep handle away from canvas edges a bit (pro feel)
    clampMinPercent: 3,
    clampMaxPercent: 97,

    // Background blur
    bgBlur: 24,
    bgDim: 0.38,
    bgSat: 1.10,

    // Hint dynamics with hysteresis
    hintDownThreshold: 58, // if sep > 58% => suggest "up"
    hintUpThreshold: 42,   // if sep < 42% => suggest "down"
    hintAutoHideMs: 2800,

    // How big should the image appear on screen (contain)
    maxCanvasWidth:  100,  // percent of viewport width
    maxCanvasHeight: 100   // percent of viewport height
  };

  let config = { ...DEFAULTS };

  // rAF state
  let rafId = null;
  let isDragging = false;

  // sep is % from top inside canvas
  let currentSep = 25;
  let targetSep = 25;

  const EASE_WHILE_DRAG = 0.45;
  const EASE_WHEN_IDLE  = 0.18;

  // hint
  let hintMode = "down"; // "down" | "up"
  let hintHideTimer = null;
  let hasInteracted = false;

  // cache canvas rect for pointer mapping
  let canvasRect = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

  function applyConfigToCSS() {
    // background blur params
    el.reveal.style.setProperty("--bg-blur", (config.bgBlur ?? 24) + "px");
    el.reveal.style.setProperty("--bg-dim", String(config.bgDim ?? 0.38));
    el.reveal.style.setProperty("--bg-sat", String(config.bgSat ?? 1.10));

    // edge fade
    el.reveal.style.setProperty("--fade-size", (config.fadeSize ?? 44) + "px");
    el.edgeFade.style.opacity = config.edgeFade ? "0.95" : "0";

    // opacity for top
    el.topImg.style.opacity = String(
      (typeof config.overlayOpacity === "number") ? config.overlayOpacity : 1
    );
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = url;
    });
  }

  function setHintMode(mode) {
    if (hintMode === mode) return;
    hintMode = mode;
    el.hint.classList.toggle("is-up", mode === "up");
  }

  function updateHintBySep(sep) {
    // hysteresis prevents flicker
    if (hintMode === "down" && sep > config.hintDownThreshold) setHintMode("up");
    else if (hintMode === "up" && sep < config.hintUpThreshold) setHintMode("down");
  }

  function showHint() {
    el.hint.classList.remove("is-hidden");
    if (hasInteracted) el.hint.classList.add("is-subtle");
  }

  function scheduleHintHide() {
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(() => {
      el.hint.classList.add("is-hidden");
    }, config.hintAutoHideMs);
  }

  function pulseHandle() {
    el.handle.classList.remove("is-pulsing");
    void el.handle.offsetWidth;
    el.handle.classList.add("is-pulsing");
    setTimeout(() => el.handle.classList.remove("is-pulsing"), 240);
  }

  function updateCanvasRect() {
    canvasRect = el.canvas.getBoundingClientRect();
  }

  function applySep(p) {
    currentSep = clamp(p, config.clampMinPercent, config.clampMaxPercent);
    el.reveal.style.setProperty("--sep", currentSep + "%");
  }

  function ensureRAF() {
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  function tick() {
    rafId = null;

    const ease = isDragging ? EASE_WHILE_DRAG : EASE_WHEN_IDLE;
    currentSep += (targetSep - currentSep) * ease;

    if (Math.abs(targetSep - currentSep) < 0.02) currentSep = targetSep;

    applySep(currentSep);
    updateHintBySep(currentSep);

    if (isDragging || Math.abs(targetSep - currentSep) >= 0.02) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function clientYToSep(clientY) {
    if (!canvasRect) updateCanvasRect();
    const y = clientY - canvasRect.top;
    const raw = (y / canvasRect.height) * 100;
    return clamp(raw, config.clampMinPercent, config.clampMaxPercent);
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();

    isDragging = true;
    el.reveal.classList.add("is-dragging");

    hasInteracted = true;
    showHint();
    pulseHandle();
    clearTimeout(hintHideTimer);

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

  function onPointerUp(e) {
    if (!isDragging) return;
    e.preventDefault();

    isDragging = false;
    el.reveal.classList.remove("is-dragging");

    try { el.reveal.releasePointerCapture(e.pointerId); } catch {}

    scheduleHintHide();
    ensureRAF();
  }

  function bindEvents() {
    // drag from handle, slider, or whole canvas for friendliness
    el.handle.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.slider.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    window.addEventListener("resize", () => {
      layoutCanvasToImage();
      updateCanvasRect();
    });

    el.reveal.addEventListener("dragstart", (ev) => ev.preventDefault());
  }

  function layoutCanvasToImage() {
    // We compute a canvas size that fits the viewport (contain) with the image aspect ratio.
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const maxW = vw * (config.maxCanvasWidth / 100);
    const maxH = vh * (config.maxCanvasHeight / 100);

    // use bottom image natural size (usually same ratio as top)
    const iw = el.bottomImg.naturalWidth || 1;
    const ih = el.bottomImg.naturalHeight || 1;
    const aspect = iw / ih;

    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }

    el.canvas.style.width = `${Math.round(w)}px`;
    el.canvas.style.height = `${Math.round(h)}px`;
  }

  async function init() {
    await loadConfigMerged();
    applyConfigToCSS();

    // start loading hidden
    el.reveal.classList.add("is-loading");

    const [topSrc, bottomSrc] = Array.isArray(config.images) ? config.images : DEFAULTS.images;

    // preload both
    const [topPre, bottomPre] = await Promise.all([
      preloadImage(topSrc),
      preloadImage(bottomSrc),
    ]);

    // apply src only after both done => no flash
    el.topImg.src = topSrc;
    el.bottomImg.src = bottomSrc;

    // set blur background from bottom
    el.reveal.style.setProperty("--bg-image", `url("${bottomSrc}")`);

    // make canvas match real visible contain rect
    layoutCanvasToImage();
    updateCanvasRect();

    // initial sep
    const initSep = Number(config.initialSepPercent ?? 25);
    currentSep = clamp(initSep, config.clampMinPercent, config.clampMaxPercent);
    targetSep = currentSep;
    applySep(currentSep);
    updateHintBySep(currentSep);

    // show
    requestAnimationFrame(() => {
      el.reveal.classList.remove("is-loading");
      showHint();
      scheduleHintHide();
    });

    bindEvents();
    ensureRAF();
  }

  init();
})();