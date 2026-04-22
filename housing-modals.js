/* ============================================================
 * housing-modals.js — CLFN Housing Suite
 * All modal open/close/save handlers for housing.html
 *
 * Load order: ... housing-settings.js → THIS FILE
 *
 * Covers:
 *   Unit edit modal (openUnitEditModal, saveUnitEdit, closeUnitEditModal)
 *   SOW modal (openSowModal, saveSOW, markSowComplete, reopenSow)
 *   Unit detail panel (openUnitDetail, udpRenderSowTable)
 *   Add unit modal (openAddUnitModal, saveNewUnit)
 *   Add tenant modal (openAddTenantModal, saveAddTenant)
 *   Tenant/contractor detail panels
 *   Scorecard (openMatchScorecard, printScorecard)
 *   Contractor search (openContractorSearch, contractorSearchFilter)
 *   Photo management (renderUnitPhotos, saveUnitPhotos)
 * ============================================================ */

'use strict';

function openContractorSearch(preserveQuery) {
  var m = document.getElementById('contractorSearchModal');
  if(m){ m.style.setProperty('display','flex','important'); document.body.classList.add('modal-open'); }
  if(!preserveQuery) {
    contractorSearchFilter('');
    setTimeout(function(){ var i=document.getElementById('ct_search_input'); if(i){i.value='';i.focus();} }, 150);
  } else {
    var inp = document.getElementById('ct_search_input');
    contractorSearchFilter(inp ? inp.value : '');
  }
}

function closeContractorSearch() {
  var m = document.getElementById('contractorSearchModal');
  if(m) m.style.display='none';
  document.body.classList.remove('modal-open');
}

function contractorSearchFilter(q) {
  var contractors = [];
  var contractors = window._contractors || [];
  var results = document.getElementById('ct_search_results');
  if(!results) return;

  var filtered = q.trim().length > 0
    ? contractors.filter(function(c){
        var qq = q.toLowerCase();
        return (c.name||'').toLowerCase().includes(qq)
          || (c.trade||'').toLowerCase().includes(qq)
          || (c.phone||'').toLowerCase().includes(qq)
          || (c.email||'').toLowerCase().includes(qq);
      })
    : contractors;

  if(!filtered.length) {
    results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">'
      +'<div class="empty-icon-lg">🧰</div>'
      +'<div class="empty-title">'+(q.trim().length > 0 ? 'No contractors matching "'+q+'"' : 'No contractors added yet')+'</div>'
      +'<div class="empty-sub">'+( q.trim().length > 0 ? 'Try a different search.' : 'Use the button above to add your first contractor.')+'</div>'
      +'</div>';
    return;
  }

  results.innerHTML = filtered.map(function(c, i) {
    var idx = contractors.indexOf(c);
    var initials = (c.name||'?').split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase();
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:border-color .15s;"'
      +' onmouseover="this.style.borderColor=&quot;var(--yellow)&quot;"'  
      +' onmouseout="this.style.borderColor=&quot;var(--border)&quot;"'  
      +' onclick="closeContractorSearch();openAddContractorModal('+idx+')">'
      +'<div style="width:40px;height:40px;border-radius:10px;background:var(--dark);color:var(--yellow);font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+initials+'</div>'
      +'<div style="flex:1;min-width:0;">'
        +'<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;">'+( c.name||'Unknown')+'</div>'
        +'<div class="js-lbl-sm">'+(c.trade||'General')+(c.phone?' · '+c.phone:'')+'</div>'
      +'</div>'
      +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
      +'</div>';
  }).join('');
}

// ── Placeholder renderers (to be built out) ──
function openUnitEditModal(unitId){
  var units = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var u = units.find(function(x){ return x.id === unitId; });
  if(!u){ showToast('Unit not found: ' + unitId); return; }
  window._editingUnitId = unitId;
  var set = function(id,val){ var el=document.getElementById(id); if(el) el.value=(val===null||val===undefined||val==='nan')?'':String(val); };
  set('ue_street',u.street); set('ue_num',u.num); set('ue_bedrooms',u.bedrooms);
  set('ue_bathrooms',u.bathrooms); set('ue_type',u.type); set('ue_foundation',u.foundation);
  set('ue_funder',u.funder); set('ue_phase',u.phase); set('ue_year',u.year);
  set('ue_status',u.status||'vacant');
  set('ue_assignedDate',u.assignedDate);
  set('ue_notes',u.notes);
  // Populate hidden assignment fields
  var toEl = document.getElementById('ue_assignedTo');
  var nmEl = document.getElementById('ue_assignedName');
  if(toEl) toEl.value = u.assignedTo||'';
  if(nmEl) nmEl.value = u.assignedName||'';
  // Show current tenant card or clear search
  var srch = document.getElementById('ue_tenant_search');
  if(srch) srch.value='';
  var curCard = document.getElementById('ue_current_tenant');
  var curName = document.getElementById('ue_current_tenant_name');
  var curMeta = document.getElementById('ue_current_tenant_meta');
  var selCard = document.getElementById('ue_tenant_selected');
  var nfCard  = document.getElementById('ue_tenant_notfound');
  if(selCard) selCard.style.display='none';
  if(nfCard)  nfCard.style.display='none';
  if(u.assignedName && u.assignedTo){
    if(curCard) curCard.style.display='block';
    if(curName) curName.textContent = u.assignedName;
    var linkedApp = (typeof applications!=='undefined'?applications:[]).find(function(a){return a.id===u.assignedTo;});
    var meta = u.assignedTo;
    if(linkedApp){ meta += ' · ' + (linkedApp.status||'').replace(/_/g,' '); }
    if(curMeta) curMeta.textContent = meta;
  } else {
    if(curCard) curCard.style.display='none';
  }
  // Populate tenant display card in the tenant section
  var tenantDisplayName = document.getElementById('ue_tenant_display_name');
  var tenantDisplayMeta = document.getElementById('ue_tenant_display_meta');
  var tenantNameInput   = document.getElementById('ue_sig_tenant_name');
  var tenantDateInput   = document.getElementById('ue_sig_tenant_date');
  if(u.assignedName) {
    if(tenantDisplayName) { tenantDisplayName.textContent = u.assignedName; tenantDisplayName.style.color = 'var(--text)'; }
    if(tenantDisplayMeta) tenantDisplayMeta.textContent = u.assignedTo || '';
    if(tenantNameInput)   tenantNameInput.value = u.assignedName;
    if(tenantDateInput)   tenantDateInput.value = u.assignedDate || '';
  } else {
    if(tenantDisplayName) { tenantDisplayName.textContent = 'Vacant'; tenantDisplayName.style.color = 'var(--muted)'; }
    if(tenantDisplayMeta) tenantDisplayMeta.textContent = 'No tenant assigned';
    if(tenantNameInput)   tenantNameInput.value = '';
    if(tenantDateInput)   tenantDateInput.value = '';
  }
  var acc=document.getElementById('ue_accessible'); if(acc) acc.checked=!!u.accessible;
  var eld=document.getElementById('ue_isElders');   if(eld) eld.checked=!!u.isElders;
  var title=document.getElementById('ue_modal_title'); if(title) title.textContent=u.num+' '+u.street;
  unitEditStatusChange();
  _ueCurrentUnitId = unitId;
  renderEditUnitPhotoPreview(unitId);
  var _uem=document.getElementById('unitEditModal'); if(_uem){_uem.style.removeProperty('display');_uem.style.setProperty('display','flex','important');}

  // Restore saved unit signatures (tenant name/date only — no canvases)
  var _set = function(id,val){ var e=document.getElementById(id); if(e&&val) e.value=val; };
  if(u.unitSig) {
    _set('ue_sig_tenant_name', u.unitSig.tenant && u.unitSig.tenant.name);
    _set('ue_sig_tenant_date', u.unitSig.tenant && u.unitSig.tenant.date);
  }
  if(u.unitHmSig) {
    _set('ue_sig_hm_name',     u.unitHmSig.name);
    _set('ue_sig_hm_date',     u.unitHmSig.date);
    _set('ue_sig_hm_notes',    u.unitHmSig.notes);
    var _hd = document.getElementById('ue_sig_hm_decision');
    if(_hd && u.unitHmSig.decision) _hd.value = u.unitHmSig.decision;
    var _hb = document.getElementById('ue_sig_hm_badge');
    if(_hb && u.unitHmSig.decision) {
      _hb.textContent  = u.unitHmSig.decision === 'approved' ? 'Approved ✓' : u.unitHmSig.decision;
      _hb.style.background = u.unitHmSig.decision === 'approved' ? '#f0fdf4' : '#eff6ff';
      _hb.style.color      = u.unitHmSig.decision === 'approved' ? '#15803d' : '#1d4ed8';
    }
  }
  if(u.unitEdSig) {
    _set('ue_sig_ed_name',  u.unitEdSig.name);
    _set('ue_sig_ed_date',  u.unitEdSig.date);
    _set('ue_sig_ed_notes', u.unitEdSig.notes);
    var _ed = document.getElementById('ue_sig_ed_decision');
    if(_ed && u.unitEdSig.decision) _ed.value = u.unitEdSig.decision;
    var _eb = document.getElementById('ue_sig_ed_badge');
    if(_eb && u.unitEdSig.decision) {
      _eb.textContent  = u.unitEdSig.decision === 'approved' ? 'Approved ✓' : u.unitEdSig.decision;
      _eb.style.background = u.unitEdSig.decision === 'approved' ? '#fffbeb' : '#fffbeb';
      _eb.style.color      = '#15803d';
    }
  }

  // Archive / Restore button in footer (ED only)
  var archWrap = document.getElementById('ue_archive_btn_wrap');
  if(archWrap) {
    var role = window.currentRole || 'housing_employee_l1';
    if(role === ROLE.ED) {
      if(u.archived) {
        archWrap.innerHTML = '<button type="button" onclick="unarchiveUnit(\''+unitId.replace(/'/g,"\\'")+'\')" style="background:none;border:1.5px solid #888;color:#888;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:6px;">📤 Restore Unit</button>';
      } else {
        archWrap.innerHTML = '<button type="button" onclick="archiveUnit(\''+unitId.replace(/'/g,"\\'")+'\')" style="background:none;border:1.5px solid #b91c1c;color:#b91c1c;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:6px;">🏚️ Archive Unit</button>';
      }
    } else {
      archWrap.innerHTML = '';
    }
  }

  // Check budget routing
  setTimeout(ueUpdateBudgetRouting, 50);
}
function unitEditStatusChange(){
  var status=(document.getElementById('ue_status')||{}).value||'';
  var row=document.getElementById('ue_assign_row');
  // Show tenant section for all statuses except archived/condemned/under_repair
  var hideStatuses = ['archived','condemned','under_repair'];
  if(row) row.style.display = hideStatuses.includes(status) ? 'none' : 'flex';
}
function closeUnitEditModal(){
  document.getElementById('unitEditModal').style.display='none';
  window._editingUnitId=null;
}

// ── SOW link from edit unit modal ─────────────────────────────────────────────
function ueOpenSow() {
  var uid = window._editingUnitId;
  if(!uid) return;
  closeUnitEditModal();
  openSowModal(uid);
}

// ── Budget threshold helpers ──────────────────────────────────────────────────
function getHmBudgetLimit() {
  // Default: HM can approve up to $25,000 unilaterally; above that needs ED
  try {
    var s = window._appSettings || {};
    return (s.hmBudgetLimit && parseFloat(s.hmBudgetLimit)) || 25000;
  } catch(e) { return 25000; }
}

function ueUpdateBudgetRouting() {
  // Read SOW total for this unit and set approval routing accordingly
  var uid = window._editingUnitId;
  if(!uid) return;

  var limit = getHmBudgetLimit();
  var sowData = null;
  sowData = getSowData(uid);
  var totalCost = sowData ? (parseFloat((sowData.totalCost||'').toString().replace(/[^0-9.]/g,''))||0) : 0;

  var indicator = document.getElementById('ue_budget_indicator');
  var hmBlock   = document.getElementById('ue_sig_hm_block');
  var edBlock   = document.getElementById('ue_sig_ed_block');

  if(!totalCost) {
    if(indicator) indicator.style.display = 'none';
    if(hmBlock) hmBlock.style.display = 'none';
    if(edBlock) edBlock.style.display = 'none';
    return;
  }

  var overBudget = totalCost > limit;
  var fmtCost  = '$' + Math.round(totalCost).toLocaleString();
  var fmtLimit = '$' + Math.round(limit).toLocaleString();

  if(indicator) {
    indicator.style.display = 'block';
    if(overBudget) {
      indicator.style.background = '#fffbeb';
      indicator.style.border = '1.5px solid #fde68a';
      indicator.style.color  = '#7a5c00';
      indicator.innerHTML = '<div class="flex-g8">'
        +'<span style="font-size:16px;">⚠️</span>'
        +'<div><strong>ED Approval Required</strong><br>'
        +'SOW total is <strong>'+fmtCost+'</strong> — exceeds the HM budget authority of '+fmtLimit+'.<br>'
        +'<span style="font-size:11px;">Executive Director must sign off before work begins.</span></div>'
        +'</div>';
    } else {
      indicator.style.background = '#f0fdf4';
      indicator.style.border = '1.5px solid #86efac';
      indicator.style.color  = '#15803d';
      indicator.innerHTML = '<div class="flex-g8">'
        +'<span style="font-size:16px;">✅</span>'
        +'<div><strong>HM Approval Sufficient</strong><br>'
        +'SOW total is <strong>'+fmtCost+'</strong> — within HM budget authority of '+fmtLimit+'.<br>'
        +'<span style="font-size:11px;">Housing Manager signature below is all that is required.</span></div>'
        +'</div>';
    }
  }

  // Show appropriate approval block
  if(hmBlock) hmBlock.style.display = 'block';
  if(edBlock) edBlock.style.display = overBudget ? 'block' : 'none';
}

// ── Unit edit sig pads removed (no signature canvases in unit edit form) ──


function saveUnitEdit(){
  var unitId=window._editingUnitId;
  var units=(typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var idx=units.findIndex(function(x){ return x.id===unitId; });
  if(idx===-1){ showToast('Unit not found'); return; }
  var get=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var chk=function(id){ var el=document.getElementById(id); return el?el.checked:false; };
  var u=units[idx];
  u.street=get('ue_street')||u.street; u.num=get('ue_num')||u.num;
  u.bedrooms=parseInt(get('ue_bedrooms'))||u.bedrooms;
  u.bathrooms=get('ue_bathrooms'); u.type=get('ue_type'); u.foundation=get('ue_foundation');
  u.funder=get('ue_funder'); u.phase=get('ue_phase'); u.year=get('ue_year');
  u.status=get('ue_status')||'vacant'; u.accessible=chk('ue_accessible'); u.isElders=chk('ue_isElders');
  u.notes=get('ue_notes');
  // Save tenant name field (editable override)
  u.unitSig = {
    tenant: {
      name: get('ue_sig_tenant_name'),
      date: get('ue_sig_tenant_date')
    }
  };
  // HM approval
  var hmDec = (document.getElementById('ue_sig_hm_decision')||{}).value||'';
  if(get('ue_sig_hm_name') || hmDec) {
    u.unitHmSig = { name: get('ue_sig_hm_name'), date: get('ue_sig_hm_date'), decision: hmDec, notes: get('ue_sig_hm_notes'), savedAt: new Date().toISOString().split('T')[0] };
    // Update budget indicator badge
    var _hb = document.getElementById('ue_sig_hm_badge');
    if(_hb && hmDec) { _hb.textContent = hmDec==='approved'?'Approved ✓':hmDec; _hb.style.color = hmDec==='approved'?'#15803d':'#1d4ed8'; }
  }
  // ED approval
  var edDec = (document.getElementById('ue_sig_ed_decision')||{}).value||'';
  if(get('ue_sig_ed_name') || edDec) {
    u.unitEdSig = { name: get('ue_sig_ed_name'), date: get('ue_sig_ed_date'), decision: edDec, notes: get('ue_sig_ed_notes'), savedAt: new Date().toISOString().split('T')[0] };
    var _eb = document.getElementById('ue_sig_ed_badge');
    if(_eb && edDec) { _eb.textContent = edDec==='approved'?'Approved ✓':edDec; _eb.style.color = '#15803d'; }
  }
  // Read from hidden fields (populated by tenant search)
  var toVal=(document.getElementById('ue_assignedTo')||{}).value||'';
  var nmVal=(document.getElementById('ue_assignedName')||{}).value||'';
  u.assignedTo=toVal; u.assignedName=nmVal;
  u.assignedDate=get('ue_assignedDate');
  // If status changed to vacant/repair/condemned, clear assignment
  if(u.status==='vacant'||u.status==='under_repair'||u.status==='condemned'){
    u.assignedTo=null; u.assignedName=null; u.assignedDate=null;
  }
  // HM approval gate — must have at least mgr_approved to assign tenant
  if(u.assignedTo && (u.status==='occupied'||u.status==='reserved')) {
    var apps2 = typeof applications!=='undefined'?applications:[];
    var linkedApp2 = apps2.find(function(a){return a.id===u.assignedTo;});
    var role2 = window.currentRole||'housing_employee_l1';
    if(linkedApp2) {
      var appStatus = linkedApp2.status||'';
      var edApproved = appStatus===APP_STATUS.ED_APPROVED;
      var hmApproved = appStatus===APP_STATUS.MGR_APPROVED||edApproved;
      if(role2=== ROLE.ED && !edApproved) {
        showToast('⚠ ED Approval required before assigning tenant. Application is: '+appStatus.replace(/_/g,' '));
        return;
      }
      if(role2=== ROLE.HOUSING_MANAGER && !hmApproved) {
        showToast('⚠ Housing Manager approval required before assigning tenant. Application is: '+appStatus.replace(/_/g,' '));
        return;
      }
      // Write back HM approval flag on unit
      u.tenantApprovedBy = role2=== ROLE.ED?'Executive Director':'Housing Manager';
      u.tenantApprovedAt = new Date().toISOString().split('T')[0];
    }
  }
  // Save unit to Supabase
  sbSaveUnit(u).catch(function(e){ console.warn('Unit save failed:', e); });
  // Sync assigned unit back onto the application record
  if(u.assignedTo) {
    var apps3 = typeof applications!=='undefined'?applications:[];
    var aIdx = apps3.findIndex(function(a){return a.id===u.assignedTo;});
    if(aIdx>=0){
      apps3[aIdx].assignedUnit = u.id;
      apps3[aIdx].assignedAddress = (u.num+' '+u.street).trim();
      sbSaveApplication(apps3[aIdx]).catch(function(e){ console.warn('App assignment save failed:', e); });
    }
  }
  auditEntry(u.id,'unit_edit','Unit saved'+(u.assignedTo?' — tenant: '+u.assignedName:''),window.currentRole||'staff');
  closeUnitEditModal(); renderInventoryView();
  if(typeof updateDashStats==='function') updateDashStats();
  showToast('✓ Saved — '+u.num+' '+u.street);
}


// ══════════════════════════════════════════════════════
// UNIT EDIT — Tenant Search Functions
// ══════════════════════════════════════════════════════

function ueTenantSearch(q) {
  var dd = document.getElementById('ue_tenant_dropdown');
  var nf = document.getElementById('ue_tenant_notfound');
  if (!dd) return;

  var apps = typeof applications !== 'undefined' ? applications : [];
  var role = window.currentRole || 'housing_employee_l1';

  // Show ed_approved to all roles; also mgr_approved for HM and ED
  var eligible = apps.filter(function(a) {
    if (a.status === APP_STATUS.ED_APPROVED) return true;
    if ((ROLE.isManagement(role)) && a.status === APP_STATUS.MGR_APPROVED) return true;
    return false;
  });

  var query = (q || '').trim().toLowerCase();
  var matches = query.length > 0
    ? eligible.filter(function(a) {
        var name = ((a.fn || '') + ' ' + (a.ln || '')).toLowerCase();
        return name.includes(query) || (a.id || '').toLowerCase().includes(query);
      })
    : eligible.slice(0, 10);

  // Hide "not found" card while typing
  if (nf) nf.style.display = 'none';

  if (!matches.length) {
    dd.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--muted);">No approved applications found'
      + (query.length > 1 ? ' matching "<strong>' + q + '</strong>"' : '')
      + '</div>'
      + '<div style="padding:10px 14px;border-top:1px solid var(--border);">'
      + '<button type="button" onmousedown="dd_showNotFound()" style="background:none;border:none;font-size:12px;font-weight:600;color:var(--yellow);cursor:pointer;font-family:DM Sans,sans-serif;padding:0;">📝 Start a new application instead →</button>'
      + '</div>';
    dd.style.display = 'block';
    return;
  }

  window._ueTenantMatches = {};
  dd.style.display = 'block';
  dd.innerHTML = matches.map(function(a) {
    var name = ((a.fn || '') + ' ' + (a.ln || '')).trim() || 'Unknown';
    var isED = a.status === APP_STATUS.ED_APPROVED;
    var statusLabel = isED ? 'ED Approved' : 'HM Recommended';
    var statusColor = isED ? '#15803d' : '#1d4ed8';
    var statusBg    = isED ? '#f0fdf4'  : '#eff6ff';
    window._ueTenantMatches[a.id] = {name: name, status: a.status};
    return '<div onmousedown="ueTenantSelectById(\''+a.id+'\')"'
      + ' style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;"'
      + ' onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'none\'">' 
      + '<div>'
      + '<div class="js-txt-bold">' + name + '</div>'
      + '<div class="js-lbl-sm">' + a.id
        + (a.bedrooms ? ' · ' + a.bedrooms + ' bed needed' : '') + '</div>'
      + '</div>'
      + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + statusBg + ';color:' + statusColor + ';white-space:nowrap;">' + statusLabel + '</span>'
      + '</div>';
  }).join('');
}

function dd_showNotFound() {
  var dd = document.getElementById('ue_tenant_dropdown');
  var nf = document.getElementById('ue_tenant_notfound');
  if (dd) dd.style.display = 'none';
  if (nf) nf.style.display = 'block';
}

function ueTenantSelectById(appId) {
  var match = (window._ueTenantMatches || {})[appId];
  if (!match) return;
  ueTenantSelect(appId, match.name, match.status);
}

function ueTenantSelect(appId, name, status) {
  // Hide dropdown
  var dd = document.getElementById('ue_tenant_dropdown');
  if (dd) dd.style.display = 'none';

  // Clear search box
  var srch = document.getElementById('ue_tenant_search');
  if (srch) srch.value = '';

  // Populate hidden fields
  var toEl = document.getElementById('ue_assignedTo');
  var nmEl = document.getElementById('ue_assignedName');
  if (toEl) toEl.value = appId;
  if (nmEl) nmEl.value = name;

  // Hide current tenant card (we're replacing it)
  var curCard = document.getElementById('ue_current_tenant');
  if (curCard) curCard.style.display = 'none';

  // Hide "not found" prompt
  var nf = document.getElementById('ue_tenant_notfound');
  if (nf) nf.style.display = 'none';

  // Show selected card
  var sel = document.getElementById('ue_tenant_selected');
  if (!sel) return;

  var isED = status === APP_STATUS.ED_APPROVED;
  var isHM = status === APP_STATUS.MGR_APPROVED;
  var statusLabel = isED ? 'ED Approved' : isHM ? 'HM Recommended' : status.replace(/_/g,' ');
  var statusColor = isED ? '#15803d' : isHM ? '#1d4ed8' : '#92400e';
  var statusBg    = isED ? '#f0fdf4'  : isHM ? '#eff6ff' : '#fffbeb';

  // Role-based warning
  var role = window.currentRole || 'housing_employee_l1';
  var warn = '';
  if (!isED && !isHM) {
    warn = '<div style="margin-top:8px;padding:8px 10px;background:#fef2f2;border-radius:6px;font-size:11px;color:#b91c1c;font-weight:600;">⛔ This application has not been approved. Cannot assign tenant.</div>';
  } else if (isHM && role === ROLE.ED) {
    warn = '<div style="margin-top:8px;padding:8px 10px;background:#eff6ff;border-radius:6px;font-size:11px;color:#1d4ed8;">ℹ️ Recommended by Housing Manager — awaiting your final approval. You may proceed with assignment.</div>';
  }

  sel.style.display = 'block';
  sel.innerHTML = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">'
    + '<div>'
    + '<div style="font-size:13px;font-weight:700;">' + name + '</div>'
    + '<div class="js-lbl-sm" class="mt-4">' + appId + '</div>'
    + '</div>'
    + '<div class="flex-g8">'
    + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + statusBg + ';color:' + statusColor + ';">' + statusLabel + '</span>'
    + '<button type="button" onclick="ueClearTenantSelection()" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 8px;font-size:11px;color:var(--muted);cursor:pointer;font-family:DM Sans,sans-serif;">✕</button>'
    + '</div>'
    + '</div>'
    + warn;
}

function ueClearTenantSelection() {
  var toEl = document.getElementById('ue_assignedTo');
  var nmEl = document.getElementById('ue_assignedName');
  if (toEl) toEl.value = '';
  if (nmEl) nmEl.value = '';
  var sel = document.getElementById('ue_tenant_selected');
  if (sel) { sel.style.display = 'none'; sel.innerHTML = ''; }
  var srch = document.getElementById('ue_tenant_search');
  if (srch) { srch.value = ''; srch.focus(); }
  var nf = document.getElementById('ue_tenant_notfound');
  if (nf) nf.style.display = 'none';
}

function ueRemoveTenant() {
  // Clear the currently assigned tenant from the unit
  var toEl = document.getElementById('ue_assignedTo');
  var nmEl = document.getElementById('ue_assignedName');
  var dtEl = document.getElementById('ue_assignedDate');
  if (toEl) toEl.value = '';
  if (nmEl) nmEl.value = '';
  if (dtEl) dtEl.value = '';
  var curCard = document.getElementById('ue_current_tenant');
  if (curCard) curCard.style.display = 'none';
  var srch = document.getElementById('ue_tenant_search');
  if (srch) { srch.value = ''; srch.focus(); }
  var sel = document.getElementById('ue_tenant_selected');
  if (sel) { sel.style.display = 'none'; sel.innerHTML = ''; }
  // Switch status back to vacant suggestion
  var statusEl = document.getElementById('ue_status');
  if (statusEl && statusEl.value === 'occupied') {
    statusEl.value = 'vacant';
    unitEditStatusChange();
  }
  showToast('Tenant removed — remember to Save Changes');
}



function _initStep6DocLib() {
  var mount = document.getElementById('step6_doclib_mount');
  if (!mount || !window.DocLibrary) return;
  // Already mounted for this app — just refresh
  if (_step6DocLib) { _step6DocLib.refresh(); return; }
  // currentAppId is set by saveApplicationRecord() in goTo() before this runs
  var appId = window.currentAppId || currentAppId;
  if (!appId && typeof generateAppId === 'function') {
    appId = generateAppId();
    currentAppId = appId;
    window.currentAppId = appId;
  }
  if (!appId) { console.warn('[DocLib] step6: no appId available'); return; }
  _step6DocLib = window.DocLibrary.create(mount, {
    entityType:    'application',
    entityId:      appId,
    pathPrefix:    'applications/' + appId,
    supabaseUrl:   SUPABASE_URL,
    supabaseAnon:  SUPABASE_ANON,
    storageBucket: STORAGE_BUCKET,
    getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ',''); },
    auditTable:    'housing_audit_log',
    getActor:      function(){ return window.currentRole || 'staff'; },
    categories:    [
      { key:'id',          label:'ID',              icon:'\uD83E\uDDFE' },
      { key:'income',      label:'Income / Pay',    icon:'\uD83D\uDCB0' },
      { key:'reference',   label:'Reference',       icon:'\uD83D\uDCDD' },
      { key:'housing_hist',label:'Housing History', icon:'\uD83C\uDFE0' },
      { key:'medical',     label:'Medical',         icon:'\u2695\uFE0F'  },
      { key:'migrated',    label:'Migrated',        icon:'\uD83D\uDCC2' },
      { key:'other',       label:'Other',           icon:'\uD83D\uDCCE' }
    ],
    maxSizeMB:     25
  });
}

// Categories for application documents. Drive the upload picker + chips.
var _SCORECARD_APP_DOC_CATEGORIES = [
  { key:'id',          label:'ID',              icon:'\uD83E\uDDFE' },
  { key:'income',      label:'Income / Pay',    icon:'\uD83D\uDCB0' },
  { key:'reference',   label:'Reference',       icon:'\uD83D\uDCDD' },
  { key:'housing_hist',label:'Housing History', icon:'\uD83C\uDFE0' },
  { key:'medical',     label:'Medical',         icon:'\u2695\uFE0F'  },
  { key:'migrated',    label:'Migrated',        icon:'\uD83D\uDCC2' },
  { key:'other',       label:'Other',           icon:'\uD83D\uDCCE' }
];

// Active factory instance — allows scSaveAssignedDocs to refresh the list
window._scDocsLib = null;

async function scLoadDocs(app) {
  var mount = document.getElementById('sc_docs_mount');
  if (!mount || !app) return;
  var appId = app.id || '';

  // Tear down any prior instance so we don't double-mount
  mount.innerHTML = '';
  if (!window.DocLibrary) {
    mount.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Document library unavailable.</div>';
    return;
  }
  var canDelete = (ROLE.isManagement(window.currentRole));

  window._scDocsLib = window.DocLibrary.create(mount, {
    entityType:    'application',
    entityId:      appId,
    pathPrefix:    'applications/' + appId,
    supabaseUrl:   SUPABASE_URL,
    supabaseAnon:  SUPABASE_ANON,
    storageBucket: STORAGE_BUCKET,
    getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ',''); },
    auditTable:    'housing_audit_log',
    getActor:      function(){ return window.currentRole || 'staff'; },
    categories:    _SCORECARD_APP_DOC_CATEGORIES,
    readOnly:      true,  // Upload happens in step 6; scorecard is review-only
    customLoader:  async function() {
      var allFiles = [];
      // Primary: app_documents table (manually assigned)
      try {
        var r = await fetch(
          SUPABASE_URL + '/rest/v1/app_documents?app_id=eq.' + encodeURIComponent(appId) + '&order=added_at.asc',
          { headers: HOUSING_HEADERS }
        );
        if (r.ok) {
          var rows = await r.json();
          rows.forEach(function(row){
            allFiles.push({
              path:     row.file_path,
              name:     row.file_name,
              size:     row.file_size || 0,
              type:     row.file_type || '',
              category: 'migrated',
              addedAt:  (row.added_at || '').slice(0,10),
              addedBy:  row.added_by || '',
              docId:    row.id
            });
          });
        }
      } catch(e) { console.warn('app_documents load error:', e); }

      // Secondary: direct uploads to this app's folder
      try {
        var appFiles = await sbListFiles('applications/' + appId + '/');
        if (appFiles && appFiles.length) {
          appFiles.forEach(function(f){
            if (!f.name || f.name === '.emptyFolderPlaceholder') return;
            var fpath = 'applications/' + appId + '/' + f.name;
            if (!allFiles.find(function(x){ return x.path === fpath; })) {
              allFiles.push({
                path:     fpath,
                name:     f.name,
                size:     f.metadata ? f.metadata.size : 0,
                type:     f.metadata ? f.metadata.mimetype : '',
                category: 'other',
                addedAt:  (f.created_at || '').slice(0,10),
                addedBy:  ''
              });
            }
          });
        }
      } catch(e) { /* folder may not exist yet */ }

      // Category enrichment: read audit-log rows for this app so we can
      // apply the per-file category stored in details JSON at upload time.
      try {
        var audit = await sbLoadFileMeta('application', appId);
        if (Array.isArray(audit)) {
          var catByPath = {};
          audit.forEach(function(row){
            if (row.path && row.category) catByPath[row.path] = row.category;
          });
          allFiles.forEach(function(f){
            if (!f.docId && catByPath[f.path]) f.category = catByPath[f.path];
          });
        }
      } catch(e) { /* non-fatal */ }

      return allFiles;
    },
    customDelete: async function(file) {
      if (file.docId) {
        // app_documents row — remove the assignment only; the underlying
        // storage file (shared migrated folder) stays put.
        await fetch(
          SUPABASE_URL + '/rest/v1/app_documents?id=eq.' + encodeURIComponent(file.docId),
          { method:'DELETE', headers: HOUSING_HEADERS }
        );
      } else {
        // Direct upload: delete the storage object + write a tombstone
        // audit row. We intentionally keep the original file_uploaded
        // audit row so history is preserved.
        await sbDeleteFile(file.path);
        await fetch(SUPABASE_URL + '/rest/v1/housing_audit_log', {
          method:'POST',
          headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer':'return=minimal' }),
          body: JSON.stringify({
            entity_type: 'application',
            entity_id:   String(appId),
            action:      'file_deleted',
            detail:      JSON.stringify({ path: file.path, name: file.name }),
            actor:       window.currentRole || 'staff',
            created_at:  new Date().toISOString()
          })
        });
      }
    }
  });

  // Wire the Assign Files button (scorecard-specific flow, stays outside factory)
  var assignBtn = document.getElementById('sc_assign_btn');
  if (assignBtn) {
    assignBtn.onclick = null;
    assignBtn.addEventListener('click', function(){ scShowAssignDocs(app); });
  }
}











// ══ IN-PAGE PRINT PANEL ══
// ══════════════════════════════════════════════════════════
// IN-PAGE PRINT PANEL
// ══════════════════════════════════════════════════════════
var _printPanelDoc = '';







// Close panel on Escape key
document.addEventListener('keydown', function(e) {
  if(e.key === 'Escape') closePrintPanel();
});

// ── Save ED adjustment ──
function saveEdAdjustment(){
  if(window.currentRole !== ROLE.ED){ showToast('Only the Executive Director can apply adjustments.'); return; }
  var app = window._currentScorecardApp;
  if(!app){ showToast('No application selected.'); return; }
  var pts = parseInt((document.getElementById('sc_ed_adj_pts')||{}).value||0)||0;
  var reason = ((document.getElementById('sc_ed_adj_reason')||{}).value||'').trim();
  var notes  = ((document.getElementById('sc_ed_adj_notes')||{}).value||'').trim();
  var idx = applications.findIndex(function(a){ return a.id===app.id; });
  if(idx===-1){ showToast('Application not found'); return; }
  applications[idx].edAdjustment   = pts;
  applications[idx].edAdjustReason = reason;
  applications[idx].edNotes        = notes;
  // Recompute score with adjustment
  if(typeof rescoreApplication === 'function') {
    rescoreApplication(applications[idx]);
  } else {
    // Simple fallback: add pts to existing score
    var bd = applications[idx].scoreBreakdown || {};
    bd.edAdjustment = pts;
    applications[idx].scoreBreakdown = bd;
    var base = Object.keys(bd).filter(function(k){return k!=='edAdjustment';})
      .reduce(function(sum,k){return sum+(bd[k]||0);},0);
    applications[idx].score = base + pts;
  }
  sbSaveApplication(applications[idx]).catch(function(e){ console.warn('ED adj save failed:',e); });
  auditEntry(app.id, 'ed_adjustment', 'ED adjusted score by '+(pts>=0?'+':'')+pts+(reason?' — '+reason:''), 'Executive Director');
  // Update display
  window._currentScorecardApp = applications[idx];
  var scoreEl = document.getElementById('sc_score_total');
  if(scoreEl) scoreEl.textContent = applications[idx].score;
  var edSec = document.getElementById('sc_ed_section');
  var edCon = document.getElementById('sc_ed_content');
  if(edSec&&edCon&&(pts||notes)){
    edSec.style.display='block';
    edCon.innerHTML = (pts?'<div style="font-size:13px;margin-bottom:6px;"><strong>'+(pts>0?'+':'')+pts+' pts</strong>'+(reason?' — '+reason:'')+'</div>':'')+(notes?'<div class="js-txt-muted">'+notes+'</div>':'');
  }
  var msg=document.getElementById('sc_ed_save_msg');
  if(msg){msg.style.display='flex';setTimeout(function(){msg.style.display='none';},2000);}
  if(typeof updateDashStats==='function') updateDashStats();
  if(typeof renderDashTable==='function') renderDashTable();
  showToast('ED adjustment saved'+(pts?' ('+( pts>0?'+':'')+pts+' pts)':''));
}

// ── User management (Settings > Users) ──


// ── Print Scorecard ──
function printScorecard(){
  var app=window._currentScorecardApp;if(!app)return;
  var name=((app.fn||'')+' '+(app.ln||'')).trim();
  var today=new Date().toLocaleDateString('en-CA');
  var bd=app.scoreBreakdown||{};var s=app.score||0;
  var logoSrc=(document.querySelector('.app-logo img')||{}).src||'';
  // Use V2 tier thresholds (ED-adjustable); fall back to defaults if not loaded yet.
  var _t = (typeof liveV2Tiers === 'object' && liveV2Tiers) ? liveV2Tiers : {critical:80, high:60, medium:40};
  var tierColor2 = s >= _t.critical ? '#14532d'
                 : s >= _t.high     ? '#1e3a5f'
                 : s >= _t.medium   ? '#92400e'
                 :                    '#b91c1c';
  var tierBg2    = s >= _t.critical ? '#f0fdf4'
                 : s >= _t.high     ? '#e8eef5'
                 : s >= _t.medium   ? '#fffbeb'
                 :                    '#fef2f2';
  // V2 breakdown has a nested structure: sectionA.{urgent,health,...}, sectionB.{rent,condition,...}, arrears, edAdjustment.
  // Flatten it into a flat list of rows with friendly labels.
  var sA = bd.sectionA || {};
  var sB = bd.sectionB || {};
  var V2ROWS = [
    {section:'A', label:'Urgent Need / Displacement',    val:sA.urgent},
    {section:'A', label:'Health & Safety Risk',          val:sA.health},
    {section:'A', label:'Overcrowding',                  val:sA.overcrowding},
    {section:'A', label:'Household Composition',         val:sA.household},
    {section:'A', label:'Accessibility Need',            val:sA.accessibility},
    {section:'A', label:'Waitlist Duration',             val:sA.waitlist},
    {section:'B', label:'Rent Payment History',          val:sB.rent},
    {section:'B', label:'Unit Condition History',        val:sB.condition},
    {section:'B', label:'Tenancy Conduct',               val:sB.conduct},
    {section:'B', label:'Income Stability',              val:sB.income},
    {section:'C', label:'Arrears Deduction',             val:bd.arrears}
  ];
  var currentSection = '';
  var tableRows = V2ROWS.map(function(row){
    var v = (row.val === undefined || row.val === null) ? 0 : row.val;
    var col = v>0?'#15803d':v<0?'#b91c1c':'#666';
    var sectionHdr = '';
    if(row.section !== currentSection) {
      currentSection = row.section;
      var sectLabel = row.section === 'A' ? 'Section A — Housing Need'
                   : row.section === 'B' ? 'Section B — Tenant Responsibility'
                   :                       'Section C — Arrears';
      sectionHdr = '<tr><td colspan="2" style="padding:10px 12px 4px;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#888;background:#fafafa;border-top:1px solid #e8e6df;">'+sectLabel+'</td></tr>';
    }
    return sectionHdr + '<tr style="border-bottom:1px solid #f0f0ec;"><td style="padding:8px 12px;font-weight:600;font-size:11px;">'+row.label+'</td><td style="padding:8px 12px;text-align:right;font-size:14px;font-weight:700;color:'+col+';">'+(v>0?'+':'')+v+'</td></tr>';
  }).join('');
  var edAdj=bd.edAdjustment||0;
  if(edAdj)tableRows+='<tr style="border-top:2px solid #F8E41A;"><td style="padding:8px 12px;font-weight:700;">ED Adjustment</td><td style="padding:8px 12px;text-align:right;font-size:14px;font-weight:700;color:'+(edAdj>0?'#15803d':'#b91c1c')+'">'+(edAdj>0?'+':'')+edAdj+'</td></tr>';
  var doc='<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Score Report — '+name+'</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}@page{size:letter;margin:16mm 14mm;}body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;}.footer{position:fixed;bottom:8mm;left:0;right:0;padding:0 14mm;display:flex;justify-content:space-between;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:5px;}</style>'
    +'</head><body>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #F8E41A;padding-bottom:12px;margin-bottom:16px;">'
    +'<div class="flex-g10">'+(logoSrc?'<img src="'+logoSrc+'" style="width:40px;height:40px;object-fit:contain;" alt="CLFN"/>':'')+'<div><div class="js-txt-lg">CLFN Housing — Score Report</div><div style="font-size:10px;color:#888;">Constance Lake First Nation</div></div></div>'
    +'<div style="text-align:right;font-size:10px;color:#888;line-height:1.7;"><strong style="font-size:12px;color:#111;">'+name+'</strong><br/>'+app.id+'<br/>Generated: '+today+'</div></div>'
    +'<div style="display:flex;align-items:center;gap:24px;background:#111;border-radius:8px;padding:16px 20px;margin-bottom:16px;">'
    +'<div><div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:4px;">Total Score</div><div style="font-size:40px;font-weight:700;color:#F8E41A;line-height:1;">'+s+'</div></div>'
    +'<div style="width:1px;height:40px;background:#333;"></div>'
    +'<div><div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:6px;">Priority Tier</div><div style="font-size:13px;font-weight:700;padding:6px 14px;border-radius:6px;background:'+tierBg2+';color:'+tierColor2+';">'+(app.tier||'—')+'</div></div>'
    +'<div style="flex:1;"><div style="font-size:9px;color:#888;margin-bottom:4px;">Score Bar</div><div style="height:6px;background:#333;border-radius:3px;overflow:hidden;"><div style="height:100%;width:'+Math.min(100,Math.max(0,Math.round((s/Math.max(100,(_t.critical||80)*1.25))*100)))+'%;background:'+tierColor2+';border-radius:3px;"></div></div></div></div>'
    +'<table style="width:100%;border-collapse:collapse;border:1px solid #eee;margin-bottom:16px;">'
    +'<thead><tr style="background:#111;border-bottom:2px solid #F8E41A;"><th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:#888;font-weight:700;">Category</th><th style="padding:8px 12px;text-align:right;font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:#888;font-weight:700;width:60px;">Score</th></tr></thead>'
    +'<tbody>'+tableRows+'</tbody>'
    +'<tfoot><tr style="background:#f5f5f3;border-top:2px solid #111;"><td style="padding:10px 12px;font-weight:700;">Total</td><td style="padding:10px 12px;text-align:right;font-size:18px;font-weight:700;">'+(s>0?'+':'')+s+'</td></tr></tfoot></table>'
    +'<div class="footer"><span>CLFN Housing Department — Confidential</span><span>Generated '+today+'</span></div>'
  showPrintPanel(doc, 'Score Report');
}





function previewFromDash(app){
  if(!app) return;
  var name    = ((app.fn||'')+' '+(app.ln||'')).trim() || '—';
  var today   = new Date().toLocaleDateString('en-CA');
  var logoSrc = (document.querySelector('.app-logo img')||{}).src || '';
  var hasCoApp = !!(app.coApp && app.coApp.fn);
  var hasArr   = !!app.hasArrears;

  // ── helpers ──
  function row(k, v) {
    var val = (v !== null && v !== undefined && String(v).trim() !== '') ? v : '—';
    return '<tr>'
      +'<td style="padding:4px 10px;color:#555;font-size:10px;font-weight:600;width:34%;'
      +'border-bottom:1px solid #f2f2f0;vertical-align:top;">'+k+'</td>'
      +'<td style="padding:4px 10px;font-size:10px;border-bottom:1px solid #f2f2f0;">'+val+'</td>'
      +'</tr>';
  }
  function section(title, body) {
    return '<div style="margin-bottom:12px;page-break-inside:avoid;">'
      +'<div style="font-size:9.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;'
      +'color:#555;border-bottom:2.5px solid #F8E41A;padding-bottom:3px;margin-bottom:0;">'
      +title+'</div>'
      +'<table class="std-tbl">'+body+'</table>'
      +'</div>';
  }
  function yn(v) { return v ? 'Yes' : 'No'; }
  function dollar(v) { var f=parseFloat(v)||0; return f>0 ? '$'+f.toLocaleString() : '—'; }

  // ── sig block (pen-on-paper for dash print — no canvas available) ──
  function sigBlock(label, pName, dt) {
    return '<div class="print-sec">'
      +'<div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;'
      +'color:#555;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid #ddd;">'+label+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:6px;">'
      +'<div><div class="sig-lbl">Full Name</div>'
      +'<div style="font-size:10.5px;font-weight:600;border-bottom:1px solid #bbb;padding-bottom:2px;min-height:15px;">'+(pName||'')+'</div></div>'
      +'<div><div class="sig-lbl">Date</div>'
      +'<div style="font-size:10px;border-bottom:1px solid #bbb;padding-bottom:2px;min-height:15px;">'+(dt||'')+'</div></div>'
      +'</div>'
      +'<div style="width:100%;height:65px;border:1px solid #ddd;border-radius:3px;background:#fafaf8;'
      +'display:flex;align-items:center;justify-content:center;">'
      +'<span style="font-size:9px;color:#ccc;">Sign here</span></div>'
      +'</div>';
  }
  function internalSig(label) {
    return '<div class="print-sec">'
      +'<div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;'
      +'color:#7a5c00;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid #e8d87a;">'+label+'</div>'
      +'<div class="sig-lbl">Name &amp; Title</div>'
      +'<div style="border-bottom:1px solid #444;height:16px;margin-bottom:8px;"></div>'
      +'<div class="sig-lbl">Signature</div>'
      +'<div style="border-bottom:1px solid #444;height:52px;margin-bottom:8px;"></div>'
      +'<div style="display:grid;grid-template-columns:1fr 90px;gap:10px;">'
      +'<div><div class="sig-lbl">Date</div>'
      +'<div class="sig-line"></div></div>'
      +'<div><div class="sig-lbl">Decision</div>'
      +'<div class="sig-line"></div></div>'
      +'</div></div>';
  }

  // ── income body ──
  var incBody = '';
  if(app.incomes && app.incomes.length) {
    app.incomes.forEach(function(inc, i) {
      var amt = inc.primaryAmt ? dollar(inc.primaryAmt) : '—';
      incBody += row(inc.person || ('Income '+(i+1)),
        (inc.incomeType||'—') + (inc.primaryAmt ? ' — '+dollar(inc.primaryAmt) : '')
        + (inc.employer ? ' · '+inc.employer : ''));
    });
  }
  if(!incBody) incBody = row('Income / Employment', '—');

  // ── household body ──
  var habBody = '';
  if(app.habitants && app.habitants.length) {
    app.habitants.forEach(function(h, i) {
      var nm = [(h.fn||''),(h.ln||'')].filter(Boolean).join(' ') || ('Member '+(i+1));
      habBody += row(nm, (h.relationship||'') + (h.dob ? ' · DOB: '+h.dob : ''));
    });
  }
  if(!habBody) habBody = row('Household Members', '—');

  // ── references body ──
  var refBody = '';
  if(app.references && app.references.length) {
    app.references.forEach(function(r, i) {
      var nm = [(r.fn||''),(r.ln||'')].filter(Boolean).join(' ') || ('Reference '+(i+1));
      if(nm || r.phone) refBody += row(nm, (r.relationship||'') + (r.phone ? ' · '+r.phone : '') + (r.email ? ' · '+r.email : ''));
    });
  }
  if(!refBody) refBody = row('References', '—');

  // ── pets body ──
  var petBody = '';
  if(app.pets && app.pets.length) {
    app.pets.forEach(function(p) {
      if(p.type || p.name) petBody += row(p.name || p.type, [p.type, p.size, p.desc].filter(Boolean).join(' · '));
    });
  }

  var sigCols = hasCoApp ? '1fr 1fr 1fr' : '1fr 1fr';

  var doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"/>'
    +'<title>CLFN Housing Application — '+name+'</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'@page{size:letter;margin:14mm 13mm 20mm 13mm;}'
    +'body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#111;background:#fff;line-height:1.4;}'
    +'.footer{position:fixed;bottom:7mm;left:0;right:0;padding:0 13mm;display:flex;justify-content:space-between;font-size:8.5px;color:#aaa;border-top:1px solid #eee;padding-top:4px;}'
    +'</style>'
    +'</head><body>'

    // Header
    +'<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #F8E41A;padding-bottom:10px;margin-bottom:14px;">'
    +'<div class="flex-g10">'
    +(logoSrc?'<img src="'+logoSrc+'" style="width:40px;height:40px;object-fit:contain;" alt="CLFN"/>':'')
    +'<div><div class="js-txt-lg">CLFN Housing Application</div>'
    +'<div style="font-size:9.5px;color:#888;">Constance Lake First Nation</div></div></div>'
    +'<div style="text-align:right;font-size:9.5px;color:#888;line-height:1.9;">'
    +'<strong style="font-size:12px;color:#111;">'+name+'</strong><br/>'
    +(app.id||'—')+'<br/>Date: '+today+'</div></div>'

    // 1. Applicant Information
    +section('Applicant Information',
       row('First Name',           app.fn   ||'—')
      +row('Last Name',            app.ln   ||'—')
      +row('Date of Birth',        app.dob  ||'—')
      +row('Band Number',          app.band ||'—')
      +row('On Reserve Status',    app.reserve||'—')
      +row('Marital Status',       app.marital||'—')
      +row('Cell Phone',           app.phone||'—')
      +row('Email Address',        app.email||'—')
      +row('Application Date',     app.appDate||'—')
      +row('Accessibility Needs',  app.accessibility||'None')
      +row('Housing Classification', app.classification||'—')
    )

    // 2. Current Address
    +section('Current Address',
       row('Street Address',  app.street  ||'—')
      +row('City',            app.city    ||'—')
      +row('Province',        app.province||'—')
      +row('Postal Code',     app.postal  ||'—')
      +row('Occupancy Date',  app.occDate ||'—')
    )

    // 3. Housing & Arrears
    +section('Current Housing &amp; Arrears',
       row('Currently Has a House', yn(app.haveHouse))
      +row('Home Condition',   app.haveHouse ? (app.homeCondition||'—') : 'N/A')
      +row('Arrears Owed to CLFN', yn(hasArr))
      +row('Arrears Amount',   hasArr ? dollar(app.arrBalAmt) : 'N/A')
    )

    // 4. Employment & Income
    +section('Employment &amp; Income', incBody)

    // 5. Co-Applicant
    +section('Co-Applicant',
       row('Co-Applicant', yn(hasCoApp))
      +(hasCoApp ? row('First Name',    app.coApp.fn  ||'—') : '')
      +(hasCoApp ? row('Last Name',     app.coApp.ln  ||'—') : '')
      +(hasCoApp ? row('Date of Birth', app.coApp.dob ||'—') : '')
      +(hasCoApp ? row('Band Number',   app.coApp.band||'—') : '')
      +(hasCoApp ? row('Reserve Status',app.coApp.reserve||'—') : '')
      +(hasCoApp ? row('Cell Phone',    app.coApp.cell||'—') : '')
      +(hasCoApp ? row('Email',         app.coApp.email||'—') : '')
    )

    // 6. Household Members
    +section('Household Members', habBody)

    // 7. References
    +section('References', refBody)

    // 8. Pets
    +(petBody ? section('Pets', petBody) : '')

    // Terms & Conditions
    +'<div style="margin-top:14px;padding:10px 12px;border:1px solid #ddd;border-radius:4px;background:#fafaf8;page-break-inside:avoid;">'
    +'<div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#555;margin-bottom:7px;padding-bottom:4px;border-bottom:1.5px solid #F8E41A;">Terms &amp; Conditions — Applicant Declaration</div>'
    +'<p style="font-size:9.5px;color:#444;line-height:1.6;margin-bottom:5px;">By signing below, I hereby apply for housing assistance from the Constance Lake First Nation (CLFN) Housing Program and declare the following:</p>'
    +'<ol style="font-size:9.5px;color:#444;line-height:1.7;padding-left:14px;">'
    +'<li>All information provided in this application is true, accurate, and complete to the best of my knowledge.</li>'
    +'<li>I understand that providing false or misleading information may result in immediate disqualification and removal from the housing waitlist.</li>'
    +'<li>I consent to CLFN collecting, using, and sharing my personal information for the purpose of assessing this application, in accordance with applicable privacy legislation.</li>'
    +'<li>I understand that my application will be scored according to the CLFN Housing Scoring Rubric and that priority is determined by score, not date of application alone.</li>'
    +'<li>I agree to notify the CLFN Housing Department within 30 days of any change in household composition, income, address, or contact information.</li>'
    +'<li>I understand that acceptance into CLFN housing is conditional upon satisfying all outstanding arrears or entering into a formal payment arrangement approved by CLFN prior to occupancy.</li>'
    +'<li>I agree to comply with all CLFN Housing policies, lease agreements, and community by-laws as a condition of tenancy.</li>'
    +'<li>I authorize CLFN to verify any information in this application with relevant third parties including employers, financial institutions, and utility providers.</li>'
    +'</ol></div>'

    // Signatures
    +'<div style="margin-top:14px;page-break-inside:avoid;">'
    +'<div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#555;border-bottom:2.5px solid #F8E41A;padding-bottom:3px;margin-bottom:10px;">Signatures</div>'
    +'<div style="display:grid;grid-template-columns:'+sigCols+';gap:12px;">'
    +sigBlock('Applicant', name, app.appDate||today)
    +(hasCoApp ? sigBlock('Co-Applicant', (app.coApp.fn||'')+' '+(app.coApp.ln||''), app.appDate||today) : '')
    +sigBlock('Received by — Housing Staff', '', today)
    +'</div></div>'

    // Internal Use
    +'<div style="margin-top:16px;border:2px solid #F8E41A;border-radius:5px;padding:12px;page-break-inside:avoid;">'
    +'<div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#7a5c00;margin-bottom:10px;padding-bottom:5px;border-bottom:1.5px solid #F8E41A;">For Internal Use Only</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;font-size:9.5px;">'
    +'<div><div style="color:#888;margin-bottom:2px;">Date Received</div><div style="border-bottom:1px solid #555;height:16px;"></div></div>'
    +'<div><div style="color:#888;margin-bottom:2px;">File Number</div><div style="border-bottom:1px solid #555;height:16px;"></div></div>'
    +'<div><div style="color:#888;margin-bottom:2px;">Waitlist Position</div><div style="border-bottom:1px solid #555;height:16px;"></div></div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;font-size:9.5px;">'
    +'<div><div class="sig-lbl">Application Complete?</div><div>☐ Yes &nbsp;&nbsp; ☐ No</div></div>'
    +'<div><div class="sig-lbl">Documents Verified?</div><div>☐ Yes &nbsp;&nbsp; ☐ No &nbsp;&nbsp; ☐ Pending</div></div>'
    +'<div><div class="sig-lbl">Site Visit Required?</div><div>☐ Yes &nbsp;&nbsp; ☐ No</div></div>'
    +'</div>'
    +'<div style="margin-bottom:12px;font-size:9.5px;"><div class="sig-lbl">Internal Notes</div>'
    +'<div style="border:1px solid #ddd;border-radius:3px;height:44px;background:#fff;"></div></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
    +internalSig('Housing Manager Approval')
    +internalSig('Executive Director Approval')
    +'</div></div>'

    +'<div class="footer">'
    +'  <span>CLFN Housing Department — Confidential</span>'
    +'  <span id="footerRight" style="display:flex;gap:20px;align-items:center;">'
    +'    <span>Generated '+today+'</span>'
    +'    <span id="pageNum" style="font-weight:600;color:#666;"></span>'
    +'  </span>'
    +'</div>'
    +'</body></html>';

  showPrintPanel(doc, 'Housing Application');
}

function openMatchScorecard(appId, unitId) {
  var app  = (typeof applications !== 'undefined' ? applications : []).find(function(a){ return a.id===appId; });
  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
  var unit = allUnits.find(function(u){ return u.id===unitId; });
  if(!app || !unit) return;

  var modal = document.getElementById('matchScorecardModal');
  if(!modal) return;

  var appName  = ((app.fn||'')+' '+(app.ln||'')).trim();
  var unitAddr = unit.num+' '+unit.street;
  var age = app.dob ? Math.floor((new Date()-new Date(app.dob))/(365.25*24*3600*1000)) : null;
  var isElders  = age !== null && age >= 55;
  var needsBeds = 1;
  if(app.habitants) needsBeds = Math.max(1, 1+(app.coApp?1:0)+app.habitants.length);
  var needsAccess = app.accessibility && app.accessibility!=='None' && app.accessibility!=='0' && app.accessibility!==0;

  // Scoring breakdown
  var breakdown = [];
  var bedScore = 0;
  if(unit.bedrooms === needsBeds)     { bedScore=10; breakdown.push({label:'Bedroom fit (exact match)',    pts:10, max:10}); }
  else if(unit.bedrooms > needsBeds)  { bedScore=5;  breakdown.push({label:'Bedroom fit (larger than needed)', pts:5, max:10}); }
  else if(unit.bedrooms===needsBeds-1){ bedScore=3;  breakdown.push({label:'Bedroom fit (one short)',     pts:3, max:10}); }
  else                                { bedScore=0;  breakdown.push({label:'Bedroom fit (insufficient)',  pts:0, max:10}); }

  var accScore = 0;
  if(needsAccess && unit.accessible)  { accScore=8;  breakdown.push({label:'Accessibility (needs met)',   pts:8,  max:8}); }
  else if(needsAccess && !unit.accessible){ accScore=-4; breakdown.push({label:'Accessibility (unmet need)', pts:-4, max:8}); }
  else                                { breakdown.push({label:'Accessibility (not required)',             pts:0,  max:8}); }

  var eldScore = 0;
  if(isElders && unit.isElders)       { eldScore=6; breakdown.push({label:'Elders eligibility (matched)',  pts:6, max:6}); }
  else if(!isElders && unit.isElders) { eldScore=-2; breakdown.push({label:'Elders unit (not eligible)',   pts:-2, max:6}); }
  else if(isElders && !unit.isElders) { breakdown.push({label:'Elders eligible (standard unit)',           pts:0,  max:6}); }
  else                                { breakdown.push({label:'Elders (not applicable)',                   pts:0,  max:6}); }

  var total = bedScore + accScore + eldScore;
  var maxScore = 24;
  var pct = Math.round(Math.max(0,total)/maxScore*100);
  var tierColor = total>=16?'#15803d':total>=10?'#d97706':'#b91c1c';

  // Build rows
  var rows = breakdown.map(function(b){
    var col = b.pts > 0 ? '#15803d' : b.pts < 0 ? '#b91c1c' : '#888';
    var bar = Math.round(Math.max(0,b.pts)/b.max*100);
    return '<tr class="row-divider">'
      +'<td style="padding:10px 14px;font-size:13px;color:var(--text);">'+b.label+'</td>'
      +'<td style="padding:10px 14px;text-align:right;">'
        +'<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">'
        +'<div style="height:4px;width:60px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="height:100%;width:'+Math.max(0,bar)+'%;background:'+col+';border-radius:3px;"></div></div>'
        +'<span style="font-size:13px;font-weight:700;color:'+col+';">'+(b.pts>0?'+':'')+b.pts+'</span>'
        +'</td>'
      +'</tr>';
  }).join('');

  document.getElementById('msc_title').textContent   = 'Match Scorecard';
  document.getElementById('msc_app').textContent     = appName + ' (' + appId + ')';
  document.getElementById('msc_unit').textContent    = unitAddr;
  document.getElementById('msc_score').textContent   = total;
  document.getElementById('msc_pct').textContent     = pct + '% match';
  document.getElementById('msc_score').style.color   = tierColor;
  document.getElementById('msc_bar_fill').style.width = pct + '%';
  document.getElementById('msc_bar_fill').style.background = tierColor;
  document.getElementById('msc_rows').innerHTML = rows;

  // Summary flags
  var flags = [];
  if(needsAccess && !unit.accessible) flags.push('<span style="color:#b91c1c;font-size:12px;">⚠ Unit does not meet accessibility needs</span>');
  if(!isElders && unit.isElders) flags.push('<span style="color:#b91c1c;font-size:12px;">⚠ Applicant not eligible for Elders unit</span>');
  if(unit.bedrooms < needsBeds)  flags.push('<span style="color:#d97706;font-size:12px;">⚠ Unit has fewer bedrooms than needed</span>');
  if(total >= 14)                flags.push('<span style="color:#15803d;font-size:12px;">✓ Strong match — recommended for assignment</span>');
  document.getElementById('msc_flags').innerHTML = flags.join('<br>') || '<span class="js-txt-muted-sm">No issues flagged</span>';

  modal.style.removeProperty('display');
  modal.style.setProperty('display','flex','important');
}


// ══════════════════════════════════════════════════════════
// RENOVATION SCOPE OF WORK
// ══════════════════════════════════════════════════════════

var _sowUnitId  = null;
var _sowItemIdx = 0;

var SOW_CATEGORIES = [
  'Foundation / Structure','Roofing','Exterior Walls / Siding','Windows & Doors',
  'Insulation','Plumbing','Electrical','Heating / HVAC','Interior Walls / Drywall',
  'Flooring','Kitchen','Bathroom','Painting','Accessibility Modifications','Other'
];

function openSowModal(unitId, projectNumber) {
  _sowUnitId  = unitId || null;
  _sowItemIdx = 0;

  // Resolve which SOW to open:
  //   - If projectNumber was passed, edit that specific SOW.
  //   - If no projectNumber but the unit has existing SOWs, open the most recent one.
  //     This preserves legacy behavior where call sites like the inventory 🔨 button
  //     expect "open the SOW for this unit" and fall back gracefully for multi-SOW.
  //   - If no projectNumber AND the unit has zero SOWs, create a new one with a
  //     freshly-auto-incremented project number.
  var existingList = unitId ? (typeof getUnitSowList === 'function' ? getUnitSowList(unitId) : []) : [];
  if(!projectNumber && existingList.length > 0){
    // Pick the most recent SOW for this unit so unit-detail click opens it.
    var sortedByDate = existingList.slice().sort(function(a, b){
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    projectNumber = sortedByDate[0].project_number || null;
  }

  var isEdit = !!projectNumber;
  var saved = (unitId && projectNumber) ? getSowByProjectNumber(unitId, projectNumber) : null;
  window._sowEditingProjectNumber = isEdit ? projectNumber : null;  // remember for save
  window._sowWasPreviouslySaved = isEdit && !!saved;
  var label = '';
  if(unitId) {
    var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
    var u = allUnits.find(function(x){ return x.id===unitId; });
    if(u) label = u.num+' '+u.street+' · '+u.bedrooms+'-bed';
  }
  var lbl = document.getElementById('sow_unit_label');
  if(lbl) lbl.textContent = label || 'No unit selected';
  var today = new Date().toISOString().slice(0,10);
  var dateEl = document.getElementById('sow_date'); if(dateEl) dateEl.value = today;
  if(saved) {
    populateSow(saved);
  } else {
    resetSow();
    if(label) { var addr=document.getElementById('sow_address'); if(addr) addr.value=label; }
  }
  // Auto-populate tenant name from unit's assigned tenant (for new SOWs only).
  if(unitId && !saved) {
    var allUnits2 = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
    var u2 = allUnits2.find(function(x){ return x.id===unitId; });
    if(u2 && u2.assignedName) {
      var tnEl = document.getElementById('sow_tenant_name');
      if(tnEl) tnEl.value = u2.assignedName;
    }
  }

  // Show project number header (new visual identifier for the SOW).
  var pnLabel = document.getElementById('sow_project_number_label');
  if(pnLabel){
    var pn = isEdit ? projectNumber : (unitId ? nextProjectNumber(unitId) : '(no unit)');
    pnLabel.textContent = pn;
    window._sowEditingProjectNumber = pn;  // lock in the project number for save (handles new too)
  }

  var modal = document.getElementById('sowModal');
  if(modal){ modal.style.removeProperty('display'); modal.style.setProperty('display','flex','important'); }

  // Init signature pads
  setTimeout(function(){
    if(true) {
      _initSigPad('sow_sig_canvas_tenant');
      _initSigPad('sow_sig_canvas_staff');
    }
  }, 100);

  // Hide budget badge
  setTimeout(function(){
    var badge = document.getElementById('sow_budget_badge');
    if(badge) badge.style.display = 'none';
  }, 50);

  // Apply the locked/unlocked state based on the SOW's status and the current user's role.
  _applySowModalLock(saved);
}

// ── SOW completion state control ──────────────────────────────────────────
// Applies read-only lock when a SOW is completed AND the viewer isn't the ED.
// Also toggles the Mark Complete / Reopen buttons based on status + permissions.
function _applySowModalLock(sow){
  var modal = document.getElementById('sowModal');
  if(!modal) return;
  var completed = isSowCompleted(sow);
  var canEdit   = canEditSow(sow);
  var readOnly  = completed && !canEdit;

  // Banner
  var banner = document.getElementById('sow_readonly_banner');
  if(banner) banner.style.display = readOnly ? 'block' : 'none';

  // Mark Complete button: only show when SOW is NOT completed AND viewer is HM or ED AND there's a unit/saved SOW.
  var mcBtn = document.getElementById('sow_mark_complete_btn');
  if(mcBtn){
    var showMC = !completed && canMarkSowComplete() && !!_sowUnitId && !!window._sowEditingProjectNumber;
    mcBtn.style.display = showMC ? 'flex' : 'none';
  }

  // Reopen button: only show when completed AND viewer is ED.
  var roBtn = document.getElementById('sow_reopen_btn');
  if(roBtn){
    roBtn.style.display = (completed && canReopenSow()) ? 'flex' : 'none';
  }

  // Save button: hidden in read-only mode.
  var saveBtn = document.getElementById('sow_save_btn');
  if(saveBtn) saveBtn.style.display = readOnly ? 'none' : '';

  // Disable every form control inside the modal body when read-only.
  // Inputs in the header (like close button) are outside this query.
  var body = modal.querySelector('div[style*="padding:24px"]');
  if(body){
    var controls = body.querySelectorAll('input, select, textarea, button');
    controls.forEach(function(el){
      // Never disable the "close the modal" or "add SOW line" structural controls? Actually,
      // when read-only we disable them all so the SOW is effectively frozen in view.
      // The only escape is the X in the modal header (not inside body), which stays enabled.
      if(readOnly){
        el.setAttribute('data-sow-locked', '1');
        el.disabled = true;
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      } else if(el.getAttribute('data-sow-locked') === '1'){
        // Un-lock if we previously locked this element.
        el.removeAttribute('data-sow-locked');
        el.disabled = false;
        el.style.opacity = '';
        el.style.cursor = '';
      }
    });
    // Disable signature canvases too (they're <canvas> not form controls; swap pointer-events).
    body.querySelectorAll('canvas').forEach(function(c){
      c.style.pointerEvents = readOnly ? 'none' : '';
      c.style.opacity = readOnly ? '0.55' : '';
    });
  }
}

function markSowComplete(){
  if(!_sowUnitId || !window._sowEditingProjectNumber){
    showToast('Save the SOW before marking complete.');
    return;
  }
  if(!canMarkSowComplete()){
    showToast('Only Housing Manager or Executive Director can mark a SOW complete.');
    return;
  }
  var pn = window._sowEditingProjectNumber;
  if(!confirm('Mark SOW ' + pn + ' as Completed?\n\nThis locks the SOW, work order, and progress reports from further edits. Only the Executive Director can reopen it.')) return;
  var sow = getSowByProjectNumber(_sowUnitId, pn);
  if(!sow){ showToast('SOW not found'); return; }
  sow.approval_status = 'completed';
  sow.completed_at = new Date().toISOString();
  sow.completed_by = window.currentUserName || _realRoleForPermissions();
  upsertSowInList(_sowUnitId, sow);
  auditEntry('SOW:'+_sowUnitId, 'sow_completed', 'SOW '+pn+' marked Completed', _realRoleForPermissions());
  showToast('✓ SOW marked Completed');
  // Re-apply lock immediately so the modal flips to read-only for non-ED users.
  _applySowModalLock(sow);
}

function reopenSow(){
  if(!_sowUnitId || !window._sowEditingProjectNumber) return;
  if(!canReopenSow()){
    showToast('Only the Executive Director can reopen a completed SOW.');
    return;
  }
  var pn = window._sowEditingProjectNumber;
  if(!confirm('Reopen SOW ' + pn + ' for editing?\n\nThis returns the SOW to its prior approval state so it can be modified.')) return;
  var sow = getSowByProjectNumber(_sowUnitId, pn);
  if(!sow){ showToast('SOW not found'); return; }
  // Restore to the prior status based on available signatures, falling back to draft.
  if(sow.edName && sow.edDate) sow.approval_status = 'ed_approved';
  else if(sow.hmName && sow.hmDate) sow.approval_status = 'hm_approved';
  else if((sow.tenantSig && sow.tenantSig.image) || (sow.staffSig && sow.staffSig.image)) sow.approval_status = 'signed';
  else sow.approval_status = 'draft';
  sow.reopened_at = new Date().toISOString();
  sow.reopened_by = window.currentUserName || _realRoleForPermissions();
  upsertSowInList(_sowUnitId, sow);
  auditEntry('SOW:'+_sowUnitId, 'sow_reopened', 'SOW '+pn+' reopened for editing', _realRoleForPermissions());
  showToast('SOW reopened');
  _applySowModalLock(sow);
}
























// ═══════════════════════════════════════════════════════════════════════════
// MULTI-SOW MODEL (one unit → many scopes of work)
// ═══════════════════════════════════════════════════════════════════════════
// Storage shape in housing_sow.data:
//   NEW:    { sows: [{project_number, created_at, approval_status, amount, progress, ...sowFields}, ...] }
//   LEGACY: { ...sowFields }  (a single SOW stored flat — migrated on read)
//
// Migration: _migrateLegacySow wraps legacy records as { sows: [legacy] } transparently.
// Writes always use the NEW shape.





function getSowByProjectNumber(unitId, projectNumber){
  var list = getUnitSowList(unitId);
  for(var i=0; i<list.length; i++){
    if(list[i].project_number === projectNumber) return list[i];
  }
  return null;
}

// ── SOW lock / permission helpers ─────────────────────────────────────────
// A SOW becomes immutable once its approval_status is 'completed'. Only the ED


function canEditSow(sow){
  // Anyone authenticated can edit a non-completed SOW (existing behavior).
  // Only the ED (real role) can edit a completed one.
  if(!isSowCompleted(sow)) return true;
  return _realRoleForPermissions() === ROLE.ED;
}
function canMarkSowComplete(){
  // HM or ED can mark a SOW complete; staff/employee cannot.
  var r = _realRoleForPermissions();
  return ROLE.isManagement(r) || r === 'hm';
}
function canReopenSow(){
  // Only ED can reopen a completed SOW.
  return _realRoleForPermissions() === ROLE.ED;
}



function upsertSowInList(unitId, sow){
  // Add or update a SOW in the unit's list (matched by project_number) and persist.
  var list = getUnitSowList(unitId);
  var found = false;
  for(var i=0; i<list.length; i++){
    if(list[i].project_number === sow.project_number){
      list[i] = sow;
      found = true;
      break;
    }
  }
  if(!found) list.push(sow);
  saveSowList(unitId, list);
  return list;
}

function nextProjectNumber(unitId){
  // Produces "<address>-SOW-NNN" where NNN is one more than the current max on this unit.
  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
  var u = allUnits.find(function(x){ return x.id === unitId; });
  var addr = u ? (u.num + ' ' + u.street).trim() : 'UNIT';
  var list = getUnitSowList(unitId);
  var maxN = 0;
  var re = new RegExp('^' + addr.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&') + '-SOW-(\\d+)$');
  list.forEach(function(s){
    var m = re.exec(String(s.project_number || ''));
    if(m){ var n = parseInt(m[1], 10); if(n > maxN) maxN = n; }
  });
  var next = ('000' + (maxN + 1)).slice(-3);
  return addr + '-SOW-' + next;
}

// ── SOW table on Unit Detail card ─────────────────────────────────────────
// Renders every SOW for a given unit as a row in a table inside the Unit Detail modal.
function udpRenderSowTable(unitId){
  var wrap = document.getElementById('udp_sow_table_wrap');
  if(!wrap) return;
  var list = getUnitSowList(unitId);
  if(!list.length){
    wrap.innerHTML = '<div style="padding:18px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;background:var(--bg);">No scopes of work yet. Click <strong style="color:var(--text);">New SOW</strong> to create one.</div>';
    return;
  }
  // Sort newest first by created_at.
  list = list.slice().sort(function(a, b){
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  var statusStyles = {
    draft:        {bg:'#f4f4f0', c:'#666',    label:'Draft'},
    signed:       {bg:'#eff6ff', c:'#1d4ed8', label:'Signed'},
    hm_approved:  {bg:'#fffbeb', c:'#92400e', label:'HM Approved'},
    ed_approved:  {bg:'#f0fdf4', c:'#15803d', label:'ED Approved'},
    completed:    {bg:'#f0fdf4', c:'#15803d', label:'Completed'}
  };

  function fmtCurrency(n){
    var v = Number(n) || 0;
    return '$' + v.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0});
  }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var rows = list.map(function(sow){
    var ss = statusStyles[sow.approval_status] || {bg:'#f4f4f0', c:'#666', label:sow.approval_status || '—'};
    var pn = esc(sow.project_number || '—');
    var date = esc(sow.created_at || sow.date || '—');
    var amount = (sow.amount == null) ? '—' : fmtCurrency(sow.amount);
    var progressPct = (sow.progress && typeof sow.progress.percent === 'number') ? sow.progress.percent : null;
    var progressCell = progressPct == null
      ? '<span style="color:var(--muted);font-size:11px;">—</span>'
      : '<div style="display:flex;align-items:center;gap:6px;min-width:80px;"><div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+Math.min(100,Math.max(0,progressPct))+'%;background:'+(progressPct>=100?'#15803d':'#1d4ed8')+';"></div></div><span style="font-size:10px;font-weight:700;color:var(--muted);min-width:26px;text-align:right;">'+progressPct+'%</span></div>';
    // Project # cell is clickable — opens the full SOW document in print-ready view.
    // Build row actions based on completion state + viewer role.
    // Completed SOW + non-ED → View (opens read-only) instead of Edit.
    // Work Order stays available to everyone regardless of status.
    var locked = isSowCompleted(sow) && !canEditSow(sow);
    var editBtn = locked
      ? '<button onclick="udpEditSow(\''+esc(unitId)+'\',\''+pn+'\')" title="View SOW (read-only)" style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">View</button>'
      : '<button onclick="udpEditSow(\''+esc(unitId)+'\',\''+pn+'\')" title="Edit SOW" style="background:none;border:1px solid var(--border);color:var(--text);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">Edit</button>';
    return '<tr style="border-top:1px solid var(--border);">'
      +'<td style="padding:8px 10px;font-size:11px;color:var(--muted);white-space:nowrap;">'+date+'</td>'
      +'<td style="padding:8px 10px;"><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:'+ss.bg+';color:'+ss.c+';white-space:nowrap;">'+ss.label+(locked?' 🔒':'')+'</span></td>'
      +'<td style="padding:8px 10px;font-size:12px;font-weight:700;white-space:nowrap;">'+amount+'</td>'
      +'<td style="padding:8px 10px;font-size:11px;"><button onclick="udpOpenSowDocument(\''+esc(unitId)+'\',\''+pn+'\')" style="background:none;border:none;color:var(--text);padding:0;font-family:ui-monospace,Menlo,Monaco,\'Courier New\',monospace;font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;" title="Open full SOW document">'+pn+'</button></td>'
      +'<td style="padding:8px 10px;font-size:10px;">'+progressCell+'</td>'
      +'<td style="padding:6px 8px;white-space:nowrap;text-align:right;">'
        +editBtn
        +'<button onclick="udpPrintWorkOrder(\''+esc(unitId)+'\',\''+pn+'\')" title="Print work order" style="background:var(--yellow);border:none;color:#111;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;font-family:DM Sans,sans-serif;">Work Order</button>'
      +'</td>'
      +'</tr>';
  }).join('');

  wrap.innerHTML = '<div class="overflow-x"><table style="width:100%;border-collapse:collapse;font-family:DM Sans,sans-serif;">'
    +'<thead><tr style="background:var(--bg);"><th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Date</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Status</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Amount</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Project #</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Progress</th>'
    +'<th style="padding:7px 10px;"></th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>';
}

function udpNewSow(){
  if(!_currentDetailUnitId) return;
  closeUnitDetail();
  openSowModal(_currentDetailUnitId);  // no projectNumber → new SOW
}

function udpEditSow(unitId, projectNumber){
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
}

function udpOpenSowDocument(unitId, projectNumber){
  // Opens the full SOW as a print-ready document (same as "Full SOW" button inside the modal).
  // Loads the SOW into the modal first so printSOW() has the right data, then triggers print.
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow){ showToast('SOW not found'); return; }
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
  // Give the modal a tick to populate before printing.
  setTimeout(function(){ if(true) printSOW(); }, 250);
}

function udpPrintWorkOrder(unitId, projectNumber){
  // Prints a work order for the specific SOW. Loads the SOW into the modal briefly so
  // the existing printWorkOrder() (which reads from modal state) produces the right output.
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow){ showToast('SOW not found'); return; }
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
  setTimeout(function(){ if(true) printWorkOrder(); }, 250);
}














function saveSOW(){
  var get=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var chk=function(id){ var el=document.getElementById(id); return el?el.checked:false; };
  var data = {
    unitId:_sowUnitId, address:get('sow_address'), date:get('sow_date'),
    tenantName:get('sow_tenant_name'),
    preparedBy:get('sow_prepared_by'), contractor:get('sow_contractor'), contractorId:(document.getElementById('sow_contractor_id')||{}).value||'',
    condition:get('sow_condition'), totalCost:get('sow_total_cost'),
    startDate:get('sow_start_date'), endDate:get('sow_end_date'), notes:get('sow_notes'),
    hmName:get('sow_hm_name'), hmDate:get('sow_hm_date'),
    edName:get('sow_ed_name'), edDate:get('sow_ed_date'),
    tenantSig: {
      name:  get('sow_sig_tenant_name'),
      date:  get('sow_sig_tenant_date'),
      image: (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_tenant') : ''
    },
    staffSig: {
      name:  get('sow_sig_staff_name'),
      date:  get('sow_sig_staff_date'),
      image: (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_staff') : ''
    },
    mold:chk('sow_mold'), asbestos:chk('sow_asbestos'), electrical:chk('sow_electrical'),
    structural:chk('sow_structural'), plumbing:chk('sow_plumbing'), fire:chk('sow_fire'),
    rentArrears:chk('sow_rent_arrears'), tenantDamage:chk('sow_tenant_damage'),
    negligence:chk('sow_negligence'), vandalism:chk('sow_vandalism'),
    policeReport:chk('sow_police_report'), accountabilityNotes:get('sow_accountability_notes'),
    items:collectSowItems(), savedAt:new Date().toISOString()
  };
  // ── Multi-SOW fields ───────────────────────────────────────────────────
  // Stamp the project number (either the one being edited or a fresh one for new SOWs).
  data.project_number = window._sowEditingProjectNumber || (_sowUnitId ? nextProjectNumber(_sowUnitId) : 'NO-UNIT-SOW-001');
  // Preserve created_at if editing an existing SOW; otherwise stamp today.
  if(_sowUnitId){
    var existing = getSowByProjectNumber(_sowUnitId, data.project_number);
    data.created_at = (existing && existing.created_at) || data.date || new Date().toISOString().slice(0,10);
    // Preserve progress block so editing SOW doesn't wipe progress.
    if(existing && existing.progress) data.progress = existing.progress;
  } else {
    data.created_at = data.date || new Date().toISOString().slice(0,10);
  }
  // Normalize the amount to a number for table display / sorting.
  var totalNum = parseFloat(String(data.totalCost||'').replace(/[^0-9.\-]/g,'')) || 0;
  data.amount = totalNum;
  // Compute a simple approval_status from the signature / approval fields on the form.
  // EXCEPTION: if the SOW was already marked 'completed', preserve that — only markSowComplete/reopenSow
  // should transition into or out of the completed state. This keeps Save from accidentally
  // downgrading a completed SOW when an ED edits its fields.
  var existingForStatus = _sowUnitId && data.project_number ? getSowByProjectNumber(_sowUnitId, data.project_number) : null;
  if(existingForStatus && existingForStatus.approval_status === 'completed'){
    data.approval_status = 'completed';
    if(existingForStatus.completed_at) data.completed_at = existingForStatus.completed_at;
    if(existingForStatus.completed_by) data.completed_by = existingForStatus.completed_by;
  } else if(data.edName && data.edDate) data.approval_status = 'ed_approved';
  else if(data.hmName && data.hmDate) data.approval_status = 'hm_approved';
  else if((data.tenantSig && data.tenantSig.image) || (data.staffSig && data.staffSig.image)) data.approval_status = 'signed';
  else data.approval_status = 'draft';

  if(_sowUnitId) upsertSowInList(_sowUnitId, data);

  // ── Audit trail ──────────────────────────────────────────────────────────
  var role = window.currentRole || 'staff';
  var addr = data.address || _sowUnitId || 'unit';
  var isNew = !window._sowWasPreviouslySaved;
  window._sowWasPreviouslySaved = true;

  // Core save event
  var detail = (isNew ? 'SOW created' : 'SOW updated') + ' — ' + addr;
  if(data.totalCost) detail += ' · Total: ' + data.totalCost;
  if(data.condition) detail += ' · Condition: ' + data.condition;
  auditEntry('SOW:'+(_sowUnitId||'?'), isNew ? 'sow_created' : 'sow_updated', detail, role);

  // Tenant signature captured
  if(data.tenantSig && (data.tenantSig.name || data.tenantSig.image)) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_tenant_signed',
      'Tenant signature recorded — ' + (data.tenantSig.name || 'name not provided') +
      (data.tenantSig.date ? ' on ' + data.tenantSig.date : ''), role);
  }
  // Staff signature captured
  if(data.staffSig && (data.staffSig.name || data.staffSig.image)) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_staff_signed',
      'Staff signature recorded — ' + (data.staffSig.name || 'name not provided') +
      (data.staffSig.date ? ' on ' + data.staffSig.date : ''), role);
  }
  // HM approval recorded
  if(data.hmName) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_hm_approval',
      'HM approval recorded — ' + data.hmName + (data.hmDate ? ' on ' + data.hmDate : ''), role);
  }
  // ED approval recorded
  if(data.edName) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_ed_approval',
      'ED approval recorded — ' + data.edName + (data.edDate ? ' on ' + data.edDate : ''), role);
  }
  // Accountability flags
  var flags = [];
  if(data.rentArrears)  flags.push('rent arrears');
  if(data.tenantDamage) flags.push('tenant damage');
  if(data.negligence)   flags.push('negligence');
  if(data.vandalism)    flags.push('vandalism');
  if(data.policeReport) flags.push('police report');
  if(flags.length) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_accountability',
      'Accountability flags set: ' + flags.join(', '), role);
  }
  // Refresh the inline audit panel if visible
  if(true) renderSowAuditLog(_sowUnitId);

  var ind=document.getElementById('sow_saved_indicator');
  if(ind) ind.textContent='✓ Saved '+new Date().toLocaleTimeString();
  showToast('Scope of work saved');
}


















function openUnitDetail(unitId) {
  var units = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var u = units.find(function(x){ return x.id === unitId; });
  if(!u) return;
  _currentDetailUnitId = unitId;

  var statusStyle = {
    vacant:      {bg:'#f0fdf4',c:'#15803d',label:'Vacant'},
    occupied:    {bg:'#eff6ff',c:'#1d4ed8',label:'Occupied'},
    under_repair:{bg:'#fffbeb',c:'#92400e',label:'Under Repair'},
    reserved:    {bg:'#faf5ff',c:'#7c3aed',label:'Reserved'},
    condemned:   {bg:'#fef2f2',c:'#b91c1c',label:'Condemned'}
  };
  var ss = statusStyle[u.status] || {bg:'#f0f0ec',c:'#888',label:u.status||'Unknown'};

  // Header
  var addr = u.num + ' ' + u.street;
  setText('udp_address', addr);
  var sub = [u.bedrooms+' bed', u.bathrooms&&u.bathrooms!=='nan'?u.bathrooms+' bath':'', u.type&&u.type!=='nan'?u.type:''].filter(Boolean).join(' · ');
  setText('udp_subtitle', sub);

  // Status badge
  var sr = document.getElementById('udp_status_row');
  if(sr) sr.innerHTML = '<span style="font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;background:'+ss.bg+';color:'+ss.c+';">'+ss.label+'</span>'
    +(u.isElders?' <span style="font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;background:#fffbeb;color:#92400e;border:1px solid #fde68a;margin-left:6px;">Elders Unit</span>':'')
    +(u.accessible?' <span style="font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;background:#eff6ff;color:#1d4ed8;margin-left:6px;">♿ Accessible</span>':'');

  // Details grid
  var det = document.getElementById('udp_details');
  if(det){
    var fields = [
      ['Foundation', (u.foundation&&u.foundation!=='nan'&&u.foundation!=='0')?u.foundation:'—'],
      ['Funder', u.funder||'None / Band'],
      ['Phase', (u.phase&&u.phase!=='nan')?u.phase:'—'],
      ['Year Built', (u.year&&u.year!=='nan')?u.year:'—'],
    ];
    det.innerHTML = fields.map(function(f){
      return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;">'
        +'<div style="font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">'+f[0]+'</div>'
        +'<div style="font-size:14px;font-weight:600;color:var(--text);text-transform:capitalize;">'+f[1]+'</div>'
        +'</div>';
    }).join('');
  }

  // Tenant section
  var ts = document.getElementById('udp_tenant_section');
  var ti = document.getElementById('udp_tenant_info');
  if(ts && ti){
    if(u.assignedName || u.status==='occupied' || u.status==='reserved'){
      ts.style.display = 'block';
      ti.innerHTML = (u.assignedName?'<div class="empty-title">'+u.assignedName+'</div>':'')
        +(u.assignedTo?'<div class="js-txt-muted-sm">App ID: '+u.assignedTo+'</div>':'')
        +(u.assignedDate?'<div class="js-txt-muted-sm">Move-in: '+u.assignedDate+'</div>':'')
        +(!u.assignedName&&!u.assignedTo?'<span class="js-lbl-xs">No tenant assigned yet</span>':'');
    } else {
      ts.style.display = 'none';
    }
  }

  // Notes
  var ns = document.getElementById('udp_notes_section');
  var nd = document.getElementById('udp_notes');
  if(ns && nd){
    if(u.notes && u.notes.trim()){
      ns.style.display = 'block';
      nd.textContent = u.notes;
    } else {
      ns.style.display = 'none';
    }
  }

  // Photos
  renderUnitPhotos(unitId);

  // Scopes of Work table
  udpRenderSowTable(unitId);

  // Tenant files preview in detail panel
  udpRenderFilePreviews(unitId);

  // Show panel
  var panel = document.getElementById('unitDetailPanel');
  if(panel){ panel.style.setProperty('display','flex','important'); }
}

// ── Unit Detail Panel — tenant files (read-only preview) ────────────
// The Unit Detail Panel shows a lightweight, read-only view of tenant
// files. Uploads + deletes happen in the dedicated tenant-files modal
// (openTenantFilesPanel). Keeping them in one place prevents dual
// data-entry surfaces and matches the "same design across all screens"
// direction.
var _udpFilesLib = null;

function udpOpenFilesModal() {
  if (!_currentDetailUnitId) return;
  if (typeof openTenantFilesPanel === 'function') openTenantFilesPanel(_currentDetailUnitId);
}


function saveNewUnit(){
  var get = function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var chk = function(id){ var el=document.getElementById(id); return el?el.checked:false; };
  var num    = get('au_num');
  var street = get('au_street');
  if(!num || !street){ showToast('Unit number and street are required'); return; }

  var newId = (street.toUpperCase().replace(/\s+/g,'-') + '-' + num).replace(/[^A-Z0-9\-]/g,'');
  var units = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : [];
  if(units.find(function(u){ return u.id === newId; })){ showToast('A unit at that address already exists'); return; }

  var newUnit = {
    id: newId, street: street, num: num,
    bedrooms: parseInt(get('au_bedrooms'))||3,
    bathrooms: get('au_bathrooms')||'1',
    type: get('au_type')||'detached unit',
    foundation: get('au_foundation')||'',
    funder: get('au_funder')||'',
    phase: get('au_phase')||'',
    year: get('au_year')||'',
    notes: get('au_notes')||'',
    accessible: chk('au_accessible'),
    isElders: chk('au_isElders'),
    status: 'vacant',
    assignedTo: null, assignedDate: null, assignedName: null
  };

  units.push(newUnit);
  housingUnits.push(newUnit);
  sbSaveUnit(newUnit).catch(function(e){ console.warn('Add unit save failed:',e); });
  if(_auStagedPhotos.length){ saveUnitPhotos(newId, _auStagedPhotos); _auStagedPhotos=[]; }
  closeAddUnitModal();
  renderInventoryView();
  showToast(num + ' ' + street + ' added to inventory');
}

function openAddUnitModal(){
  var fields = ['au_num','au_street','au_bathrooms','au_year','au_phase','au_notes'];
  fields.forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var bedEl = document.getElementById('au_bedrooms'); if(bedEl) bedEl.value='3';
  var typeEl = document.getElementById('au_type'); if(typeEl) typeEl.value='';
  var fndEl = document.getElementById('au_foundation'); if(fndEl) fndEl.value='';
  var funEl = document.getElementById('au_funder'); if(funEl) funEl.value='';
  var accEl = document.getElementById('au_accessible'); if(accEl) accEl.checked=false;
  var eldEl = document.getElementById('au_isElders'); if(eldEl) eldEl.checked=false;
  _auStagedPhotos = [];
  renderAddUnitPhotoPreview();
  var modal = document.getElementById('addUnitModal');
  if(modal){ modal.style.removeProperty('display'); modal.style.setProperty('display','flex','important'); }
}

// ── addScoringCriteria ──


// ── renderBudgetPools ──
var BUDGET_POOLS = [
  { id:'emergency', label:'Emergency Repairs',  icon:'🚨', color:'#b91c1c', bg:'#fef2f2' },
  { id:'isc',       label:'ISC Funds',          icon:'🏛️', color:'#1d4ed8', bg:'#eff6ff' },
  { id:'rrap',      label:'RRAP Funds',         icon:'🏠', color:'#7c3aed', bg:'#faf5ff' },
  { id:'band',      label:'Band Funds',         icon:'🌲', color:'#15803d', bg:'#f0fdf4' },
  { id:'cmhc',      label:'CMHC',               icon:'🏗️', color:'#92400e', bg:'#fffbeb' },
  { id:'ofnlp',     label:'OFNLP',              icon:'🤝', color:'#0e7490', bg:'#ecfeff' },
];








function saveBudgetPools(){
  // Also save HM budget limit
  var limitEl = document.getElementById('settings_hm_budget_limit');
  if(limitEl && limitEl.value) {
    var s = window._appSettings || {};
    var prevLimit = s.hmBudgetLimit;
    s.hmBudgetLimit = parseFloat(limitEl.value)||25000;
    window._appSettings = s;
    sbSaveSetting('app_settings', s).then(function(ok){
      if(!ok){
        s.hmBudgetLimit = prevLimit;
        window._appSettings = s;
        showToast('Could not save HM budget limit — retry.');
      }
    });
  }
  var fyEl = document.getElementById('budget_fiscal_year');
  var data = {fiscalYear: fyEl ? fyEl.value : '2025-2026', pools:{}};
  BUDGET_POOLS.forEach(function(p){
    var allocEl = document.getElementById('budget_alloc_'+p.id);
    var notesEl = document.getElementById('budget_notes_'+p.id);
    data.pools[p.id] = {
      allocated: parseFloat((allocEl?allocEl.value:0))||0,
      notes: notesEl ? notesEl.value : ''
    };
  });
  saveBudgetData(data);  // saveBudgetData already surfaces its own errors
  var hmLimitEl=document.getElementById('settings_hm_budget_limit');
  auditEntry('SETTINGS','settings_budget_save','Budget allocations saved for '+data.fiscalYear+(hmLimitEl?' — HM limit: $'+hmLimitEl.value:''),window.currentRole||'staff');
  showToast('Budget allocations saved');
  renderBudgetPools();
}

// ── renderUnitScoreTable ──
var UNIT_SCORE_KEY = 'clfn_unit_score_model';

function openRenoSearch() {
  renoSearchFilter('');
  var m = document.getElementById('renoSearchModal');
  if(m){ m.style.setProperty('display','flex','important'); document.body.classList.add('modal-open'); }
  setTimeout(function(){ var i=document.getElementById('reno_search_input'); if(i){i.value='';i.focus();} }, 150);
}

function closeRenoSearch() {
  var m = document.getElementById('renoSearchModal');
  if(m) m.style.display='none';
  document.body.classList.remove('modal-open');
}

function openRenoNewRequest() {
  // Open unit search first — employee picks a unit then opens its SOW
  var m = document.getElementById('unitSearchModal');
  if(!m){ openUnitSearch(); return; }
  // Override unit search results click to open SOW instead of edit modal
  window._renoNewRequestMode = true;
  unitSearchFilter('');
  m.style.setProperty('display','flex','important');
  document.body.classList.add('modal-open');
  // Update title hint
  var title = m.querySelector('#unit_search_results');
  setTimeout(function(){
    var i=document.getElementById('unit_search_input');
    if(i){ i.value=''; i.placeholder='Search for the unit needing renovation…'; i.focus(); }
    // Patch clicks to open SOW
    if(title) title.querySelectorAll('[onclick]').forEach(function(el){
      // Will be re-rendered on filter — handled in unitSearchFilter via flag
    });
  }, 150);
}

function renoSearchFilter(q) {
  var allUnits = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var renoUnits = allUnits.filter(function(u){ return u.status==='under_repair'||u.status==='condemned'; });

  var filtered = q.trim().length > 0
    ? renoUnits.filter(function(u){ return (u.num+' '+u.street).toLowerCase().includes(q.toLowerCase()); })
    : renoUnits;

  var statusStyle = {
    under_repair: {bg:'#fffbeb', c:'#92400e', label:'Under Repair'},
    condemned:    {bg:'#fef2f2', c:'#b91c1c', label:'Condemned'}
  };

  var container = document.getElementById('reno_search_results');
  if(!container) return;

  if(!filtered.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;font-style:italic;">'
      +(q ? 'No active renovation units matching "'+q+'"' : 'No units currently under repair or condemned.')
      +'</div>';
    return;
  }

  container.innerHTML = filtered.map(function(u) {
    var ss = statusStyle[u.status] || {bg:'#f4f4f0',c:'#888',label:u.status};
    var rs = calcRenoScore(u.id);
    var scoreBadge = rs.score
      ? '<span style="font-size:10px;font-weight:700;color:var(--muted);margin-left:6px;">Score: '+rs.score+'</span>'
      : '';
    var uid = u.id.replace(/'/g,"\\'");
    return '<div onclick="closeRenoSearch();openRenoProgress(\''+uid+'\')" '
      +'style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;transition:border-color .12s;" '
      +'onmouseover="this.style.borderColor=\'var(--yellow)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
      +'<div style="min-width:0;flex:1;">'
        +'<div style="font-weight:700;font-size:13px;">'+u.num+' '+u.street+'</div>'
        +'<div class="js-lbl-sm">'+u.bedrooms+'-bed'+(u.type&&u.type!=='0'?' · '+u.type:'')+scoreBadge+'</div>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
        +'<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:8px;background:'+ss.bg+';color:'+ss.c+';">'+ss.label+'</span>'
        +'<button onclick="event.stopPropagation();closeRenoSearch();openSowModal(\''+uid+'\')" '
          +'title="Open Scope of Work" '
          +'style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;font-weight:700;font-family:DM Sans,sans-serif;color:var(--muted);white-space:nowrap;" '
          +'onmouseover="this.style.borderColor=\'var(--yellow)\';this.style.color=\'var(--text)\'" '
          +'onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--muted)\'">'
          +'🔨 SOW'
        +'</button>'
      +'</div>'
      +'</div>';
  }).join('');
}

// ── Renovations export ──


// ── Contractors export ──


// ── (legacy stubs — kept for compatibility) ──

function getInventoryExportData(){ return []; }

// ── MOBILE MENU ──




// (mobile menu nav close removed — no sidebar)

// ══ RESTORED UNIT/PHOTO FUNCTIONS ══

function renderUnitPhotos(unitId){
  var container = document.getElementById('udp_photos');
  if(!container) return;
  var photos = getUnitPhotos(unitId);
  if(!photos.length){
    container.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:10px 0;font-style:italic;">No photos yet — upload one below.</div>';
    return;
  }
  var html = '';
  photos.forEach(function(p, i){
    html += '<div style="position:relative;flex-shrink:0;">'
      +'<img src="'+p.data+'" alt="Unit photo" data-uid="'+unitId+'" data-idx="'+i+'" style="width:90px;height:70px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer;" title="Click to view"/>'
      +'<button type="button" data-del-uid="'+unitId+'" data-del-idx="'+i+'" style="position:absolute;top:-5px;right:-5px;background:#b91c1c;border:none;color:#fff;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:10px;line-height:18px;text-align:center;padding:0;" title="Remove">✕</button>'
      +'</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('img[data-uid]').forEach(function(img){
    img.onclick = function(){ viewUnitPhoto(img.getAttribute('data-uid'), parseInt(img.getAttribute('data-idx'))); };
  });
  container.querySelectorAll('button[data-del-uid]').forEach(function(btn){
    btn.onclick = function(){ deleteUnitPhoto(btn.getAttribute('data-del-uid'), parseInt(btn.getAttribute('data-del-idx'))); };
  });
}

function openUnitEditFromDetail() {
  if(_currentDetailUnitId){
    closeUnitDetail();
    openUnitEditModal(_currentDetailUnitId);
  }
}

function openRenoProgress(unitId) {
  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
  var u = allUnits.find(function(x){ return x.id === unitId; });
  if(!u) return;
  var _rpUnitId = unitId;
  window._rpUnitId = unitId;

  // Populate header
  var hdr = document.getElementById('rp_unit_header');
  if(hdr) hdr.textContent = u.num + ' ' + u.street;

  // SOW summary
  var sow = null;
  sow = getSowData(unitId);
  var sumEl = document.getElementById('rp_sow_summary');
  if(sumEl) {
    if(sow && sow.items && sow.items.length) {
      sumEl.innerHTML = '<div class="js-txt-bold2" style="font-weight:400;">SOW filed: '+sow.items.length+' items — <span style="color:var(--yellow);cursor:pointer;" data-opensow="1">View SOW →</span></div>';
    } else {
      sumEl.innerHTML = '<div class="js-txt-muted">No Scope of Work filed yet. <span style="color:var(--yellow);cursor:pointer;font-weight:700;" data-createsow="1">Create SOW →</span></div>';
    }
    // Wire SOW spans
    if(sumEl){
      var sp=sumEl.querySelector('[data-opensow]');
      if(sp)sp.onclick=function(){openSowModal(unitId);};
      var sp2=sumEl.querySelector('[data-createsow]');
      if(sp2)sp2.onclick=function(){closeRenoProgress();openSowModal(unitId);};
    }
  }

  // Progress data
  var prog = null;
  prog = (window._renoProgress && window._renoProgress[unitId]) || null;

  // Overall progress bar
  var pct = prog ? (prog.overallPct||0) : 0;
  var pctEl = document.getElementById('rp_overall_pct');
  var barEl = document.getElementById('rp_overall_bar');
  var statusEl = document.getElementById('rp_status_label');
  if(pctEl) pctEl.textContent = pct + '%';
  if(barEl) barEl.style.width = pct + '%';
  if(statusEl) statusEl.textContent = prog ? (prog.status||'In Progress') : 'Not Started';

  // Populate editable fields
  var sel = document.getElementById('rp_status_select');
  var pctIn = document.getElementById('rp_pct_input');
  var contr = document.getElementById('rp_contractor');
  var tgt = document.getElementById('rp_target_date');
  var notes = document.getElementById('rp_notes');
  if(sel) sel.value = prog ? (prog.status||'Not Started') : 'Not Started';
  if(pctIn) pctIn.value = pct||'';
  if(contr) contr.value = prog ? (prog.contractor||'') : '';
  var contrId = document.getElementById('rp_contractor_id');
  if(contrId) contrId.value = prog ? (prog.contractorId||'') : '';
  if(tgt) tgt.value = prog ? (prog.targetDate||'') : '';
  if(notes) notes.value = '';  // Clear notes each time — it's for new updates

  // Render photo preview (stored photos)
  var photoPreview = document.getElementById('rp_photo_preview');
  window._rpPendingPhotos = [];
  if(photoPreview) {
    var storedPhotos = prog ? (prog.photos||[]) : [];
    photoPreview.innerHTML = storedPhotos.map(function(src, i) {
      return '<div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">'
        +'<img src="'+src+'" class="img-cover"/>'
        +'<button type="button" onclick="removeRenoPhoto('+i+')" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1;">✕</button>'
        +'</div>';
    }).join('');
    window._rpStoredPhotos = storedPhotos.slice();
  }

  // Render update history
  var histEl = document.getElementById('rp_history');
  if(histEl) {
    var updates = prog ? (prog.updates||[]) : [];
    if(!updates.length) {
      histEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;">No updates yet.</div>';
    } else {
      histEl.innerHTML = updates.slice().reverse().map(function(u) {
        return '<div style="padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">'
          +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'
          +'<span style="font-size:11px;font-weight:700;color:var(--text);">'+u.status+' — '+u.pct+'%</span>'
          +'<span class="js-lbl-xs">'+u.date+'</span>'
          +'</div>'
          +(u.notes?'<div class="js-txt-muted-sm">'+u.notes+'</div>':'')
          +(u.photos&&u.photos.length?'<div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap;">'
            +u.photos.map(function(s){return '<img src="'+s+'" style="width:48px;height:48px;object-fit:cover;border-radius:5px;border:1px solid var(--border);"/>';}).join('')
            +'</div>':'')
          +'</div>';
      }).join('');
    }
  }

  var modal = document.getElementById('renoProgressModal');
  if(modal){ modal.style.removeProperty('display'); modal.style.setProperty('display','flex','important'); }
  renderRenoScoreBadge(unitId);
}

function openAddTenantModal(){
  var units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var sel=document.getElementById('at_unit');
  if(!sel) return;
  // Only vacant/reserved units available for assignment
  sel.innerHTML='<option value="">— Select a unit —</option>';
  units.filter(function(u){return u.status==='vacant'||u.status==='reserved';}).forEach(function(u){
    var opt=document.createElement('option');
    opt.value=u.id;
    opt.textContent=u.num+' '+u.street+' ('+u.bedrooms+'-bed · '+u.status+')';
    sel.appendChild(opt);
  });
  // Clear all fields
  var appid=document.getElementById('at_appid'); if(appid) appid.value='';
  var appidval=document.getElementById('at_appid_val'); if(appidval) appidval.value='';
  var date=document.getElementById('at_date'); if(date) date.value='';
  var st=document.getElementById('at_status'); if(st) st.value='occupied';
  var sel2=document.getElementById('at_app_selected'); if(sel2){sel2.style.display='none';sel2.innerHTML='';}
  var dd=document.getElementById('at_app_dropdown'); if(dd) dd.style.display='none';
  var err=document.getElementById('at_error'); if(err) err.style.display='none';
  var modal=document.getElementById('addTenantModal');
  if(modal){ modal.style.setProperty('display','flex','important'); document.body.classList.add('modal-open'); }
}

function closeAddTenantModal(){
  var modal=document.getElementById('addTenantModal');
  if(modal) modal.style.display='none';
  document.body.classList.remove('modal-open');
}

function atSearchApps(q){
  var dd=document.getElementById('at_app_dropdown');
  if(!dd) return;
  var apps=typeof applications!=='undefined'?applications:(window.SP_APPLICATIONS||[]);
  // ed_approved = fully approved; mgr_approved = HM recommended (HM role can assign)
  var role = window.currentRole || 'housing_employee_l1';
  var valid=apps.filter(function(a){
    if(role=== ROLE.ED) return a.status===APP_STATUS.ED_APPROVED||a.status===APP_STATUS.MGR_APPROVED;
    if(role=== ROLE.HOUSING_MANAGER) return a.status===APP_STATUS.ED_APPROVED||a.status===APP_STATUS.MGR_APPROVED;
    return a.status===APP_STATUS.ED_APPROVED;
  });
  var matches=q.trim().length>0
    ? valid.filter(function(a){
        var name=((a.fn||'')+' '+(a.ln||'')).toLowerCase();
        return name.includes(q.toLowerCase())||(a.id||'').toLowerCase().includes(q.toLowerCase());
      })
    : valid.slice(0,8);
  if(!matches.length){
    dd.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--muted);">No approved applications found'+(q.trim().length>1?' for <strong>'+q+'</strong>':'')+'</div>'
      +'<div style="padding:8px 14px;border-top:1px solid var(--border);background:var(--bg);">'
      +'<button type="button" onmousedown="closeAddTenantModal();newApp();" style="background:none;border:none;font-size:12px;font-weight:600;color:var(--yellow);cursor:pointer;font-family:DM Sans,sans-serif;padding:0;">📝 Start a new application instead →</button>'
      +'</div>';
    dd.style.display='block';
    return;
  }
  dd.style.display='block';
  dd.innerHTML=matches.map(function(a){
    var name=((a.fn||'')+' '+(a.ln||'')).trim()||'Unknown';
    var safeName=name.replace(/'/g,'’');
    var isED=a.status===APP_STATUS.ED_APPROVED; var isHM=a.status===APP_STATUS.MGR_APPROVED;
    var statusLabel=isED?'ED Approved':isHM?'HM Recommended':a.status.replace(/_/g,' ');
    var statusCol=isED?'#15803d':isHM?'#1d4ed8':'#888';
    var statusBg=isED?'#f0fdf4':isHM?'#eff6ff':'var(--bg)';
    return '<div onmousedown="atSelectApp(\''+a.id+'\',\''+safeName+'\',\''+a.status+'\') " '
      +'style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;" '
      +'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'none\'">'
      +'<div>'
        +'<div class="js-txt-bold">'+name+'</div>'
        +'<div class="js-lbl-sm">'+a.id+(a.bedrooms?' · '+a.bedrooms+' bed req\'d':'')+'</div>'
      +'</div>'
      +'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:'+statusBg+';color:'+statusCol+';">'+statusLabel+'</span>'
      +'</div>';
  }).join('')
  +'<div style="padding:8px 14px;border-top:1px solid var(--border);background:var(--bg);">'
  +'<button type="button" onmousedown="closeAddTenantModal();newApp();" style="background:none;border:none;font-size:12px;font-weight:600;color:var(--yellow);cursor:pointer;font-family:DM Sans,sans-serif;padding:0;">📝 Not found? Start a new application →</button>'
  +'</div>';
}

function atSelectApp(appId,name,status){
  var dd=document.getElementById('at_app_dropdown'); if(dd) dd.style.display='none';
  var input=document.getElementById('at_appid'); if(input) input.value=name+' ('+appId+')';
  var hidden=document.getElementById('at_appid_val'); if(hidden) hidden.value=appId;
  var sel=document.getElementById('at_app_selected');
  if(sel){
    var statusCol=status===APP_STATUS.ED_APPROVED?'#15803d':status===APP_STATUS.MGR_APPROVED?'#1d4ed8':'#92400e';
    var statusBg=status===APP_STATUS.ED_APPROVED?'#f0fdf4':status===APP_STATUS.MGR_APPROVED?'#eff6ff':'#fffbeb';
    var statusLabel={'ed_approved':'ED Approved','mgr_approved':'HM Recommended','submitted':'Submitted','returned':'Returned','declined':'Declined'}[status]||status;
    var warn=status!==APP_STATUS.ED_APPROVED&&status!==APP_STATUS.MGR_APPROVED
      ? '<div style="font-size:11px;color:#92400e;margin-top:4px;">⚠️ This application has not been fully approved. Housing Manager confirmation required before assigning.</div>'
      : (status===APP_STATUS.MGR_APPROVED?'<div style="font-size:11px;color:#1d4ed8;margin-top:4px;">ℹ️ Recommended by HM — awaiting Executive Director final approval.</div>':'');
    sel.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;">'
      +'<div style="font-size:12px;font-weight:700;">'+name+'</div>'
      +'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:'+statusBg+';color:'+statusCol+';">'+statusLabel+'</span>'
      +'</div>'
      +'<div class="js-lbl-sm" class="mt-4">'+appId+'</div>'
      +warn;
    sel.style.display='block';
  }
  var err=document.getElementById('at_error'); if(err) err.style.display='none';
}

function saveAddTenant(){
  var unitId=(document.getElementById('at_unit')||{}).value||'';
  var appId=(document.getElementById('at_appid_val')||{}).value||'';
  var appInput=((document.getElementById('at_appid')||{}).value||'').trim();
  var date=(document.getElementById('at_date')||{}).value||'';
  var status=(document.getElementById('at_status')||{}).value||'occupied';

  var err=document.getElementById('at_error');
  function showErr(msg){ if(err){err.textContent=msg;err.style.display='block';}else showToast(msg); }

  // Validation
  if(!unitId){ showErr('Please select a unit.'); return; }
  if(!appId && !appInput){ showErr('A housing application is required. Use "Start a New Application" above, or search for an existing approved application.'); return; }
  if(!appId && appInput){ showErr('Please select an application from the search dropdown — type a name or App ID to find it.'); return; }
  if(!date){ showErr('Move-in date is required.'); return; }

  // Pull tenant name from linked application
  var apps=typeof applications!=='undefined'?applications:(window.SP_APPLICATIONS||[]);
  var linkedApp=apps.find(function(a){ return a.id===appId; });
  var tenantName=linkedApp?(((linkedApp.fn||'')+' '+(linkedApp.ln||'')).trim()||'Unknown'):'Unknown';

  var units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var idx=units.findIndex(function(u){return u.id===unitId;});
  if(idx===-1){ showErr('Unit not found.'); return; }

  units[idx].assignedName=tenantName;
  units[idx].assignedTo=appId;
  units[idx].assignedDate=date;
  units[idx].status=status;
  sbSaveUnit(units[idx]).catch(function(e){ console.warn('Tenant assign unit save:',e); });

  closeAddTenantModal();
  if(typeof renderTenantsView==='function') renderTenantsView();
  if(typeof renderInventoryView==='function') renderInventoryView();
  showToast('✓ '+tenantName+' assigned to '+units[idx].num+' '+units[idx].street);
}


function openTenantDetail(unitId) {
  if(!panel) return;

  var apps = typeof applications !== 'undefined' ? applications : [];
  var app = apps.find(function(a){ return a.id === u.assignedTo; });
  var name = app ? ((app.fn||'')+' '+(app.ln||'')).trim() : (u.assignedName||'Unknown');

  var hdr = panel.querySelector('#tdp_name');
  if(hdr) hdr.textContent = name;
  var addr = panel.querySelector('#tdp_unit');
  if(addr) addr.textContent = u.num+' '+u.street;

  document.getElementById('tdp_view_app_btn') && (document.getElementById('tdp_view_app_btn').onclick = function(){
    if(app) openEditModal(app.id);
  });

  // Switch to info tab by default
  var tabs = panel.querySelectorAll('[data-tdp-tab]');
  tabs.forEach(function(t){ t.style.display = t.getAttribute('data-tdp-tab') === 'info' ? '' : 'none'; });

  panel.style.removeProperty('display');
  panel.style.setProperty('display','flex','important');
}

function openContractorDetail(idx) {
  var contractors = [];
  var contractors = window._contractors || [];
  var ct = contractors[idx];
  if(!ct) return;

  var panel = document.getElementById('contractorDetailPanel');
  if(!panel) return;

  var setT = function(id, v){ var el=panel.querySelector('#'+id); if(el) el.textContent=v||'—'; };

  setT('cdp_name',  ct.name);
  setT('cdp_trade', ct.trade);
  setT('cdp_phone', ct.phone);
  setT('cdp_email', ct.email);
  setT('cdp_address', ct.address);
  setT('cdp_hst',   ct.hst);
  setT('cdp_wsib_num',    ct.wsibNum);
  setT('cdp_ins_provider', ct.insProvider);
  setT('cdp_ins_policy',   ct.insPolicy);
  setT('cdp_ins_amount',   ct.insAmount);

  // Expiry badges with colour coding
  function expiryBadge(id, dateStr) {
    var el = panel.querySelector('#'+id);
    if(!el) return;
    if(!dateStr) { el.textContent = '—'; el.style.color = '#888'; return; }
    var days = Math.round((new Date(dateStr) - new Date()) / (1000*60*60*24));
    var label = days < 0 ? 'Expired ' + dateStr : days < 30 ? 'Expires ' + dateStr + ' (' + days + 'd)' : dateStr;
    var color = days < 0 ? '#b91c1c' : days < 30 ? '#d97706' : '#15803d';
    el.textContent = label;
    el.style.color = color;
  }
  expiryBadge('cdp_wsib_expiry', ct.wsibExpiry);
  expiryBadge('cdp_ins_expiry',  ct.insExpiry);

  // Key contacts section
  var peopleCard = panel.querySelector('#cdp_people_card');
  var peopleEl   = panel.querySelector('#cdp_people');
  var people = ct.people || [];
  var validPeople = people.filter(function(p){ return p && p.name; });
  if(peopleEl) {
    if(validPeople.length) {
      peopleEl.innerHTML = validPeople.map(function(p){
        return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:10px 12px;background:var(--bg);border-radius:8px;">'
          +'<div><div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Name</div>'
          +'<div class="js-txt-bold">'+(p.name||'—')+'</div></div>'
          +'<div><div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Role</div>'
          +'<div class="js-txt-bold2" style="font-weight:400;">'+(p.role||'—')+'</div></div>'
          +'<div><div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Phone</div>'
          +'<div class="js-txt-bold2" style="font-weight:400;">'+(p.phone||'—')+'</div></div>'
          +'</div>';
      }).join('');
    }
  }
  if(peopleCard) peopleCard.style.display = validPeople.length ? '' : 'none';

  // Notes section
  var notesCard = panel.querySelector('#cdp_notes_card');
  var notesEl   = panel.querySelector('#cdp_notes');
  if(notesEl) notesEl.textContent = ct.notes || '';
  if(notesCard) notesCard.style.display = ct.notes ? '' : 'none';

  panel.style.removeProperty('display');
  panel.style.setProperty('display','flex','important');
  document.body.classList.add('modal-open');
}

function renderEditUnitPhotoPreview(unitId) {
  var container = document.getElementById('ue_photo_preview');
  if(!container) return;
  var photos = getUnitPhotos(unitId);
  if(!photos.length){ container.innerHTML='<span style="font-size:12px;color:var(--muted);font-style:italic;">No photos yet</span>'; return; }
  var html = '';
  photos.forEach(function(p, i){
    html += '<div style="position:relative;flex-shrink:0;">'
      +'<img src="'+p.data+'" style="width:70px;height:55px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" data-ue-uid="'+unitId+'" data-ue-idx="'+i+'"/>'
      +'<button type="button" data-ue-del-uid="'+unitId+'" data-ue-del-idx="'+i+'" style="position:absolute;top:-5px;right:-5px;background:#b91c1c;border:none;color:#fff;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:9px;line-height:16px;text-align:center;padding:0;">✕</button>'
      +'</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('button[data-ue-del-uid]').forEach(function(btn){
    btn.onclick = function(){
      var uid = btn.getAttribute('data-ue-del-uid');
      var idx = parseInt(btn.getAttribute('data-ue-del-idx'));
      var p = getUnitPhotos(uid); p.splice(idx,1); saveUnitPhotos(uid,p);
      renderEditUnitPhotoPreview(uid);
    };
  });
}

var _ueCurrentUnitId = null;

function getUnitPhotos(unitId){
  try {
    return (window._unitPhotos && window._unitPhotos[unitId]) ? window._unitPhotos[unitId].map(function(r){ return r.file_path||r; }) : [];
  } catch(e){ return []; }
}

function saveUnitPhotos(unitId, photos){
  if(!window._unitPhotos) window._unitPhotos = {};
  window._unitPhotos[unitId] = photos;
  // Sync to Supabase — delete existing and re-insert
  fetch(SUPABASE_URL+'/rest/v1/housing_unit_photos?unit_id=eq.'+encodeURIComponent(unitId), { method:'DELETE', headers:HOUSING_HEADERS })
    .then(function(){
      if(!photos.length) return;
      return fetch(SUPABASE_URL+'/rest/v1/housing_unit_photos', {
        method:'POST', headers:Object.assign({},HOUSING_HEADERS,{'Prefer':'return=minimal'}),
        body: JSON.stringify(photos.map(function(p){ return { unit_id: unitId, file_path: typeof p==='string'?p:(p.file_path||''), file_name: typeof p==='string'?p.split('/').pop():(p.file_name||''), added_by: window.currentUser||'staff' }; }))
      });
    }).catch(function(e){ console.warn('Unit photos save failed:',e); });
}

function openAppFromMatch(appId){
  window._appFormReturnTo = 'match';
  if(typeof window.openEditModal === 'function') window.openEditModal(appId);
}

function closeMatchScorecard(){
  var modal = document.getElementById('matchScorecardModal');
  if(modal) modal.style.display = 'none';
}

window.openEditModal = function(appId) {
  var app = applications.find(function(a){ return a.id === appId; });
  if(!app) { showToast('Application not found'); return; }

  // Store the ID so saveApplicationRecord knows which record to update
  currentAppId = app.id;

  // ── Helper: set field value safely ──
  function set(id, val) {
    var el = document.getElementById(id);
    if(!el) return;
    if(el.type === 'checkbox') el.checked = !!val;
    else el.value = val || '';
  }
  function tog(id, val) {
    var el = document.getElementById(id);
    if(el) { el.checked = !!val; el.dispatchEvent(new Event('change')); }
  }

  // ── Step 0: Applicant Info ──
  set('fn',           app.fn);
  set('ln',           app.ln);
  set('dob',          app.dob);
  set('band',         app.band);
  set('reserve',      app.reserve);
  set('marital',      app.marital);
  set('phone',        app.phone);
  set('email',        app.email);
  set('street',       app.street);
  set('city',         app.city);
  set('prov',         app.province || app.prov);
  set('postal',       app.postal);
  set('occDate',      app.occDate);
  set('appDate',      app.appDate);
  set('accessibility', app.accessibility);
  // Populate classification dropdown — map legacy values to new options
  // Use classification value as-is; only remap truly legacy values that no longer exist as options
  var clsVal = app.classification || '';
  set('classification', clsVal);
  liveSync();

  // Restore application type toggle
  var isFileUpdate = (app.appType === 'existing_tenant');
  var newRadio = document.getElementById('apptype_new');
  var exRadio  = document.getElementById('apptype_existing');
  if(newRadio) newRadio.checked = !isFileUpdate;
  if(exRadio)  exRadio.checked  =  isFileUpdate;
  if(typeof onAppTypeChange === 'function') onAppTypeChange();

  // House condition
  tog('hasHouseToggle', app.haveHouse);
  var houseBlk = document.getElementById('homeCondBlk');
  if(houseBlk) houseBlk.style.display = app.haveHouse ? 'block' : 'none';
  if(app.haveHouse) set('homeCondition', app.homeCondition);

  // Arrears
  tog('arrToggle', app.hasArrears);
  var arrBlkEl = document.getElementById('arrBlk');
  if(arrBlkEl) arrBlkEl.style.display = app.hasArrears ? 'block' : 'none';
  if(app.hasArrears) {
    // arrBalAmt and arrMonthlyPayment are type="text" with currency formatting
    var arrBalEl = document.getElementById('arrBalAmt');
    if(arrBalEl && app.arrBalAmt) {
      var _arrNum = parseFloat(app.arrBalAmt) || 0;
      arrBalEl.value = _arrNum ? '$' + _arrNum.toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
    }
    var arrMonEl = document.getElementById('arrMonthlyPayment');
    if(arrMonEl && app.arrMonthlyPayment) {
      var _monNum = parseFloat(app.arrMonthlyPayment) || 0;
      arrMonEl.value = _monNum ? '$' + _monNum.toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
    }
    var arrPlanEl = document.getElementById('arrPlanMonths');
    if(arrPlanEl) arrPlanEl.value = app.arrPlanMonths || '';
    var arrAgrEl = document.getElementById('arrAgreementDate');
    if(arrAgrEl) arrAgrEl.value = app.arrAgreementDate || '';
    var arrDueEl = document.getElementById('arrFirstDueDate');
    if(arrDueEl) arrDueEl.value = app.arrFirstDueDate || '';
    var arrFreqEl = document.getElementById('arrFrequency');
    if(arrFreqEl) arrFreqEl.value = app.arrFrequency || 'monthly';
  }

  // ── Step 1: Employment & Income ──
  var incomeList = document.getElementById('incomeList');
  if(incomeList) {
    incomeList.innerHTML = '';
    var incomes = app.incomes || [];
    if(!incomes.length) {
      // Add one blank row
      addIncome();
    } else {
      incomes.forEach(function(inc, i) {
        addIncome();
        var rows = incomeList.querySelectorAll('.rrow');
        var row  = rows[rows.length - 1];
        var sels = row.querySelectorAll('select');
        var txts = row.querySelectorAll('input[type="text"]');
        var nums = row.querySelectorAll('input[type="number"]');
        if(sels[0]) sels[0].value = inc.person    || 'Applicant';
        if(sels[1]) sels[1].value = inc.incomeType || '';
        if(txts[0]) txts[0].value = inc.employer   || '';
        if(nums[0]) nums[0].value = inc.primaryAmt  || '';
      });
    }
  }

  // ── Step 2: Co-Applicant ──
  var co = app.coApp;
  var coStatus = (app.hasCoApp || (co && co.fn)) ? 'yes' : 'no';
  set('co_status', coStatus);
  var coBlk = document.getElementById('coBlk');
  if(coBlk) coBlk.style.display = coStatus === 'yes' ? 'block' : 'none';
  if(co) {
    set('co_fn',      co.fn);
    set('co_ln',      co.ln);
    set('co_dob',     co.dob);
    set('co_band',    co.band);
    set('co_reserve', co.reserve);
    set('co_cell',    co.cell);
    set('co_home',    co.home);
    set('co_email',   co.email);
  }

  // ── Step 3: Household Members ──
  var habList = document.getElementById('habList');
  if(habList) {
    habList.innerHTML = '';
    var habitants = app.habitants || [];
    if(habitants.length) {
      habitants.forEach(function(h) {
        addHab();
        var rows = habList.querySelectorAll('.rrow');
        var row  = rows[rows.length - 1];
        var txts = row.querySelectorAll('input[type="text"]');
        var dts  = row.querySelectorAll('input[type="date"]');
        var sels = row.querySelectorAll('select');
        if(txts[0]) txts[0].value = h.fn || '';
        if(txts[1]) txts[1].value = h.ln || '';
        if(dts[0])  dts[0].value  = h.dob || '';
        if(sels[0]) sels[0].value = h.relationship || '';
      });
    }
  }

  // ── Step 4: References ──
  var refList = document.getElementById('refList');
  if(refList) {
    refList.innerHTML = '';
    var refs = app.references || [];
    if(refs.length) {
      refs.forEach(function(r) {
        if(!r.fn && !r.phone) return;
        addRef();
        var rows = refList.querySelectorAll('.rrow');
        var row  = rows[rows.length - 1];
        var txts = row.querySelectorAll('input[type="text"]');
        var tels = row.querySelectorAll('input[type="tel"]');
        var ems  = row.querySelectorAll('input[type="email"]');
        var sels = row.querySelectorAll('select');
        if(txts[0]) txts[0].value = r.fn || '';
        if(txts[1]) txts[1].value = r.ln || '';
        if(sels[0]) sels[0].value = r.relationship || '';
        if(tels[0]) tels[0].value = r.phone || '';
        if(ems[0])  ems[0].value  = r.email || '';
      });
    }
  }

  // ── Step 5: Pets ──
  var petList = document.getElementById('petList');
  if(petList) {
    petList.innerHTML = '';
    var pets = app.pets || [];
    pets.forEach(function(p) {
      if(!p.type && !p.name) return;
      addPet();
      var rows = petList.querySelectorAll('.rrow');
      var row  = rows[rows.length - 1];
      var txts = row.querySelectorAll('input[type="text"]');
      var sels = row.querySelectorAll('select');
      var tas  = row.querySelectorAll('textarea');
      if(txts[0]) txts[0].value = p.name || '';
      if(sels[0]) sels[0].value = p.type || '';
      if(sels[1]) sels[1].value = p.size || '';
      if(tas[0])  tas[0].value  = p.desc || '';
    });
  }

  // ── Navigate to form ──
  showApp();
  goTo(0);

  // Update the app ID display
  var appNumCard = document.getElementById('appNumCard');
  if(appNumCard) appNumCard.textContent = app.id;

  // Show an "editing" banner in the form header
  var secHdr = document.querySelector('#step0 .sec-hdr p');
  if(secHdr) secHdr.innerHTML = '<span style="background:var(--yellow);color:#111;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:6px;">Editing</span>' + app.id + ' — changes saved when you submit';

  // Show the modal
  var modal = document.getElementById('editModal');
  if(modal) modal.classList.add('on');

  // Update page header for editing
  var _name = ((app.fn||'')+' '+(app.ln||'')).trim();
  var _t = document.getElementById('appLayout_title');
  var _s = document.getElementById('appLayout_subtitle');
  if(_t) _t.textContent = _name || 'Edit Application';
  if(_s) _s.innerHTML = '<span style="background:var(--yellow);color:#111;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:6px;">Editing</span>' + app.id;

  // ── Restore saved signature fields ──────────────────────────────────────
  function _setSigF(id, val){ var e=document.getElementById(id); if(e&&val) e.value=val; }
  if(app.sig) {
    _setSigF('sig_name',    app.sig.applicant   && app.sig.applicant.name);
    _setSigF('sig_date',    app.sig.applicant   && app.sig.applicant.date);
    _setSigF('sig_co_name', app.sig.coApplicant && app.sig.coApplicant.name);
    _setSigF('sig_co_date', app.sig.coApplicant && app.sig.coApplicant.date);
    _setSigF('sig_staff',   app.sig.staff       && app.sig.staff.name);
    _setSigF('sig_recv',    app.sig.staff       && app.sig.staff.date);
    // Restore canvas drawings (deferred until step 8 is visible)
    window._pendingSigRestore = app.sig;
  }
  if(app.hmSig) {
    _setSigF('sig_hm_name',     app.hmSig.name);
    _setSigF('sig_hm_date',     app.hmSig.date);
    _setSigF('sig_hm_notes',    app.hmSig.notes);
    var _hd=document.getElementById('sig_hm_decision'); if(_hd&&app.hmSig.decision) _hd.value=app.hmSig.decision;
  }
  if(app.edSig) {
    _setSigF('sig_ed_name',     app.edSig.name);
    _setSigF('sig_ed_date',     app.edSig.date);
    _setSigF('sig_ed_notes_sig',app.edSig.notes);
    var _ed=document.getElementById('sig_ed_decision'); if(_ed&&app.edSig.decision) _ed.value=app.edSig.decision;
  }

  // ── Restore V2 scoring fields ──
  function setV2(id, val) {
    var el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else if (val !== undefined && val !== null) el.value = String(val);
  }
  setV2('urgent_need',          app.urgentNeed          || app.urgent_need          || 'none');
  setV2('health_risk',          app.healthRisk          || app.health_risk          || 'none');
  setV2('persons_over_standard',app.personsOverStandard || app.persons_over_standard|| 0);
  setV2('lone_parent',          app.loneParent          || app.lone_parent);
  setV2('elder_in_household',   app.elderInHousehold    || app.elder_in_household);
  setV2('household_disability', app.householdDisability || app.household_disability);
  setV2('income_stability',     app.incomeStability     || app.income_stability     || 'stable');

  // Prior tenancy toggle — drives visibility of history fields
  var noPrior = (app.noPriorTenancy !== undefined) ? app.noPriorTenancy : (app.no_prior_tenancy !== undefined ? app.no_prior_tenancy : true);
  setV2('no_prior_tenancy', noPrior ? 'true' : 'false');
  var histFields = document.getElementById('tenancy_history_fields');
  if (histFields) histFields.style.display = noPrior ? 'none' : 'block';

  // HM-assessed fields — only populate if role allows
  setV2('rent_payment_history', app.rentPaymentHistory || app.rent_payment_history || 'no_history');
  setV2('unit_condition',       app.unitCondition      || app.unit_condition       || 'no_history');
  setV2('tenancy_conduct',      app.tenancyConduct     || app.tenancy_conduct      || 'no_history');

  // Apply role locks and trigger fresh V2 score
  applyTenancyFieldRoles();
  triggerV2Score();

  // Audit — log that this application was opened for editing
  var _editType = app.appType === 'existing_tenant' ? 'File Update' : 'New Housing';
  var _editStatus = (app.status||'draft').replace(/_/g,' ');
  auditEntry(app.id, 'application_opened', _editType + ' opened for editing — current status: ' + _editStatus, window.currentRole||'staff');

  showToast('Editing ' + _name);
}



// ── sigBlock — top-level helper for printSOW (also used locally in previewFromDash) ──
function sigBlock(label, pName, dt, imgSrc) {
  var sigHtml = imgSrc
    ? '<img src="'+imgSrc+'" style="max-height:55px;max-width:100%;object-fit:contain;"/>'
    : '<span style="font-size:9px;color:#ccc;">Sign here</span>';
  return '<div class="print-sec">'    +'<div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;'    +'color:#555;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid #ddd;">'+label+'</div>'    +'<div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:6px;">'    +'<div><div class="sig-lbl">Full Name</div>'    +'<div style="font-size:10.5px;font-weight:600;border-bottom:1px solid #bbb;padding-bottom:2px;min-height:15px;">'+(pName||'')+'</div></div>'    +'<div><div class="sig-lbl">Date</div>'    +'<div style="font-size:10px;border-bottom:1px solid #bbb;padding-bottom:2px;min-height:15px;">'+(dt||'')+'</div></div>'    +'</div>'    +'<div style="width:100%;height:65px;border:1px solid #ddd;border-radius:3px;background:#fafaf8;'    +'display:flex;align-items:center;justify-content:center;">'    +sigHtml+'</div>'    +'</div>';
}

function printSOW(){
  saveSOW();
  var get = function(id){ var el=document.getElementById(id); return el ? el.value.trim() : ''; };
  var chk = function(id){ var el=document.getElementById(id); return el && el.checked; };
  var items   = collectSowItems();
  var hazards = [
    {id:'sow_mold',       label:'Mould / Mildew'},
    {id:'sow_asbestos',   label:'Asbestos Risk'},
    {id:'sow_electrical', label:'Electrical Hazard'},
    {id:'sow_structural', label:'Structural Concern'},
    {id:'sow_plumbing',   label:'Plumbing / Sewage'},
    {id:'sow_fire',       label:'Fire Safety'}
  ].filter(function(h){ return chk(h.id); }).map(function(h){ return h.label; });

  var totalCost = get('sow_total_cost');
  var today = new Date().toLocaleDateString('en-CA');

  // Tenant / staff signature data
  var tenantName     = get('sow_sig_tenant_name') || get('sow_tenant_name') || '—';
  var tenantDate     = get('sow_sig_tenant_date') || '—';
  var tenantSigImg   = (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_tenant') : '';
  var staffName      = get('sow_sig_staff_name') || get('sow_prepared_by') || '—';
  var staffDate      = get('sow_sig_staff_date') || today;
  var staffSigImg    = (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_staff') : '';

  // Accountability flags
  var acctFlags = [];
  if(chk('sow_rent_arrears'))   acctFlags.push('Rent arrears');
  if(chk('sow_tenant_damage'))  acctFlags.push('Tenant damage');
  if(chk('sow_negligence'))     acctFlags.push('Negligence');
  if(chk('sow_vandalism'))      acctFlags.push('Vandalism');
  if(chk('sow_police_report'))  acctFlags.push('Police report on file');
  var acctNotes = get('sow_accountability_notes');

  // Helper: render a signature block (with or without image)
  

  // Helper: approval sig block (no canvas — printed blanks or filled names)
  function approvalBlock(role, name, date) {
    return '<div class="print-sec">'
      +'<div style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:4px;">'+role+'</div>'
      +'<div style="font-size:11px;font-weight:bold;color:#111;margin-bottom:6px;">'+(name||'_____________________________')+'</div>'
      +'<div style="height:40px;border-bottom:1px solid #555;margin-bottom:4px;"></div>'
      +'<div style="font-size:9px;color:#555;">Date: '+(date||'_____________')+'</div>'
      +'</div>';
  }

  var itemRows = items.filter(function(it){ return it.category||it.description||it.cost; }).map(function(it, i){
    var cost = it.cost ? '$'+parseFloat(it.cost).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    return '<tr style="'+(i%2===1?'background:#f8f8f8;':'')+'">'
      +'<td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;color:#444;">'+( it.category||'—')+'</td>'
      +'<td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;color:#222;">'+(it.description||'—')+'</td>'
      +'<td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;text-align:right;font-weight:600;color:#222;">'+cost+'</td>'
      +'</tr>';
  }).join('');

  var html = '<!DOCTYPE html><html lang="en"><head>'
    +'<meta charset="UTF-8"/>'
    +'<title>Scope of Work — CLFN Housing</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'body{font-family:Georgia,serif;font-size:11px;color:#111;background:#fff;}'
    +'@page{size:letter portrait;margin:15mm 15mm 18mm 15mm;}'
    +'@media print{'
      +'body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      +'.no-print{display:none!important;}'
      +'.page-break{page-break-before:always;}'
    +'}'
    +'.header{background:#000;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;margin-bottom:0;}'
    +'.header-left{display:flex;align-items:center;gap:14px;}'
    +'.header-logo{height:48px;width:auto;background:#000;}'
    +'.header-title{font-family:Georgia,serif;}'
    +'.header-title .org{font-size:13px;font-weight:bold;color:#F8E41A;letter-spacing:.04em;}'
    +'.header-title .dept{font-size:10px;color:#ccc;margin-top:2px;}'
    +'.header-right{text-align:right;}'
    +'.header-right .doc-type{font-size:16px;font-weight:bold;color:#F8E41A;letter-spacing:.05em;}'
    +'.header-right .doc-date{font-size:9px;color:#aaa;margin-top:3px;}'
    +'.yellow-bar{background:#F8E41A;height:4px;}'
    +'.body{padding:20px 0 0;}'
    +'.section{margin-bottom:20px;}'
    +'.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:#000;padding:5px 10px;margin-bottom:0;}'
    +'.section-body{border:1px solid #ddd;border-top:none;padding:12px 14px;}'
    +'.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;}'
    +'.grid-4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px 16px;}'
    +'.field label{display:block;font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:3px;}'
    +'.field span{display:block;font-size:11px;color:#111;min-height:14px;border-bottom:1px solid #e0e0e0;padding-bottom:3px;}'
    +'table{width:100%;border-collapse:collapse;font-size:10px;}'
    +'th{background:#000;color:#F8E41A;padding:7px 10px;text-align:left;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;}'
    +'th.right{text-align:right;}'
    +'.total-row td{background:#F8E41A;color:#000;font-weight:bold;padding:8px 10px;font-size:11px;}'
    +'.hazard-badge{display:inline-block;background:#fff0f0;color:#b91c1c;border:1px solid #fca5a5;padding:3px 9px;border-radius:3px;font-size:9px;font-weight:bold;margin:2px;}'
    +'.sig-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:4px;}'
    +'.sig-line{margin-top:32px;border-top:1px solid #333;padding-top:5px;font-size:9px;color:#555;}'
    +'.sig-name{font-size:11px;font-weight:bold;color:#111;margin-bottom:2px;}'
    +'.footer{margin-top:24px;border-top:3px solid #F8E41A;padding-top:8px;display:flex;justify-content:space-between;align-items:center;}'
    +'.footer-left{font-size:8.5px;color:#666;}'
    +'.footer-right{font-size:8.5px;color:#666;}'
    +'</style>'
    +'</head><body>'

    /* HEADER */
    +'<div class="header">'
      +'<div class="header-left">'
        +'<img class="header-logo" src="LOGO_SRC" alt="CLFN"/>'
        +'<div class="header-title">'
          +'<div class="org">Constance Lake First Nation</div>'
          +'<div class="dept">Housing Department</div>'
        +'</div>'
      +'</div>'
      +'<div class="header-right">'
        +'<div class="doc-type">SCOPE OF WORK</div>'
        +'<div class="doc-date">Generated: '+today+'</div>'
      +'</div>'
    +'</div>'
    +'<div class="yellow-bar"></div>'

    /* BODY */
    +'<div class="body">'

    /* Unit Info */
    +'<div class="section">'
      +'<div class="section-title">Unit Information</div>'
      +'<div class="section-body">'
        +'<div class="grid-4">'
          +'<div class="field"><label>Unit Address</label><span>'+get('sow_address')+'</span></div>'
          +'<div class="field"><label>Current Tenant</label><span>'+(get('sow_tenant_name')||'—')+'</span></div>'
          +'<div class="field"><label>Date Prepared</label><span>'+get('sow_date')+'</span></div>'
          +'<div class="field"><label>Prepared By</label><span>'+get('sow_prepared_by')+'</span></div>'
          +'<div class="field"><label>Contractor</label><span>'+(get('sow_contractor')||'—')+'</span></div>'
          +'<div class="field"></div>'
        +'</div>'
      +'</div>'
    +'</div>'

    /* Condition & Schedule */
    +'<div class="section">'
      +'<div class="section-title">Condition Assessment &amp; Schedule</div>'
      +'<div class="section-body">'
        +'<div class="grid-4">'
          +'<div class="field"><label>Overall Condition</label><span>'+get('sow_condition')+'</span></div>'
          +'<div class="field"><label>Estimated Total Cost</label><span>'+totalCost+'</span></div>'
          +'<div class="field"><label>Target Start Date</label><span>'+get('sow_start_date')+'</span></div>'
          +'<div class="field"><label>Target Completion</label><span>'+get('sow_end_date')+'</span></div>'
        +'</div>'
      +'</div>'
    +'</div>'

    /* Scope Items */
    +'<div class="section">'
      +'<div class="section-title">Scope of Work Items</div>'
      +'<table>'
        +'<thead><tr>'
          +'<th style="width:22%">Category</th>'
          +'<th>Description of Work</th>'
          +'<th class="right" style="width:14%">Est. Cost</th>'
        +'</tr></thead>'
        +'<tbody>'+itemRows+'</tbody>'
        +'<tfoot>'
          +'<tr class="total-row">'
            +'<td colspan="2" style="text-align:right;padding-right:16px;">TOTAL ESTIMATED COST</td>'
            +'<td style="text-align:right;">'+totalCost+'</td>'
          +'</tr>'
        +'</tfoot>'
      +'</table>'
    +'</div>'

    /* Health & Safety */
    +(hazards.length
      ? '<div class="section">'
          +'<div class="section-title">Health &amp; Safety Concerns</div>'
          +'<div class="section-body">'
            +hazards.map(function(h){ return '<span class="hazard-badge">⚠ '+h+'</span>'; }).join('')
          +'</div>'
        +'</div>'
      : '')

    /* Notes */
    +(get('sow_notes')
      ? '<div class="section">'
          +'<div class="section-title">Additional Notes</div>'
          +'<div class="section-body" style="font-size:11px;line-height:1.6;color:#222;">'+get('sow_notes')+'</div>'
        +'</div>'
      : '')

    /* Accountability */
    +((acctFlags.length || acctNotes)
      ? '<div class="section">'
          +'<div class="section-title">Tenant Accountability</div>'
          +'<div class="section-body">'
            +(acctFlags.length ? '<div style="margin-bottom:8px;">'+acctFlags.map(function(f){ return '<span class="hazard-badge">'+f+'</span>'; }).join(' ')+'</div>' : '')
            +(acctNotes ? '<div style="font-size:10px;color:#444;line-height:1.5;">'+acctNotes+'</div>' : '')
          +'</div>'
        +'</div>'
      : '')

    /* Terms & Conditions */
    +'<div class="section">'      +'<div class="section-title">Terms &amp; Conditions</div>'      +'<div class="section-body" style="font-size:9.5px;color:#444;line-height:1.65;">'        +'<p style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:10px;">Constance Lake First Nation &mdash; Housing Department</p>'        +'<div class="print-mb"><strong>1. Prioritization of Requests.</strong> Renovation requests are assessed and prioritized based on urgency of need, health and safety risk to occupants, and overall unit condition. Immediate hazards &mdash; structural, electrical, plumbing, or fire safety &mdash; take priority over general maintenance and cosmetic work.</div>'        +'<div class="print-mb"><strong>2. Funding Eligibility &amp; Unit Qualifying Criteria.</strong> Approval is subject to available funding and the qualifying criteria of the unit under its applicable program (e.g. ISC, CMHC Sec. 95, CMHC Sec. 56.1, or Band-funded). Funding availability may affect the scope, cost ceiling, or timing of approved work.</div>'        +'<div class="print-mb"><strong>3. Budget Authority &amp; Approval Routing.</strong> Requests within the Housing Manager&rsquo;s approved budget authority may be approved by the HM. Requests exceeding that threshold require Executive Director approval before work commences. No work begins until all approvals are documented.</div>'        +'<div class="print-mb"><strong>4. Tenant Responsibilities.</strong> The tenant must provide timely access to the unit for inspection and work. Damage, negligence, or vandalism attributed to the tenant may reduce priority and may result in financial responsibility for a portion of repair costs.</div>'        +'<div class="print-mb"><strong>5. No Guarantee of Approval or Timeline.</strong> Submission does not guarantee approval or a specific completion date. Decisions will be communicated in writing. Priority and scheduling may change based on available resources and emerging urgent community needs.</div>'        +'<div><strong>6. Accuracy of Information.</strong> All information must be accurate and complete. False or misleading information may result in the request being cancelled, delayed, or referred for further review.</div>'      +'</div>'    +'</div>'
    /* Acknowledgement & Signatures */
    +'<div class="section">'
      +'<div class="section-title">Signatures &amp; Acknowledgement</div>'
      +'<div class="section-body">'
        /* Declaration text */
        +'<div style="font-size:9.5px;color:#444;line-height:1.6;margin-bottom:14px;padding:10px 12px;background:#f9f9f7;border-left:3px solid #F8E41A;">'
          +'By signing below, the tenant acknowledges the scope of work described in this document and grants access to the unit for the purpose of completing the renovation. '
          +'The Housing Staff member confirms this Scope of Work is accurate and complete.'
        +'</div>'
        /* Tenant + Staff */
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;">'
          +sigBlock('Tenant Signature', tenantName, tenantDate, tenantSigImg)
          +sigBlock('Housing Staff Signature', staffName, staffDate, staffSigImg)
        +'</div>'
      +'</div>'
    +'</div>'

    /* Approvals */
    +'<div class="section">'
      +'<div class="section-title">Management Approvals</div>'
      +'<div class="section-body">'
        +'<div style="font-size:9px;color:#888;margin-bottom:12px;">Budget authority: HM may approve up to the configured limit. Work exceeding this limit requires Executive Director approval.</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">'
          +approvalBlock('Housing Manager Approval', get('sow_hm_name'), get('sow_hm_date'))
          +approvalBlock('Executive Director Approval', get('sow_ed_name'), get('sow_ed_date'))
        +'</div>'
      +'</div>'
    +'</div>'

    +'</div>'/* /body */

    /* FOOTER */
    +'<div class="footer">'
      +'<div class="footer-left">Constance Lake First Nation — Housing Department &nbsp;|&nbsp; Confidential</div>'
      +'<div class="footer-right">Generated '+today+'</div>'
    +'</div>'

    +'</body></html>';

  /* Inject logo */
  html = html.replace('LOGO_SRC', 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAbXB9ADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=');

  showPrintPanel(html, 'Scope of Work');
}