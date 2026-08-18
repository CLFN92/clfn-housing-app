/* ============================================================================
 * housing-labels.js — Labels module (Settings -> Admin -> Labels)
 *
 * Real printable 2"x1" unit labels: per-nation config + 2-3 emergency contacts
 * + unit selection (with a "stale" reprint filter) + a live printed-QR-module
 * size calc, and two outputs: an HTML print sheet/roll (exact `in` sizing) and
 * a single-ink K-only knockout metal-press PDF.
 *
 * Conventions match the rest of the app: raw fetch() to Supabase REST/RPC with
 * HOUSING_HEADERS + SUPABASE_URL, qrcodejs via the global _qrLoadLib(), jsPDF
 * via a local lazy loader (mirrors _prjLoadJsPdf), ED/super_user gated in the
 * UI (DB RLS gates get_my_role()). Logo + nation name come from NATION_CONFIG.
 * ========================================================================== */
(function () {
  'use strict';

  var LBL_DEFAULTS = {
    cta_text: 'SCAN TO REPORT AN ISSUE',
    qr_error_level: 'M',
    label_width_in: 2.00,
    label_height_in: 1.00,
    accent_colour: '#F2C14E'
  };
  // QR byte-mode data capacity by version (1..10) per error level; module count
  // for version v is 17 + 4v. Lets us compute the printed module size WITHOUT
  // rendering, so the UI can warn/block before printing.
  var QR_CAP = {
    L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
    M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
    Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
    H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119]
  };
  var QR_IN = 0.58;          // printed QR square (inches)
  var QR_QUIET = 2;          // quiet-zone modules each side

  var _lbl = { config: null, contacts: [], statusByUnit: {}, selected: {}, loaded: false, filter: '', staleOnly: false, occOnly: false };

  // ---- helpers ---------------------------------------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function _hdrs() { return Object.assign({}, window.HOUSING_HEADERS, { 'Content-Type': 'application/json' }); }
  function _units() { return (window.housingUnits || []).filter(function (u) { return !u.archived; }); }
  function _unitAddr(u) { return ((u.num || '') + ' ' + (u.street || '')).trim() || ('Unit ' + u.id); }
  function _isEd() { var r = (window.currentRole || ''); return r === 'ed' || r === 'super_user'; }
  function _nationLogo() { try { return (window._appSettings && window._appSettings.theme && window._appSettings.theme.theme && window._appSettings.theme.theme.logo) || (window._appSettings && window._appSettings.theme && window._appSettings.theme.logo) || (window.NATION_CONFIG && window.NATION_CONFIG.logo) || ''; } catch (e) { return (window.NATION_CONFIG && window.NATION_CONFIG.logo) || ''; } }
  function _nationName() { var nc = window.NATION_CONFIG || {}; return nc.display_name || nc.short || 'Housing'; }

  async function _rpc(fn, args) {
    var r = await fetch(window.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: _hdrs(), body: JSON.stringify(args || {}) });
    var t = await r.text();
    var d; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
    if (!r.ok) throw new Error((d && d.message) || ('RPC ' + fn + ' failed (' + r.status + ')'));
    return d;
  }
  async function _rest(method, path, body) {
    var r = await fetch(window.SUPABASE_URL + '/rest/v1/' + path, { method: method, headers: Object.assign(_hdrs(), { 'Prefer': 'return=minimal' }), body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { var t = await r.text().catch(function () { return ''; }); throw new Error(t || (method + ' ' + path + ' failed (' + r.status + ')')); }
    return true;
  }

  // Default QR base for this nation: its portal host + /u (no scheme, kept short
  // so the printed QR stays sparse). The /u/* redirect lives in _redirects.
  function _defaultQrBase() {
    var base = (typeof nationPortalBase === 'function') ? nationPortalBase() : location.origin;
    return String(base).replace(/^https?:\/\//, '').replace(/\/$/, '') + '/u';
  }
  function _qrTextFor(slug) {
    var base = (_lbl.config && _lbl.config.qr_base_url) || _defaultQrBase();
    base = String(base).replace(/\/$/, '');
    return base + '/' + slug;
  }
  // Printed module size (mm) for a given encoded string, without rendering.
  function _qrModuleMM(text) {
    var lvl = (_lbl.config && _lbl.config.qr_error_level) || LBL_DEFAULTS.qr_error_level;
    var cap = QR_CAP[lvl] || QR_CAP.M;
    var len = text.length, v = cap.length;
    for (var i = 0; i < cap.length; i++) { if (len <= cap[i]) { v = i + 1; break; } }
    var modules = 17 + 4 * v;
    return { version: v, modules: modules, mm: (QR_IN * 25.4) / (modules + 2 * QR_QUIET) };
  }
  // Representative worst case: the largest slug we might assign (unit count + a margin).
  function _sampleQrText() {
    var n = _units().length || 275;
    var sampleSlug = String(Math.max(n, 100) + 50);
    return _qrTextFor(sampleSlug);
  }

  // ---- data load -------------------------------------------------------------
  async function _lblLoad() {
    var cfg = await _rpc('get_label_config', {});
    _lbl.config = cfg || {};
    if (!_lbl.config.qr_base_url) _lbl.config.qr_base_url = _defaultQrBase();
    _lbl.contacts = (cfg && cfg.emergency_contacts) ? cfg.emergency_contacts.slice() : [];
    if (!_lbl.contacts.length) _lbl.contacts = [{ label: '', phone: '', is_active: true }, { label: '', phone: '', is_active: true }];
    // Reprint status (never_printed | stale | current)
    _lbl.statusByUnit = {};
    try {
      var r = await fetch(window.SUPABASE_URL + '/rest/v1/v_unit_label_status?select=unit_id,label_status,last_printed_at', { headers: window.HOUSING_HEADERS });
      if (r.ok) { (await r.json()).forEach(function (row) { _lbl.statusByUnit[row.unit_id] = row; }); }
    } catch (e) { /* status is best-effort */ }
    _lbl.loaded = true;
  }

  // ---- panel render ----------------------------------------------------------
  window.renderLabelsPanel = function () {
    var host = document.getElementById('labels_panel_body');
    if (!host) return;
    if (!_isEd()) { host.innerHTML = '<div class="empty-state-ctr">Labels are restricted to the Executive Director.</div>'; return; }
    host.innerHTML = '<div class="txt-sm-meta" style="padding:12px;">Loading label settings…</div>';
    _lblLoad().then(function () { _lblRender(host); }).catch(function (e) {
      host.innerHTML = '<div class="empty-state-ctr">Could not load label settings.<br><span class="txt-sm-meta">' + esc(e.message || e) + '</span><br><span class="txt-sm-meta">If this is a new nation, run the labels migration (supabase/migrations/20260818_labels.sql) on this project first.</span></div>';
    });
  };

  function _lblRender(host) {
    var c = _lbl.config, logo = _nationLogo();
    var dens = _qrModuleMM(_sampleQrText());
    host.innerHTML =
      '<div class="card card-flush sec-pad">'
      + _lblConfigHtml(c, logo)
      + '</div>'
      + '<div class="card card-flush sec-pad" style="margin-top:14px;">'
      + _lblContactsHtml()
      + '</div>'
      + '<div class="card card-flush sec-pad" style="margin-top:14px;">'
      + _lblDensityHtml(dens)
      + '</div>'
      + '<div class="card card-flush sec-pad" style="margin-top:14px;">'
      + _lblUnitsHtml()
      + '</div>';
    _lblWireUnitEvents();
  }

  function _row(label, id, val, ph, type) {
    return '<label class="lbl-yellow" style="display:block;margin-top:8px;">' + esc(label)
      + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"'
      + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' style="width:100%;margin-top:3px;"/></label>';
  }

  function _lblConfigHtml(c, logo) {
    var levels = ['L', 'M', 'Q', 'H'].map(function (l) { return '<option value="' + l + '"' + (c.qr_error_level === l ? ' selected' : '') + '>' + l + '</option>'; }).join('');
    return '<div class="modal-hdr">Label configuration</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;">'
      + '<div>' + _row('Department label', 'lbl_dept', c.department_label, 'Housing Department')
      + _row('Housing email', 'lbl_email', c.housing_email, 'housing@nation.ca', 'email')
      + _row('Housing phone', 'lbl_phone', c.housing_phone) + '</div>'
      + '<div>' + _row('Call to action', 'lbl_cta', c.cta_text || LBL_DEFAULTS.cta_text)
      + _row('Default community', 'lbl_comm', c.default_community, 'On reserve')
      + _row('Accent colour', 'lbl_accent', c.accent_colour || LBL_DEFAULTS.accent_colour) + '</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:0 14px;">'
      + _row('QR base URL (short domain -> denser-safe QR)', 'lbl_qrbase', c.qr_base_url, _defaultQrBase())
      + '<label class="lbl-yellow" style="display:block;margin-top:8px;">QR error level<select id="lbl_qrlvl" style="width:100%;margin-top:3px;">' + levels + '</select></label>'
      + _row('Width (in)', 'lbl_w', c.label_width_in || 2.00, '', 'number')
      + _row('Height (in)', 'lbl_h', c.label_height_in || 1.00, '', 'number')
      + '</div>'
      + '<div style="margin-top:12px;display:flex;align-items:center;gap:14px;">'
      + '<div><div class="txt-sm-meta">Nation logo (from Nation settings — read only)</div>'
      + '<div style="margin-top:4px;background:#000;border-radius:6px;padding:8px 12px;display:inline-block;min-width:80px;text-align:center;">'
      + (logo ? '<img src="' + esc(logo) + '" alt="logo" style="max-height:34px;max-width:150px;"/>' : '<span style="color:#e88;font-size:12px;">No logo set — printing is blocked</span>')
      + '</div></div>'
      + '<button class="btn btn-primary" style="margin-left:auto;" onclick="_lblSaveConfig()">Save configuration</button>'
      + '</div>'
      + '<div id="lbl_cfg_msg" class="txt-sm-meta" style="margin-top:6px;"></div>';
  }

  window._lblSaveConfig = function () {
    function v(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
    var row = {
      department_label: v('lbl_dept') || null,
      housing_email: v('lbl_email') || null,
      housing_phone: v('lbl_phone') || null,
      cta_text: v('lbl_cta') || LBL_DEFAULTS.cta_text,
      default_community: v('lbl_comm') || null,
      accent_colour: v('lbl_accent') || LBL_DEFAULTS.accent_colour,
      qr_base_url: v('lbl_qrbase') || _defaultQrBase(),
      qr_error_level: v('lbl_qrlvl') || 'M',
      label_width_in: parseFloat(v('lbl_w')) || 2.00,
      label_height_in: parseFloat(v('lbl_h')) || 1.00,
      updated_at: new Date().toISOString(),
      updated_by: (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || null
    };
    var msg = document.getElementById('lbl_cfg_msg'); if (msg) msg.textContent = 'Saving…';
    _rest('PATCH', 'nation_label_config?id=eq.true', row).then(function () {
      Object.assign(_lbl.config, row);
      if (msg) { msg.textContent = 'Saved.'; msg.style.color = 'var(--success)'; }
      // refresh density readout
      var host = document.getElementById('labels_panel_body'); if (host) _lblRender(host);
    }).catch(function (e) { if (msg) { msg.textContent = 'Could not save: ' + (e.message || e); msg.style.color = 'var(--danger)'; } });
  };

  // ---- emergency contacts ----------------------------------------------------
  function _lblContactsHtml() {
    var rows = _lbl.contacts.map(function (ct, i) {
      return '<div class="lbl-ct-row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center;margin-top:6px;">'
        + '<input value="' + esc(ct.label || '') + '" placeholder="Label (e.g. After-hours emergency)" data-lblct="label" data-i="' + i + '"/>'
        + '<input value="' + esc(ct.phone || '') + '" placeholder="Phone" data-lblct="phone" data-i="' + i + '"/>'
        + '<button class="btn btn-ghost" onclick="_lblRemoveContact(' + i + ')"' + (_lbl.contacts.length <= 2 ? ' disabled title="Minimum 2 contacts"' : '') + '>Remove</button>'
        + '</div>';
    }).join('');
    return '<div class="modal-hdr">Emergency contacts <span class="txt-sm-meta">(2–3 required)</span></div>'
      + '<div id="lbl_ct_list">' + rows + '</div>'
      + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">'
      + '<button class="btn btn-ghost" onclick="_lblAddContact()"' + (_lbl.contacts.length >= 3 ? ' disabled title="Maximum 3 contacts"' : '') + '>+ Add contact</button>'
      + '<button class="btn btn-primary" onclick="_lblSaveContacts()">Save contacts</button>'
      + '<span id="lbl_ct_msg" class="txt-sm-meta"></span></div>';
  }
  function _lblSyncContactsFromDom() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-lblct]'), function (inp) {
      var i = parseInt(inp.getAttribute('data-i'), 10), k = inp.getAttribute('data-lblct');
      if (_lbl.contacts[i]) _lbl.contacts[i][k] = inp.value;
    });
  }
  window._lblAddContact = function () { _lblSyncContactsFromDom(); if (_lbl.contacts.length >= 3) return; _lbl.contacts.push({ label: '', phone: '', is_active: true }); _reRenderContacts(); };
  window._lblRemoveContact = function (i) { _lblSyncContactsFromDom(); if (_lbl.contacts.length <= 2) return; _lbl.contacts.splice(i, 1); _reRenderContacts(); };
  function _reRenderContacts() {
    var wrap = document.querySelector('#labels_panel_body .card:nth-child(2)');
    // simplest: re-render whole panel to keep add/remove disabled states in sync
    var host = document.getElementById('labels_panel_body'); if (host) _lblRender(host);
  }
  window._lblSaveContacts = function () {
    _lblSyncContactsFromDom();
    var clean = _lbl.contacts.map(function (c) { return { label: (c.label || '').trim(), phone: (c.phone || '').trim(), is_active: true }; })
      .filter(function (c) { return c.label || c.phone; });
    var msg = document.getElementById('lbl_ct_msg');
    if (clean.length < 2 || clean.length > 3) { if (msg) { msg.textContent = 'Keep 2 or 3 contacts.'; msg.style.color = 'var(--danger)'; } return; }
    if (clean.some(function (c) { return !c.label || !c.phone; })) { if (msg) { msg.textContent = 'Every contact needs a label and phone.'; msg.style.color = 'var(--danger)'; } return; }
    if (msg) { msg.textContent = 'Saving…'; msg.style.color = ''; }
    _rpc('set_emergency_contacts', { p_contacts: clean }).then(function () {
      if (msg) { msg.textContent = 'Saved.'; msg.style.color = 'var(--success)'; }
      var host = document.getElementById('labels_panel_body'); if (host) _lblRender(host);
    }).catch(function (e) { if (msg) { msg.textContent = 'Could not save: ' + (e.message || e); msg.style.color = 'var(--danger)'; } });
  };

  // ---- QR density readout ----------------------------------------------------
  function _lblDensityHtml(d) {
    var warn = d.mm < 0.45 ? 'block' : (d.mm < 0.6 ? 'warn' : 'ok');
    var col = warn === 'ok' ? 'var(--success)' : (warn === 'warn' ? 'var(--warn-amber-text)' : 'var(--danger)');
    var txt = warn === 'ok' ? 'Good — scans reliably on a printed label.'
      : warn === 'warn' ? 'Marginal — under 0.6 mm/module. Use a shorter QR base URL (e.g. a short nation domain) for reliable scanning.'
        : 'Too dense — under 0.45 mm/module. Printing is blocked. Shorten the QR base URL.';
    return '<div class="modal-hdr">Printed QR size</div>'
      + '<div class="txt-sm-meta">Encoded sample: <code>' + esc(_sampleQrText()) + '</code></div>'
      + '<div style="margin-top:6px;font-weight:700;color:' + col + ';">'
      + d.mm.toFixed(2) + ' mm per module &middot; QR version ' + d.version + ' (' + d.modules + '×' + d.modules + ' modules) at ' + QR_IN + '&quot;</div>'
      + '<div class="txt-sm-meta" style="color:' + col + ';margin-top:3px;">' + txt + '</div>';
  }

  // ---- unit selection --------------------------------------------------------
  function _statusPill(s) {
    if (s === 'stale') return '<span class="badge" style="background:var(--warn-amber-bg);color:var(--warn-amber-text);">stale</span>';
    if (s === 'current') return '<span class="badge" style="background:var(--success-bg);color:var(--success);">current</span>';
    return '<span class="badge" style="background:#eee;color:#777;">never</span>';
  }
  function _lblFilteredUnits() {
    var f = (_lbl.filter || '').toLowerCase();
    return _units().filter(function (u) {
      if (_lbl.occOnly && !(u.assignedName || u.assignedTo)) return false;
      var st = (_lbl.statusByUnit[u.id] || {}).label_status || 'never_printed';
      if (_lbl.staleOnly && st !== 'stale') return false;
      if (f) { var hay = (_unitAddr(u) + ' ' + u.id).toLowerCase(); if (hay.indexOf(f) === -1) return false; }
      return true;
    });
  }
  function _lblUnitsHtml() {
    var rows = _lblFilteredUnits().map(function (u) {
      var st = (_lbl.statusByUnit[u.id] || {}).label_status || 'never_printed';
      return '<tr><td><input type="checkbox" data-lblunit="' + esc(u.id) + '"' + (_lbl.selected[u.id] ? ' checked' : '') + '/></td>'
        + '<td><b>' + esc(_unitAddr(u)) + '</b></td><td class="txt-sm-meta">' + esc(u.id) + '</td>'
        + '<td>' + _statusPill(st) + '</td></tr>';
    }).join('');
    var selCount = Object.keys(_lbl.selected).filter(function (k) { return _lbl.selected[k]; }).length;
    var noLogo = !_nationLogo();
    return '<div class="modal-hdr">Units &amp; printing</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">'
      + '<input id="lbl_filter" placeholder="Filter by address or id" value="' + esc(_lbl.filter) + '" style="flex:1;min-width:180px;"/>'
      + '<label class="txt-sm-meta" style="display:flex;align-items:center;gap:4px;"><input type="checkbox" id="lbl_stale"' + (_lbl.staleOnly ? ' checked' : '') + '/> Stale only</label>'
      + '<label class="txt-sm-meta" style="display:flex;align-items:center;gap:4px;"><input type="checkbox" id="lbl_occ"' + (_lbl.occOnly ? ' checked' : '') + '/> Occupied only</label>'
      + '<button class="btn btn-ghost" onclick="_lblSelectAll(true)">Select all</button>'
      + '<button class="btn btn-ghost" onclick="_lblSelectAll(false)">Clear</button>'
      + '</div>'
      + '<div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px;"><table class="std-table" style="width:100%;"><tbody>' + rows + '</tbody></table></div>'
      + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
      + '<b>' + selCount + ' selected</b>'
      + '<label class="txt-sm-meta">Sheet cols <input id="lbl_cols" type="number" value="' + (_lbl.cols || 3) + '" min="1" max="6" style="width:52px;"/></label>'
      + '<label class="txt-sm-meta">rows <input id="lbl_rows" type="number" value="' + (_lbl.rows || 10) + '" min="1" max="20" style="width:52px;"/></label>'
      + '<input id="lbl_notes" placeholder="Batch notes (optional)" style="flex:1;min-width:150px;"/>'
      + '</div>'
      + (noLogo ? '<div class="txt-sm-meta" style="color:var(--danger);margin-top:6px;">No nation logo set — set one in Nation settings before printing.</div>' : '')
      + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn btn-primary" onclick="_lblPrint(\'laser_sheet\')">Print sheet (laser)</button>'
      + '<button class="btn btn-ghost" onclick="_lblPrint(\'roll\')">Print roll (1/label)</button>'
      + '<button class="btn btn-ghost" onclick="_lblPrint(\'metal_pdf\')">Metal press PDF</button>'
      + '<button class="btn btn-ghost" onclick="_lblAlignmentTest()">Alignment test</button>'
      + '</div>'
      + '<div id="lbl_print_msg" class="txt-sm-meta" style="margin-top:6px;"></div>';
  }
  function _lblWireUnitEvents() {
    var f = document.getElementById('lbl_filter'); if (f) f.oninput = function () { _lbl.filter = f.value; _refreshUnits(); };
    var s = document.getElementById('lbl_stale'); if (s) s.onchange = function () { _lbl.staleOnly = s.checked; _refreshUnits(); };
    var o = document.getElementById('lbl_occ'); if (o) o.onchange = function () { _lbl.occOnly = o.checked; _refreshUnits(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-lblunit]'), function (cb) {
      cb.onchange = function () { _lbl.selected[cb.getAttribute('data-lblunit')] = cb.checked; };
    });
  }
  function _refreshUnits() {
    // re-render only the units card body to preserve focus in the filter box
    var host = document.getElementById('labels_panel_body'); if (!host) return;
    var cards = host.querySelectorAll('.card'); var unitsCard = cards[cards.length - 1];
    if (unitsCard) { unitsCard.innerHTML = _lblUnitsHtml(); _lblWireUnitEvents(); var f = document.getElementById('lbl_filter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
  }
  window._lblSelectAll = function (on) {
    _lblFilteredUnits().forEach(function (u) { _lbl.selected[u.id] = !!on; });
    _refreshUnits();
  };

  function _selectedUnitIds() { return Object.keys(_lbl.selected).filter(function (k) { return _lbl.selected[k]; }); }
  function _pmsg(t, err) { var m = document.getElementById('lbl_print_msg'); if (m) { m.textContent = t; m.style.color = err ? 'var(--danger)' : ''; } }

  // ---- print orchestration ---------------------------------------------------
  window._lblAlignmentTest = function () { _lblDoPrint(['__ALIGN__'], 'laser_sheet', true); };

  window._lblPrint = function (output) {
    if (!_nationLogo()) { _pmsg('Set a nation logo before printing.', true); return; }
    var d = _qrModuleMM(_sampleQrText());
    if (d.mm < 0.45) { _pmsg('QR modules are ' + d.mm.toFixed(2) + ' mm (under 0.45). Shorten the QR base URL first.', true); return; }
    var ids = _selectedUnitIds();
    if (!ids.length) { _pmsg('Select at least one unit.', true); return; }
    _pmsg('Preparing ' + ids.length + ' label(s)…');
    // Assign slugs to any selected unit that lacks one, then render.
    Promise.all(ids.map(function (id) {
      var u = _units().filter(function (x) { return x.id === id; })[0];
      if (u && u.label_slug != null) return Promise.resolve({ id: id, slug: u.label_slug });
      return _rpc('assign_label_slug', { p_unit_id: id }).then(function (slug) { if (u) u.label_slug = slug; return { id: id, slug: slug }; });
    })).then(function (mapped) {
      var slugById = {}; mapped.forEach(function (m) { slugById[m.id] = m.slug; });
      _lblDoPrint(ids, output, false, slugById);
    }).catch(function (e) { _pmsg('Could not assign QR slugs: ' + (e.message || e), true); });
  };

  // Build a label descriptor (content the renderers consume).
  function _labelDescriptor(unitId, slugById) {
    var u = _units().filter(function (x) { return x.id === unitId; })[0] || { id: unitId };
    var c = _lbl.config || {};
    var slug = slugById ? slugById[unitId] : u.label_slug;
    return {
      unitId: unitId,
      address: _unitAddr(u),
      community: c.default_community || '',
      cta: c.cta_text || LBL_DEFAULTS.cta_text,
      department: c.department_label || '',
      email: c.housing_email || '',
      phone: c.housing_phone || '',
      accent: c.accent_colour || LBL_DEFAULTS.accent_colour,
      contacts: (_lbl.contacts || []).filter(function (x) { return (x.label || '').trim() && (x.phone || '').trim(); }).map(function (x) { return { label: x.label.trim(), phone: x.phone.trim() }; }),
      qrText: _qrTextFor(slug),
      logo: _nationLogo()
    };
  }

  function _lblDoPrint(ids, output, isAlign, slugById) {
    var descs = isAlign ? [_alignDescriptor()] : ids.map(function (id) { return _labelDescriptor(id, slugById); });
    _ensureQr(function () {
      // Render each QR to a PNG data URL up front.
      _renderQrs(descs, function () {
        if (output === 'metal_pdf') { _lblMetalPdf(descs); }
        else { _lblHtmlPrint(descs, output); }
        if (!isAlign) _recordPrints(ids, output);
      });
    });
  }

  function _recordPrints(ids, output) {
    var notes = (document.getElementById('lbl_notes') || {}).value || null;
    _rpc('record_label_prints', { p_unit_ids: ids, p_output: output, p_substrate: (output === 'metal_pdf' ? 'anodized_aluminum' : 'paper'), p_notes: notes })
      .then(function () { _pmsg('Printed ' + ids.length + ' label(s) and logged the run.'); _lblLoad().then(function () { _refreshUnits(); }); })
      .catch(function (e) { _pmsg('Labels rendered, but logging the run failed: ' + (e.message || e), true); });
  }

  function _alignDescriptor() {
    return { unitId: '__ALIGN__', address: '123 Alignment Test', community: 'Print at 100% scale', cta: 'THIS BOX MUST MEASURE 2" x 1"', department: 'Housing Department', email: 'housing@nation.ca', phone: '555-555-5555', accent: (_lbl.config && _lbl.config.accent_colour) || LBL_DEFAULTS.accent_colour, contacts: [{ label: 'Emergency', phone: '911' }, { label: 'After hours', phone: '555-0000' }], qrText: _qrTextFor('000'), logo: _nationLogo() };
  }

  // ---- QR rendering to data URLs --------------------------------------------
  function _ensureQr(cb) { if (window.QRCode) return cb(); if (typeof _qrLoadLib === 'function') _qrLoadLib(cb); else { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = cb; document.head.appendChild(s); } }
  function _renderQrs(descs, cb) {
    var host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-9999px;top:0;'; document.body.appendChild(host);
    var lvl = (_lbl.config && _lbl.config.qr_error_level) || 'M';
    descs.forEach(function (d) {
      var el = document.createElement('div'); host.appendChild(el);
      new QRCode(el, { text: d.qrText, width: 320, height: 320, correctLevel: QRCode.CorrectLevel[lvl] || QRCode.CorrectLevel.M });
      var cv = el.querySelector('canvas'); var im = el.querySelector('img');
      d.qrPng = cv ? cv.toDataURL('image/png') : (im ? im.src : '');
    });
    // qrcodejs img may render async; if any missing, retry shortly.
    var missing = descs.some(function (d) { return !d.qrPng; });
    if (missing) { setTimeout(function () { descs.forEach(function (d) { if (!d.qrPng) { var im = host.querySelector('img'); if (im) d.qrPng = im.src; } }); document.body.removeChild(host); cb(); }, 250); }
    else { document.body.removeChild(host); cb(); }
  }

  // ---- shared label geometry -------------------------------------------------
  function _bandHeight(d) { var rows = (d.contacts.length || 0) + 1; return 0.045 + 0.095 * rows; }
  function _housingBits(d) { return [d.department, d.email, d.phone].filter(Boolean); }

  // ---- HTML print (laser sheet / roll / alignment) --------------------------
  function _labelHtml(d) {
    var bandH = _bandHeight(d);
    var contacts = d.contacts.map(function (c) { return '<div class="bline fit" style="color:' + esc(d.accent) + ';">' + esc(c.label) + ' &middot; ' + esc(c.phone) + '</div>'; }).join('');
    var housing = _housingBits(d).map(esc).join(' &middot; ');
    return '<div class="lbl">'
      + '<img class="qr" src="' + esc(d.qrPng || '') + '"/>'
      + '<div class="body" style="bottom:' + bandH.toFixed(3) + 'in;">'
      + '<div class="addr fit">' + esc(d.address) + '</div>'
      + (d.community ? '<div class="comm fit">' + esc(d.community) + '</div>' : '')
      + '<div class="cta fit">' + esc(d.cta) + '</div>'
      + '</div>'
      + '<div class="band" style="height:' + bandH.toFixed(3) + 'in;">'
      + (d.logo ? '<img class="blogo" src="' + esc(d.logo) + '"/>' : '')
      + '<div class="blines">' + contacts + '<div class="bline fit" style="color:#fff;">' + housing + '</div></div>'
      + '</div></div>';
  }

  function _lblHtmlPrint(descs, output) {
    var roll = (output === 'roll');
    var cols = Math.max(1, parseInt((document.getElementById('lbl_cols') || {}).value, 10) || 3);
    var mTop = 0.5, mSide = 0.19, gapX = 0.13, gapY = 0.0;   // Avery-ish 2x1 defaults
    var pageCss = roll
      ? '@page { size: 2in 1in; margin: 0; } .lbl { page-break-after: always; }'
      : '@page { size: letter; margin: ' + mTop + 'in ' + mSide + 'in; } .sheet { display:grid; grid-template-columns: repeat(' + cols + ', 2in); column-gap:' + gapX + 'in; row-gap:' + gapY + 'in; }';
    var css = '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      + 'html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;}'
      + pageCss
      + '.lbl{position:relative;width:2in;height:1in;overflow:hidden;background:#fff;}'
      + '.qr{position:absolute;top:0.055in;left:0.055in;width:0.58in;height:0.58in;image-rendering:pixelated;}'
      + '.body{position:absolute;left:0.70in;right:0.05in;top:0.055in;overflow:hidden;}'
      + '.addr{font-weight:800;font-size:12.5pt;line-height:1.0;white-space:nowrap;color:#111;}'
      + '.comm{font-size:7pt;color:#666;white-space:nowrap;margin-top:0.015in;}'
      + '.cta{font-size:5.4pt;font-weight:700;color:#666;white-space:nowrap;letter-spacing:.2px;margin-top:0.02in;}'
      + '.band{position:absolute;left:0;right:0;bottom:0;background:#000;display:flex;align-items:center;gap:0.05in;padding:0 0.05in;}'
      + '.blogo{height:0.2in;max-width:0.5in;object-fit:contain;flex:0 0 auto;}'
      + '.blines{flex:1 1 auto;min-width:0;}'
      + '.bline{white-space:nowrap;font-size:6pt;line-height:1.12;font-weight:700;overflow:hidden;}';
    var body = roll ? descs.map(_labelHtml).join('') : '<div class="sheet">' + descs.map(_labelHtml).join('') + '</div>';
    var fitJs = 'function fit(el){var fs=parseFloat(getComputedStyle(el).fontSize);var g=0;while(el.scrollWidth>el.clientWidth+0.5&&fs>3&&g<200){fs-=0.4;el.style.fontSize=fs+"px";g++;}return parseFloat(getComputedStyle(el).fontSize);}'
      + 'Array.prototype.forEach.call(document.querySelectorAll(".lbl"),function(l){'
      + 'Array.prototype.forEach.call(l.querySelectorAll(".body .fit"),fit);'
      + 'var bl=l.querySelectorAll(".band .fit"),min=999;Array.prototype.forEach.call(bl,function(e){min=Math.min(min,fit(e));});'
      + 'Array.prototype.forEach.call(bl,function(e){e.style.fontSize=min+"px";});});'
      + 'setTimeout(function(){window.focus();window.print();},60);';
    var w = window.open('', '_blank');
    if (!w) { _pmsg('Pop-up blocked — allow pop-ups to print.', true); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Unit labels</title><style>' + css + '</style></head><body>' + body + '<scr' + 'ipt>' + fitJs + '</scr' + 'ipt></body></html>');
    w.document.close();
  }

  // ---- Metal press PDF (K-only, knockout band) ------------------------------
  function _lblLoadJsPdf(cb, onerr) {
    if (window.jspdf && window.jspdf.jsPDF) return cb();
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = cb; s.onerror = onerr || function () { }; document.head.appendChild(s);
  }
  // Recolour a logo to a solid-white silhouette (opaque pixels -> white) so it
  // knocks out of the black band; transparent stays transparent (no ink).
  function _whiteSilhouette(dataUrl, cb) {
    if (!dataUrl) return cb('');
    var img = new Image();
    img.onload = function () {
      try {
        var cv = document.createElement('canvas'); cv.width = img.naturalWidth || 200; cv.height = img.naturalHeight || 80;
        var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, cv.width, cv.height);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/png'), cv.width / cv.height);
      } catch (e) { cb(''); }
    };
    img.onerror = function () { cb(''); };
    img.src = dataUrl;
  }
  function _fitText(doc, text, maxW, startPt, minPt) {
    var pt = startPt;
    doc.setFontSize(pt);
    while (doc.getTextWidth(text) > maxW && pt > (minPt || 4)) { pt -= 0.5; doc.setFontSize(pt); }
    return pt;
  }
  function _lblMetalPdf(descs) {
    var logo = (descs[0] && descs[0].logo) || '';
    _whiteSilhouette(logo, function (whiteLogo, logoAR) {
      _lblLoadJsPdf(function () {
        var jsPDF = window.jspdf.jsPDF;
        var bleed = 0.125, trimW = 2, trimH = 1, W = trimW + 2 * bleed, Ht = trimH + 2 * bleed;
        var doc = new jsPDF({ unit: 'in', format: [W, Ht] });
        descs.forEach(function (d, idx) {
          if (idx > 0) doc.addPage([W, Ht], 'p');
          _metalLabel(doc, d, bleed, trimW, trimH, W, Ht, whiteLogo, logoAR);
        });
        var fname = 'unit-labels-metal.pdf';
        doc.save(fname);
        try { window.open(doc.output('bloburl'), '_blank'); } catch (e) { }
      }, function () { _pmsg('Could not load the PDF engine (offline?).', true); });
    });
  }
  function _metalLabel(doc, d, bleed, trimW, trimH, W, Ht, whiteLogo, logoAR) {
    var ox = bleed, oy = bleed; // trim origin
    // QR — black modules print directly; white in the PNG = no ink = bare metal.
    if (d.qrPng) doc.addImage(d.qrPng, 'PNG', ox + 0.055, oy + 0.055, 0.58, 0.58);
    var bandH = _bandHeight(d), bandY = oy + trimH - bandH;
    // Full-bleed black band (extends into the bottom bleed + both side bleeds).
    doc.setFillColor(0, 0, 0); doc.rect(0, bandY, W, Ht - bandY, 'F');
    // Body text (100% K only — no grey tints on metal).
    var bx = ox + 0.70, bw = (ox + trimW - 0.05) - bx, by = oy + 0.11;
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold');
    _fitText(doc, d.address, bw, 12.5, 6); doc.text(d.address, bx, by, { baseline: 'top' });
    var yy = by + 0.16;
    if (d.community) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(d.community, bx, yy, { baseline: 'top' }); yy += 0.11; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.4); doc.text(d.cta, bx, yy, { baseline: 'top' });
    // Knockout logo (white silhouette) at the band left.
    var lx = ox + 0.05, logoH = Math.min(0.2, bandH - 0.04), logoW = logoH * (logoAR || 2);
    if (whiteLogo) { try { doc.addImage(whiteLogo, 'PNG', lx, bandY + (bandH - logoH) / 2, logoW, logoH); } catch (e) { } }
    // Knockout band text (white = no ink = bare-metal letters).
    var tx = ox + 0.05 + (whiteLogo ? logoW + 0.05 : 0), tw = (ox + trimW - 0.05) - tx;
    var lineH = 0.095, ty = bandY + 0.05;
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
    d.contacts.forEach(function (c) { var s = c.label + ' · ' + c.phone; _fitText(doc, s, tw, 6, 3.5); doc.text(s, tx, ty, { baseline: 'top' }); ty += lineH; });
    var hz = _housingBits(d).join(' · '); _fitText(doc, hz, tw, 6, 3.5); doc.text(hz, tx, ty, { baseline: 'top' });
    // Crop marks at the four trim corners.
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.006);
    var m = 0.06, cx0 = ox, cy0 = oy, cx1 = ox + trimW, cy1 = oy + trimH;
    [[cx0, cy0, 1, 1], [cx1, cy0, -1, 1], [cx0, cy1, 1, -1], [cx1, cy1, -1, -1]].forEach(function (c) {
      doc.line(c[0], c[1] - c[3] * 0.02, c[0], c[1] - c[3] * (0.02 + m)); // vertical tick outside trim
      doc.line(c[0] - c[2] * 0.02, c[1], c[0] - c[2] * (0.02 + m), c[1]); // horizontal tick
    });
  }

  window._labelsBoot = true; // marker that the module loaded
})();
