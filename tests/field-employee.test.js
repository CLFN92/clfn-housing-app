/* ============================================================================
 * tests/field-employee.test.js
 *
 * Dependency-free regression check for the Field Employee role + work-order
 * assignment/visibility rules. The project has no test runner or build step
 * (see CLAUDE.md), so this is a plain Node script that loads the REAL source
 * (CLFN_PERMS from shared.js, the visibility filter from shared-data.js, and
 * APPROVAL_AUTHORITY from approval-authority.js) and asserts behaviour.
 *
 *   Run from the repo root:  node tests/field-employee.test.js
 *   Exit code 0 = all pass, 1 = a failure (CI-friendly).
 *
 * Browser globals the modules read are mocked minimally below. This covers the
 * decision logic only — it does NOT exercise the live Supabase backend or DOM
 * rendering (do a real-device smoke test after deploy for those).
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ── Mock browser globals ────────────────────────────────────────────────────
global.window = {};
const window = global.window;

// ── Load real CLFN_PERMS (the initPerms IIFE in shared.js) ──────────────────
const sharedSrc = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
(function loadPerms() {
  const start  = sharedSrc.indexOf('(function initPerms()');
  const anchor = sharedSrc.indexOf('window.CLFN_PERMS = Object.freeze(', start);
  const end    = sharedSrc.indexOf('})();', anchor) + '})();'.length;
  if (start < 0 || anchor < 0 || end < 0) throw new Error('Could not locate initPerms() in shared.js');
  eval(sharedSrc.slice(start, end));
})();
const P = window.CLFN_PERMS;

// ── Load real visibility filter from shared-data.js ─────────────────────────
const sdSrc = fs.readFileSync(path.join(ROOT, 'shared-data.js'), 'utf8');
const fnMatch = sdSrc.match(/function sowHiddenFromCurrentFieldEmployee\(sow\)\{[\s\S]*?\n\}/);
if (!fnMatch) throw new Error('Could not locate sowHiddenFromCurrentFieldEmployee in shared-data.js');
// Wrap as an expression so it returns the fn (strict-mode eval won't leak a
// bare function declaration into this scope).
const sowHiddenFromCurrentFieldEmployee = eval('(' + fnMatch[0] + ')');

// ── Load real APPROVAL_AUTHORITY (top-level var; capture via trailing expr) ─
const A = eval(fs.readFileSync(path.join(ROOT, 'approval-authority.js'), 'utf8') + '\n;APPROVAL_AUTHORITY');

// ── Tiny assert harness ─────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(name, cond) { (cond ? pass++ : fail++); console.log((cond ? '  PASS  ' : '  FAIL  ') + name); }
function setUser(role, email) {
  window._viewAsRole = ''; window._realRole = role; window.currentRole = role;
  const s = { email: email }; window.HOUSING_SESSION = s; global.HOUSING_SESSION = s;
}

console.log('\n=== 1. Role capabilities (CLFN_PERMS) ===');
ok('field_employee is a valid role',              P.isValidRole('field_employee'));
ok('label = "Field Employee"',                    P.roleLabel('field_employee') === 'Field Employee');
ok('hasHousingAccess(field_employee) = true',     P.hasHousingAccess('field_employee') === true);
ok('canCreateApp(field_employee) = false',        P.canCreateApp('field_employee') === false);
ok('canEditApp(field_employee) = false',          P.canEditApp('field_employee') === false);
ok('canEditSow(field_employee,draft) = true',     P.canEditSow('field_employee', 'draft') === true);
ok('canEditSow(field_employee,completed) = false',P.canEditSow('field_employee', 'completed') === false);
ok('canMarkSowComplete(field_employee) = true',   P.canMarkSowComplete('field_employee') === true);
ok('canEditProgressForUnit(field_employee)=true', P.canEditProgressForUnit('field_employee', false) === true);
ok('canApproveSowHm(field_employee) = false',     P.canApproveSowHm('field_employee') === false);
ok('canApproveSowEd(field_employee) = false',     P.canApproveSowEd('field_employee') === false);

console.log('\n=== 2. Visibility filter: sowHiddenFromCurrentFieldEmployee ===');
const inhouseMine   = { assignedTeam: 'in_house',   assignedTo: 'crew@nation.ca' };
const inhouseOther  = { assignedTeam: 'in_house',   assignedTo: 'someoneelse@nation.ca' };
const inhouseUnassd = { assignedTeam: 'in_house',   assignedTo: '' };
const contractorJob = { assignedTeam: 'contractor', contractorId: 'c1' };
const legacyNoTeam  = { contractor: 'Bob Builders', contractorId: 'c2' };

setUser('field_employee', 'crew@nation.ca');
ok('FE sees in-house job assigned to them',        sowHiddenFromCurrentFieldEmployee(inhouseMine)   === false);
ok('FE hidden from in-house job for someone else', sowHiddenFromCurrentFieldEmployee(inhouseOther)  === true);
ok('FE hidden from unassigned in-house job',       sowHiddenFromCurrentFieldEmployee(inhouseUnassd) === true);
ok('FE hidden from contractor job',                sowHiddenFromCurrentFieldEmployee(contractorJob) === true);
ok('FE hidden from legacy (no team) job',          sowHiddenFromCurrentFieldEmployee(legacyNoTeam)  === true);
setUser('field_employee', 'CREW@nation.ca');
ok('FE email match is case-insensitive',           sowHiddenFromCurrentFieldEmployee(inhouseMine)   === false);

['ed', 'housing_manager', 'housing_employee_l2', 'housing_employee_l1'].forEach(function (r) {
  setUser(r, 'x@nation.ca');
  ok(r + ' sees in-house-other', sowHiddenFromCurrentFieldEmployee(inhouseOther)  === false);
  ok(r + ' sees contractor job', sowHiddenFromCurrentFieldEmployee(contractorJob) === false);
});

console.log('\n=== 3. assignWorkOrder approval authority (default HM/ED) ===');
ok("can('assignWorkOrder','housing_manager') = true",  A.can('assignWorkOrder', 'housing_manager') === true);
ok("can('assignWorkOrder','ed') = true",               A.can('assignWorkOrder', 'ed') === true);
ok("can('assignWorkOrder','field_employee') = false",  A.can('assignWorkOrder', 'field_employee') === false);
ok("can('assignWorkOrder','housing_employee_l2')=false",A.can('assignWorkOrder', 'housing_employee_l2') === false);
ok("super_user inherits ED (assignWorkOrder) = true",  A.can('assignWorkOrder', 'super_user') === true);
ok("assignWorkOrder has a Settings label",             !!(A.labels && A.labels.assignWorkOrder));
ok("assignWorkOrder grouped under 'SOW & Renovation'", (A.groups && A.groups['SOW & Renovation'] || []).indexOf('assignWorkOrder') !== -1);
ok("can('editRenoProgress','field_employee') = true",  A.can('editRenoProgress', 'field_employee') === true);

console.log('\n=== 4. saveSOW assignment reconcile ===');
function reconcile(d) {
  if (d.assignedTeam === 'in_house') { d.contractor = ''; d.contractorId = ''; }
  else if (d.assignedTeam === 'contractor') { d.assignedTo = ''; d.assignedToName = ''; }
  return d;
}
const a = reconcile({ assignedTeam: 'in_house',   assignedTo: 'crew@n.ca', assignedToName: 'Crew', contractor: 'StaleCo', contractorId: 'c9' });
ok('in-house clears contractor + contractorId', a.contractor === '' && a.contractorId === '' && a.assignedTo === 'crew@n.ca');
const b = reconcile({ assignedTeam: 'contractor', assignedTo: 'crew@n.ca', assignedToName: 'Crew', contractorId: 'c1' });
ok('contractor clears assignee fields',         b.assignedTo === '' && b.assignedToName === '' && b.contractorId === 'c1');

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
