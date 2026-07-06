/* ============================================================================
 * inspection-questionnaire.js — Guided Unit Inspection questionnaire
 *
 * A guided, section-by-section walkthrough of a unit inspection (Option A):
 *   Details  ->  one screen per checklist section  ->  Review
 * Each item is rated Pass / Repair / Fail / N-A with an optional note, with a
 * "Mark all Pass" shortcut per section and a progress bar. The Review screen
 * summarises deficiencies and captures general notes, then hands off to the
 * existing inspection modal (openInspectionModal) PRE-FILLED via window._inspSeed
 * so photos, approval sign-off, PDF and the save path are 100% reused.
 *
 * Mirrors reno-questionnaire.js: self-contained IIFE, self-injected modal,
 * delegated handlers (no inline onclick), universal Back button.
 *
 * Public:  window.openInspectionQuestionnaire(prefillUnitId?)
 *          window.closeInspectionQuestionnaire()
 * Reuses the globals INSP_CHECKLIST_TEMPLATE and INSP_TYPES from inspections-init.js.
 * ========================================================================== */
(function(){
  'use strict';

  var RATINGS = [
    { v:'pass',   lbl:'✓ Pass',   c:'#15803d', bg:'#f0fdf4', bd:'#86efac' },
    { v:'repair', lbl:'⚠ Repair', c:'#b45309', bg:'#fffbeb', bd:'#fcd34d' },
    { v:'fail',   lbl:'✗ Fail',   c:'#b91c1c', bg:'#fef2f2', bd:'#fca5a5' },
    { v:'na',     lbl:'N/A',           c:'#6b7280', bg:'#f4f4f5', bd:'#d4d4d8' }
  ];

  function _sections(){ return (typeof INSP_CHECKLIST_TEMPLATE !== 'undefined' && INSP_CHECKLIST_TEMPLATE) || []; }
  function _types(){ return (typeof INSP_TYPES !== 'undefined' && INSP_TYPES) || ['Routine']; }
  function _key(section, item){ return section + '|' + item; }

  // ── State ──────────────────────────────────────────────────────────────────
  var S = null;
  function _reset(unitId, unitLabel){
    S = {
      unitId:   unitId || '',
      unitLabel:unitLabel || '',
      type:     'Routine',
      date:     new Date().toISOString().split('T')[0],
      inspector:(window.HOUSING_SESSION && window.HOUSING_SESSION.name) || '',
      role:     window.currentRole || '',
      step:     unitId ? 'section' : 'details',
      sectionIdx: 0,
      ratings:  {},   // key -> { rating, notes }
      generalNotes: ''
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
  function _deficiencies(){
    var out = [];
    _sections().forEach(function(sec){
      sec.items.forEach(function(item){
        var r = S.ratings[_key(sec.section, item)];
        if(r && (r.rating === 'fail' || r.rating === 'repair')){
          out.push({ section: sec.section, item: item, rating: r.rating, notes: (r.notes||'') });
        }
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

    var secs = _sections();
    var html = '', footLeft = '', footRight = '';

    // Progress bar — one segment per section, only during the section walk.
    if(prog){
      if(S.step === 'section'){
        var pct = Math.round(((S.sectionIdx) / Math.max(1, secs.length)) * 100);
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
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:14px;">'+typeBtns+'</div>'
        + '<div style="display:flex;gap:12px;flex-wrap:wrap;">'
        +   '<div style="flex:1;min-width:150px;"><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;">INSPECTION DATE</label>'
        +     '<input id="iq_date" type="date" value="'+_esc(S.date)+'" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;font-family:var(--sans);"/></div>'
        +   '<div style="flex:1;min-width:150px;"><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;">INSPECTOR</label>'
        +     '<input id="iq_inspector" type="text" value="'+_esc(S.inspector)+'" placeholder="Full name" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;font-family:var(--sans);"/></div>'
        + '</div>';
      footRight = '<button class="btn btn-primary" data-iq-start="1"'+(S.unitId?'':' disabled')+'>Start inspection →</button>';
    }

    // ── One section ───────────────────────────────────────────────────────────
    else if(S.step === 'section'){
      var sec = secs[S.sectionIdx];
      html = _stepTitle(sec.section, 'Rate each item. Add a note on anything that needs repair or fails.')
        + '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">'
        +   '<button class="btn btn-ghost btn-sm" data-iq-allpass="1" style="font-size:12px;">✓ Mark all Pass</button></div>'
        + '<div style="display:flex;flex-direction:column;gap:10px;">'
        + sec.items.map(function(item){ return _itemRow(sec.section, item); }).join('')
        + '</div>';
      footLeft  = '<button class="btn btn-ghost" data-iq-back="1">← Back</button>';
      footRight = (S.sectionIdx < secs.length - 1)
        ? '<button class="btn btn-primary" data-iq-next="1">Next section →</button>'
        : '<button class="btn btn-primary" data-iq-next="1">Review →</button>';
    }

    // ── Review ────────────────────────────────────────────────────────────────
    else if(S.step === 'review'){
      var c = _counts();
      var defs = _deficiencies();
      var st = _suggestStatus();
      var stMeta = { pass:{l:'Pass',c:'#15803d'}, needs_repair:{l:'Needs Repair',c:'#b45309'}, fail:{l:'Fail',c:'#b91c1c'}, pending:{l:'Pending',c:'#6b7280'} }[st];
      html = _stepTitle('Review & save','Confirm the summary, add any overall notes, then continue to add photos and save.')
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">'
        +   _pill(c.rated + '/' + c.total + ' rated', 'var(--muted)')
        +   _pill(c.pass + ' pass', '#15803d')
        +   (c.repair ? _pill(c.repair + ' repair', '#b45309') : '')
        +   (c.fail ? _pill(c.fail + ' fail', '#b91c1c') : '')
        +   '<span style="margin-left:auto;font-size:12px;font-weight:700;color:'+stMeta.c+';align-self:center;">Overall: '+stMeta.l+'</span>'
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
      html += '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;">GENERAL NOTES</label>'
        + '<textarea id="iq_notes" rows="4" placeholder="Overall observations, recommendations… (you can also draft these with AI on the next screen)" '
        +   'style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical;font-family:var(--sans);">'+_esc(S.generalNotes)+'</textarea>';
      footLeft  = '<button class="btn btn-ghost" data-iq-back="1">← Back</button>';
      footRight = '<button class="btn btn-primary" data-iq-finish="1">Add photos & save →</button>';
    }

    body.innerHTML = html;
    if(foot) foot.innerHTML = (footLeft || '<span></span>') + (footRight || '<span></span>');

    if(S.step === 'details'){
      var si = document.getElementById('iq_unit_search');
      if(si){ si.addEventListener('input', function(){ _renderUnits(this.value); }); }
      _renderUnits('');
    }
  }

  function _pill(txt, color){
    return '<span style="font-size:11px;font-weight:700;color:'+color+';background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:3px 11px;">'+_esc(txt)+'</span>';
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
    var showNote = cur === 'fail' || cur === 'repair';
    return '<div class="iq-item" style="border:1px solid var(--border);border-radius:10px;padding:9px 11px;background:var(--surface);">'
      + '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:7px;">'+_esc(item)+'</div>'
      + '<div style="display:flex;gap:6px;">'+btns+'</div>'
      + '<input data-iq-note="'+_esc(k)+'" type="text" value="'+_esc(note)+'" placeholder="Note — what’s wrong / location…" '
      +   'style="width:100%;margin-top:'+(showNote||note?'8px':'0')+';padding:'+(showNote||note?'8px 10px':'0')+';height:'+(showNote||note?'auto':'0')+';'
      +   'border:1px solid var(--border);border-radius:7px;font-size:12px;box-sizing:border-box;font-family:var(--sans);'
      +   'overflow:hidden;opacity:'+(showNote||note?'1':'0')+';transition:all .12s;'+((showNote||note)?'':'border:none;padding:0;margin:0;')+'"/>'
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

  // ── Sync DOM inputs into state (before nav / re-render) ─────────────────────
  function _syncDetails(){
    var d = document.getElementById('iq_date');       if(d) S.date = d.value;
    var ins = document.getElementById('iq_inspector'); if(ins) S.inspector = ins.value;
  }
  function _syncNotes(){
    var n = document.getElementById('iq_notes'); if(n) S.generalNotes = n.value;
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
    // Preserve any typed date/inspector before an action re-renders the step.
    if(S && S.step === 'details') _syncDetails();
    var t = e.target.closest('[data-iq-close],[data-iq-type],[data-iq-unit],[data-iq-start],[data-iq-back],[data-iq-next],[data-iq-allpass],[data-iq-rate],[data-iq-finish]');
    if(!t){ if(e.target.id === 'inspQModal') close(); return; }

    if(t.hasAttribute('data-iq-close')){ close(); return; }

    if(t.hasAttribute('data-iq-type')){ S.type = t.getAttribute('data-iq-type'); render(); return; }

    if(t.hasAttribute('data-iq-unit')){
      S.unitId = t.getAttribute('data-iq-unit');
      S.unitLabel = t.getAttribute('data-iq-unit-label') || '';
      render();
      return;
    }

    if(t.hasAttribute('data-iq-start')){
      _syncDetails();
      if(!S.unitId){ if(typeof showToast==='function') showToast('Please select a unit.'); return; }
      S.step = 'section'; S.sectionIdx = 0; render(); return;
    }

    if(t.hasAttribute('data-iq-rate')){
      var k = t.getAttribute('data-iq-rate'), v = t.getAttribute('data-iq-val');
      if(!S.ratings[k]) S.ratings[k] = { rating:'', notes:'' };
      S.ratings[k].rating = (S.ratings[k].rating === v) ? '' : v;   // toggle off if re-clicked
      render();   // re-render section to reflect selection + show/hide note field
      return;
    }

    if(t.hasAttribute('data-iq-allpass')){
      var sec = _sections()[S.sectionIdx];
      sec.items.forEach(function(item){
        var k2 = _key(sec.section, item);
        if(!S.ratings[k2]) S.ratings[k2] = { rating:'', notes:'' };
        S.ratings[k2].rating = 'pass';
      });
      render(); return;
    }

    if(t.hasAttribute('data-iq-back')){
      if(S.step === 'review'){ _syncNotes(); S.step = 'section'; S.sectionIdx = _sections().length - 1; render(); return; }
      if(S.step === 'section'){
        if(S.sectionIdx > 0){ S.sectionIdx--; render(); }
        else { S.step = 'details'; render(); }
        return;
      }
      return;
    }

    if(t.hasAttribute('data-iq-next')){
      if(S.sectionIdx < _sections().length - 1){ S.sectionIdx++; render(); }
      else { S.step = 'review'; render(); }
      return;
    }

    if(t.hasAttribute('data-iq-finish')){ _syncNotes(); _finish(); return; }
  }

  // ── Finish: seed the existing inspection modal and hand off ─────────────────
  function _finish(){
    var checklist = [];
    _sections().forEach(function(sec){
      sec.items.forEach(function(item){
        var r = S.ratings[_key(sec.section, item)];
        if(r && (r.rating || (r.notes && r.notes.trim()))){
          checklist.push({ key:_key(sec.section,item), section:sec.section, item:item, rating:r.rating||'', notes:(r.notes||'').trim() });
        }
      });
    });
    window._inspSeed = {
      unit_id:         S.unitId,
      unit_address:    S.unitLabel,
      type:            S.type,
      inspection_date: S.date,
      inspector_name:  S.inspector,
      inspector_role:  S.role,
      overall_status:  _suggestStatus(),
      general_notes:   S.generalNotes,
      checklist:       checklist
    };
    close();
    if(typeof openInspectionModal === 'function') openInspectionModal(null);
    else if(typeof showToast === 'function') showToast('Inspection form unavailable.', {type:'error'});
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
    S = null;
  }

  window.openInspectionQuestionnaire  = open;
  window.closeInspectionQuestionnaire = close;
})();
