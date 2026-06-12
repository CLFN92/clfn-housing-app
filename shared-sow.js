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
  // Produces "SOW-YYYY-NN" with a globally unique sequential counter across
  // all units — scans every entry in _sowCache so each SOW gets a distinct
  // project number regardless of which unit it belongs to.
  // unitId is accepted for backward-compatibility but no longer used.
  var year   = new Date().getFullYear();
  var prefix = 'SOW-' + year + '-';
  var maxN   = 0;
  var cache  = window._sowCache || {};
  Object.keys(cache).forEach(function(uid) {
    var list = getUnitSowList(uid);
    list.forEach(function(s) {
      var pn = String(s.project_number || '');
      if (pn.indexOf(prefix) === 0) {
        var n = parseInt(pn.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    });
  });
  var seq = ('0' + (maxN + 1)).slice(-2); // zero-pad to 2 digits: 01, 02 … 99
  return prefix + seq;
}

// ─── SOW archive lifecycle ────────────────────────────────────────────────
// archiveSow / unarchiveSow flip the per-SOW `archived` flag inside the
// unit's SOW list and persist via upsertSowInList. The Reno Approvals view
// and the unit-detail SOW table both filter archived SOWs out by default;
// a "Show archived" toggle exposes them for review.
//
// hasActiveSows is the trigger for unit-status auto-revert: the unit is
// flipped back from 'under_repair' to its priorStatus once no SOW remains
// that is both not-archived AND not-completed. Multi-SOW units stay
// 'under_repair' while phased work is still active.
function archiveSow(unitId, projectNumber, role){
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow) return null;
  sow.archived   = true;
  sow.archivedAt = new Date().toISOString();
  sow.archivedBy = role || (window.currentRole || 'staff');
  upsertSowInList(unitId, sow);
  return sow;
}
function unarchiveSow(unitId, projectNumber){
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow) return null;
  sow.archived = false;
  delete sow.archivedAt;
  delete sow.archivedBy;
  upsertSowInList(unitId, sow);
  return sow;
}
function hasActiveSows(unitId){
  var list = getUnitSowList(unitId);
  return list.some(function(s){
    return !s.archived && s.approval_status !== 'completed';
  });
}

// ─── Unit-renovation auto-flip for the renovation lifecycle ───────────────
// flipUnitToUnderRepair: when a SOW is first HM/ED-approved, mark the unit
// as under renovation so it surfaces in the Renovations view. Idempotent —
// no-op if already flagged or condemned (condemned cannot be under reno).
function flipUnitToUnderRepair(unit){
  if(!unit || unit.status === 'condemned') return false;
  if(unit.under_renovation) return false;
  unit.under_renovation = true;
  return true;
}
// revertUnitFromRepair: clears the under_renovation flag when all SOWs are
// complete. No-op if the flag isn't set.
function revertUnitFromRepair(unit){
  if(!unit || !unit.under_renovation) return false;
  unit.under_renovation = false;
  return true;
}

// maybeAutoFlipUnitForSow — called from saveSOW after the new approval_status
// is computed. Detects two transitions:
//   • first HM/ED approval (was draft/signed, now hm/ed_approved) → flip to under_repair
//   • completion (now 'completed' AND no other active SOWs)       → revert
// Returns true if the unit was changed (caller should persist via sbSaveUnit).
function maybeAutoFlipUnitForSow(unit, newSow, prevApprovalStatus){
  if(!unit || !newSow) return false;
  var newStatus  = newSow.approval_status;
  var wasApproved = prevApprovalStatus === 'hm_approved'
                 || prevApprovalStatus === 'ed_approved'
                 || prevApprovalStatus === 'completed';
  // First-approval transition.
  if((newStatus === 'hm_approved' || newStatus === 'ed_approved') && !wasApproved){
    return flipUnitToUnderRepair(unit);
  }
  // Completion → maybe revert (only if no other SOW is still active).
  if(newStatus === 'completed' && !hasActiveSows(unit.id)){
    return revertUnitFromRepair(unit);
  }
  return false;
}
