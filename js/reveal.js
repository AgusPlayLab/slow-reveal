/* js/reveal.js
   Vertical reveal fullscreen (touch + mouse) con rAF + easing.
   Carga config/default.json y luego config.json (override).
   Añade fondo blur usando la imagen inferior para evitar bandas con contain.
*/

(() => {
  const el = {
    container: document.getElementById("reveal"),
    topImg: document.getElementById("topImg"),
    bottomImg: document.getElementById("bottomImg"),
    slider: document.getElementById("slider"),
    handle: document.getElementById("handle"),
    hint: document.getElementById("hint"),
    edgeFade: document.getElementById("edgeFade"),
  };

  const DEFAULTS = {
    images: ["images/top.jpg", "images/bottom.jpg"], // [top, bottom]
    fitMode: "contain",               // ✅ no recorta
    objectPosition: "center center",
    overlayOpacity: 1,
    edgeFade: true,
    fadeSize: 36,
    initialSepPercent: 25,            // ~75% top visible
    // Blur background tuning (opcional)
    bgBlur: 24,
    bgDim: 0.35,
    bgSat: 1.15,
  };

  let config = { ...DEFAULTS };

  let rect = null;
  let isDragging = false;
  let rafId = null;

  // --sep = posición del separador desde arriba (0..100)
  let currentSep = config.initialSepPercent;
  let targetSep = currentSep;

  const EASE_WHILE_DRAG = 0.35;
  const EASE_WHEN_IDLE  = 0.18;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function updateRect() {
    rect = el.container.getBoundingClientRect();
  }

  function clientYToSep(clientY) {
    if (!rect) updateRect();
    const y = clientY - rect.top;
    return clamp((y / rect.height) * 100, 0, 100);
  }

  function applySep(p) {
    currentSep = clamp(p, 0, 100);
    el.container.style.setProperty("--sep", currentSep + "%");
  }

  function applyVisualConfig() {
    el.container.style.setProperty("--fit-mode", config.fitMode || "contain");
    el.container.style.setProperty("--object-position", config.objectPosition || "center center");
    el.container.style.setProperty("--fade-size", (config.fadeSize ?? 36) + "px");

    // Fondo blur tuning
    el.container.style.setProperty("--bg-blur", (config.bgBlur ?? 24) + "px");
    el.container.style.setProperty("--bg-dim", String(config.bgDim ?? 0.35));
    el.container.style.setProperty("--bg-sat", String(config.bgSat ?? 1.15));

    // Opacidad del top
    el.topImg.style.opacity = String(
      (typeof config.overlayOpacity === "number") ? config.overlayOpacity : 1
    );

    // Edge fade on/off
    el.edgeFade.style.opacity = config.edgeFade ? "0.95" : "0";
  }

  function setImagesFromConfig() {
    const list = Array.isArray(config.images) ? config.images : null;
    const topSrc = (list && list[0]) || config.topImage || el.topImg.src;
    const bottomSrc = (list && list[1]) || config.bottomImage || el.bottomImg.src;

    if (topSrc) el.topImg.src = topSrc;
    if (bottomSrc) el.bottomImg.src = bottomSrc;

    // ✅ Fondo blur usa la imagen inferior (normalmente la “after”)
    if (bottomSrc) {
      el.container.style.setProperty("--bg-image", `url("${bottomSrc}")`);
    }
  }

  function readInitialSep() {
    const v = (config.initialSepPercent ?? config.initialClipPercent ?? 25);
    currentSep = clamp(Number(v), 0, 100);
    targetSep = currentSep;
    applySep(currentSep);
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

    if (isDragging || Math.abs(targetSep - currentSep) >= 0.02) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function hideHintOnce() {
    if (!el.hint) return;
    el.hint.classList.add("is-hidden");
  }

  function pulseHandle() {
    el.handle.classList.remove("is-pulsing");
    void el.handle.offsetWidth; // restart anim
    el.handle.classList.add("is-pulsing");
    setTimeout(() => el.handle.classList.remove("is-pulsing"), 240);
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();

    updateRect();
    isDragging = true;
    el.container.classList.add("is-dragging");
    hideHintOnce();
    pulseHandle();

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

    ensureRAF();
  }

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
    // Base
    const base = await fetchJson("config/default.json");
    if (base) config = { ...config, ...base };

    // Override (opcional)
    const override = await fetchJson("config.json");
    if (override) config = { ...config, ...override };
  }

  function bindEvents() {
    el.handle.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.slider.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.container.addEventListener("pointerdown", onPointerDown, { passive: false });

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    window.addEventListener("resize", updateRect);
    el.container.addEventListener("dragstart", (ev) => ev.preventDefault());
  }

  async function init() {
    updateRect();
    await loadConfigMerged();
    applyVisualConfig();
    setImagesFromConfig();
    readInitialSep();
    bindEvents();
    ensureRAF();
  }

  init();
})();