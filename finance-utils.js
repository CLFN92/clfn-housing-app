/* ============================================================
 * finance-utils.js — Finance Module Utilities
 *
 * Pure helpers: formatting, display pills, tenant lookup.
 * No side effects at load time. All functions are called lazily
 * from event handlers after the page and data layer are ready.
 *
 * Loaded before the main finance.html inline script so every
 * module in that block can call these without forward-declaration.
 * ============================================================ */

function toast(msg, duration) {
  if (typeof showToast === 'function') { showToast(msg, {duration: duration || 2500}); return; }
  console.log(msg);
}

function seedIfEmpty(){
  // Phase F3: no-op. Real tenant data comes from the housing → tenants
  // trigger-sync installed by the F2 migration. Demo/dev data should be
  // inserted directly in Supabase via the SQL editor if needed.
}
function fmt(n){ return formatCurrency(n); }
function today(){return new Date().toISOString().slice(0,10);}
function tenantName(t){return t.first+' '+t.last;}
function tenantNameHtml(t){return escapeHtml(tenantName(t));}
function getTenant(id){return getData().tenants.find(function(t){return t.id===id;})||null;}
function methodLabel(m){
  var map={cash:'Cash',debit:'Debit',credit:'Credit Card',etransfer:'E-Transfer','online-banking':'Online Banking',cheque:'Cheque',auto:'Auto Payment',eft:'EFT (Auto)',payroll:'Payroll Deduction'};
  return map[m]||m||'';
}
function typePill(type){
  var map={'band-on':'<span class="pill pill-blue">Band On-Reserve</span>','band-off':'<span class="pill pill-gray">Band Off-Reserve</span>','band-staff':'<span class="pill pill-yellow">Band Staff</span>','clea':'<span class="pill pill-green">CLEA</span>','community':'<span class="pill pill-gray">Community</span>'};
  return map[type]||type;
}
function statusPill(s){
  var map={approved:'<span class="pill pill-green">Approved</span>',posted:'<span class="pill pill-green">Posted</span>','pending-ed':'<span class="pill pill-yellow">Pending ED</span>',pending:'<span class="pill pill-yellow">Pending</span>',reversed:'<span class="pill pill-red">Reversed</span>',nsf:'<span class="pill pill-red">NSF</span>','pending-reversal':'<span class="pill pill-orange">Rev. Pending</span>',active:'<span class="pill pill-green">Active</span>','paid-off':'<span class="pill pill-blue">Paid Off</span>',resolved:'<span class="pill pill-blue">Resolved</span>'};
  return map[s]||'<span class="pill pill-gray">'+s+'</span>';
}
function isInCollections(tenantId){
  return getData().collections.some(function(c){return c.tenantId===tenantId&&(c.status==='approved'||c.status==='pending-ed');});
}
function collectionsBadge(tenantId){
  return isInCollections(tenantId)?'<span class="collections-badge" style="margin-left:6px;">&#128680; Collections</span>':'';
}
