/* ═══════════════════════════════════════════════════════════════════════
   shared.js — CLFN Housing Suite shared factories
   ───────────────────────────────────────────────────────────────────────
   Loaded by: finance.html, housing.html, renos.html
   Exposes:  window.SigWidget, window.DocLibrary

   IMPORTANT: Pure browser script. No ES modules, no imports, no build
   step — matches the suite's "vanilla JS with direct fetch calls"
   architectural constraint. Reads NO globals; everything is passed in
   via opts to keep these factories dependency-free and testable.

   CSS classes live in shared.css under the .sigw-* and .doclib-*
   namespaces; see the shared.css file for the full list.

   See PLAN.md for the Phase C refactor context.
   ═══════════════════════════════════════════════════════════════════════ */

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// SHARED SIGNATURE WIDGET FACTORY (Phase F3B — shared JS, v1)
// Single entry point: window.SigWidget.create(mountEl, opts)
// Produces a 3-tab signature widget (Draw / Type / Wet-or-E-Sign) and
// returns a controller with methods: getDataURL(), clear(), getMeta(),
// lock(), unlock(), isSigned().
//
// This factory is intentionally self-contained with ZERO external
// dependencies (no jQuery, no getData, no toast) so that when Phase C
// refactor introduces /shared.js, this block can be moved verbatim.
// CSS lives in shared.css under the .sigw-* namespace.
//
// Consumers in this file: initVoucherSigs() (voucher modal).
// Consumers elsewhere (housing.html, etc.) can adopt this factory too.
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
window.SigWidget = (function(){
  'use strict';

  // Render a single typed name into an offscreen canvas so we can produce
  // a consistent data URL regardless of which tab the user signed on.
  function _renderTypedToDataURL(name, width, height) {
    var c = document.createElement('canvas');
    c.width = width || 600; c.height = height || 90;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.font = 'italic 34px Georgia, serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(name || '', 12, c.height/2);
    return c.toDataURL('image/png');
  }

  function create(mountEl, opts) {
    opts = opts || {};
    var id = opts.id || ('sigw_' + Math.random().toString(36).slice(2,9));
    var height = opts.height || 90;
    var allowTabs = opts.tabs || ['draw','type','wet'];
    var labelDraw = opts.labelDraw || '\u270F\uFE0F Draw';
    var labelType = opts.labelType || '\u2328\uFE0F Type';
    var labelWet  = opts.labelWet  || '\uD83D\uDD8A Wet / E-Sign';

    // Build DOM
    var root = document.createElement('div');
    root.className = 'sigw';
    root.dataset.sigwId = id;

    var tabs = document.createElement('div');
    tabs.className = 'sigw-tabs';

    var panels = {};
    var tabBtns = {};

    function makeTab(key, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sigw-tab';
      b.dataset.tab = key;
      b.textContent = label;
      b.onclick = function(){ setMethod(key); };
      tabs.appendChild(b);
      tabBtns[key] = b;
    }

    if (allowTabs.indexOf('draw') >= 0) makeTab('draw', labelDraw);
    if (allowTabs.indexOf('type') >= 0) makeTab('type', labelType);
    if (allowTabs.indexOf('wet')  >= 0) makeTab('wet',  labelWet);

    root.appendChild(tabs);

    // ── Draw panel ──
    var drawPanel, canvas, drawCtx;
    if (allowTabs.indexOf('draw') >= 0) {
      drawPanel = document.createElement('div');
      drawPanel.className = 'sigw-panel';
      drawPanel.dataset.panel = 'draw';
      canvas = document.createElement('canvas');
      canvas.className = 'sigw-canvas';
      canvas.width = 700; canvas.height = height;
      canvas.style.height = height + 'px';
      drawPanel.appendChild(canvas);
      var footer = document.createElement('div');
      footer.className = 'sigw-canvas-footer';
      var hint = document.createElement('span');
      hint.className = 'sigw-hint';
      hint.textContent = 'Sign with finger or mouse';
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'sigw-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.onclick = function(){ clear(); };
      footer.appendChild(hint);
      footer.appendChild(clearBtn);
      drawPanel.appendChild(footer);
      root.appendChild(drawPanel);
      panels.draw = drawPanel;

      drawCtx = canvas.getContext('2d');
      drawCtx.strokeStyle = '#111';
      drawCtx.lineWidth = 2;
      drawCtx.lineCap = 'round';
      drawCtx.lineJoin = 'round';

      // Pointer handling (covers mouse + touch via pointer events where available)
      var drawing = false, lastX = 0, lastY = 0, _locked = false;
      function pos(ev){
        var rect = canvas.getBoundingClientRect();
        var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
        var src = ev.touches ? ev.touches[0] : ev;
        return { x:(src.clientX - rect.left) * sx, y:(src.clientY - rect.top) * sy };
      }
      function start(ev){ if(_locked)return; ev.preventDefault(); drawing = true; var p = pos(ev); lastX = p.x; lastY = p.y; }
      function move(ev){ if(!drawing||_locked)return; ev.preventDefault(); var p = pos(ev); drawCtx.beginPath(); drawCtx.moveTo(lastX,lastY); drawCtx.lineTo(p.x,p.y); drawCtx.stroke(); lastX=p.x; lastY=p.y; _updateSignedState(); }
      function end(){ drawing = false; }
      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', move);
      canvas.addEventListener('mouseup', end);
      canvas.addEventListener('mouseleave', end);
      canvas.addEventListener('touchstart', start, {passive:false});
      canvas.addEventListener('touchmove', move, {passive:false});
      canvas.addEventListener('touchend', end);
      root._setDrawLocked = function(v){ _locked = !!v; };
    }

    // ── Type panel ──
    var typeInput;
    if (allowTabs.indexOf('type') >= 0) {
      var typePanel = document.createElement('div');
      typePanel.className = 'sigw-panel';
      typePanel.dataset.panel = 'type';
      typePanel.hidden = true;
      var pad = document.createElement('div');
      pad.className = 'sigw-type-pad';
      typeInput = document.createElement('input');
      typeInput.type = 'text';
      typeInput.className = 'sigw-type-input';
      typeInput.placeholder = 'Type full legal name';
      typeInput.addEventListener('input', _updateSignedState);
      var note = document.createElement('div');
      note.className = 'sigw-type-note';
      note.textContent = 'Typing your name constitutes a legal electronic signature';
      pad.appendChild(typeInput);
      pad.appendChild(note);
      typePanel.appendChild(pad);
      root.appendChild(typePanel);
      panels.type = typePanel;
    }

    // ── Wet panel ──
    var wetInput;
    if (allowTabs.indexOf('wet') >= 0) {
      var wetPanel = document.createElement('div');
      wetPanel.className = 'sigw-panel';
      wetPanel.dataset.panel = 'wet';
      wetPanel.hidden = true;
      var wpad = document.createElement('div');
      wpad.className = 'sigw-wet-pad';
      var wnote = document.createElement('div');
      wnote.className = 'sigw-wet-note';
      wnote.textContent = 'Print this form for a wet signature, or send via DocuSign / Adobe Sign and attach the signed copy.';
      wetInput = document.createElement('input');
      wetInput.type = 'text';
      wetInput.className = 'sigw-wet-input';
      wetInput.placeholder = 'Reference # or e-sign envelope ID (optional)';
      wetInput.addEventListener('input', _updateSignedState);
      wpad.appendChild(wnote);
      wpad.appendChild(wetInput);
      wetPanel.appendChild(wpad);
      root.appendChild(wetPanel);
      panels.wet = wetPanel;
    }

    // Mount
    if (mountEl && mountEl.appendChild) mountEl.appendChild(root);

    // ── Controller state ──
    var currentMethod = allowTabs[0] || 'draw';
    var locked = false;

    function setMethod(method) {
      if (locked) return;
      if (!panels[method]) return;
      currentMethod = method;
      Object.keys(panels).forEach(function(k){
        panels[k].hidden = (k !== method);
        tabBtns[k].classList.toggle('is-active', k === method);
      });
      _updateSignedState();
    }

    function isSigned() {
      if (currentMethod === 'draw' && canvas) {
        try {
          var data = drawCtx.getImageData(0,0,canvas.width,canvas.height).data;
          for (var i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
          return false;
        } catch(e) { return false; }
      }
      if (currentMethod === 'type' && typeInput) return typeInput.value.trim().length > 0;
      if (currentMethod === 'wet'  && wetInput)  return wetInput.value.trim().length > 0;
      return false;
    }

    function _updateSignedState() {
      root.classList.toggle('is-signed', isSigned());
    }

    function getDataURL() {
      // Returns a PNG data URL regardless of method, so downstream print /
      // email code can just slot an <img src=...>.
      if (currentMethod === 'draw' && canvas) {
        return isSigned() ? canvas.toDataURL('image/png') : '';
      }
      if (currentMethod === 'type' && typeInput) {
        var v = typeInput.value.trim();
        return v ? _renderTypedToDataURL(v, canvas ? canvas.width : 700, height) : '';
      }
      // Wet / external e-sign doesn't produce a pixel signature in-app;
      // return empty data URL and caller should use getMeta() for the ref.
      return '';
    }

    function getMeta() {
      return {
        method: currentMethod,
        typedName: typeInput ? typeInput.value.trim() : '',
        wetRef:    wetInput  ? wetInput.value.trim()  : '',
        signed:    isSigned()
      };
    }

    function clear() {
      if (locked) return;
      if (canvas && drawCtx) drawCtx.clearRect(0, 0, canvas.width, canvas.height);
      if (typeInput) typeInput.value = '';
      if (wetInput)  wetInput.value  = '';
      _updateSignedState();
    }

    function lock() {
      locked = true;
      if (root._setDrawLocked) root._setDrawLocked(true);
      if (typeInput) typeInput.disabled = true;
      if (wetInput)  wetInput.disabled  = true;
      Object.keys(tabBtns).forEach(function(k){ tabBtns[k].disabled = true; });
    }

    function unlock() {
      locked = false;
      if (root._setDrawLocked) root._setDrawLocked(false);
      if (typeInput) typeInput.disabled = false;
      if (wetInput)  wetInput.disabled  = false;
      Object.keys(tabBtns).forEach(function(k){ tabBtns[k].disabled = false; });
    }

    // Initialize default tab
    setMethod(currentMethod);

    return {
      id: id,
      root: root,
      setMethod: setMethod,
      getDataURL: getDataURL,
      getMeta: getMeta,
      clear: clear,
      lock: lock,
      unlock: unlock,
      isSigned: isSigned
    };
  }

  // ── createPair ──────────────────────────────────────────────────────
  // Bundles two SigWidgets with a shared Yes/No presence toggle.
  // Everything consumer-specific (CURRENT_USER, role-validation copy,
  // label strings) is passed through opts — the factory just applies.
  //
  // opts shape:
  //   toggleMount: HTMLElement          (required) where to render toggle
  //   toggleLabel: '...'                label next to toggle (default 'Customer Present?')
  //   initialMode: 'yes' | 'no'         default 'yes'
  //   modes: { yes: {...}, no: {...} }  (required) see below
  //   leftNameInput, leftNameNote,      (optional) DOM refs for auto-fill + notes
  //   rightNameInput, rightNameNote,
  //   widgetOpts: {...}                 passed to each create()
  //   onChange: function(mode)          fired after a mode change
  //
  // modes[k] shape:
  //   yesButtonText, noButtonText       button labels (only consulted on 'yes')
  //   description                       subtitle shown next to toggle
  //   left:  { title, sub, nameAuto, nameNote, nameNoteKind }
  //   right: { title, sub, nameAuto, nameNote, nameNoteKind }
  //     nameNoteKind: 'success' | 'warning' | 'danger' | '' (default)
  //
  // Returns:
  //   left, right                       the two controllers
  //   setMode(m), getMode()
  //   lock(), unlock(), isLocked()
  //   isBothSigned()
  //   getDataURLs()  -> {left, right}
  //   root                              the toggle element (for styling)
  function createPair(mountLeft, mountRight, opts) {
    opts = opts || {};
    if (!opts.modes || !opts.modes.yes || !opts.modes.no) {
      throw new Error('SigWidget.createPair: opts.modes.{yes,no} required');
    }
    var widgetOpts = opts.widgetOpts || {};

    // Build the two widgets first so we can reach them from the toggle
    var leftW  = create(mountLeft,  widgetOpts);
    var rightW = create(mountRight, widgetOpts);

    // Build the toggle strip
    var tmount = opts.toggleMount;
    var toggleEl = document.createElement('div');
    toggleEl.className = 'sigw-presence';
    var label = document.createElement('span');
    label.className = 'sigw-presence-label';
    label.textContent = opts.toggleLabel || 'Customer Present?';
    var btnGroup = document.createElement('div');
    btnGroup.className = 'sigw-presence-btns';
    var yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = 'sigw-presence-btn';
    yesBtn.textContent = (opts.modes.yes.yesButtonText) || '\u2713 Yes';
    var noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'sigw-presence-btn';
    noBtn.textContent = (opts.modes.yes.noButtonText) || 'No';
    btnGroup.appendChild(yesBtn);
    btnGroup.appendChild(noBtn);
    var desc = document.createElement('span');
    desc.className = 'sigw-presence-desc';
    toggleEl.appendChild(label);
    toggleEl.appendChild(btnGroup);
    toggleEl.appendChild(desc);
    if (tmount && tmount.appendChild) tmount.appendChild(toggleEl);

    var currentMode = opts.initialMode || 'yes';
    var locked = false;

    function _applyNote(el, text, kind) {
      if (!el) return;
      el.textContent = text || '';
      var c = 'var(--muted)';
      if (kind === 'success') c = 'var(--success)';
      else if (kind === 'warning' || kind === 'danger') c = 'var(--danger)';
      el.style.color = c;
    }

    function _applyPadLabels(side, cfg) {
      // side: 'left' | 'right'; cfg: {title, sub, nameAuto, nameNote, nameNoteKind}
      if (!cfg) return;
      var titleEl = opts[side + 'TitleEl'];
      var subEl   = opts[side + 'SubEl'];
      var nameEl  = opts[side + 'NameInput'];
      var noteEl  = opts[side + 'NameNote'];
      if (titleEl && cfg.title != null) titleEl.innerHTML  = cfg.title;
      if (subEl   && cfg.sub   != null) subEl.textContent  = cfg.sub;
      if (nameEl  && cfg.nameAuto != null && !locked) nameEl.value = cfg.nameAuto;
      if (noteEl) _applyNote(noteEl, cfg.nameNote || '', cfg.nameNoteKind || '');
    }

    function setMode(m) {
      if (locked) return;
      if (m !== 'yes' && m !== 'no') return;
      currentMode = m;
      var modeCfg = opts.modes[m];
      // Update button visuals
      yesBtn.classList.toggle('is-active', m === 'yes');
      noBtn.classList.toggle('is-active',  m === 'no');
      // Update description
      desc.textContent = modeCfg.description || '';
      // Apply labels + name inputs + notes
      _applyPadLabels('left',  modeCfg.left);
      _applyPadLabels('right', modeCfg.right);
      // Clear pads on switch
      leftW.clear();
      rightW.clear();
      if (typeof opts.onChange === 'function') opts.onChange(m);
    }

    yesBtn.onclick = function(){ setMode('yes'); };
    noBtn.onclick  = function(){ setMode('no');  };

    // Initial application
    setMode(currentMode);

    function lock() {
      locked = true;
      leftW.lock(); rightW.lock();
      yesBtn.disabled = true; noBtn.disabled = true;
    }
    function unlock() {
      locked = false;
      leftW.unlock(); rightW.unlock();
      yesBtn.disabled = false; noBtn.disabled = false;
    }
    function isBothSigned() { return leftW.isSigned() && rightW.isSigned(); }
    function getDataURLs() { return { left: leftW.getDataURL(), right: rightW.getDataURL() }; }

    return {
      left: leftW,
      right: rightW,
      root: toggleEl,
      setMode: setMode,
      getMode: function(){ return currentMode; },
      lock: lock,
      unlock: unlock,
      isLocked: function(){ return locked; },
      isBothSigned: isBothSigned,
      getDataURLs: getDataURLs
    };
  }

  return { create: create, createPair: createPair };
})();


// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// SHARED DOCUMENT LIBRARY FACTORY (Phase F3B \u2014 shared JS, v1)
//
// Single entry point: window.DocLibrary.create(mountEl, opts)
// Produces an upload + list + delete UI for per-entity document storage.
// Storage backend: Supabase Storage bucket (path-scoped per entity).
// Metadata backend: audit-log row with details JSON (category lives here
// in v1; will move to its own column in Phase F3C).
//
// Designed zero-dependency: no jQuery, no getData(), no toast(), no
// window.NATION_CONFIG reads inside the factory. Everything is passed via
// opts so the factory can be lifted verbatim into /shared.js in Phase C.
//
// Uses existing shared styles: std-table-card, std-table, tic-hist-chip,
// plus a few doclib-* classes added to shared.css for upload area.
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
window.DocLibrary = (function(){
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────
  function _fmtBytes(b) {
    if (b == null || isNaN(b)) return '\u2014';
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(0) + ' KB';
    return (b/1024/1024).toFixed(1) + ' MB';
  }
  function _safeName(n) { return String(n || 'file').replace(/[^a-zA-Z0-9._-]/g, '_'); }
  function _iconForType(mime) {
    mime = (mime||'').toLowerCase();
    if (mime.indexOf('pdf') >= 0) return '\uD83D\uDCC4';
    if (mime.indexOf('image') >= 0) return '\uD83D\uDDBC\uFE0F';
    if (mime.indexOf('word') >= 0 || mime.indexOf('officedocument') >= 0) return '\uD83D\uDCDD';
    if (mime.indexOf('sheet') >= 0 || mime.indexOf('excel') >= 0) return '\uD83D\uDCCA';
    return '\uD83D\uDCCE';
  }
  function _escAttr(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function _escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Network layer ────────────────────────────────────────────────────
  // All calls use raw fetch() + REST/Storage endpoints. No supabase-js.
  function _storageHeaders(opts) {
    var tok = (typeof opts.getAuthToken === 'function' && opts.getAuthToken()) || opts.supabaseAnon;
    return { 'apikey': opts.supabaseAnon, 'Authorization': 'Bearer ' + tok };
  }
  function _restHeaders(opts) {
    var tok = (typeof opts.getAuthToken === 'function' && opts.getAuthToken()) || opts.supabaseAnon;
    return {
      'apikey': opts.supabaseAnon,
      'Authorization': 'Bearer ' + tok,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
  }

  function _uploadBytes(opts, path, file) {
    var url = opts.supabaseUrl + '/storage/v1/object/' + opts.storageBucket + '/' + path;
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({}, _storageHeaders(opts), {
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true'
      }),
      body: file
    });
  }

  function _signUrl(opts, path) {
    var url = opts.supabaseUrl + '/storage/v1/object/sign/' + opts.storageBucket + '/' + path;
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({}, _storageHeaders(opts), { 'Content-Type':'application/json' }),
      body: JSON.stringify({ expiresIn: 3600 })
    }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if (!d || !d.signedURL && !d.signedUrl) return null;
        var rel = d.signedURL || d.signedUrl;
        // Supabase returns a relative path; prepend storage host
        return opts.supabaseUrl + '/storage/v1' + rel;
      });
  }

  function _deleteObject(opts, path) {
    var url = opts.supabaseUrl + '/storage/v1/object/' + opts.storageBucket + '/' + path;
    return fetch(url, { method:'DELETE', headers: _storageHeaders(opts) });
  }

  function _saveMeta(opts, path, name, size, type, category) {
    var url = opts.supabaseUrl + '/rest/v1/' + opts.auditTable;
    var actor = (typeof opts.getActor === 'function' && opts.getActor()) || 'staff';
    return fetch(url, {
      method: 'POST',
      headers: _restHeaders(opts),
      body: JSON.stringify({
        entity_type: opts.entityType,
        entity_id:   String(opts.entityId),
        action:      'file_uploaded',
        details:     JSON.stringify({ path:path, name:name, size:size, type:type, category:category||'other' }),
        actor:       actor,
        created_at:  new Date().toISOString()
      })
    });
  }

  function _loadMeta(opts) {
    // We list by entity + action=file_uploaded AND exclude any rows that
    // have been marked 'file_deleted' for the same path. A small query
    // gets us both in one round-trip.
    var base = opts.supabaseUrl + '/rest/v1/' + opts.auditTable +
      '?entity_type=eq.' + encodeURIComponent(opts.entityType) +
      '&entity_id=eq.' + encodeURIComponent(String(opts.entityId)) +
      '&action=in.(file_uploaded,file_deleted)' +
      '&order=created_at.desc&limit=500';
    var tok = (typeof opts.getAuthToken === 'function' && opts.getAuthToken()) || opts.supabaseAnon;
    return fetch(base, {
      headers: { 'apikey': opts.supabaseAnon, 'Authorization': 'Bearer ' + tok, 'Accept':'application/json' }
    }).then(function(r){ return r.ok ? r.json() : []; })
      .then(function(rows){
        if (!Array.isArray(rows)) return [];
        var deletedPaths = {};
        rows.forEach(function(r){
          if (r.action === 'file_deleted') {
            try { var d = JSON.parse(r.details||'{}'); if (d.path) deletedPaths[d.path] = true; } catch(e){}
          }
        });
        var files = [];
        var seenPath = {};
        rows.forEach(function(r){
          if (r.action !== 'file_uploaded') return;
          try {
            var d = JSON.parse(r.details || '{}');
            if (!d.path || deletedPaths[d.path]) return;
            if (seenPath[d.path]) return;
            seenPath[d.path] = true;
            files.push({
              path: d.path,
              name: d.name || d.path.split('/').pop(),
              size: d.size || 0,
              type: d.type || '',
              category: d.category || 'other',
              addedAt: (r.created_at || '').slice(0,10),
              addedBy: r.actor || ''
            });
          } catch(e) {}
        });
        return files;
      });
  }

  function _markDeleted(opts, path, name) {
    var url = opts.supabaseUrl + '/rest/v1/' + opts.auditTable;
    var actor = (typeof opts.getActor === 'function' && opts.getActor()) || 'staff';
    return fetch(url, {
      method:'POST',
      headers: _restHeaders(opts),
      body: JSON.stringify({
        entity_type: opts.entityType,
        entity_id:   String(opts.entityId),
        action:      'file_deleted',
        details:     JSON.stringify({ path:path, name:name }),
        actor:       actor,
        created_at:  new Date().toISOString()
      })
    });
  }

  // ── Factory ──────────────────────────────────────────────────────────
  function create(mountEl, opts) {
    opts = opts || {};
    // Required opts
    ['entityType','entityId','pathPrefix','supabaseUrl','supabaseAnon','storageBucket']
      .forEach(function(k){ if (!opts[k]) throw new Error('DocLibrary: opts.'+k+' required'); });
    // Defaults
    opts.categories = opts.categories && opts.categories.length ? opts.categories : [
      { key:'other', label:'Other', icon:'\uD83D\uDCCE' }
    ];
    opts.auditTable = opts.auditTable || 'housing_audit_log';
    opts.maxSizeMB  = opts.maxSizeMB || 25;

    var state = {
      files: [],
      loading: true,
      filter: 'all',      // category key or 'all'
      uploadCategory: opts.categories[0].key,
      uploading: false,
      error: null
    };

    // Build DOM once
    var root = document.createElement('div');
    root.className = 'std-table-card doclib';
    mountEl.appendChild(root);

    function render() {
      var hasFiles = state.files.length > 0;
      var filtered = state.filter === 'all'
        ? state.files
        : state.files.filter(function(f){ return f.category === state.filter; });
      var totalCount = state.files.length;
      var shownCount = filtered.length;

      var catByKey = {};
      opts.categories.forEach(function(c){ catByKey[c.key] = c; });

      // Header
      var headerHTML =
        '<div class="std-table-hdr">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<h3 style="margin:0;font-size:15px;font-weight:700;">Documents</h3>' +
            '<span class="std-table-count">' +
              (shownCount === totalCount ? totalCount + ' total' : shownCount + ' shown \u00B7 ' + totalCount + ' total') +
            '</span>' +
          '</div>' +
        '</div>';

      // Upload area (skipped when readOnly)
      var uploadHTML = '';
      if (!opts.readOnly) {
        var catOptions = opts.categories.map(function(c){
          var sel = c.key === state.uploadCategory ? ' selected' : '';
          return '<option value="'+_escAttr(c.key)+'"'+sel+'>'+(c.icon?c.icon+' ':'')+_escHtml(c.label)+'</option>';
        }).join('');
        uploadHTML =
          '<div class="doclib-upload-row">' +
            '<div class="doclib-upload-drop" data-dl-drop>' +
              '<input type="file" multiple data-dl-file-input style="display:none;">' +
              '<span class="doclib-upload-icon">\uD83D\uDCC1</span>' +
              '<div class="doclib-upload-text">' +
                '<div style="font-size:13px;font-weight:600;">Drop files here or click to upload</div>' +
                '<div style="font-size:11px;color:var(--muted);">Max ' + opts.maxSizeMB + ' MB per file</div>' +
              '</div>' +
            '</div>' +
            '<label class="doclib-upload-cat">' +
              '<span>Category</span>' +
              '<select data-dl-cat class="std-filter-control narrow">'+catOptions+'</select>' +
            '</label>' +
          '</div>' +
          (state.uploading ? '<div class="doclib-status doclib-status-info">Uploading\u2026</div>' : '') +
          (state.error ? '<div class="doclib-status doclib-status-error">'+_escHtml(state.error)+'</div>' : '');
      }

      // Filter chips
      var chipAll = '<button type="button" class="btn btn-sm tic-hist-chip' +
        (state.filter==='all'?' is-active':'') + '" data-dl-chip="all">All</button>';
      var chips = opts.categories.map(function(c){
        var active = state.filter === c.key ? ' is-active' : '';
        return '<button type="button" class="btn btn-sm tic-hist-chip'+active+'" data-dl-chip="'+_escAttr(c.key)+'">' +
          (c.icon ? c.icon + ' ' : '') + _escHtml(c.label) + '</button>';
      }).join('');
      var filterHTML =
        '<div class="std-filter-row" style="flex-wrap:wrap;">' +
          '<span class="std-filter-label">Category</span>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + chipAll + chips + '</div>' +
        '</div>';

      // Table body
      var bodyRows;
      if (state.loading) {
        bodyRows = '<tr class="empty-row"><td colspan="5">Loading\u2026</td></tr>';
      } else if (!hasFiles) {
        bodyRows = '<tr class="empty-row"><td colspan="5">No documents yet.' +
          (opts.readOnly ? '' : ' Upload your first file above.') + '</td></tr>';
      } else if (!filtered.length) {
        bodyRows = '<tr class="empty-row"><td colspan="5">No documents match this filter.</td></tr>';
      } else {
        bodyRows = filtered.map(function(f){
          var cat = catByKey[f.category] || { label: f.category || 'Other', icon:'\uD83D\uDCCE' };
          var icon = _iconForType(f.type);
          return '<tr>' +
            '<td style="font-size:16px;width:28px;">'+icon+'</td>' +
            '<td class="std-cell-primary" style="max-width:320px;white-space:normal;word-break:break-word;">' +
              _escHtml(f.name) +
              '<div style="font-size:11px;color:var(--muted);font-weight:normal;">' +
                _escHtml(f.addedAt||'') + (f.addedBy?' \u00B7 '+_escHtml(f.addedBy):'') + '</div>' +
            '</td>' +
            '<td>' +
              '<span class="std-pill std-pill-info">' + (cat.icon?cat.icon+' ':'') + _escHtml(cat.label) + '</span>' +
            '</td>' +
            '<td class="std-cell-right std-cell-mono">'+_fmtBytes(f.size)+'</td>' +
            '<td class="std-cell-tail" style="white-space:nowrap;">' +
              '<button class="btn btn-ghost btn-sm" data-dl-view="'+_escAttr(f.path)+'">View</button>' +
              (opts.readOnly ? '' : ' <button class="btn btn-ghost btn-sm" style="color:var(--danger);" data-dl-del="'+_escAttr(f.path)+'" data-dl-del-name="'+_escAttr(f.name)+'">Delete</button>') +
            '</td>' +
          '</tr>';
        }).join('');
      }

      var tableHTML =
        '<div style="overflow-x:auto;">' +
          '<table class="std-table">' +
            '<thead><tr>' +
              '<th></th><th>File</th><th>Category</th>' +
              '<th class="std-cell-right">Size</th>' +
              '<th class="std-cell-tail">Actions</th>' +
            '</tr></thead>' +
            '<tbody>'+bodyRows+'</tbody>' +
          '</table>' +
        '</div>';

      root.innerHTML = headerHTML + uploadHTML + filterHTML + tableHTML;

      _wireEvents();
    }

    function _wireEvents() {
      // Chip click
      root.querySelectorAll('[data-dl-chip]').forEach(function(btn){
        btn.onclick = function(){ state.filter = btn.getAttribute('data-dl-chip'); render(); };
      });
      // Category dropdown (upload)
      var cat = root.querySelector('[data-dl-cat]');
      if (cat) cat.onchange = function(){ state.uploadCategory = cat.value; };
      // Drop zone click opens file picker
      var drop = root.querySelector('[data-dl-drop]');
      var fi   = root.querySelector('[data-dl-file-input]');
      if (drop && fi) {
        drop.onclick = function(){ fi.click(); };
        drop.ondragover = function(e){ e.preventDefault(); drop.classList.add('is-drag'); };
        drop.ondragleave = function(){ drop.classList.remove('is-drag'); };
        drop.ondrop = function(e){
          e.preventDefault(); drop.classList.remove('is-drag');
          if (e.dataTransfer && e.dataTransfer.files) _handleFiles(e.dataTransfer.files);
        };
        fi.onchange = function(){ _handleFiles(fi.files); fi.value = ''; };
      }
      // View + delete
      root.querySelectorAll('[data-dl-view]').forEach(function(btn){
        btn.onclick = function(){
          var p = btn.getAttribute('data-dl-view');
          _signUrl(opts, p).then(function(u){
            if (u) window.open(u, '_blank');
            else _setError('Could not generate link for that file.');
          }).catch(function(){ _setError('Could not generate link for that file.'); });
        };
      });
      root.querySelectorAll('[data-dl-del]').forEach(function(btn){
        btn.onclick = function(){
          var p = btn.getAttribute('data-dl-del');
          var n = btn.getAttribute('data-dl-del-name');
          if (!confirm('Delete "'+n+'"? This cannot be undone.')) return;
          btn.disabled = true;
          _deleteObject(opts, p).then(function(){ return _markDeleted(opts, p, n); })
            .then(function(){
              state.files = state.files.filter(function(f){ return f.path !== p; });
              if (typeof opts.onChange === 'function') opts.onChange('delete', { path:p, name:n });
              render();
            })
            .catch(function(){ _setError('Delete failed.'); btn.disabled = false; });
        };
      });
    }

    function _setError(msg) {
      state.error = msg; render();
      setTimeout(function(){ state.error = null; render(); }, 4000);
    }

    function _handleFiles(fileList) {
      if (!fileList || !fileList.length) return;
      var files = Array.prototype.slice.call(fileList);
      // Size guard
      var tooBig = files.filter(function(f){ return f.size > opts.maxSizeMB * 1024 * 1024; });
      if (tooBig.length) { _setError('Some files exceed the '+opts.maxSizeMB+' MB limit.'); return; }

      state.uploading = true; state.error = null; render();

      // Sequential uploads \u2014 keeps order predictable + avoids rate limits
      function next(i) {
        if (i >= files.length) {
          state.uploading = false;
          return refresh();
        }
        var f = files[i];
        var ts = Date.now();
        var path = opts.pathPrefix.replace(/\/$/,'') + '/' + ts + '_' + _safeName(f.name);
        _uploadBytes(opts, path, f).then(function(r){
          if (!r.ok) throw new Error('upload failed');
          return _saveMeta(opts, path, f.name, f.size, f.type, state.uploadCategory);
        }).then(function(){
          if (typeof opts.onChange === 'function') {
            opts.onChange('upload', { path:path, name:f.name, category:state.uploadCategory });
          }
          next(i+1);
        }).catch(function(){
          state.uploading = false;
          _setError('Upload failed: ' + f.name);
        });
      }
      next(0);
    }

    function refresh() {
      state.loading = true; render();
      return _loadMeta(opts).then(function(files){
        state.files = files;
        state.loading = false;
        render();
      }).catch(function(){
        state.loading = false;
        _setError('Could not load documents.');
      });
    }

    // Initial render + load
    render();
    refresh();

    return {
      root: root,
      refresh: refresh,
      setCategoryFilter: function(k){ state.filter = k; render(); },
      getFiles: function(){ return state.files.slice(); }
    };
  }

  return { create: create };
})();
