/* ══════════════════════════════════════════════════════════════════════════
 * project-schedule.js — Gantt schedule of incomplete maintenance/renovation
 * projects (SOWs). Self-injecting full-screen overlay opened from a button on
 * the Renovations and RFQ pages (openProjectSchedule / closeProjectSchedule),
 * mirroring the TIC / reno-questionnaire self-injecting-modal pattern.
 *
 * The SOW is the project (it generates the RFQ), so there is ONE bar per
 * incomplete SOW: startDate -> endDate. Where a SOW's dates are blank, the
 * linked awarded-RFQ contract dates fill the gap. A project is "incomplete"
 * when approval_status !== 'completed' and it is not archived. Overdue = the
 * completion date has passed and the project is not complete.
 *
 * No external libraries — a pure CSS/HTML Gantt (precise overdue styling +
 * a "today" marker), theme-aware via the app's CSS variables. Reads the
 * in-memory window._sowCache / window._rfqCache, and lazily fetches them from
 * Supabase if a page opened this without them loaded (e.g. rfq.html).
 * ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  var _psFilters = { status: '', overdueOnly: false, search: '' };
  var _psProjects = [];   // last-gathered list (for export)

  // ── date helpers ──────────────────────────────────────────────────────────
  function _psParse(s){
    if(!s) return null;
    var str = String(s).trim();
    if(!str) return null;
    // Accept YYYY-MM-DD (or an ISO timestamp) — build at LOCAL midnight so day
    // math isn't shifted by timezone.
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return new Date(+m[1], +m[2]-1, +m[3]);
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function _psToday(){ var n=new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function _psDayDiff(a,b){ return Math.round((b.getTime()-a.getTime())/86400000); }
  function _psFmt(d){
    if(!d) return '';
    var mm=('0'+(d.getMonth()+1)).slice(-2), dd=('0'+d.getDate()).slice(-2);
    return d.getFullYear()+'-'+mm+'-'+dd;
  }
  var _PS_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function _psNice(d){ return d ? (_PS_MON[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear()) : '—'; }
  function _psEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── data ─────────────────────────────────────────────────────────────────
  function _psSowList(unitVal){
    if(!unitVal) return [];
    if(Array.isArray(unitVal.sows)) return unitVal.sows;
    if(Array.isArray(unitVal)) return unitVal;
    return [];
  }
  function _psStatus(sow){
    var s = String(sow.approval_status || sow.approvalStatus || '').toLowerCase();
    var sys = !!(sow.system_approved || sow.systemApproved);
    if(s==='ed_approved' && sys) return { label:'System Approved', color:'#6366f1' };
    var map = {
      '':            { label:'Draft',       color:'#6b7280' },
      'draft':       { label:'Draft',       color:'#6b7280' },
      'signed':      { label:'Signed',      color:'#0891b2' },
      'submitted':   { label:'Pending HM',  color:'#d97706' },
      'hm_approved': { label:'Pending ED',  color:'#2563eb' },
      'ed_approved': { label:'Approved',    color:'#16a34a' },
      'completed':   { label:'Completed',   color:'#16a34a' }
    };
    return map[s] || { label:(s||'Draft'), color:'#6b7280' };
  }
  // Awarded-RFQ contract dates for a given SOW (fills blank SOW dates).
  function _psRfqDates(pn, unitId){
    var out = { start:null, end:null };
    var cache = window._rfqCache || {};
    Object.keys(cache).forEach(function(k){
      var r = cache[k]; if(!r) return;
      var matchPn = pn && (r.sow_project_number===pn);
      var matchUnit = unitId && (String(r.sow_unit_id)===String(unitId));
      if(!(matchPn || (matchUnit && !pn))) return;
      var d = r.data || {};
      var st = _psParse(d.start_date || d.contract_date);
      var en = _psParse(d.completion_date);
      if(st && !out.start) out.start = st;
      if(en && !out.end) out.end = en;
    });
    return out;
  }
  function _psUnitAddr(unitId){
    try{
      var units = (typeof getAllUnits==='function') ? getAllUnits() : (window.housingUnits||[]);
      for(var i=0;i<units.length;i++){ if(String(units[i].id)===String(unitId)) return ((units[i].num||'')+' '+(units[i].street||'')).trim(); }
    }catch(e){}
    return '';
  }

  function _psGather(){
    var today = _psToday();
    var out = [];
    var cache = window._sowCache || {};
    Object.keys(cache).forEach(function(unitId){
      _psSowList(cache[unitId]).forEach(function(sow){
        if(!sow) return;
        var status = String(sow.approval_status || sow.approvalStatus || '').toLowerCase();
        if(status==='completed') return;                 // only INCOMPLETE
        if(sow.archived) return;
        var pn = sow.project_number || sow.projectNumber || '';
        if(!pn) return;                                  // only real, saved projects
        var start = _psParse(sow.startDate || sow.start_date);
        var end   = _psParse(sow.endDate   || sow.end_date);
        if(!start || !end){
          var rf = _psRfqDates(pn, unitId);
          if(!start && rf.start) start = rf.start;
          if(!end   && rf.end)   end   = rf.end;
        }
        var st = _psStatus(sow);
        var assigned = !!(sow.contractorId || sow.contractor || sow.assignedToName ||
                          (sow.assignedTeam==='in_house' && sow.assignedTo));
        var overdueDays = (end && end.getTime() < today.getTime()) ? _psDayDiff(end, today) : 0;
        var bucket;
        if(!start && !end)        bucket='nodate';
        else if(overdueDays>0)    bucket='overdue';
        else if(end && _psDayDiff(today,end)<=14 && _psDayDiff(today,end)>=0) bucket='soon';
        else if(start && start.getTime()<=today.getTime() && (!end || end.getTime()>=today.getTime())) bucket='active';
        else                      bucket='future';
        out.push({
          unitId: unitId, pn: pn,
          address: sow.address || _psUnitAddr(unitId) || '(no address)',
          contractor: sow.contractor || sow.assignedToName || (sow.assignedTeam==='in_house' ? (typeof nationShort==='function'? nationShort()+' crew' : 'In-house crew') : ''),
          statusLabel: st.label, statusColor: st.color, assigned: assigned,
          totalCost: sow.totalCost || sow.total_cost || '',
          start: start, end: end, overdueDays: overdueDays, bucket: bucket
        });
      });
    });
    // Sort: overdue first (most overdue), then by soonest completion, then start.
    out.sort(function(a,b){
      if((b.overdueDays>0)-(a.overdueDays>0)) return (b.overdueDays>0)-(a.overdueDays>0);
      if(a.overdueDays!==b.overdueDays) return b.overdueDays-a.overdueDays;
      var ae=a.end?a.end.getTime():Infinity, be=b.end?b.end.getTime():Infinity;
      if(ae!==be) return ae-be;
      var as=a.start?a.start.getTime():Infinity, bs=b.start?b.start.getTime():Infinity;
      return as-bs;
    });
    return out;
  }

  function _psApplyFilters(list){
    var f = _psFilters;
    var q = (f.search||'').toLowerCase().trim();
    return list.filter(function(p){
      if(f.overdueOnly && p.overdueDays<=0) return false;
      if(f.status && p.statusLabel !== f.status) return false;
      if(q){
        var hay = (p.pn+' '+p.address+' '+p.contractor+' '+p.statusLabel).toLowerCase();
        if(hay.indexOf(q)===-1) return false;
      }
      return true;
    });
  }

  // ── styles (injected once) ────────────────────────────────────────────────
  function _psEnsureStyles(){
    if(document.getElementById('ps_styles')) return;
    var s = document.createElement('style');
    s.id = 'ps_styles';
    s.textContent = [
      '#projSchedOverlay{position:fixed;inset:0;z-index:1200;background:var(--bg,#f4f5f7);display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
      '#projSchedOverlay.open{display:flex;}',
      '.ps-hero{background:#1f2937;color:#fff;padding:16px 22px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;}',
      '.ps-hero h2{margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em;}',
      '.ps-hero p{margin:4px 0 0;font-size:12.5px;opacity:.8;}',
      '.ps-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
      '.ps-chip{font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;white-space:nowrap;}',
      '.ps-chip b{font-weight:800;}',
      '.ps-chip.red{background:#dc2626;} .ps-chip.amber{background:#d97706;} .ps-chip.blue{background:#2563eb;}',
      '.ps-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 22px;background:var(--card,#fff);border-bottom:1px solid var(--border,#e5e7eb);}',
      '.ps-toolbar input[type=text],.ps-toolbar select{font-size:13px;padding:7px 10px;border:1px solid var(--border,#d9e0e7);border-radius:8px;background:var(--bg,#fff);color:var(--text,#16202b);}',
      '.ps-toolbar label{font-size:12.5px;color:var(--text,#16202b);display:flex;align-items:center;gap:6px;cursor:pointer;}',
      '.ps-legend{display:flex;gap:12px;flex-wrap:wrap;margin-left:auto;font-size:11.5px;color:var(--muted,#6b7280);align-items:center;}',
      '.ps-legend span{display:inline-flex;align-items:center;gap:5px;}',
      '.ps-legend i{width:12px;height:12px;border-radius:3px;display:inline-block;}',
      '.ps-gantt-wrap{flex:1;overflow:auto;position:relative;}',
      '.ps-gantt{min-width:100%;}',
      '.ps-head-row{display:flex;position:sticky;top:0;z-index:6;background:var(--card,#fff);border-bottom:1px solid var(--border,#e5e7eb);}',
      '.ps-corner{flex:0 0 var(--ps-label-w,268px);width:var(--ps-label-w,268px);position:sticky;left:0;z-index:7;background:var(--card,#fff);border-right:1px solid var(--border,#e5e7eb);padding:8px 12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b7280);display:flex;align-items:center;}',
      '.ps-months{display:flex;}',
      '.ps-month{flex:0 0 auto;border-right:1px solid var(--border,#eef1f4);font-size:11px;font-weight:700;color:var(--muted,#6b7280);padding:8px 6px;box-sizing:border-box;white-space:nowrap;overflow:hidden;}',
      '.ps-row{display:flex;border-bottom:1px solid var(--border,#eef1f4);}',
      '.ps-row:hover{background:rgba(37,99,235,.05);}',
      '.ps-label{flex:0 0 var(--ps-label-w,268px);width:var(--ps-label-w,268px);position:sticky;left:0;z-index:5;background:var(--card,#fff);border-right:1px solid var(--border,#e5e7eb);padding:8px 12px;cursor:pointer;}',
      '.ps-row:hover .ps-label{background:#eef4ff;}',
      '.ps-l-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.ps-pn{font-size:12.5px;font-weight:700;color:var(--text,#16202b);font-family:ui-monospace,Menlo,Consolas,monospace;}',
      '.ps-badge{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:6px;color:#fff;white-space:nowrap;}',
      '.ps-badge.od{background:#dc2626;}',
      '.ps-l-addr{font-size:12.5px;color:var(--text,#16202b);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ps-l-sub{font-size:11px;color:var(--muted,#6b7280);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ps-track{position:relative;flex:1;min-height:56px;}',
      '.ps-grid{position:absolute;top:0;bottom:0;width:1px;background:var(--border,#eef1f4);}',
      '.ps-today-seg{position:absolute;top:0;bottom:0;width:2px;background:#dc2626;opacity:.55;z-index:3;}',
      '.ps-bar{position:absolute;top:9px;height:22px;border-radius:6px;display:flex;align-items:center;padding:0 8px;font-size:11px;font-weight:700;color:#fff;overflow:hidden;white-space:nowrap;z-index:2;box-shadow:0 1px 2px rgba(0,0,0,.12);}',
      '.ps-bar-overdue{background:#dc2626;} .ps-bar-soon{background:#d97706;} .ps-bar-active{background:#2563eb;} .ps-bar-future{background:#64748b;}',
      '.ps-bar.openend{-webkit-mask-image:linear-gradient(90deg,#000 72%,transparent);mask-image:linear-gradient(90deg,#000 72%,transparent);}',
      '.ps-bar2{position:absolute;top:35px;height:9px;border-radius:5px;z-index:2;background:#0d9488;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.28) 0,rgba(255,255,255,.28) 3px,transparent 3px,transparent 6px);}',
      '.ps-bar2-over{background:#dc2626;}',
      '.ps-nodate{position:absolute;top:16px;left:10px;font-size:11.5px;color:var(--muted,#9ca3af);font-style:italic;}',
      '.ps-empty{padding:60px 20px;text-align:center;color:var(--muted,#6b7280);}',
      '@media(max-width:640px){.ps-corner,.ps-label{--ps-label-w:180px;flex-basis:180px;width:180px;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── overlay shell ─────────────────────────────────────────────────────────
  function _psEnsureOverlay(){
    _psEnsureStyles();
    var ov = document.getElementById('projSchedOverlay');
    if(ov) return ov;
    ov = document.createElement('div');
    ov.id = 'projSchedOverlay';
    ov.innerHTML =
      '<div class="ps-hero">'
      +  '<div>'
      +    '<h2>Project Schedule</h2>'
      +    '<p>Incomplete maintenance &amp; renovation projects &middot; start to completion &middot; overdue flagged</p>'
      +    '<div class="ps-chips" id="ps_chips"></div>'
      +  '</div>'
      +  '<div style="display:flex;gap:8px;align-items:center;">'
      +    '<div class="export-dropdown" style="position:relative;">'
      +      '<button onclick="_psToggleExport(this)" class="btn btn-primary">\uD83D\uDCE4 Export</button>'
      +      '<div class="header-export-menu" id="ps_export_menu">'
      +        '<button onclick="_psExport(\'csv\')" class="header-export-item">CSV</button>'
      +        '<button onclick="_psExport(\'excel\')" class="header-export-item">Excel</button>'
      +      '</div>'
      +    '</div>'
      +    '<button onclick="closeProjectSchedule()" class="btn btn-ghost-dark">\u2715 Close</button>'
      +  '</div>'
      +'</div>'
      +'<div class="ps-toolbar">'
      +  '<input id="ps_search" type="text" placeholder="Search project #, address, contractor\u2026" oninput="_psOnFilter()" style="min-width:220px;"/>'
      +  '<select id="ps_status" onchange="_psOnFilter()">'
      +    '<option value="">All statuses</option>'
      +    '<option>Draft</option><option>Signed</option><option>Pending HM</option>'
      +    '<option>Pending ED</option><option>Approved</option><option>System Approved</option>'
      +  '</select>'
      +  '<label><input type="checkbox" id="ps_overdue" onchange="_psOnFilter()"/> Overdue only</label>'
      +  '<div class="ps-legend">'
      +    '<span><i style="background:#dc2626;"></i>Overdue</span>'
      +    '<span><i style="background:#d97706;"></i>Due \u226414d</span>'
      +    '<span><i style="background:#2563eb;"></i>In progress</span>'
      +    '<span><i style="background:#64748b;"></i>Upcoming</span>'
      +    '<span><i style="background:#0d9488;height:8px;"></i>Elapsed (assigned &amp; started)</span>'
      +    '<span><i style="background:#dc2626;opacity:.55;width:2px;border-radius:0;"></i>Today</span>'
      +  '</div>'
      +'</div>'
      +'<div class="ps-gantt-wrap" id="ps_body"></div>';
    document.body.appendChild(ov);
    return ov;
  }

  // ── render ────────────────────────────────────────────────────────────────
  function _psRender(){
    var body = document.getElementById('ps_body');
    if(!body) return;
    var all = _psProjects;
    var list = _psApplyFilters(all);

    // Summary chips (always over the full set, not the filtered view).
    var overdue = all.filter(function(p){return p.overdueDays>0;}).length;
    var soon    = all.filter(function(p){return p.bucket==='soon';}).length;
    var active  = all.filter(function(p){return p.bucket==='active';}).length;
    var nodate  = all.filter(function(p){return p.bucket==='nodate';}).length;
    var chips = document.getElementById('ps_chips');
    if(chips) chips.innerHTML =
        '<span class="ps-chip"><b>'+all.length+'</b> incomplete</span>'
      + '<span class="ps-chip red"><b>'+overdue+'</b> overdue</span>'
      + '<span class="ps-chip amber"><b>'+soon+'</b> due \u226414d</span>'
      + '<span class="ps-chip blue"><b>'+active+'</b> in progress</span>'
      + (nodate? '<span class="ps-chip"><b>'+nodate+'</b> no dates</span>' : '');

    if(!list.length){
      body.innerHTML = '<div class="ps-empty">'+(all.length? 'No projects match the current filters.' : 'No incomplete projects with a schedule were found.')+'</div>';
      return;
    }

    // Timeline scale from every dated project + today.
    var today = _psToday();
    var dated = list.filter(function(p){return p.start||p.end;});
    var times = [today.getTime()];
    dated.forEach(function(p){ if(p.start)times.push(p.start.getTime()); if(p.end)times.push(p.end.getTime()); });
    var minD = new Date(Math.min.apply(null,times)), maxD = new Date(Math.max.apply(null,times));
    var rangeStart = new Date(minD.getFullYear(), minD.getMonth(), 1);
    var rangeEnd   = new Date(maxD.getFullYear(), maxD.getMonth()+1, 0);
    var totalDays  = _psDayDiff(rangeStart, rangeEnd) + 1;
    var dayWidth   = Math.max(3, Math.min(16, Math.round(1180/totalDays)));
    var timelineW  = totalDays * dayWidth;

    // Month header cells + gridline offsets.
    var months='', grid='', cur=new Date(rangeStart.getFullYear(),rangeStart.getMonth(),1);
    while(cur.getTime() <= rangeEnd.getTime()){
      var mStart=new Date(cur.getFullYear(),cur.getMonth(),1);
      var mEnd=new Date(cur.getFullYear(),cur.getMonth()+1,0);
      var segS=mStart.getTime()<rangeStart.getTime()?rangeStart:mStart;
      var segE=mEnd.getTime()>rangeEnd.getTime()?rangeEnd:mEnd;
      var wDays=_psDayDiff(segS,segE)+1;
      months += '<div class="ps-month" style="width:'+(wDays*dayWidth)+'px;">'+_PS_MON[cur.getMonth()]+' '+cur.getFullYear()+'</div>';
      var gx=_psDayDiff(rangeStart,mStart)*dayWidth;
      if(gx>0) grid += '<div class="ps-grid" style="left:'+gx+'px;"></div>';
      cur = new Date(cur.getFullYear(),cur.getMonth()+1,1);
    }
    var todayX = (_psDayDiff(rangeStart,today))*dayWidth;
    var todaySeg = (todayX>=0 && todayX<=timelineW) ? '<div class="ps-today-seg" style="left:'+todayX+'px;"></div>' : '';

    function barFor(p){
      if(!p.start && !p.end) return '<div class="ps-nodate">No dates set</div>';
      var left, width, extra='';
      if(p.start && p.end){
        left  = _psDayDiff(rangeStart,p.start)*dayWidth;
        width = Math.max(_psDayDiff(p.start,p.end)+1,1)*dayWidth;
      } else if(p.end && !p.start){
        var ex=(_psDayDiff(rangeStart,p.end)+1)*dayWidth;
        width=Math.min(7*dayWidth,ex); left=Math.max(0,ex-width); extra=' deadline';
      } else { // start, no end -> open-ended to range end
        left=_psDayDiff(rangeStart,p.start)*dayWidth;
        width=Math.max(timelineW-left,dayWidth*3); extra=' openend';
      }
      var cap = p.pn + (width>90 && p.start && p.end ? '  \u00b7  '+_psFmt(p.start)+' \u2192 '+_psFmt(p.end) : '');
      var elapsedDays = (p.start && p.start.getTime()<=today.getTime()) ? _psDayDiff(p.start, today) : 0;
      var tip = p.pn+' | '+p.address+' | '+p.statusLabel
              + ' | '+(p.start?_psNice(p.start):'no start')+' \u2192 '+(p.end?_psNice(p.end):'no completion')
              + (p.overdueDays>0? ' | OVERDUE '+p.overdueDays+'d' : '')
              + (p.assigned && elapsedDays>0 ? ' | in execution '+elapsedDays+'d (contractor assigned)' : '');
      var main = '<div class="ps-bar ps-bar-'+p.bucket+extra+'" style="left:'+left+'px;width:'+width+'px;" title="'+_psEsc(tip)+'">'+_psEsc(cap)+'</div>';

      // Secondary "elapsed" bar: only for projects that have STARTED (past start
      // date) AND have a contractor / crew assigned. Shows time from start to
      // today; the portion beyond the planned completion date is drawn as an
      // overrun (red).
      var sec = '';
      if(p.start && p.assigned && p.start.getTime()<=today.getTime()){
        var sLeft = _psDayDiff(rangeStart, p.start)*dayWidth;
        var todayX2 = (_psDayDiff(rangeStart, today)+1)*dayWidth;
        var planX  = p.end ? (_psDayDiff(rangeStart, p.end)+1)*dayWidth : null;
        var over   = (planX!=null && today.getTime()>p.end.getTime());
        var onEnd  = over ? planX : todayX2;
        sec += '<div class="ps-bar2" style="left:'+sLeft+'px;width:'+Math.max(onEnd-sLeft,2)+'px;" title="'+_psEsc('Elapsed since start: '+elapsedDays+' days')+'"></div>';
        if(over) sec += '<div class="ps-bar2 ps-bar2-over" style="left:'+planX+'px;width:'+Math.max(todayX2-planX,2)+'px;" title="'+_psEsc('Overrun past planned completion: '+p.overdueDays+' days')+'"></div>';
      }
      return main + sec;
    }

    var rows = list.map(function(p){
      var odBadge = p.overdueDays>0 ? '<span class="ps-badge od">OVERDUE '+p.overdueDays+'d</span>' : '';
      var statusBadge = '<span class="ps-badge" style="background:'+p.statusColor+';">'+_psEsc(p.statusLabel)+'</span>';
      var sub = [p.contractor, (p.start?_psFmt(p.start):'?')+' \u2192 '+(p.end?_psFmt(p.end):'?')].filter(Boolean).join('  \u00b7  ');
      var openCall = "_psOpenSow('"+String(p.unitId).replace(/'/g,"\\'")+"','"+String(p.pn).replace(/'/g,"\\'")+"')";
      return '<div class="ps-row">'
        +  '<div class="ps-label" onclick="'+openCall+'" title="Open '+_psEsc(p.pn)+'">'
        +    '<div class="ps-l-top"><span class="ps-pn">'+_psEsc(p.pn)+'</span>'+statusBadge+odBadge+'</div>'
        +    '<div class="ps-l-addr">'+_psEsc(p.address)+'</div>'
        +    '<div class="ps-l-sub">'+_psEsc(sub)+'</div>'
        +  '</div>'
        +  '<div class="ps-track" style="width:'+timelineW+'px;">'+grid+todaySeg+barFor(p)+'</div>'
        +'</div>';
    }).join('');

    body.innerHTML =
      '<div class="ps-gantt" style="--ps-label-w:268px;">'
      +  '<div class="ps-head-row"><div class="ps-corner">Project ('+list.length+')</div><div class="ps-months" style="width:'+timelineW+'px;">'+months+'</div></div>'
      +  rows
      +'</div>';
  }

  // ── public + wired handlers ───────────────────────────────────────────────
  function _psLoadIfNeeded(cb){
    var haveSow = false, c = window._sowCache || {};
    for(var k in c){ if(_psSowList(c[k]).length){ haveSow=true; break; } }
    var needSow = !haveSow;
    var needRfq = !(window._rfqCache && Object.keys(window._rfqCache).length);
    if(!needSow && !needRfq){ cb(); return; }
    if(typeof SUPABASE_URL==='undefined' || typeof HOUSING_HEADERS==='undefined'){ cb(); return; }
    var jobs = [];
    if(needSow){
      window._sowCache = window._sowCache || {};
      jobs.push(fetch(SUPABASE_URL+'/rest/v1/housing_sow?select=*',{headers:HOUSING_HEADERS})
        .then(function(r){return r.ok?r.json():[];})
        .then(function(rows){ (rows||[]).forEach(function(r){ window._sowCache[r.unit_id]=r.data; }); })
        .catch(function(){}));
    }
    if(needRfq){
      window._rfqCache = window._rfqCache || {};
      jobs.push(fetch(SUPABASE_URL+'/rest/v1/housing_rfq?select=*&order=created_at.desc',{headers:HOUSING_HEADERS})
        .then(function(r){return r.ok?r.json():[];})
        .then(function(rows){ (rows||[]).forEach(function(r){ window._rfqCache[r.id]=r; }); })
        .catch(function(){}));
    }
    Promise.all(jobs).then(cb).catch(cb);
  }

  window.openProjectSchedule = function(){
    var ov = _psEnsureOverlay();
    ov.classList.add('open');
    var body = document.getElementById('ps_body');
    if(body) body.innerHTML = '<div class="ps-empty">Loading projects\u2026</div>';
    _psLoadIfNeeded(function(){
      _psProjects = _psGather();
      _psRender();
    });
  };
  window.closeProjectSchedule = function(){
    var ov = document.getElementById('projSchedOverlay');
    if(ov) ov.classList.remove('open');
  };
  window._psOnFilter = function(){
    _psFilters.search     = (document.getElementById('ps_search')||{}).value || '';
    _psFilters.status     = (document.getElementById('ps_status')||{}).value || '';
    _psFilters.overdueOnly= !!(document.getElementById('ps_overdue')||{}).checked;
    _psRender();
  };
  window._psToggleExport = function(btn){
    var m = document.getElementById('ps_export_menu');
    if(m) m.classList.toggle('open');
  };
  window._psOpenSow = function(unitId, pn){
    if(typeof openSowModal === 'function'){ closeProjectSchedule(); openSowModal(unitId, pn); return; }
    // Fallback (e.g. rfq.html doesn't load the SOW modal): deep-link to the unit.
    window.location.href = 'inventory.html?unit=' + encodeURIComponent(unitId);
  };
  window._psExport = function(format){
    var m = document.getElementById('ps_export_menu'); if(m) m.classList.remove('open');
    var list = _psApplyFilters(_psProjects);
    var headers = ['Project #','Address','Contractor / Assignee','Status','Start','Completion','Days Overdue','Est. Cost'];
    var data = list.map(function(p){
      return [ p.pn, p.address, p.contractor||'', p.statusLabel,
               p.start?_psFmt(p.start):'', p.end?_psFmt(p.end):'',
               p.overdueDays>0?p.overdueDays:'', p.totalCost||'' ];
    });
    var ns = (typeof nationShort==='function')? nationShort() : 'Housing';
    var fname = ns+'_Project_Schedule_'+_psFmt(_psToday());
    if(typeof _doExport === 'function'){ _doExport(format, headers, data, fname, [16,26,22,14,12,12,10,10], true); }
    else if(typeof showToast==='function'){ showToast('Export unavailable on this page.'); }
  };
})();
