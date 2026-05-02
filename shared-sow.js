/* ============================================================
 * shared-sow.js — CLFN Housing Suite
 * Multi-SOW helpers shared between housing.html and renos.html.
 * ============================================================
 * Depends on: shared-data.js (getUnitSowList, saveSowList,
 *             isSowCompleted, _realRoleForPermissions),
 *             shared-config.js (ROLE), approval-authority.js
 * Load order: ...shared-data.js → THIS FILE → page-specific scripts
 *
 * Exposes (as globals):
 *   getSowByProjectNumber(unitId, projectNumber)
 *   unitHasCompletedSow(unitId)
 *   canEditSow(sow)
 *   canMarkSowComplete()
 *   canReopenSow()
 *   upsertSowInList(unitId, sow)
 *   nextProjectNumber(unitId)
 * ============================================================ */

function getSowByProjectNumber(unitId, projectNumber){
  var list = getUnitSowList(unitId);
  for(var i=0; i<list.length; i++){
    if(list[i].project_number === projectNumber) return list[i];
  }
  return null;
}

function unitHasCompletedSow(unitId){
  return getUnitSowList(unitId).some(isSowCompleted);
}

// ── SOW lock / permission helpers ─────────────────────────────────────────
// A SOW becomes immutable once its approval_status is 'completed'.
// Only the ED can edit/reopen completed SOWs.

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
