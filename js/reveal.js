/*
  Vertical reveal component extracted from index.html
  - Loads `config/default.json` (falls back to `config.json`)
  - Auto-detects image aspect and adjusts container
  - Keeps backward compatibility with current markup
*/
(function(){
  const container = document.getElementById('reveal');
  const topLayer = document.getElementById('topLayer');
  const topImg = topLayer.querySelector('img');
  const bottomImg = container.querySelector('.img-bottom');
  const slider = document.getElementById('slider');
  const handle = document.getElementById('handle');
  const hint = document.getElementById('hint');

  const defaultConfig = {
    // initialClipPercent: separator position from top (0 = top image fully visible)
    initialClipPercent: 0,
    autoAspect: true,
    defaultAspectRatio: '16/10',
    orientation: 'vertical'
  };
  defaultConfig.blendMode = 'normal';
  defaultConfig.overlayOpacity = 1;
  defaultConfig.fadeSize = 36;
  defaultConfig.objectPosition = 'center center';
  defaultConfig.objectPosition = 'center top';
  defaultConfig.fitMode = 'cover';
  defaultConfig.cycle = false;

  let config = Object.assign({}, defaultConfig);

  // Try loading config files in order: config/default.json -> config.json
  async function loadConfig(){
    const candidates = ['config/default.json','config.json'];
    for(const path of candidates){
      try {
        const res = await fetch(path, {cache:'no-cache'});
        if(res.ok){
          const json = await res.json();
          config = Object.assign({}, defaultConfig, json);
          return;
        }
      } catch(err){ /* try next */ }
    }
    // no external config found — keep defaults
  }

  // Load bottom image from data-src (returns a promise that resolves when loaded or errored)
  function loadBottomImage(){
    return new Promise(resolve=>{
      const src = bottomImg.getAttribute('src') || bottomImg.dataset.src;
      if(!src){ return resolve(); }
      // already loaded
      if(bottomImg.src && bottomImg.complete && bottomImg.naturalWidth){ return resolve(); }
      // set src if not present
      if(!bottomImg.src) bottomImg.src = bottomImg.dataset.src || src;
      function done(){ bottomImg.removeEventListener('load', onLoad); bottomImg.removeEventListener('error', onError); resolve(); }
      function onLoad(){ done(); }
      function onError(){ done(); }
      bottomImg.addEventListener('load', onLoad);
      bottomImg.addEventListener('error', onError);
    });
  }

  // --- Preload helpers and placeholder to avoid layout/jumps while loading ---
  const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const _preloads = new Map(); // url -> Promise<HTMLImageElement>

  function preloadImage(url){
    if(!url) return Promise.resolve(null);
    if(_preloads.has(url)) return _preloads.get(url);
    const p = new Promise(resolve=>{
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = ()=> resolve(img);
      img.src = url;
    });
    _preloads.set(url, p);
    return p;
  }

  function setBottomSrc(url){
    if(!url) return;
    try{ if(!bottomImg.style.transition) bottomImg.style.transition = 'opacity 220ms ease'; }catch(e){}
    bottomImg.style.opacity = 0;
    const onLoad = ()=>{
      bottomImg.removeEventListener('load', onLoad);
      // reveal at configured overlay opacity for top; bottom should be fully visible
      bottomImg.style.opacity = 1;
    };
    bottomImg.addEventListener('load', onLoad);
    bottomImg.src = url;
    // if image already cached and complete, call handler immediately
    try{ if(bottomImg.complete && bottomImg.naturalWidth) onLoad(); }catch(e){}
  }

  function setTopSrc(url){
    if(!url) return;
    try{ if(!topImg.style.transition) topImg.style.transition = 'opacity 220ms ease'; }catch(e){}
    topImg.style.opacity = 0;
    const onLoad = ()=>{
      topImg.removeEventListener('load', onLoad);
      // apply configured overlay opacity when top has loaded
      topImg.style.opacity = (typeof config.overlayOpacity === 'number') ? config.overlayOpacity : 1;
    };
    topImg.addEventListener('load', onLoad);
    topImg.src = url;
    // if image already cached and complete, call handler immediately
    try{ if(topImg.complete && topImg.naturalWidth) onLoad(); }catch(e){}
  }

  function clamp(n,a,b){ return Math.max(a, Math.min(b, Number(n) || 0)); }

  function ensureImageLoaded(img){
    return new Promise(resolve=>{
      if(img.complete && img.naturalWidth){ resolve(); }
      else {
        img.addEventListener('load', function onLoad(){ img.removeEventListener('load', onLoad); resolve(); });
        img.addEventListener('error', function onError(){ img.removeEventListener('error', onError); resolve(); });
      }
    });
  }

  // Core state
  let containerRect = null;
  let containerHeight = 0;
  let isDragging = false;
  let rafId = null;
  let clipPercent = defaultConfig.initialClipPercent;
  let targetClip = clipPercent;
  let lastY = 0; let lastTime = 0; let velocity = 0;
  let _savedObjectPosition = null;

  // image sequence state
  let imagesList = [];
  let currentIndex = 0; // index of image currently shown in the top layer
  function getIndex(i){ if(imagesList.length===0) return 0; return ((i % imagesList.length) + imagesList.length) % imagesList.length; }

  function loadImageToElement(url, el){ if(!el) return; try{ el.src = url; }catch(e){} }

  function advanceForward(){
    if(imagesList.length <= 1) return;
    // rotate forward: top becomes previous bottom, bottom becomes next
    const currentTop = imagesList[getIndex(currentIndex)];
    const currentBottom = imagesList[getIndex(currentIndex + 1)];
    currentIndex = getIndex(currentIndex + 1);
    // set new top to the image that was beneath (preload then swap)
    preloadImage(currentBottom).then(()=> setTopSrc(currentBottom));
    // preload and set next bottom
    const upcoming = imagesList[getIndex(currentIndex + 1)];
    preloadImage(upcoming).then(()=> setBottomSrc(upcoming));
  }

  function advanceBackward(){
    if(imagesList.length <= 1) return;
    const currentTop = imagesList[getIndex(currentIndex)];
    currentIndex = getIndex(currentIndex - 1);
    const newTop = imagesList[getIndex(currentIndex)];
    // set new top (preload to avoid flicker)
    preloadImage(newTop).then(()=> setTopSrc(newTop));
    // bottom becomes previous top
    preloadImage(currentTop).then(()=> setBottomSrc(currentTop));
  }

  function updateRect(){ containerRect = container.getBoundingClientRect(); containerHeight = containerRect.height || 1; }

  function applyClip(p){
    clipPercent = clamp(p, 0, 100);
    // expose slider position for CSS and UI
    container.style.setProperty('--sep', clipPercent + '%');
    handle.setAttribute('aria-valuenow', Math.round(100 - clipPercent));
  }

  function scheduleRender(){ if(rafId==null) rafId = requestAnimationFrame(render); }
  function render(){
    rafId = null;
    if(isDragging){
      // while dragging, follow pointer exactly for immediate response
      clipPercent = targetClip;
    } else {
      // smooth easing when not actively dragging
      clipPercent += (targetClip - clipPercent) * 0.22;
    }
    applyClip(clipPercent);
    // continue rendering while dragging or while easing still moving
    if(isDragging || Math.abs(targetClip - clipPercent) > 0.05) scheduleRender();
  }

  function clientYToPercent(clientY){ const y = clientY - containerRect.top; return clamp((y / containerHeight) * 100, 0, 100); }

  function onPointerDown(e){
    if(e.type === 'pointerdown' && e.button && e.button !== 0) return;
    e.preventDefault(); updateRect(); isDragging = true; container.classList.add('dragging'); handle.classList.add('active','vibrate');
    lastY = e.clientY; lastTime = performance.now(); velocity = 0; hint.classList.add('hidden');
    try{ container.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){}
    try{ (e.target||handle).setPointerCapture && (e.target||handle).setPointerCapture(e.pointerId) }catch(err){}
    // disable clip-path transition while dragging for immediate response
    try{ topImg.style.transition = 'opacity 160ms ease'; }catch(e){}
    // don't set bottomImg.src synchronously here — preloads are handled in applyConfig
    // no objectPosition changes; nothing to save
    targetClip = clientYToPercent(e.clientY); scheduleRender();
    window.addEventListener('pointermove', onPointerMove, {passive:false});
    window.addEventListener('pointerup', onPointerUp, {passive:false});
    setTimeout(()=>handle.classList.remove('vibrate'),220);
  }

  function onPointerMove(e){
    if(!isDragging) return; e.preventDefault(); updateRect();
    const now = performance.now(); const y = e.clientY; const dt = Math.max(1, now - lastTime);
    const dy = y - lastY;
    velocity = dy / dt; lastY = y; lastTime = now;

    // (no dynamic objectPosition changes) keep focus configured in CSS/config

    let raw = ((y - containerRect.top) / containerHeight) * 100;
    if(imagesList.length > 1 && config.cycle){
      // cycling enabled: allow overflow to advance images
      while(raw >= 100){ raw -= 100; advanceForward(); }
      while(raw < 0){ raw += 100; advanceBackward(); }
      targetClip = clamp(raw, 0, 100);
    } else {
      // no cycling: clamp to boundaries so the handle stays at 0..100
      targetClip = clamp(raw, 0, 100);
    }
    scheduleRender();
  }

  function onPointerUp(e){
    if(!isDragging) return; isDragging = false; container.classList.remove('dragging'); handle.classList.remove('active');
    try{ (e.target||handle).releasePointerCapture && (e.target||handle).releasePointerCapture(e.pointerId) }catch(err){}
    window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp);
    applyClip(targetClip);
    // nothing to restore for objectPosition (we keep it static)
    // restore clip-path transition so future programmatic easing looks smooth
    try{ topImg.style.transition = 'opacity 220ms ease, clip-path 120ms linear'; }catch(e){}
    const speedThreshold = 0.15;
    if(Math.abs(velocity) > speedThreshold){
      let projectedPx = velocity * 180; let projectedPercent = (projectedPx / containerHeight) * 100;
      let final = clamp(targetClip + projectedPercent, 0, 100); let start = null; const startVal = clipPercent; const dur = 420;
      function inertiaStep(ts){ if(!start) start = ts; const t = Math.min(1, (ts-start)/dur); const eased = 1 - Math.pow(1 - t, 3); const cur = startVal + (final - startVal) * eased; applyClip(cur); if(t<1) requestAnimationFrame(inertiaStep); }
      requestAnimationFrame(inertiaStep);
    }
  }

  function onContainerClick(e){ if(isDragging) return; updateRect(); targetClip = clientYToPercent(e.clientY); applyClip(targetClip); }

  function onHandleKey(e){ const step = 4; if(e.key==='ArrowDown'||e.key==='PageDown'){ targetClip = clamp(targetClip + step, 0, 100); applyClip(targetClip); e.preventDefault(); } else if(e.key==='ArrowUp'||e.key==='PageUp'){ targetClip = clamp(targetClip - step, 0, 100); applyClip(targetClip); e.preventDefault(); } }

  async function applyConfig(){
    if(Array.isArray(config.images) && config.images.length > 0){
      imagesList = config.images.slice();
    } else {
      imagesList = [];
      if(config.topImage) imagesList.push(config.topImage);
      if(config.bottomImage) imagesList.push(config.bottomImage);
    }

    currentIndex = getIndex(config.startIndex || 0);

    if(imagesList.length > 0) {
      const topUrl = imagesList[getIndex(currentIndex)];
      // keep placeholder in DOM until real image is loaded
      if(!topImg.src) topImg.src = TRANSPARENT_GIF;
      topImg.style.opacity = 0;
      preloadImage(topUrl).then(()=> setTopSrc(topUrl));
    }
    if(imagesList.length > 1) {
      const nextUrl = imagesList[getIndex(currentIndex + 1)];
      if(!bottomImg.src) bottomImg.src = TRANSPARENT_GIF;
      bottomImg.style.opacity = 0;
      preloadImage(nextUrl).then(()=> setBottomSrc(nextUrl));
    }
    try{ topImg.style.mixBlendMode = config.blendMode || 'normal'; }catch(e){}
    container.style.setProperty('--fade-size', (config.fadeSize || 36) + 'px');
    topImg.style.objectFit = config.fitMode || defaultConfig.fitMode || 'cover';
    bottomImg.style.objectFit = config.fitMode || defaultConfig.fitMode || 'cover';
    container.style.setProperty('--objectPosition', config.objectPosition || defaultConfig.objectPosition || 'center top');
    clipPercent = clamp(config.initialClipPercent ?? clipPercent, 0, 100);
    targetClip = clipPercent;
    // NOTE: avoid changing container aspect-ratio dynamically to prevent layout jumps while images load
    // also opportunistically preload neighbors to make cycling smooth
    if(imagesList.length > 0){
      const prev = imagesList[getIndex(currentIndex - 1)];
      const next = imagesList[getIndex(currentIndex + 1)];
      preloadImage(prev);
      preloadImage(next);
      // preload a couple more ahead (non-blocking)
      preloadImage(imagesList[getIndex(currentIndex + 2)]);
    }
    updateRect(); applyClip(clipPercent);
  }

  async function init(){ await loadConfig(); await applyConfig(); handle.addEventListener('pointerdown', onPointerDown, {passive:false}); slider.addEventListener('pointerdown', onPointerDown, {passive:false}); container.addEventListener('click', onContainerClick); handle.addEventListener('keydown', onHandleKey); window.addEventListener('resize', updateRect); container.style.touchAction = 'none'; }
  init();

  window.__slowReveal = { setPercent(p){ targetClip = clamp(p,0,100); applyClip(targetClip); }, getPercent(){ return clipPercent }, updateConfig(c){ config = Object.assign({}, config, c); applyConfig(); } };

  // --- Configuration UI logic (local controls, save/load) ---
  (function(){
    const savedKey = 'slowReveal.config';
    const cfgToggle = document.getElementById('configToggle');
    const cfgPanel = document.getElementById('configPanel');
    const blendSelect = document.getElementById('blendSelect');
    const opacityRange = document.getElementById('opacityRange');
    const opacityVal = document.getElementById('opacityVal');
    const fadeRange = document.getElementById('fadeRange');
    const fadeVal = document.getElementById('fadeVal');
    const fitModeSelect = document.getElementById('fitModeSelect');
    const objectPosSelect = document.getElementById('objectPosSelect');
    const cycleToggle = document.getElementById('cycleToggle');
    const clipRange = document.getElementById('clipRange');
    const clipVal = document.getElementById('clipVal');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const loadBtn = document.getElementById('loadBtn');
    const loadInput = document.getElementById('loadInput');

        function showPanel(show){
          // initialize transition once
          if(!cfgPanel._inited){
            try{ cfgPanel.style.transition = 'opacity 180ms ease, transform 180ms ease'; }catch(e){}
            cfgPanel._inited = true;
          }
          if(show){
            cfgPanel.hidden = false;
            cfgPanel.style.display = 'block';
            // slight slide/fade in
            cfgPanel.style.transform = 'translateY(-6px)';
            // force a frame then reveal
            requestAnimationFrame(()=>{
              cfgPanel.style.opacity = '1';
              cfgPanel.style.transform = 'translateY(0)';
            });
            cfgToggle.setAttribute('aria-pressed','true');
          } else {
            cfgPanel.style.opacity = '0';
            cfgPanel.style.transform = 'translateY(-6px)';
            cfgToggle.removeAttribute('aria-pressed');
            setTimeout(()=>{ try{ cfgPanel.hidden = true; cfgPanel.style.display = 'none'; }catch(e){} }, 200);
          }
        }

    function readSaved(){ try{ const txt = localStorage.getItem(savedKey); return txt ? JSON.parse(txt) : null; }catch(e){return null} }
    function writeSaved(obj){ try{ localStorage.setItem(savedKey, JSON.stringify(obj)); }catch(e){}
    }

    function updateUIFromConfig(cfg){
      blendSelect.value = cfg.blendMode || 'normal';
      opacityRange.value = (typeof cfg.overlayOpacity === 'number') ? cfg.overlayOpacity : 1; opacityVal.textContent = opacityRange.value;
      fadeRange.value = cfg.fadeSize || 36; fadeVal.textContent = fadeRange.value + 'px';
      fitModeSelect.value = cfg.fitMode || defaultConfig.fitMode || 'cover';
      objectPosSelect.value = cfg.objectPosition || defaultConfig.objectPosition || 'center top';
          cycleToggle.checked = !!cfg.cycle;
      clipRange.value = (typeof cfg.initialClipPercent === 'number') ? cfg.initialClipPercent : defaultConfig.initialClipPercent; clipVal.textContent = clipRange.value + '%';
    }

    function currentConfigFromUI(){
      return {
        blendMode: blendSelect.value,
        overlayOpacity: Number(opacityRange.value),
        fadeSize: Number(fadeRange.value),
        fitMode: fitModeSelect.value,
            objectPosition: objectPosSelect.value,
            cycle: !!cycleToggle.checked,
        initialClipPercent: Number(clipRange.value)
      };
    }

    // wire events
    cfgToggle.addEventListener('click', (ev)=>{ ev.stopPropagation(); showPanel(!cfgPanel.hidden); });
    // close panel when clicking outside
    document.addEventListener('click', (ev)=>{ if(!cfgPanel.hidden && !cfgPanel.contains(ev.target) && ev.target !== cfgToggle) showPanel(false); });
    blendSelect.addEventListener('change', ()=>{ const c = currentConfigFromUI(); window.__slowReveal.updateConfig(c); writeSaved(Object.assign({}, config, c)); });
    opacityRange.addEventListener('input', ()=>{ opacityVal.textContent = opacityRange.value; window.__slowReveal.updateConfig({overlayOpacity:Number(opacityRange.value)}); });
    fadeRange.addEventListener('input', ()=>{ fadeVal.textContent = fadeRange.value + 'px'; window.__slowReveal.updateConfig({fadeSize:Number(fadeRange.value)}); });
    clipRange.addEventListener('input', ()=>{ clipVal.textContent = clipRange.value + '%'; window.__slowReveal.setPercent(Number(clipRange.value)); });
    fitModeSelect.addEventListener('change', ()=>{ window.__slowReveal.updateConfig({fitMode: fitModeSelect.value}); writeSaved(Object.assign({}, config, currentConfigFromUI())); });
    objectPosSelect.addEventListener('change', ()=>{ window.__slowReveal.updateConfig({objectPosition: objectPosSelect.value}); writeSaved(Object.assign({}, config, currentConfigFromUI())); });
    cycleToggle.addEventListener('change', ()=>{ window.__slowReveal.updateConfig({cycle: !!cycleToggle.checked}); writeSaved(Object.assign({}, config, currentConfigFromUI())); });

    saveBtn.addEventListener('click', ()=>{ const cur = currentConfigFromUI(); writeSaved(cur); alert('Configuración guardada localmente'); });
    resetBtn.addEventListener('click', ()=>{ updateUIFromConfig(defaultConfig); window.__slowReveal.updateConfig(defaultConfig); writeSaved(defaultConfig); });
    downloadBtn.addEventListener('click', ()=>{ const payload = Object.assign({}, config, currentConfigFromUI()); const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'slow-reveal.config.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); });
    loadBtn.addEventListener('click', ()=> loadInput.click());
    loadInput.addEventListener('change', (ev)=>{
      const f = ev.target.files && ev.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ()=>{ try{ const parsed = JSON.parse(r.result); window.__slowReveal.updateConfig(parsed); updateUIFromConfig(parsed); writeSaved(parsed); alert('Configuración cargada'); }catch(e){ alert('Archivo inválido'); } }; r.readAsText(f);
    });

    (function initUI(){
      const saved = readSaved();
      const base = Object.assign({}, config, saved || {});
      updateUIFromConfig(base);
    })();
  })();
})();
