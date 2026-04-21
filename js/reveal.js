/* js/reveal.js
   - 2 images: bottom always visible, top revealed via clip-path.
   - Fullscreen, contain (no crop) + blurred background from bottom image.
   - No "flash" while loading: preload both, then fade-in.
   - Smooth drag with rAF + easing (touch + mouse via pointer events).
   - Hint text cross-fades: "down" vs "up" depending on position, with gentle behavior.
   - Config merge: config/default.json (base) + config.json (override if exists).
*/

(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    container: $("reveal"),
    topImg: $("topImg"),
    bottomImg: $("bottomImg"),
    slider: $("slider"),
    handle: $("handle"),
    hint: $("hint"),
    edgeFade: $("edgeFade"),
    veil: $("veil"),
  };

  const DEFAULTS = {
    images: ["images/top.jpg", "images/bottom.jpg"], // [top, bottom]
    fitMode: "contain",                 // show full image
    objectPosition: "center center",
    overlayOpacity: 1,

    edgeFade: true,
    fadeSize: 44,

    // separator from top: 25 => top visible ~75%
    initialSepPercent: 25,

    // Keep handle away from system UI
    clampMinPercent: 4,
    clampMaxPercent: 96,

    // Blur background tuning
    bgBlur: 24,
    bgDim: 0.38,
    bgSat: 1.10,

    // Hint behavior thresholds with hysteresis
    hintDownThreshold: 55, // when sep > 55 => suggest "up"
    hintUpThreshold: 45,   // when sep < 45 => suggest "down"
    hintAutoHideMs: 2600   // after interaction ends
  };

  let config = { ...DEFAULTS };

  // State
  let rect = null;
  let isDragging = false;
  let rafId = null;

  // --sep: separator position from top (0..100)
  let currentSep = config.initialSepPercent;
  let targetSep = currentSep;

  // Easing
  const EASE_WHILE_DRAG = 0.42; // very responsive
  const EASE_WHEN_IDLE  = 0.18; // gentle ease after release

  // Hint state
  let hintMode = "down"; // "down" or "up"
  let hintHideTimer = null;
  let hasInteracted = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function updateRect() {
    rect = el.container.getBoundingClientRect();
  }

  function clientYToSep(clientY) {
    if (!rect) updateRect();
    const y = clientY - rect.top;
    const raw = (y / rect.height) * 100;
    return clamp(raw, config.clampMinPercent, config.clampMaxPercent);
  }

  function applySep(p) {
    currentSep = clamp(p, config.clampMinPercent, config.clampMaxPercent);
    el.container.style.setProperty("--sep", currentSep + "%");
  }

  function applyVisualConfig() {
    el.container.style.setProperty("--fit-mode", config.fitMode || "contain");
    el.container.style.setProperty("--object-position", config.objectPosition || "center center");
    el.container.style.setProperty("--fade-size", (config.fadeSize ?? 44) + "px");

    // Blur tuning
    el.container.style.setProperty("--bg-blur", (config.bgBlur ?? 24) + "px");
    el.container.style.setProperty("--bg-dim", String(config.bgDim ?? 0.38));
    el.container.style.setProperty("--bg-sat", String(config.bgSat ?? 1.10));

    // Top opacity
    el.topImg.style.opacity = String(
      (typeof config.overlayOpacity === "number") ? config.overlayOpacity : 1
    );

    // Edge fade toggle
    el.edgeFade.style.opacity = config.edgeFade ? "0.95" : "0";
  }

  function setBlurBackground(bottomSrc) {
    if (bottomSrc) {
      el.container.style.setProperty("--bg-image", `url("${bottomSrc}")`);
    }
  }

  // --- Hint behavior ---
  function setHintMode(mode) {
    if (!el.hint) return;
    if (hintMode === mode) return;
    hintMode = mode;
    el.hint.classList.toggle("is-up", mode === "up");
  }

  function updateHintBySep(sep) {
    // Hysteresis so it doesn't flicker around one boundary
    if (hintMode === "down" && sep > config.hintDownThreshold) setHintMode("up");
    else if (hintMode === "up" && sep < config.hintUpThreshold) setHintMode("down");
  }

  function showHintSubtle() {
    if (!el.hint) return;
    el.hint.classList.remove("is-hidden");
    if (hasInteracted) el.hint.classList.add("is-subtle");
  }

  function scheduleHintHide() {
    if (!el.hint) return;
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(() => {
      el.hint.classList.add("is-hidden");
    }, config.hintAutoHideMs);
  }

  function pulseHandle() {
    el.handle.classList.remove("is-pulsing");
    void el.handle.offsetWidth; // restart animation
    el.handle.classList.add("is-pulsing");
    setTimeout(() => el.handle.classList.remove("is-pulsing"), 240);
  }

  // --- Animation loop ---
  function ensureRAF() {
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  function tick() {
    rafId = null;

    const ease = isDragging ? EASE_WHILE_DRAG : EASE_WHEN_IDLE;
    currentSep += (targetSep - currentSep) * ease;

    // snap
    if (Math.abs(targetSep - currentSep) < 0.02) currentSep = targetSep;

    applySep(currentSep);
    updateHintBySep(currentSep);

    if (isDragging || Math.abs(targetSep - currentSep) >= 0.02) {
      rafId = requestAnimationFrame(tick);
    }
  }

  // --- Pointer events ---
  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();

    updateRect();
    isDragging = true;
    el.container.classList.add("is-dragging");

    // Hint: show and become subtle after first interaction
    if (!hasInteracted) hasInteracted = true;
    showHintSubtle();
    pulseHandle();

    clearTimeout(hintHideTimer);

    try { el.container.setPointerCapture(e.pointerId); } catch (_) {}
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
    el.container.classList.remove("is-dragging");

    try { el.container.releasePointerCapture(e.pointerId); } catch (_) {}

    // Hide hint after a bit
    scheduleHintHide();
    ensureRAF();
  }

  function bindEvents() {
    // Drag anywhere: handle, slider, or the whole container
    el.handle.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.slider.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.container.addEventListener("pointerdown", onPointerDown, { passive: false });

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    window.addEventListener("resize", updateRect);
    el.container.addEventListener("dragstart", (ev) => ev.preventDefault());
  }

  // --- Config loading (merge base + override) ---
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

  // --- Preload to avoid flashes ---
  function preloadImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(false);
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function preloadAndApplyImages() {
    const list = Array.isArray(config.images) ? config.images : null;
    const topSrc = (list && list[0]) || config.topImage || "images/top.jpg";
    const bottomSrc = (list && list[1]) || config.bottomImage || "images/bottom.jpg";

    // Preload both
    await Promise.all([preloadImage(topSrc), preloadImage(bottomSrc)]);

    // Apply sources only after preload
    el.topImg.src = topSrc;
    el.bottomImg.src = bottomSrc;

    // Blur background from bottom
    setBlurBackground(bottomSrc);
  }

  function applyInitialSep() {
    const v = Number(config.initialSepPercent ?? config.initialClipPercent ?? 25);
    currentSep = clamp(v, config.clampMinPercent, config.clampMaxPercent);
    targetSep = currentSep;
    applySep(currentSep);
    updateHintBySep(currentSep);
  }

  async function init() {
    updateRect();
    await loadConfigMerged();

    // Apply config visuals first (so loading state looks right)
    applyVisualConfig();

    // Start loading: keep hidden
    el.container.classList.add("is-loading");

    // Preload, then show
    await preloadAndApplyImages();
    applyInitialSep();

    // Reveal UI after a tiny delay for smoother paint
    requestAnimationFrame(() => {
      el.container.classList.remove("is-loading");
      showHintSubtle();
      scheduleHintHide();
    });

    bindEvents();
    ensureRAF();
  }

  init();
})();