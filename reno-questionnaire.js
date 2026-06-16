/* ============================================================================
 * reno-questionnaire.js — Dynamic Renovation / Maintenance Questionnaire
 *
 * A guided, branching wizard staff use to capture a complete scope of work.
 * Flow per issue:  Unit → Trade → Room → Component → Issue(s) → Severity → Details
 * Every question is button-driven from a data tree with an auto "Other…" free
 * text option, a Back button on every step, and multi-select at the Issue step
 * (e.g. a toilet that is both "Leaking at base" AND "Will not flush").
 * Multiple issues accumulate, then an overall Notes step. On submit it opens the
 * standard SOW (Maintenance Request) modal pre-populated (one work item per
 * issue) and can email a copy of the request to the tenant — entering and
 * saving the tenant's email to their record when none is on file.
 *
 * Public:  window.openRenoQuestionnaire(prefillUnitId?) / window.closeRenoQuestionnaire()
 * Self-contained IIFE; one delegated click handler (no inline onclick).
 * ========================================================================== */
(function(){
  'use strict';

  // ── Question tree (trades[].cat MUST match SOW_CATEGORIES) ─────────────────
  var ROOMS = ['Kitchen','Bathroom','Bedroom','Living Room','Hallway / Stairs',
               'Basement','Laundry','Utility / Mechanical','Exterior','Whole Unit'];

  var SEVERITY = [
    { v:'Urgent — safety / habitability', c:'#b91c1c' },
    { v:'High — needs prompt repair',     c:'#d97706' },
    { v:'Medium — schedule soon',         c:'#0891b2' },
    { v:'Low — cosmetic / when able',     c:'#15803d' }
  ];

  var TRADES = [
    { cat:'Plumbing', icon:'🚰', components:[
      { label:'Toilet',          issues:['Will not flush','Constantly running','Leaking at base','Tank / bowl cracked','Loose / rocks','Clogged','Seal / wax ring'] },
      { label:'Faucet / Tap',    issues:['Dripping / leaking','No or low pressure','No hot water','Handle broken','Leaking under sink','Corroded'] },
      { label:'Sink / Basin',    issues:['Drain clogged','Cracked / chipped','Leaking','Loose from wall'] },
      { label:'Bathtub / Shower',issues:['No hot water','Low pressure','Drain clogged','Cracked / chipped','Caulking / mould','Diverter broken'] },
      { label:'Water Heater',    issues:['No hot water','Leaking tank','Pilot / element','Noisy','Not enough hot water'] },
      { label:'Pipes / Drain',   issues:['Active leak','Frozen','Burst','Slow drain','Sewer smell / backup'] },
      { label:'Sump Pump',       issues:['Not working','Running constantly','Noisy'] }
    ]},
    { cat:'Electrical', icon:'💡', components:[
      { label:'Outlet / Receptacle', issues:['No power','Sparking / burnt','Loose / damaged','Not grounded','Warm to touch'] },
      { label:'Light Fixture',       issues:['Not working','Flickering','Broken / damaged','Missing','Cover missing'] },
      { label:'Switch',              issues:['Not working','Sparking','Loose','Warm to touch'] },
      { label:'Breaker / Panel',     issues:['Trips repeatedly','No power to area','Buzzing / humming','Burning smell','Label / cover missing'] },
      { label:'Smoke / CO Detector', issues:['Not working','Chirping / beeping','Missing','Expired','Disconnected'] },
      { label:'Wiring',              issues:['Exposed / unsafe','Burning smell','Knob & tube / old','Junction box open'] },
      { label:'Exterior Light',      issues:['Not working','Broken','Missing'] }
    ]},
    { cat:'Windows & Doors', icon:'🚪', components:[
      { label:'Window',         issues:['Will not open / close','Broken glass','Foggy / failed seal','Drafty','Lock / latch broken','Screen damaged','Rotted / damaged frame'] },
      { label:'Exterior Door',  issues:['Will not close / latch','Lock / deadbolt broken','Drafty','Damaged / rotted','Weatherstripping','Threshold damaged'] },
      { label:'Interior Door',  issues:['Will not close','Off the hinges','Hole / damage','Handle / latch broken','Missing'] },
      { label:'Patio / Sliding',issues:['Will not slide','Off track','Glass broken','Lock broken','Drafty'] },
      { label:'Storm Door',     issues:['Closer broken','Glass / screen damaged','Will not close'] }
    ]},
    { cat:'Heating / HVAC', icon:'🔥', components:[
      { label:'Furnace',           issues:['No heat','Short cycling','Noisy','Pilot / ignition','Filter / maintenance'] },
      { label:'Baseboard Heater',  issues:['No heat','Overheating','Damaged','Thermostat not working'] },
      { label:'Thermostat',        issues:['Not working','Inaccurate','Blank / no power'] },
      { label:'Ventilation / Fan', issues:['Not working','Noisy','Mould / dirty','Duct disconnected'] },
      { label:'Heat Pump / AC',    issues:['No heat','No cooling','Noisy','Leaking','Not turning on'] }
    ]},
    { cat:'Flooring', icon:'🪵', components:[
      { label:'Subfloor',      issues:['Soft / rotted','Squeaking','Uneven / sagging','Water damage'] },
      { label:'Finished Floor',issues:['Damaged / cracked','Lifting / peeling','Water damage','Worn out','Buckling'] },
      { label:'Carpet',        issues:['Stained','Torn / worn','Odour','Loose / tripping'] },
      { label:'Tile',          issues:['Cracked','Loose','Grout failing'] }
    ]},
    { cat:'Interior Walls / Drywall', icon:'🧱', components:[
      { label:'Drywall',          issues:['Hole','Crack','Water damage','Mould','Nail pops'] },
      { label:'Ceiling',          issues:['Water stain','Sagging','Crack','Hole'] },
      { label:'Trim / Baseboard', issues:['Damaged','Missing','Detached'] }
    ]},
    { cat:'Kitchen', icon:'🍳', components:[
      { label:'Cabinets',    issues:['Doors broken / off','Water damage','Missing hardware','Shelf broken'] },
      { label:'Countertop',  issues:['Damaged / cracked','Burned','Lifting / delaminating'] },
      { label:'Stove / Oven',issues:['Not working','Element / burner out','Door / seal','Hood fan'] },
      { label:'Fridge',      issues:['Not cooling','Leaking','Noisy','Seal damaged'] },
      { label:'Sink Area',   issues:['Backsplash damaged','Caulking'] }
    ]},
    { cat:'Bathroom', icon:'🛁', components:[
      { label:'Vanity / Cabinet', issues:['Water damage','Doors broken','Countertop damaged'] },
      { label:'Exhaust Fan',      issues:['Not working','Noisy','Mould / dirty','Missing'] },
      { label:'Tile / Surround',  issues:['Cracked','Mould','Loose','Grout / caulking failing'] },
      { label:'Mirror / Accessory',issues:['Broken','Missing','Loose'] }
    ]},
    { cat:'Roofing', icon:'🏠', components:[
      { label:'Shingles',     issues:['Missing','Damaged / curling','Active leak'] },
      { label:'Soffit / Fascia',issues:['Damaged','Rotted','Detached'] },
      { label:'Eavestrough',  issues:['Clogged','Leaking','Detached / sagging'] },
      { label:'Flashing / Vent',issues:['Leaking','Damaged','Missing'] }
    ]},
    { cat:'Exterior Walls / Siding', icon:'🧱', components:[
      { label:'Siding',     issues:['Damaged','Missing','Rotted','Loose'] },
      { label:'Trim / Corners',issues:['Damaged','Rotted','Missing'] },
      { label:'Caulking / Seal',issues:['Failing','Missing','Gap / draft'] }
    ]},
    { cat:'Foundation / Structure', icon:'🏗️', components:[
      { label:'Foundation',     issues:['Cracks','Water / seepage','Settling / heaving'] },
      { label:'Framing',        issues:['Rot','Damage','Sagging'] },
      { label:'Stairs / Railing',issues:['Loose','Broken','Missing','Rotted'] },
      { label:'Deck / Porch',   issues:['Rotted','Loose / unsafe','Railing'] }
    ]},
    { cat:'Insulation', icon:'🧣', components:[
      { label:'Attic / Ceiling', issues:['Missing / inadequate','Wet / damaged'] },
      { label:'Wall',            issues:['Missing / inadequate','Draft / cold spot'] },
      { label:'Pipes / Ducts',   issues:['Missing','Frozen risk'] }
    ]},
    { cat:'Painting', icon:'🎨', components:[
      { label:'Walls',   issues:['Peeling','Stained','Needs repaint','Patch & paint'] },
      { label:'Ceiling', issues:['Stained','Peeling','Needs repaint'] },
      { label:'Trim / Doors',issues:['Chipped','Needs repaint'] }
    ]},
    { cat:'Accessibility Modifications', icon:'♿', components:[
      { label:'Grab Bars',    issues:['Install required','Loose','Relocate'] },
      { label:'Ramp',         issues:['Install required','Repair','Railing'] },
      { label:'Door Widening',issues:['Required for mobility'] },
      { label:'Bathroom Mods',issues:['Walk-in / roll-in shower','Raised toilet','Other mod'] }
    ]},
    { cat:'Other', icon:'🔧', components:[
      { label:'General / Other', issues:['Describe in details'] }
    ]}
  ];

  // step → previous step (drives the universal Back button)
  var BACK = { trade:'unit', room:'trade', component:'room', issue:'component', severity:'issue', details:'severity', review:'trade' };

  // ── State ──────────────────────────────────────────────────────────────────
  var S = null;
  function _freshDraft(){ return { trade:null, room:'', component:'', issues:[], severity:'', details:'' }; }
  function _reset(unitId, unitLabel, tenantName){
    S = {
      unitId: unitId || '', unitLabel: unitLabel || '', tenantName: tenantName || '',
      step: unitId ? 'trade' : 'unit',
      draft: _freshDraft(),
      issues: [],
      notes: '',
      emailTenant: false, tenantEmail: '', tenantEmailOnFile: false, tenantResolved: false
    };
  }

  // ── Modal shell ─────────────────────────────────────────────────────────────
  function _ensure(){
    if(document.getElementById('renoQModal')) return;
    var ov = document.createElement('div');
    ov.id = 'renoQModal'; ov.className = 'modal-ov'; ov.style.display = 'none';
    ov.innerHTML =
      '<div class="modal" style="max-width:760px;width:96%;max-height:92vh;display:flex;flex-direction:column;">'
      + '<div class="modal-hdr" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">'
      +   '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);">Renovation Questionnaire</div>'
      +   '<h2 style="margin:2px 0 0;">New Maintenance Scope</h2>'
      +   '<div id="rq_unit_label" style="font-size:12px;color:var(--muted);margin-top:2px;"></div></div>'
      +   '<button class="modal-close" data-rq-close="1" aria-label="Close">&#x2715;</button>'
      + '</div>'
      + '<div id="rq_breadcrumb" style="padding:8px 18px 0;font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;"></div>'
      + '<div id="rq_body" style="padding:16px 18px;overflow-y:auto;flex:1;"></div>'
      + '<div id="rq_footer" class="modal-ftr" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;border-top:1px solid var(--border);"></div>'
      + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', _onClick);
    ov.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function _curTrade(){ return S.draft.trade; }
  function _curComponent(){ var t=_curTrade(); if(!t) return null; return (t.components||[]).filter(function(c){ return c.label === S.draft.component; })[0]; }

  function _optButton(field, val, color){
    var style = 'text-align:left;padding:11px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);'
      + 'cursor:pointer;font-size:13px;font-weight:600;font-family:var(--sans);color:var(--text);'
      + (color ? 'border-left:4px solid '+color+';' : '');
    return '<button class="rq-opt" data-rq-pick="'+field+'" data-rq-val="'+_esc(val)+'" style="'+style+'" '
      + 'onmouseover="this.style.borderColor=\'var(--yellow)\';this.style.background=\'var(--bg)\'" '
      + 'onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--surface)\'">'+_esc(val)+'</button>';
  }
  function _otherButton(field){
    return '<button class="rq-opt-other" data-rq-other="'+field+'" style="text-align:left;padding:11px 14px;border:1px dashed var(--border);border-radius:10px;'
      + 'background:var(--bg);cursor:pointer;font-size:13px;font-weight:600;color:var(--muted);font-family:var(--sans);">✏️ Other…</button>';
  }
  function _grid(inner){ return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:9px;">'+inner+'</div>'; }
  function _optGrid(field, values, colors){
    return _grid(values.map(function(v,i){ return _optButton(field, v, colors ? colors[i] : ''); }).join('') + _otherButton(field));
  }
  function _stepTitle(t,sub){
    return '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:3px;">'+_esc(t)+'</div>'
      + (sub ? '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;">'+_esc(sub)+'</div>' : '<div style="margin-bottom:12px;"></div>');
  }
  function _backBtn(){
    return BACK[S.step] ? '<button class="btn btn-ghost" data-rq-back="1">← Back</button>' : '<span></span>';
  }

  function render(){
    var body = document.getElementById('rq_body');
    var foot = document.getElementById('rq_footer');
    var bc   = document.getElementById('rq_breadcrumb');
    var ul   = document.getElementById('rq_unit_label');
    if(!body) return;
    if(ul) ul.textContent = S.unitLabel || '';

    var crumbs = [];
    if(S.draft.trade)        crumbs.push(S.draft.trade.cat);
    if(S.draft.room)         crumbs.push(S.draft.room);
    if(S.draft.component)    crumbs.push(S.draft.component);
    if(S.draft.issues.length)crumbs.push(S.draft.issues.join(', '));
    if(bc) bc.innerHTML = crumbs.length
      ? crumbs.map(function(c){ return '<span style="background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:2px 10px;">'+_esc(c)+'</span>'; }).join('<span>›</span>')
      : '';

    var html = '', footRight = '';

    if(S.step === 'unit'){
      html = _stepTitle('Which unit is this for?','Search by address or unit number.')
        + '<input id="rq_unit_search" type="text" placeholder="Search units…" autocomplete="off" '
        + 'style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:10px;font-family:var(--sans);"/>'
        + '<div id="rq_unit_results" style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;"></div>';
    }
    else if(S.step === 'trade'){
      html = _stepTitle('What needs work?','Pick the trade / area. You can add more than one issue.')
        + _grid(TRADES.map(function(t){
            return '<button class="rq-opt" data-rq-trade="'+_esc(t.cat)+'" style="text-align:left;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);cursor:pointer;font-size:13px;font-weight:600;font-family:var(--sans);color:var(--text);" '
              + 'onmouseover="this.style.borderColor=\'var(--yellow)\';this.style.background=\'var(--bg)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--surface)\'">'
              + '<span style="font-size:18px;margin-right:8px;">'+t.icon+'</span>'+_esc(t.cat)+'</button>';
          }).join(''));
      if(S.issues.length) footRight = '<button class="btn btn-ghost" data-rq-step="review">Review '+S.issues.length+' issue'+(S.issues.length>1?'s':'')+' →</button>';
    }
    else if(S.step === 'room'){
      html = _stepTitle('Which room / area?', S.draft.trade.cat) + _optGrid('room', ROOMS);
    }
    else if(S.step === 'component'){
      var t = _curTrade();
      html = _stepTitle('What item / component?', S.draft.trade.cat + ' · ' + S.draft.room)
        + _optGrid('component', (t.components||[]).map(function(c){ return c.label; }));
    }
    else if(S.step === 'issue'){
      var comp = _curComponent();
      var opts = (comp && comp.issues) ? comp.issues.slice() : ['Describe in details'];
      // include any custom (Other) issues already chosen so they show selected
      S.draft.issues.forEach(function(v){ if(opts.indexOf(v) === -1) opts.push(v); });
      html = _stepTitle('What is wrong? (select all that apply)', S.draft.component)
        + _grid(opts.map(function(v){
            var on = S.draft.issues.indexOf(v) !== -1;
            return '<button class="rq-toggle" data-rq-toggle="'+_esc(v)+'" style="text-align:left;padding:11px 14px;border:2px solid '+(on?'var(--yellow)':'var(--border)')+';border-radius:10px;'
              + 'background:'+(on?'var(--bg)':'var(--surface)')+';cursor:pointer;font-size:13px;font-weight:600;font-family:var(--sans);color:var(--text);display:flex;align-items:center;gap:8px;">'
              + '<span style="display:inline-flex;width:16px;height:16px;border-radius:4px;border:1px solid '+(on?'var(--yellow)':'var(--border)')+';background:'+(on?'var(--yellow)':'transparent')+';align-items:center;justify-content:center;font-size:11px;color:var(--dark);">'+(on?'✓':'')+'</span>'
              + _esc(v)+'</button>';
          }).join('') + _otherButton('issue'));
      footRight = '<button class="btn btn-primary" data-rq-step="severity"'+(S.draft.issues.length?'':' disabled')+'>Next →</button>';
    }
    else if(S.step === 'severity'){
      html = _stepTitle('How urgent is it?', S.draft.component + ' — ' + S.draft.issues.join(', '))
        + _optGrid('severity', SEVERITY.map(function(s){ return s.v; }), SEVERITY.map(function(s){ return s.c; }));
    }
    else if(S.step === 'details'){
      html = _stepTitle('Add detail','Describe exactly what you see — location, quantity, how long, any safety concern. The more detail, the better the scope of work.')
        + '<textarea id="rq_details" rows="4" placeholder="e.g. Main-floor bathroom faucet drips constantly and the cabinet below shows water staining. Tenant reports ~2 weeks." '
        + 'style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical;font-family:var(--sans);">'+_esc(S.draft.details)+'</textarea>';
      footRight = '<button class="btn btn-primary" data-rq-additem="1">✓ Add this issue</button>';
    }
    else if(S.step === 'review'){
      if(!S.tenantResolved) _resolveTenant();
      html = _stepTitle('Review & submit', S.issues.length + ' issue' + (S.issues.length===1?'':'s') + ' captured for ' + (S.unitLabel||'this unit') + '.');
      html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
      if(!S.issues.length){
        html += '<div style="padding:18px;text-align:center;color:var(--muted);font-style:italic;background:var(--bg);border-radius:8px;">No issues added yet.</div>';
      } else {
        S.issues.forEach(function(it, i){
          html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">'
            + '<div style="flex:1;min-width:0;">'
            +   '<div style="font-size:12px;font-weight:700;color:var(--text);">'+_esc(it.trade)+' · '+_esc(it.room)+'</div>'
            +   '<div style="font-size:13px;color:var(--text);margin-top:2px;">'+_esc(it.description)+'</div>'
            + '</div>'
            + '<button class="rq-del" data-rq-del="'+i+'" title="Remove" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer;color:var(--muted);font-size:11px;">Remove</button>'
            + '</div>';
        });
      }
      html += '</div>';
      html += '<button class="btn btn-ghost" data-rq-step="trade" style="margin-bottom:16px;">+ Add another issue</button>';

      html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:6px;">Overall notes (optional)</div>';
      html += '<textarea id="rq_notes" rows="3" placeholder="Anything else the crew / contractor should know — access, tenant availability, materials on hand…" '
        + 'style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical;font-family:var(--sans);margin-bottom:14px;">'+_esc(S.notes)+'</textarea>';

      // ── Email to tenant ──
      html += '<div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--surface);">'
        + '<label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;">'
        +   '<input type="checkbox" data-rq-emailtoggle="1"'+(S.emailTenant?' checked':'')+' style="margin-top:2px;width:16px;height:16px;"/>'
        +   '<span style="font-size:13px;font-weight:600;color:var(--text);">📧 Email a copy of this request to the tenant'
        +     (S.tenantName ? ' <span style="color:var(--muted);font-weight:400;">('+_esc(S.tenantName)+')</span>' : '')+'</span>'
        + '</label>';
      if(S.emailTenant){
        if(!S.tenantName){
          html += '<div style="font-size:12px;color:var(--danger);margin-top:8px;">No tenant is assigned to this unit, so there is no one to email.</div>';
        } else if(!S.tenantResolved){
          html += '<div style="font-size:12px;color:var(--muted);margin-top:8px;">Looking up tenant email…</div>';
        } else if(S.tenantEmailOnFile){
          html += '<div style="font-size:12px;color:var(--muted);margin-top:8px;">Will send to <strong>'+_esc(S.tenantEmail)+'</strong>.</div>';
        } else {
          html += '<div style="margin-top:10px;">'
            + '<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;">No email on file for this tenant — enter one to send (it will be saved to their record):</div>'
            + '<input id="rq_tenant_email" type="email" value="'+_esc(S.tenantEmail)+'" placeholder="tenant@example.com" '
            + 'style="width:100%;padding:9px 12px;border:1px solid var(--yellow);border-radius:8px;font-size:13px;box-sizing:border-box;font-family:var(--sans);"/>'
            + '</div>';
        }
      }
      html += '</div>';

      footRight = '<button class="btn btn-primary" data-rq-submit="1"'+(S.issues.length?'':' disabled')+'>📋 Create Maintenance Request</button>';
    }

    body.innerHTML = html;
    if(foot) foot.innerHTML = _backBtn() + (footRight || '<span style="font-size:11px;color:var(--muted);">'+(S.issues.length? S.issues.length+' issue'+(S.issues.length>1?'s':'')+' so far':'')+'</span>');

    if(S.step === 'unit'){ _wireUnitSearch(); }
  }

  // ── Tenant email resolution ─────────────────────────────────────────────────
  function _resolveTenant(){
    if(S.tenantResolved) return;
    var u = _units().filter(function(x){ return x && x.id === S.unitId; })[0];
    S.tenantName = (u && u.assignedName) || S.tenantName || '';
    if(!S.tenantName || typeof _resolveTenantEmailForUnit !== 'function'){ S.tenantResolved = true; return; }
    _resolveTenantEmailForUnit(u).then(function(email){
      S.tenantEmail = email || '';
      S.tenantEmailOnFile = !!email;
      S.tenantResolved = true;
      if(S.step === 'review') render();
    }).catch(function(){ S.tenantResolved = true; if(S.step === 'review') render(); });
  }

  // ── Unit search ─────────────────────────────────────────────────────────────
  function _units(){ return (typeof housingUnits !== 'undefined' && housingUnits) ? housingUnits : (window.HOUSING_UNITS_DATA || []); }
  function _unitLabel(u){ return ((u.num||'') + ' ' + (u.street||'')).trim() + (u.bedrooms ? ' · ' + u.bedrooms + '-bed' : ''); }
  function _wireUnitSearch(){
    var inp = document.getElementById('rq_unit_search');
    var res = document.getElementById('rq_unit_results');
    if(!inp || !res) return;
    function draw(q){
      var term = (q||'').toLowerCase().trim();
      var list = _units().filter(function(u){ return u && !u.archived; });
      if(term) list = list.filter(function(u){ return _unitLabel(u).toLowerCase().indexOf(term) !== -1; });
      list = list.slice(0, 60);
      res.innerHTML = list.length ? list.map(function(u){
        return '<button class="rq-unit" data-rq-unit="'+_esc(u.id)+'" data-rq-unit-label="'+_esc(_unitLabel(u))+'" data-rq-unit-tenant="'+_esc(u.assignedName||'')+'" '
          + 'style="text-align:left;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px;font-family:var(--sans);color:var(--text);" '
          + 'onmouseover="this.style.borderColor=\'var(--yellow)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
          + '<span style="font-weight:600;">'+_esc(_unitLabel(u))+'</span>'
          + (u.assignedName ? '<span style="color:var(--muted);font-size:12px;"> — '+_esc(u.assignedName)+'</span>' : '')
          + (u.status ? '<span style="color:var(--muted);font-size:11px;float:right;text-transform:capitalize;">'+_esc((u.status||'').replace('_',' '))+'</span>' : '')
          + '</button>';
      }).join('') : '<div style="padding:14px;text-align:center;color:var(--muted);font-style:italic;">No units found.</div>';
    }
    inp.addEventListener('input', function(){ draw(inp.value); });
    draw('');
    setTimeout(function(){ inp.focus(); }, 60);
  }

  // ── Capture text inputs before navigating away ──────────────────────────────
  function _capture(){
    if(S.step === 'details'){ var d=document.getElementById('rq_details'); if(d) S.draft.details = d.value; }
    if(S.step === 'review'){
      var n=document.getElementById('rq_notes'); if(n) S.notes = n.value;
      var te=document.getElementById('rq_tenant_email'); if(te && !S.tenantEmailOnFile) S.tenantEmail = (te.value||'').trim();
    }
  }

  // ── Click delegation ────────────────────────────────────────────────────────
  function _onClick(e){
    var el = e.target.closest('[data-rq-close],[data-rq-trade],[data-rq-pick],[data-rq-toggle],[data-rq-other],[data-rq-unit],[data-rq-step],[data-rq-back],[data-rq-additem],[data-rq-del],[data-rq-submit],[data-rq-emailtoggle]');
    if(!el) return;
    if(el.hasAttribute('data-rq-close')){ close(); return; }

    if(el.hasAttribute('data-rq-unit')){
      S.unitId = el.getAttribute('data-rq-unit');
      S.unitLabel = el.getAttribute('data-rq-unit-label') || '';
      S.tenantName = el.getAttribute('data-rq-unit-tenant') || '';
      S.tenantResolved = false; S.tenantEmail=''; S.tenantEmailOnFile=false;
      S.step = 'trade'; render(); return;
    }
    if(el.hasAttribute('data-rq-trade')){
      var cat = el.getAttribute('data-rq-trade');
      S.draft = _freshDraft();
      S.draft.trade = TRADES.filter(function(t){ return t.cat === cat; })[0] || { cat:cat, components:[] };
      S.step = 'room'; render(); return;
    }
    if(el.hasAttribute('data-rq-toggle')){ // multi-select issue
      var v = el.getAttribute('data-rq-toggle');
      var ix = S.draft.issues.indexOf(v);
      if(ix === -1) S.draft.issues.push(v); else S.draft.issues.splice(ix,1);
      render(); return;
    }
    if(el.hasAttribute('data-rq-pick')){ _pick(el.getAttribute('data-rq-pick'), el.getAttribute('data-rq-val')); return; }
    if(el.hasAttribute('data-rq-other')){ _other(el.getAttribute('data-rq-other')); return; }
    if(el.hasAttribute('data-rq-emailtoggle')){ _capture(); S.emailTenant = !!el.checked; if(S.emailTenant) _resolveTenant(); render(); return; }
    if(el.hasAttribute('data-rq-back')){ _capture(); var p = BACK[S.step]; if(p){ S.step = p; render(); } return; }
    if(el.hasAttribute('data-rq-step')){ _capture(); S.step = el.getAttribute('data-rq-step'); render(); return; }
    if(el.hasAttribute('data-rq-additem')){ _addItem(); return; }
    if(el.hasAttribute('data-rq-del')){ _capture(); S.issues.splice(parseInt(el.getAttribute('data-rq-del'),10),1); render(); return; }
    if(el.hasAttribute('data-rq-submit')){ _submit(); return; }
  }

  // single-select advance (room/component/severity)
  function _pick(field, val){
    S.draft[field] = val;
    var next = { room:'component', component:'issue', severity:'details' }[field];
    if(next){ S.step = next; render(); }
  }

  // "Other…" — free text. For the multi-select issue step it ADDS to the list;
  // for single-select steps it sets the value and advances.
  function _other(field){
    var body = document.getElementById('rq_body');
    if(!body) return;
    var label = { room:'room / area', component:'item / component', issue:'issue', severity:'urgency' }[field] || field;
    var wrap = document.createElement('div');
    wrap.style.marginTop = '12px';
    wrap.innerHTML = '<input id="rq_other_input" type="text" placeholder="Describe the '+_esc(label)+'…" '
      + 'style="width:100%;padding:10px 12px;border:1px solid var(--yellow);border-radius:8px;font-size:13px;box-sizing:border-box;font-family:var(--sans);margin-bottom:8px;"/>'
      + '<button class="btn btn-primary" id="rq_other_go">'+(field==='issue'?'Add':'Continue →')+'</button>';
    body.appendChild(wrap);
    var inp = document.getElementById('rq_other_input');
    var go  = document.getElementById('rq_other_go');
    function commit(){
      var v=(inp.value||'').trim(); if(!v){ inp.focus(); return; }
      if(field === 'issue'){ if(S.draft.issues.indexOf(v) === -1) S.draft.issues.push(v); render(); }
      else { _pick(field, v); }
    }
    go.addEventListener('click', commit);
    inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); commit(); } });
    inp.focus();
  }

  function _buildDescription(d){
    var head = [d.room, d.component].filter(Boolean).join(' — ');
    var line = head + (d.issues.length ? ': ' + d.issues.join(', ') : '');
    if(d.severity) line += ' [' + d.severity.split(' — ')[0] + ']';
    if(d.details)  line += ' — ' + d.details;
    return line.trim();
  }

  function _addItem(){
    var det = (document.getElementById('rq_details')||{}).value || '';
    S.draft.details = det.trim();
    var d = S.draft;
    S.issues.push({
      trade: d.trade.cat, room: d.room, component: d.component, issues: d.issues.slice(),
      severity: d.severity, details: d.details, description: _buildDescription(d)
    });
    S.draft = _freshDraft();
    S.step = 'review'; render();
  }

  // ── Submit → SOW modal + optional tenant email ──────────────────────────────
  function _saveTenantEmail(name, email){
    try {
      if(typeof SUPABASE_URL === 'undefined' || typeof HOUSING_HEADERS === 'undefined') return;
      fetch(SUPABASE_URL + '/rest/v1/tenants?full_name=eq.' + encodeURIComponent(name), {
        method: 'PATCH',
        headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ email: email })
      }).catch(function(e){ console.warn('[reno-q] tenant email save failed:', e); });
    } catch(e){ console.warn('[reno-q] tenant email save threw:', e); }
  }
  function _emailTenantCopy(unitLabel, tenantName, issues, notes, email){
    if(typeof window.sendNotification !== 'function') return;
    var natShort = (window.NATION_CONFIG && (NATION_CONFIG.short || NATION_CONFIG.display_name)) || 'Housing';
    var rows = issues.map(function(it){
      return '<li><strong>'+_esc(it.trade)+' — '+_esc(it.room)+':</strong> '+_esc(it.description)+'</li>';
    }).join('');
    var html = '<p>Hello'+(tenantName?' '+_esc(tenantName):'')+',</p>'
      + '<p>A maintenance request has been started for your home'+(unitLabel?' at <strong>'+_esc(unitLabel)+'</strong>':'')+'. Here is a summary of what was reported:</p>'
      + '<ul>'+rows+'</ul>'
      + (notes ? '<p><strong>Notes:</strong> '+_esc(notes)+'</p>' : '')
      + '<p>The '+_esc(natShort)+' Housing team will review and schedule the work. If any detail is incorrect, please reply to this email.</p>'
      + '<p>Thank you,<br/>'+_esc(natShort)+' Housing</p>';
    window.sendNotification({
      to: email,
      subject: natShort + ' Housing — Maintenance Request' + (unitLabel ? ': ' + unitLabel : ''),
      bodyHtml: html
    }).then(function(){
      if(typeof showToast === 'function') showToast('Copy emailed to the tenant.');
    }).catch(function(err){
      console.warn('[reno-q] tenant email failed:', err);
      if(typeof showToast === 'function') showToast('Could not email the tenant: ' + (err && err.message || err), { type:'error' });
    });
  }

  function _submit(){
    _capture();
    if(!S.issues.length){ if(typeof showToast==='function') showToast('Add at least one issue first.'); return; }
    if(typeof openSowModal !== 'function'){ if(typeof showToast==='function') showToast('Maintenance Request form is not available on this page.', {type:'error'}); return; }

    // Tenant email handling
    if(S.emailTenant && S.tenantName){
      var email = (S.tenantEmailOnFile ? S.tenantEmail : (S.tenantEmail||'')).trim();
      if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        if(typeof showToast==='function') showToast('Enter a valid tenant email, or untick the email option.', { type:'error' });
        return;
      }
      if(!S.tenantEmailOnFile) _saveTenantEmail(S.tenantName, email);   // save new email to the tenant record
      _emailTenantCopy(S.unitLabel, S.tenantName, S.issues.slice(), S.notes, email);
    }

    var unitId = S.unitId, issues = S.issues.slice(), notes = S.notes;
    close();
    window._sowForceNew = true;
    openSowModal(unitId);
    setTimeout(function(){
      try {
        var cont = document.getElementById('sow_items');
        if(cont){
          Array.prototype.slice.call(cont.querySelectorAll('div[id^="sow_item_"]')).forEach(function(row){
            var desc=(row.querySelector('[data-sow="description"]')||{}).value||'';
            var cat =(row.querySelector('[data-sow="category"]')||{}).value||'';
            if(!desc && !cat) row.remove();
          });
        }
        issues.forEach(function(it){ if(typeof addSowItem === 'function') addSowItem({ category: it.trade, description: it.description }); });
        if(typeof recalcSowTotal === 'function') recalcSowTotal();
        var n = document.getElementById('sow_notes');
        if(n){
          var add = 'Captured via Renovation Questionnaire.' + (notes ? '\n' + notes : '');
          n.value = n.value ? (n.value + '\n\n' + add) : add;
        }
        if(typeof showToast === 'function') showToast(issues.length + ' issue' + (issues.length>1?'s':'') + ' added to the maintenance request.');
      } catch(err){ console.warn('[reno-q] populate SOW failed:', err); }
    }, 220);
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  function open(prefillUnitId){
    _ensure();
    var unitId = '', unitLabel = '', tenantName = '';
    if(prefillUnitId){
      var u = _units().filter(function(x){ return x && x.id === prefillUnitId; })[0];
      if(u){ unitId = u.id; unitLabel = _unitLabel(u); tenantName = u.assignedName || ''; }
    }
    _reset(unitId, unitLabel, tenantName);
    var ov = document.getElementById('renoQModal');
    if(ov){ ov.style.display = 'flex'; document.body.classList.add('modal-open'); }
    render();
  }
  function close(){
    var ov = document.getElementById('renoQModal');
    if(ov) ov.style.display = 'none';
    document.body.classList.remove('modal-open');
  }

  window.openRenoQuestionnaire = open;
  window.closeRenoQuestionnaire = close;
})();
