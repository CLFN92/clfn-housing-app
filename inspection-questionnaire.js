/* ============================================================================
 * inspection-questionnaire.js — Guided Unit Inspection questionnaire
 *
 * A guided, BRANCHING walkthrough that SAVES DIRECTLY (no hand-off):
 *   Details  ->  per-section gate ("all good?" -> skip, or drill into items)
 *            ->  Photos  ->  Review (+ general comments)  ->  Save
 *
 * - Branching: each section first asks "Is everything OK here?" — "All good"
 *   marks the whole section Pass and advances; "Inspect items" drills into the
 *   item ratings (Pass / Repair / Fail / N-A) with an inline COMMENT on anything
 *   flagged.
 * - Photos are a step in the flow (the shared DocLibrary, scoped to the record
 *   id that is minted up front and reused on save).
 * - Save writes the inspection row directly via _inspSave + refreshes the list.
 *   Approval sign-off still happens later by opening the record in the form.
 *
 * Self-contained IIFE, self-injected modal, delegated handlers, universal Back.
 * Reuses globals from inspections-init.js: INSP_CHECKLIST_TEMPLATE, INSP_TYPES,
 * _inspUuid, _inspSave, _inspLoad, renderInspectionsList, DocLibrary.
 *
 * Public: window.openInspectionQuestionnaire(prefillUnitId?) / .close...()
 * ========================================================================== */
(function(){
  'use strict';

  var RATINGS = [
    { v:'pass',   lbl:'✓ Pass',   c:'#15803d', bg:'#f0fdf4', bd:'#86efac' },
    { v:'repair', lbl:'⚠ Repair', c:'#b45309', bg:'#fffbeb', bd:'#fcd34d' },
    { v:'fail',   lbl:'✗ Fail',   c:'#b91c1c', bg:'#fef2f2', bd:'#fca5a5' },
    { v:'na',     lbl:'N/A',      c:'#6b7280', bg:'#f4f4f5', bd:'#d4d4d8' }
  ];

  // Shared input CSS. -webkit-appearance:none strips iOS Safari's native
  // date-input chrome (which otherwise renders taller than a text input and
  // centres its text), so the Date and Inspector fields are the same height.
  var _iqFieldCss = 'width:100%;height:44px;box-sizing:border-box;padding:0 12px;'
    + 'border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:var(--sans);'
    + 'background:var(--surface);color:var(--text);-webkit-appearance:none;appearance:none;';

  function _sections(){ return (typeof INSP_CHECKLIST_TEMPLATE !== 'undefined' && INSP_CHECKLIST_TEMPLATE) || []; }
  function _types(){ return (typeof INSP_TYPES !== 'undefined' && INSP_TYPES) || ['Routine']; }
  function _key(section, item){ return section + '|' + item; }
  function _uuid(){ return (typeof _inspUuid === 'function') ? _inspUuid() : ('' + Date.now() + Math.round(1e6*(''+Math.random()).slice(2))); }

  // ── State ──────────────────────────────────────────────────────────────────
  var S = null;
  function _reset(unitId, unitLabel){
    S = {
      inspId:   _uuid(),               // record id + document-library scope
      unitId:   unitId || '',
      unitLabel:unitLabel || '',
      type:     'Routine',
      date:     new Date().toISOString().split('T')[0],
      inspector:(window.HOUSING_SESSION && window.HOUSING_SESSION.name) || '',
      role:     window.currentRole || '',
      step:     unitId ? 'section' : 'details',
      sectionIdx: 0,
      ratings:  {},   // key -> { rating, notes }
      generalNotes: '',
      saving: false,
      photoMounted: false
    };
  }

  // ── Modal shell ─────────────────────────────────────────────────────────────
  function _ensure(){
    if(document.getElementById('inspQModal')) return;
    var ov = document.createElement('div');
    ov.id = 'inspQModal'; ov.className = 'modal-ov'; ov.style.display = 'none';
    ov.innerHTML =
      '<div class="modal" style="max-width:760px;width:96%;max-height:92vh;display:flex;flex-direction:column;">'
      + '<div class="modal-hdr" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">'
      +   '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);">Unit Inspection</div>'
      +   '<h2 style="margin:2px 0 0;">Guided Inspection</h2>'
      +   '<div id="iq_unit_label" style="font-size:12px;color:var(--muted);margin-top:2px;"></div></div>'
      +   '<button class="modal-close" data-iq-close="1" aria-label="Close">✕</button>'
      + '</div>'
      + '<div id="iq_progress" style="padding:10px 18px 0;"></div>'
      + '<div id="iq_body" style="padding:14px 18px;overflow-y:auto;flex:1;"></div>'
      + '<div id="iq_footer" class="modal-ftr" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;border-top:1px solid var(--border);"></div>'
      + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', _onClick);
    ov.addEventListener('input', _onInput);
    ov.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function _stepTitle(t,sub){
    return '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:3px;">'+_esc(t)+'</div>'
      + (sub ? '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;">'+_esc(sub)+'</div>' : '<div style="margin-bottom:12px;"></div>');
  }
  function _pill(txt, color){
    return '<span style="font-size:11px;font-weight:700;color:'+color+';background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:3px 11px;">'+_esc(txt)+'</span>';
  }
  function _deficiencies(){
    var out = [];
    _sections().forEach(function(sec){
      sec.items.forEach(function(item){
        var r = S.ratings[_key(sec.section, item)];
        if(r && (r.rating === 'fail' || r.rating === 'repair')) out.push({ section:sec.section, item:item, rating:r.rating, notes:(r.notes||'') });
      });
    });
    return out;
  }
  function _counts(){
    var c = { total:0, pass:0, repair:0, fail:0, na:0, rated:0 };
    _sections().forEach(function(sec){
      sec.items.forEach(function(item){
        c.total++;
        var r = S.ratings[_key(sec.section, item)];
        if(r && r.rating){ c.rated++; if(c[r.rating] != null) c[r.rating]++; }
      });
    });
    return c;
  }
  function _suggestStatus(){
    var c = _counts();
    if(c.fail)   return 'fail';
    if(c.repair) return 'needs_repair';
    if(c.rated && c.rated >= (c.total - c.na)) return 'pass';
    return 'pending';
  }
  // ── Render ──────────────────────────────────────────────────────────────────
  function render(){
    var body = document.getElementById('iq_body');
    var foot = document.getElementById('iq_footer');
    var prog = document.getElementById('iq_progress');
    var ul   = document.getElementById('iq_unit_label');
    if(!body) return;
    if(ul) ul.textContent = S.unitLabel || '';
    S.photoMounted = false;

    var secs = _sections();
    var html = '', footLeft = '', footRight = '';

    if(prog){
      if(S.step === 'section'){
        var pct = Math.round((S.sectionIdx / Math.max(1, secs.length)) * 100);
        prog.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:6px;">'
          + '<span>Section ' + (S.sectionIdx+1) + ' of ' + secs.length + '</span>'
          + '<span>' + _counts().rated + ' of ' + _counts().total + ' items rated</span></div>'
          + '<div style="height:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;overflow:hidden;">'
          + '<div style="height:100%;width:' + pct + '%;background:var(--yellow);transition:width .2s;"></div></div>';
      } else { prog.innerHTML = ''; }
    }

    // ── Details ───────────────────────────────────────────────────────────────
    if(S.step === 'details'){
      var typeBtns = _types().map(function(t){
        var on = S.type === t;
        return '<button class="iq-opt" data-iq-type="'+_esc(t)+'" style="text-align:center;padding:10px 12px;border:2px solid '+(on?'var(--yellow)':'var(--border)')+';border-radius:10px;'
          + 'background:'+(on?'var(--bg)':'var(--surface)')+';cursor:pointer;font-size:13px;font-weight:600;font-family:var(--sans);color:var(--text);">'+_esc(t)+'</button>';
      }).join('');
      html = _stepTitle('Inspection details','Pick the unit and type, then walk each area.')
        + '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;">UNIT</label>'
        + '<input id="iq_unit_search" type="text" placeholder="Search units by address…" autocomplete="off" '
        +   'style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:8px;font-family:var(--sans);"/>'
        + '<div id="iq_unit_results" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;margin-bottom:14px;"></div>'
        + '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;">TYPE</label>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:18px;">'+typeBtns+'</div>'
        + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px;">'
        +   '<div style="flex:1;min-width:150px;margin-bottom:6px;"><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">INSPECTION DATE</label>'
        +     '<input id="iq_date" type="date" value="'+_esc(S.date)+'" style="'+_iqFieldCss+'text-align:left;"/></div>'
        +   '<div style="flex:1;min-width:150px;margin-bottom:6px;"><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">INSPECTOR</label>'
        +     '<input id="iq_inspector" type="text" value="'+_esc(S.inspector)+'" placeholder="Full name" style="'+_iqFieldCss+'"/></div>'
        + '</div>';
      footRight = '<button class="btn btn-primary" data-iq-start="1"'+(S.unitId?'':' disabled')+'>Start inspection →</button>';
    }

    // ── One section: rate the items (with a quick "mark all pass" shortcut) ───
    else if(S.step === 'section'){
      var sec  = secs[S.sectionIdx];
      html = _stepTitle(sec.section, 'Rate each item. A comment box opens on anything you flag Repair or Fail.')
        + '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">'
        +   '<button class="btn btn-ghost btn-sm" data-iq-allpass="1" style="font-size:12px;">✓ Mark remaining Pass</button></div>'
        + '<div style="display:flex;flex-direction:column;gap:10px;">'
        + sec.items.map(function(item){ return _itemRow(sec.section, item); }).join('')
        + '</div>';
      footLeft  = '<button class="btn btn-ghost" data-iq-back="1">← Back</button>';
      footRight = (S.sectionIdx < secs.length - 1)
        ? '<button class="btn btn-primary" data-iq-next="1">Next section →</button>'
        : '<button class="btn btn-primary" data-iq-next="1">Photos →</button>';
    }

    // ── Photos (in-flow) ──────────────────────────────────────────────────────
    else if(S.step === 'photos'){
      html = _stepTitle('Photos & documents','Attach any photos or files for this inspection. Optional — you can skip.')
        + '<div id="iq_doclib"></div>';
      footLeft  = '<button class="btn btn-ghost" data-iq-back="1">← Back</button>';
      footRight = '<button class="btn btn-primary" data-iq-next="1">Review →</button>';
    }

    // ── Review + general comments + SAVE ──────────────────────────────────────
    else if(S.step === 'review'){
      var c = _counts();
      var defs = _deficiencies();
      var st = _suggestStatus();
      var stMeta = { pass:{l:'Pass',c:'#15803d'}, needs_repair:{l:'Needs Repair',c:'#b45309'}, fail:{l:'Fail',c:'#b91c1c'}, pending:{l:'Pending',c:'#6b7280'} }[st];
      html = _stepTitle('Review & save','Confirm the summary, add any overall comments, then save the report.')
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">'
        +   _pill(c.rated + '/' + c.total + ' rated', 'var(--muted)')
        +   _pill(c.pass + ' pass', '#15803d')
        +   (c.repair ? _pill(c.repair + ' repair', '#b45309') : '')
        +   (c.fail ? _pill(c.fail + ' fail', '#b91c1c') : '')
        +   '<span style="margin-left:auto;font-size:12px;font-weight:700;color:'+stMeta.c+';">Overall: '+stMeta.l+'</span>'
        + '</div>';
      if(defs.length){
        html += '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Deficiencies ('+defs.length+')</div>'
          + '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">'
          + defs.map(function(d){
              var meta = d.rating === 'fail' ? {c:'#b91c1c',bg:'#fef2f2',l:'FAIL'} : {c:'#b45309',bg:'#fffbeb',l:'REPAIR'};
              return '<div style="border:1px solid var(--border);border-left:4px solid '+meta.c+';border-radius:8px;padding:8px 11px;background:'+meta.bg+';">'
                + '<div style="font-size:12px;font-weight:700;color:var(--text);">'+_esc(d.section)+' · '+_esc(d.item)+' '
                + '<span style="font-size:10px;font-weight:800;color:'+meta.c+';">'+meta.l+'</span></div>'
                + (d.notes ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+_esc(d.notes)+'</div>' : '')
                + '</div>';
            }).join('')
          + '</div>';
      } else {
        html += '<div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;padding:11px;font-size:12px;color:#15803d;font-weight:600;margin-bottom:16px;">✓ No deficiencies flagged — all rated items passed.</div>';
      }
      html += '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;">GENERAL COMMENTS</label>'
        + '<textarea id="iq_notes" rows="4" placeholder="Overall observations, recommendations, follow-up…" '
        +   'style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical;font-family:var(--sans);">'+_esc(S.generalNotes)+'</textarea>';
      footLeft  = '<button class="btn btn-ghost" data-iq-back="1">← Back</button>';
      footRight = '<button class="btn btn-primary" data-iq-save="1"'+(S.saving?' disabled':'')+'>'+(S.saving?'Saving…':'✓ Save Inspection')+'</button>';
    }

    body.innerHTML = html;
    if(foot) foot.innerHTML = (footLeft || '<span></span>') + (footRight || '<span></span>');

    if(S.step === 'details'){
      var si = document.getElementById('iq_unit_search');
      if(si) si.addEventListener('input', function(){ _renderUnits(this.value); });
      _renderUnits('');
    }
    if(S.step === 'photos') _mountPhotos();
  }

  function _itemRow(section, item){
    var k = _key(section, item);
    var cur = (S.ratings[k] && S.ratings[k].rating) || '';
    var note = (S.ratings[k] && S.ratings[k].notes) || '';
    var btns = RATINGS.map(function(r){
      var on = cur === r.v;
      return '<button class="iq-rate" data-iq-rate="'+_esc(k)+'" data-iq-val="'+r.v+'" '
        + 'style="flex:1;min-width:56px;padding:7px 4px;border:1.5px solid '+(on?r.bd:'var(--border)')+';border-radius:8px;'
        + 'background:'+(on?r.bg:'var(--surface)')+';color:'+(on?r.c:'var(--muted)')+';font-weight:'+(on?'800':'600')+';'
        + 'font-size:11px;cursor:pointer;font-family:var(--sans);white-space:nowrap;">'+r.lbl+'</button>';
    }).join('');
    var showNote = cur === 'fail' || cur === 'repair' || !!note;
    return '<div class="iq-item" style="border:1px solid var(--border);border-radius:10px;padding:9px 11px;background:var(--surface);">'
      + '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:7px;">'+_esc(item)+'</div>'
      + '<div style="display:flex;gap:6px;">'+btns+'</div>'
      + (showNote
          ? '<input data-iq-note="'+_esc(k)+'" type="text" value="'+_esc(note)+'" placeholder="Comment — what’s wrong / location…" '
            + 'style="width:100%;margin-top:8px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;box-sizing:border-box;font-family:var(--sans);"/>'
          : '')
      + '</div>';
  }

  function _renderUnits(q){
    var box = document.getElementById('iq_unit_results');
    if(!box) return;
    var units = (window.housingUnits || []).filter(function(u){ return u && !u.archived; })
      .map(function(u){ return { id:u.id, label:((u.num||'')+(u.num&&u.street?' ':'')+(u.street||'')) || u.id }; })
      .sort(function(a,b){ return a.label.localeCompare(b.label); });
    var ql = (q||'').toLowerCase().trim();
    if(ql) units = units.filter(function(u){ return u.label.toLowerCase().indexOf(ql) !== -1; });
    units = units.slice(0, 40);
    if(!units.length){ box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">No units match.</div>'; return; }
    box.innerHTML = units.map(function(u){
      var on = S.unitId === u.id;
      return '<button class="iq-unit" data-iq-unit="'+_esc(u.id)+'" data-iq-unit-label="'+_esc(u.label)+'" '
        + 'style="text-align:left;padding:9px 12px;border:1.5px solid '+(on?'var(--yellow)':'var(--border)')+';border-radius:8px;'
        + 'background:'+(on?'var(--bg)':'var(--surface)')+';cursor:pointer;font-size:13px;font-weight:600;color:var(--text);font-family:var(--sans);">'
        + _esc(u.label)+'</button>';
    }).join('');
  }

  // Mount the shared DocLibrary for photos, scoped to this record's id.
  function _mountPhotos(){
    var mount = document.getElementById('iq_doclib');
    if(!mount) return;
    if(!window.DocLibrary){ mount.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:12px;">Document library unavailable — you can add photos after saving.</div>'; return; }
    if(S.photoMounted) return;
    S.photoMounted = true;
    mount.innerHTML = '';
    try {
      window._inspQDocLib = window.DocLibrary.create(mount, {
        entityType:    'inspection',
        entityId:      S.inspId,
        pathPrefix:    'inspections/' + S.inspId + '/photos',
        supabaseUrl:   window.SUPABASE_URL,
        supabaseAnon:  window.SUPABASE_ANON,
        storageBucket: window.STORAGE_BUCKET,
        getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ',''); },
        auditTable:    'housing_audit_log',
        getActor:      function(){ return (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || window.currentRole || 'staff'; },
        categories:    [{ key:'photo', label:'Photo', icon:'📷' }, { key:'report', label:'Report', icon:'📄' }, { key:'other', label:'Other', icon:'📎' }]
      });
    } catch(e){ mount.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:12px;">Could not load the uploader — add photos after saving.</div>'; }
  }

  // ── Sync DOM inputs into state ──────────────────────────────────────────────
  function _syncDetails(){
    var d = document.getElementById('iq_date');       if(d) S.date = d.value;
    var ins = document.getElementById('iq_inspector'); if(ins) S.inspector = ins.value;
  }
  function _syncNotes(){ var n = document.getElementById('iq_notes'); if(n) S.generalNotes = n.value; }

  // ── Navigation helpers ──────────────────────────────────────────────────────
  function _advance(){
    if(S.sectionIdx < _sections().length - 1){ S.sectionIdx++; render(); }
    else { S.step = 'photos'; render(); }
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  function _onInput(e){
    var t = e.target;
    if(t && t.getAttribute && t.getAttribute('data-iq-note') != null){
      var k = t.getAttribute('data-iq-note');
      if(!S.ratings[k]) S.ratings[k] = { rating:'', notes:'' };
      S.ratings[k].notes = t.value;
    }
  }
  function _onClick(e){
    if(!S) return;
    if(S.step === 'details') _syncDetails();
    var t = e.target.closest('[data-iq-close],[data-iq-type],[data-iq-unit],[data-iq-start],[data-iq-back],[data-iq-next],[data-iq-allpass],[data-iq-rate],[data-iq-save]');
    if(!t){ if(e.target.id === 'inspQModal') close(); return; }

    if(t.hasAttribute('data-iq-close')){ close(); return; }
    if(t.hasAttribute('data-iq-type')){ S.type = t.getAttribute('data-iq-type'); render(); return; }
    if(t.hasAttribute('data-iq-unit')){ S.unitId = t.getAttribute('data-iq-unit'); S.unitLabel = t.getAttribute('data-iq-unit-label') || ''; render(); return; }

    if(t.hasAttribute('data-iq-start')){
      _syncDetails();
      if(!S.unitId){ if(typeof showToast==='function') showToast('Please select a unit.'); return; }
      S.step = 'section'; S.sectionIdx = 0; render(); return;
    }

    if(t.hasAttribute('data-iq-rate')){
      var k = t.getAttribute('data-iq-rate'), v = t.getAttribute('data-iq-val');
      if(!S.ratings[k]) S.ratings[k] = { rating:'', notes:'' };
      S.ratings[k].rating = (S.ratings[k].rating === v) ? '' : v;
      render(); return;
    }

    if(t.hasAttribute('data-iq-allpass')){
      var sec = _sections()[S.sectionIdx];
      sec.items.forEach(function(item){
        var k2 = _key(sec.section, item);
        if(!S.ratings[k2]) S.ratings[k2] = { rating:'', notes:'' };
        if(!S.ratings[k2].rating) S.ratings[k2].rating = 'pass';
      });
      render(); return;
    }

    if(t.hasAttribute('data-iq-back')){
      if(S.step === 'review'){ _syncNotes(); S.step = 'photos'; render(); return; }
      if(S.step === 'photos'){ S.step = 'section'; S.sectionIdx = _sections().length - 1; render(); return; }
      if(S.step === 'section'){
        if(S.sectionIdx > 0){ S.sectionIdx--; render(); }
        else { S.step = 'details'; render(); }
        return;
      }
      return;
    }

    if(t.hasAttribute('data-iq-next')){
      if(S.step === 'photos'){ S.step = 'review'; render(); return; }
      _advance(); return;   // from a section's items view
    }

    if(t.hasAttribute('data-iq-save')){ _syncNotes(); _save(); return; }
  }

  // ── Direct save ─────────────────────────────────────────────────────────────
  function _buildChecklist(){
    var out = [];
    _sections().forEach(function(sec){
      sec.items.forEach(function(item){
        var r = S.ratings[_key(sec.section, item)];
        if(r && (r.rating || (r.notes && r.notes.trim()))){
          out.push({ key:_key(sec.section,item), section:sec.section, item:item, rating:r.rating||'', notes:(r.notes||'').trim() });
        }
      });
    });
    return out;
  }
  async function _save(){
    if(S.saving) return;
    if(!S.unitId){ if(typeof showToast==='function') showToast('Please select a unit.', {type:'error'}); return; }
    if(typeof _inspSave !== 'function'){ if(typeof showToast==='function') showToast('Save is unavailable on this page.', {type:'error'}); return; }
    S.saving = true; render();
    var record = {
      id:              S.inspId,
      unit_id:         S.unitId,
      unit_address:    S.unitLabel,
      type:            S.type,
      inspection_date: S.date,
      inspector_name:  S.inspector,
      inspector_role:  S.role,
      overall_status:  _suggestStatus(),
      checklist:       _buildChecklist(),
      general_notes:   S.generalNotes,
      created_by:      (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || window.currentRole || ''
    };
    try {
      await _inspSave(record, true);
      if(typeof _inspLoad === 'function') await _inspLoad();
      if(typeof renderInspectionsList === 'function') renderInspectionsList();
      if(typeof showToast === 'function') showToast('✓ Inspection saved');
      close();
    } catch(e){
      S.saving = false; render();
      if(typeof showToast === 'function') showToast('Save failed: ' + (e && e.message ? e.message : 'unknown error'), {type:'error'});
    }
  }

  // ── Public ──────────────────────────────────────────────────────────────────
  function open(prefillUnitId){
    _ensure();
    var label = '';
    if(prefillUnitId){
      var u = (window.housingUnits||[]).find(function(x){ return x && x.id === prefillUnitId; });
      if(u) label = ((u.num||'')+(u.num&&u.street?' ':'')+(u.street||'')) || u.id;
    }
    _reset(prefillUnitId, label);
    render();
    var ov = document.getElementById('inspQModal');
    if(ov) ov.style.display = 'flex';
  }
  function close(){
    var ov = document.getElementById('inspQModal');
    if(ov) ov.style.display = 'none';
    window._inspQDocLib = null;
    S = null;
  }

  window.openInspectionQuestionnaire  = open;
  window.closeInspectionQuestionnaire = close;
})();
