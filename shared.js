/* ═══════════════════════════════════════════════════════════════════════
   shared.js — CLFN Housing Suite shared factories
   ───────────────────────────────────────────────────────────────────────
   Loaded by: finance.html, housing.html, renos.html, index.html
   Exposes:  window.CLFN_PERMS, window.SigWidget, window.DocLibrary,
             window.SbStorage (and bare sb* aliases)

   IMPORTANT: Pure browser script. No ES modules, no imports, no build
   step — matches the suite's "vanilla JS with direct fetch calls"
   architectural constraint. Reads NO globals; everything is passed in
   via opts to keep these factories dependency-free and testable.

   CSS classes live in shared.css under the .sigw-* and .doclib-*
   namespaces; see the shared.css file for the full list.
   ═══════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════
// CLFN_PERMS — Authoritative role definitions and capability checks
// Single source of truth for all four app pages.
// Previously duplicated in housing.html, renos.html, finance.html,
// index.html — now lives here only.
// ═══════════════════════════════════════════════════════════════════════
(function initPerms(){

  // ── Authoritative role keys ───────────────────────────────────────────
  // Canonical values stored in staff.role. The DB was normalized to these
  // via the Phase A0 migration.
  var ROLES = Object.freeze({
    ED:         'ed',
    HM:         'housing_manager',
    HE_L2:      'housing_employee_l2',
    HE_L1:      'housing_employee_l1',
    CFO:        'cfo',
    FINANCE_L1: 'finance_l1'
  });

  // ── Legacy-name aliases ───────────────────────────────────────────────
  // Normalized at read-time so any pre-existing session tokens or cached
  // strings keep working.
  var LEGACY_ALIASES = Object.freeze({
    'employee':  ROLES.HE_L1,
    'staff':     ROLES.HE_L1,
    'hm':        ROLES.HM,
    'manager':   ROLES.HM,
    'finance':   ROLES.FINANCE_L1
  });

  // ── Human-readable labels (role switcher, badges, audit log) ──────────
  var ROLE_LABELS = Object.freeze({
    'ed':                   'Executive Director',
    'housing_manager':      'Housing Manager',
    'housing_employee_l2':  'Housing Employee L2',
    'housing_employee_l1':  'Housing Employee L1',
    'cfo':                  'CFO',
    'finance_l1':           'Finance Clerk L1'
  });

  var VALID_KEYS = Object.freeze(Object.keys(ROLE_LABELS));

  // ── Core helpers ──────────────────────────────────────────────────────

  function normalizeRole(role){
    if(role == null) return null;
    var r = String(role).toLowerCase().trim();
    if(r in LEGACY_ALIASES) return LEGACY_ALIASES[r];
    return r;
  }

  function isValidRole(role){
    var r = normalizeRole(role);
    return VALID_KEYS.indexOf(r) !== -1;
  }

  function assertRole(role, caller){
    var r = normalizeRole(role);
    if(r == null) throw new Error('[permissions] '+(caller||'check')+': role is required');
    if(VALID_KEYS.indexOf(r) === -1){
      throw new Error('[permissions] '+(caller||'check')+': unknown role "'+role+'" (normalized to "'+r+'"). Valid: '+VALID_KEYS.join(', '));
    }
    return r;
  }

  function roleLabel(role){
    var r = normalizeRole(role);
    return ROLE_LABELS[r] || String(role||'');
  }

  // ── Effective vs. real role ───────────────────────────────────────────
  // effectiveRole: the role the app is currently acting as (honors view-as).
  // realRole:      the actual authenticated user's role — used for override
  //                authority (only the real ED can unlock a completed SOW,
  //                regardless of which role they're previewing as).
  function effectiveRole(){
    return normalizeRole(window._viewAsRole || window.currentRole || null);
  }
  function realRole(){
    return normalizeRole(window._realRole || window.currentRole || null);
  }

  // ── Module-level access gates ─────────────────────────────────────────
  function hasHousingAccess(role){
    var r = assertRole(role, 'hasHousingAccess');
    return r === ROLES.ED || r === ROLES.HM || r === ROLES.HE_L2 || r === ROLES.HE_L1;
  }

  function hasFinanceAccess(role){
    var r = assertRole(role, 'hasFinanceAccess');
    return r === ROLES.ED || r === ROLES.HM || r === ROLES.HE_L2
        || r === ROLES.CFO || r === ROLES.FINANCE_L1;
  }

  // ── Housing-app capabilities ──────────────────────────────────────────

  function canCreateApp(role){
    var r = assertRole(role, 'canCreateApp');
    return hasHousingAccess(r);
  }

  function canEditApp(role, opts){
    var r = assertRole(role, 'canEditApp');
    if(r === ROLES.ED || r === ROLES.HM || r === ROLES.HE_L2) return true;
    if(r === ROLES.HE_L1){
      if(!opts) return false;
      var isOwner = (opts.ownerRole === r) || (opts.ownerName && opts.ownerName === opts.currentUserName);
      var isDraft = !opts.status || opts.status === 'draft';
      return !!(isOwner && isDraft);
    }
    return false;
  }

  function canEditSow(role, sowStatus){
    var r = assertRole(role, 'canEditSow');
    if(!hasHousingAccess(r)) return false;
    if(sowStatus === 'completed') return realRole() === ROLES.ED;
    if(r === ROLES.HE_L1) return false;
    return true;
  }

  function canEditProgressForUnit(role, unitHasCompletedSow){
    var r = assertRole(role, 'canEditProgressForUnit');
    if(!hasHousingAccess(r)) return false;
    if(r === ROLES.HE_L1) return false;
    if(unitHasCompletedSow) return realRole() === ROLES.ED;
    return true;
  }

  // ── Approval authority ────────────────────────────────────────────────
  function canApproveSowHm(role){
    var r = assertRole(role, 'canApproveSowHm');
    if(typeof APPROVAL_AUTHORITY !== 'undefined') return APPROVAL_AUTHORITY.can('approveSowUnderThreshold', r);
    return r === ROLES.HM || r === ROLES.ED;
  }
  function canApproveSowEd(role){
    var r = assertRole(role, 'canApproveSowEd');
    if(typeof APPROVAL_AUTHORITY !== 'undefined') return APPROVAL_AUTHORITY.can('approveSowOverThreshold', r);
    return r === ROLES.ED;
  }
  function canMarkSowComplete(role){
    var r = assertRole(role, 'canMarkSowComplete');
    if(typeof APPROVAL_AUTHORITY !== 'undefined') return APPROVAL_AUTHORITY.can('approveSowUnderThreshold', r)||APPROVAL_AUTHORITY.can('approveSowOverThreshold', r);
    return r === ROLES.ED || r === ROLES.HM;
  }
  function canReopenSow(role){
    var r = assertRole(role, 'canReopenSow');
    if(typeof APPROVAL_AUTHORITY !== 'undefined') return APPROVAL_AUTHORITY.can('lockSow', r);
    return r === ROLES.ED;
  }

  // ── Role switcher (ED's "view as") ────────────────────────────────────
  function getViewAsOptions(role){
    var r = assertRole(role, 'getViewAsOptions');
    if(r !== ROLES.ED) return [];
    return VALID_KEYS.filter(function(k){ return k !== ROLES.ED; });
  }

  // Expose immutable API.
  window.CLFN_PERMS = Object.freeze({
    ROLES:                  ROLES,
    ROLE_LABELS:            ROLE_LABELS,
    normalizeRole:          normalizeRole,
    isValidRole:            isValidRole,
    assertRole:             assertRole,
    roleLabel:              roleLabel,
    effectiveRole:          effectiveRole,
    realRole:               realRole,
    hasHousingAccess:       hasHousingAccess,
    hasFinanceAccess:       hasFinanceAccess,
    canCreateApp:           canCreateApp,
    canEditApp:             canEditApp,
    canEditSow:             canEditSow,
    canEditProgressForUnit: canEditProgressForUnit,
    canApproveSowHm:        canApproveSowHm,
    canApproveSowEd:        canApproveSowEd,
    canMarkSowComplete:     canMarkSowComplete,
    canReopenSow:           canReopenSow,
    getViewAsOptions:       getViewAsOptions
  });
})();

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

      drawCtx = canvas.getContext('2d', { willReadFrequently: true });
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
// SHARED DOCUMENT LIBRARY FACTORY (Phase F3B — shared JS, v2)
//
// Single entry point: window.DocLibrary.create(mountEl, opts)
// Produces an upload + list + delete UI for per-entity document storage.
// Storage backend: Supabase Storage bucket (path-scoped per entity).
// Metadata backend: audit-log row with `detail` JSON (category lives here
// in v1; will move to its own column in Phase F3C).
//
// Designed zero-dependency: no jQuery, no getData(), no toast(), no
// window.NATION_CONFIG reads inside the factory. Everything is passed via
// opts so the factory can be lifted verbatim into /shared.js in Phase C.
//
// Opts (all in window.DocLibrary.create(mountEl, opts)):
//   REQUIRED:
//     entityType, entityId, pathPrefix, supabaseUrl, supabaseAnon,
//     storageBucket
//   OPTIONAL:
//     auditTable       default 'housing_audit_log'
//     categories       array of {key,label,icon?}; default [{Other}]
//     getActor         function returning the actor string for audit rows
//     getAuthToken     function returning a bearer token override
//     readOnly         hides upload + delete controls
//     maxSizeMB        per-file upload cap, default 25
//     onChange         (action, file) => void — hook for external refresh
//     customLoader     async () => files[] — replaces default audit-log
//                      fetch. Files must have {path,name,size?,type?,
//                      category?,addedAt?,addedBy?}; extra fields are
//                      preserved on the file object and reach customDelete.
//                      Use when files come from a non-audit-log source
//                      (e.g. app_documents table + storage listing).
//     customDelete     async (file) => void — replaces default storage +
//                      tombstone delete flow. Receives the full file
//                      object from customLoader; should return a Promise
//                      that resolves after the delete is committed.
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

  function _mimeType(file) {
    // Browsers sometimes return empty or wrong MIME for Office files.
    // Use file extension as authoritative source when browser type is absent.
    var t = file.type || '';
    if (t && t !== 'application/octet-stream') return t;
    var ext = (file.name || '').split('.').pop().toLowerCase();
    var map = {
      'pdf':  'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc':  'application/msword',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls':  'application/vnd.ms-excel',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'png':  'image/png',
      'jpg':  'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif':  'image/gif',
      'webp': 'image/webp',
      'txt':  'text/plain',
      'csv':  'text/csv',
    };
    return map[ext] || 'application/octet-stream';
  }

  function _uploadBytes(opts, path, file) {
    var url = opts.supabaseUrl + '/storage/v1/object/' + opts.storageBucket + '/' + path;
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({}, _storageHeaders(opts), {
        'Content-Type': _mimeType(file),
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
    // Column name is `detail` (singular) in both housing_audit_log and
    // finance_audit_log. Type differs: housing is text, finance is jsonb.
    // opts.detailAsJson:true sends the object directly (jsonb-friendly);
    // default stringifies (text-friendly). See PLAN.md schema notes.
    var detailPayload = { path:path, name:name, size:size, type:type, category:category||'other' };
    return fetch(url, {
      method: 'POST',
      headers: _restHeaders(opts),
      body: JSON.stringify({
        entity_type: opts.entityType,
        entity_id:   String(opts.entityId),
        action:      'file_uploaded',
        detail:      opts.detailAsJson ? detailPayload : JSON.stringify(detailPayload),
        actor:       actor,
        created_at:  new Date().toISOString()
      })
    });
  }

  function _loadMeta(opts) {
    // We list by entity + action=file_uploaded AND exclude any rows that
    // have been marked 'file_deleted' for the same path. A small query
    // gets us both in one round-trip.
    // Column is `detail` (singular). housing_audit_log stores it as text
    // (stringified JSON); finance_audit_log stores it as jsonb (object).
    // _parseDetail handles both cases tolerantly.
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
            var d = _parseDetail(r.detail);
            if (d.path) deletedPaths[d.path] = true;
          }
        });
        var files = [];
        var seenPath = {};
        rows.forEach(function(r){
          if (r.action !== 'file_uploaded') return;
          var d = _parseDetail(r.detail);
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
        });
        return files;
      });
  }

  // Tolerant: handles text columns (stringified JSON) and jsonb columns
  // (already-parsed objects). Returns {} on anything unparseable.
  function _parseDetail(v) {
    if (v == null) return {};
    if (typeof v === 'object') return v;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch(e) { return {}; }
    }
    return {};
  }

  function _markDeleted(opts, path, name) {
    var url = opts.supabaseUrl + '/rest/v1/' + opts.auditTable;
    var actor = (typeof opts.getActor === 'function' && opts.getActor()) || 'staff';
    var detailPayload = { path:path, name:name };
    return fetch(url, {
      method:'POST',
      headers: _restHeaders(opts),
      body: JSON.stringify({
        entity_type: opts.entityType,
        entity_id:   String(opts.entityId),
        action:      'file_deleted',
        detail:      opts.detailAsJson ? detailPayload : JSON.stringify(detailPayload),
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
          '<div class="doclib-upload-area">' +
            '<div class="doclib-upload-drop" data-dl-drop>' +
              '<input type="file" multiple data-dl-file-input style="display:none;">' +
              '<span class="doclib-upload-icon">\uD83D\uDCC1</span>' +
              '<div class="doclib-upload-text">' +
                '<strong>Drop files here or click to upload</strong>' +
                '<span>Max ' + opts.maxSizeMB + ' MB per file</span>' +
              '</div>' +
            '</div>' +
            '<div class="doclib-upload-cat">' +
              '<label class="doclib-upload-cat-label">Category</label>' +
              '<select data-dl-cat class="std-filter-control">'+catOptions+'</select>' +
            '</div>' +
          '</div>' +
          (state.uploading ? '<div class="doclib-status doclib-status-info">Uploading\u2026</div>' : '') +
          (state.error ? '<div class="doclib-status doclib-status-error">'+_escHtml(state.error)+'</div>' : '');
      }

      // Filter chips
      var chipAll = '<button type="button" class="tic-hist-chip' +
        (state.filter==='all'?' is-active':'') + '" data-dl-chip="all">All</button>';
      var chips = opts.categories.map(function(c){
        var active = state.filter === c.key ? ' is-active' : '';
        return '<button type="button" class="tic-hist-chip'+active+'" data-dl-chip="'+_escAttr(c.key)+'">' +
          (c.icon ? c.icon + ' ' : '') + _escHtml(c.label) + '</button>';
      }).join('');
      var filterHTML =
        '<div class="doclib-filter-row">' +
          '<span class="doclib-filter-label">Category</span>' +
          '<div class="doclib-filter-chips">' + chipAll + chips + '</div>' +
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
              _escHtml(f.name.replace(/^\d+_/, '')) +
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
        '<div class="doclib-table-wrap">' +
          '<table class="std-table doclib-table">' +
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
          var n = btn.getAttribute('data-dl-del-name').replace(/^\d+_/, '');
          // Branded confirm modal — replaces browser confirm()
          var ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;';
          ov.innerHTML =
            '<div style="background:var(--surface);border-radius:14px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden;">' +
              '<div class="modal-hdr compact">' +
                '<div>' +
                  '<div class="modal-hdr-title">Delete File?</div>' +
                  '<div class="modal-hdr-sub">This cannot be undone</div>' +
                '</div>' +
              '</div>' +
              '<div style="padding:20px;">' +
                '<p style="margin:0 0 20px;font-size:13px;color:var(--muted);line-height:1.5;">' +
                  'Are you sure you want to delete <strong style="color:var(--text);">' + _escHtml(n) + '</strong>?' +
                '</p>' +
                '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
                  '<button class="btn btn-ghost" data-dl-cancel>Cancel</button>' +
                  '<button class="btn" style="background:var(--danger);color:#fff;border-color:var(--danger);" data-dl-confirm>Delete</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          document.body.appendChild(ov);
          ov.querySelector('[data-dl-cancel]').onclick = function(){ document.body.removeChild(ov); };
          ov.addEventListener('click', function(e){ if (e.target === ov) document.body.removeChild(ov); });
          ov.querySelector('[data-dl-confirm]').onclick = function(){
            document.body.removeChild(ov);
            btn.disabled = true;
          var file = state.files.find(function(f){ return f.path === p; }) || { path:p, name:n };
          var deleteFlow;
          if (typeof opts.customDelete === 'function') {
            deleteFlow = Promise.resolve(opts.customDelete(file));
          } else {
            deleteFlow = _deleteObject(opts, p).then(function(){ return _markDeleted(opts, p, n); });
          }
          deleteFlow
            .then(function(){
              state.files = state.files.filter(function(f){ return f.path !== p; });
              if (typeof opts.onChange === 'function') opts.onChange('delete', file);
              render();
            })
            .catch(function(){ _setError('Delete failed.'); btn.disabled = false; });
          };
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
          if (!r.ok) {
            return r.text().then(function(body){
              console.error('[DocLib] Storage upload failed:', r.status, body, 'path:', path, 'type:', _mimeType(f));
              throw new Error('upload failed: ' + body);
            });
          }
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
      // customLoader opt overrides the default audit-log load. Expected
      // return: Promise resolving to an array of {path, name, size, type,
      // category?, addedAt?, addedBy?} objects. Any extra fields (like
      // scorecard's docId) are preserved on the file object and reach
      // customDelete if set.
      var loader = (typeof opts.customLoader === 'function')
        ? opts.customLoader()
        : _loadMeta(opts);
      return Promise.resolve(loader).then(function(files){
        state.files = Array.isArray(files) ? files : [];
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


// ═══════════════════════════════════════════════════════════════════════
// SUPABASE STORAGE HELPERS (Phase C — extracted from housing/renos)
// ───────────────────────────────────────────────────────────────────────
// These helpers were duplicated byte-for-byte across housing.html and
// renos.html. They now live here and both apps get them from shared.js.
//
// Config dependencies — these must exist as window globals BEFORE any
// helper is called. Both housing.html and renos.html already declare
// them near the top of their scripts:
//   window.SUPABASE_URL     — Supabase project URL (from NATION_CONFIG)
//   window.SUPABASE_ANON    — anon/public key (from NATION_CONFIG)
//   window.STORAGE_BUCKET   — bucket name (from NATION_CONFIG, or
//                             'housing-files' default)
//   window.HOUSING_HEADERS  — {'apikey', 'Authorization'} object used
//                             by housing_audit_log REST calls
//   window.currentRole      — optional; used as the audit 'actor'
//   window._sb              — optional; Supabase JS client for signed URLs
//
// Path conventions:
//   tenants/{unitId}/{timestamp}_{filename}
//   applications/{appId}/{timestamp}_{filename}
//   contractors/{contractorId}/{bucket}/{timestamp}_{filename}
//   units/{unitId}/photos/{timestamp}_{filename}
//   sow/{unitId}/{timestamp}_{filename}
//
// Exposes both window.SbStorage (namespaced) and the legacy top-level
// names (sbUploadFile, sbGetSignedUrl, etc.) — the latter because 15+
// existing call sites use them bare.
// ═══════════════════════════════════════════════════════════════════════
(function(){
  'use strict';

  function sbStorageHeaders() {
    var h = { 'apikey': window.SUPABASE_ANON };
    if (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization']) {
      h['Authorization'] = window.HOUSING_HEADERS['Authorization'];
    }
    return h;
  }

  // Return authenticated URL with properly encoded path and token
  function sbGetFileUrl(path) {
    var token = (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ','');
    var encodedPath = path.split('/').map(function(seg){ return encodeURIComponent(seg); }).join('/');
    var base = window.SUPABASE_URL + '/storage/v1/object/authenticated/' + window.STORAGE_BUCKET + '/' + encodedPath;
    return token ? (base + '?token=' + encodeURIComponent(token)) : base;
  }

  // Upload a File object to Supabase Storage. Returns {path, url} or throws.
  async function sbUploadFile(path, file) {
    var url = window.SUPABASE_URL + '/storage/v1/object/' + window.STORAGE_BUCKET + '/' + path;
    var res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({}, sbStorageHeaders(), { 'x-upsert': 'true' }),
      body: file
    });
    if (!res.ok) {
      var err = await res.text();
      throw new Error('Upload failed: ' + err);
    }
    return { path: path, url: sbGetFileUrl(path) };
  }

  // Get a signed URL for a file (valid 1 hour)
  async function sbGetSignedUrl(path) {
    // Prefer Supabase JS client if available — handles encoding cleanly
    try {
      if (window._sb) {
        var r = await window._sb.storage.from(window.STORAGE_BUCKET).createSignedUrl(path, 3600);
        if (r.data && r.data.signedUrl) return r.data.signedUrl;
      }
    } catch(e) { console.warn('createSignedUrl error:', e); }
    // Fallback: authenticated URL with token param
    return sbGetFileUrl(path);
  }

  // Delete a file from storage
  async function sbDeleteFile(path) {
    var url = window.SUPABASE_URL + '/storage/v1/object/' + window.STORAGE_BUCKET;
    var res = await fetch(url, {
      method: 'DELETE',
      headers: Object.assign({}, sbStorageHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [path] })
    });
    return res.ok;
  }

  // List files under a path prefix
  async function sbListFiles(prefix) {
    var cleanPrefix = prefix.replace(/\/$/, '');
    var url = window.SUPABASE_URL + '/storage/v1/object/list/' + window.STORAGE_BUCKET;
    var res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({}, sbStorageHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: cleanPrefix, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!res.ok) return [];
    var data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  // Save file metadata to housing_audit_log (text detail column)
  async function sbSaveFileMeta(entityType, entityId, filePath, fileName, fileSize, fileType) {
    try {
      await fetch(window.SUPABASE_URL + '/rest/v1/housing_audit_log', {
        method: 'POST',
        headers: Object.assign({}, window.HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: String(entityId),
          action: 'file_uploaded',
          detail: JSON.stringify({ path: filePath, name: fileName, size: fileSize, type: fileType }),
          actor: window.currentRole || 'staff',
          created_at: new Date().toISOString()
        })
      });
    } catch(e) { console.warn('File meta save failed:', e); }
  }

  // Load file list for an entity from audit log (filters out deleted).
  // Column is `detail` (singular, text). Uses a tolerant parser in case
  // of jsonb drift later.
  function _sbParseDetail(v) {
    if (v == null) return {};
    if (typeof v === 'object') return v;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch(e) { return {}; }
    }
    return {};
  }
  async function sbLoadFileMeta(entityType, entityId) {
    try {
      var r = await fetch(
        window.SUPABASE_URL + '/rest/v1/housing_audit_log?entity_type=eq.'+entityType+'&entity_id=eq.'+encodeURIComponent(String(entityId))+'&action=in.(file_uploaded,file_deleted)&order=created_at.desc',
        { headers: window.HOUSING_HEADERS }
      );
      if (!r.ok) return [];
      var rows = await r.json();
      var deleted = rows.filter(function(row){ return row.action === 'file_deleted'; }).map(function(row){ return _sbParseDetail(row.detail).path; });
      return rows
        .filter(function(row){ return row.action === 'file_uploaded'; })
        .filter(function(row){ var d = _sbParseDetail(row.detail); return d.path && !deleted.includes(d.path); })
        .map(function(row){
          var d = _sbParseDetail(row.detail);
          return { path: d.path, name: d.name, size: d.size, type: d.type, category: d.category, addedAt: (row.created_at||'').slice(0,10), addedBy: row.actor, logId: row.id };
        });
    } catch(e) { return []; }
  }

  // Unified upload handler: uploads to Supabase Storage + saves metadata
  async function sbUploadAndSave(entityType, entityId, file, pathPrefix) {
    var ts = Date.now();
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var path = pathPrefix + '/' + ts + '_' + safeName;
    var result = await sbUploadFile(path, file);
    await sbSaveFileMeta(entityType, String(entityId), path, file.name, file.size, file.type);
    return { path: path, name: file.name, size: file.size, type: file.type,
             addedAt: new Date().toISOString().slice(0,10), addedBy: window.currentRole || 'staff' };
  }

  // Expose namespaced API
  window.SbStorage = {
    storageHeaders: sbStorageHeaders,
    getFileUrl: sbGetFileUrl,
    uploadFile: sbUploadFile,
    getSignedUrl: sbGetSignedUrl,
    deleteFile: sbDeleteFile,
    listFiles: sbListFiles,
    saveFileMeta: sbSaveFileMeta,
    loadFileMeta: sbLoadFileMeta,
    uploadAndSave: sbUploadAndSave
  };
  // Expose legacy top-level aliases — 15+ call sites across housing.html
  // and renos.html use these bare names. Keep them until every caller
  // migrates to window.SbStorage.
  window.sbStorageHeaders = sbStorageHeaders;
  window.sbGetFileUrl     = sbGetFileUrl;
  window.sbUploadFile     = sbUploadFile;
  window.sbGetSignedUrl   = sbGetSignedUrl;
  window.sbDeleteFile     = sbDeleteFile;
  window.sbListFiles      = sbListFiles;
  window.sbSaveFileMeta   = sbSaveFileMeta;
  window.sbLoadFileMeta   = sbLoadFileMeta;
  window.sbUploadAndSave  = sbUploadAndSave;
})();
