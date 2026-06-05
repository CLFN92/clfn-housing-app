/* ============================================================
 * finance-export.js — Finance Module CSV Exports
 *
 * exportStdCSV() is the shared CSV builder.
 * Each exportXxx() wrapper mirrors the page's current filter
 * state so the downloaded file matches exactly what the user sees.
 *
 * Dependencies (all lazy — called only on user action, after page load):
 *   getData(), getTenant(), tenantName(), today(), fmt(), methodLabel(),
 *   toast(), calcAllTotals(), getAllTransactions()
 * ============================================================ */

// ── Shared CSV export helper ──────────────────────────────────────────────
// Every page's Export CSV button calls its own exportXxx() wrapper, which
// collects the currently-filtered rows and delegates to this utility.
//
// Args:
//   reportName: human-friendly suffix, e.g. "Tenants", "Rent-Ledger"
//   headers:    array of column header strings
//   rows:       array of row arrays (same length + order as headers)
function exportStdCSV(reportName, headers, rows){
  function esc(v){
    if (v === null || v === undefined) return '""';
    var s = String(v);
    // Quote every value and escape embedded quotes. This is safest for
    // fields that may contain commas, newlines, or quotes.
    return '"' + s.replace(/"/g,'""') + '"';
  }
  var headerLine = headers.map(esc).join(',');
  var bodyLines  = rows.map(function(r){ return r.map(esc).join(','); });
  // Prepend a BOM so Excel opens UTF-8 files correctly
  var csv = '﻿' + headerLine + '\n' + bodyLines.join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var prefix = (window.NATION_CONFIG && window.NATION_CONFIG.short_name) ? window.NATION_CONFIG.short_name + '-' : '';
  var fname = prefix + 'Finance-' + reportName + '-' + today() + '.csv';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 100);
  toast('Exported ' + rows.length + ' row' + (rows.length===1?'':'s') + ' to ' + fname);
}

// ── Per-page export wrappers. Each pulls from the page's current filter
// state so the CSV matches exactly what the user sees on screen. ──────────

function exportTenants(){
  var d = getData();
  var typeLabels = {
    'band-on':'Band On-Reserve','band-off':'Band Off-Reserve','band-staff':'Band Office Staff',
    'clea':'CLEA','community':'Community Member'
  };
  // Reuse the same filter logic as renderTenantList
  var fStatus = (document.getElementById('tfilt_status')||{}).value || '';
  var fType   = (document.getElementById('tfilt_type')||{}).value   || '';
  var fArr    = (document.getElementById('tfilt_arrears')||{}).value|| '';
  var fCol    = (document.getElementById('tfilt_col')||{}).value    || '';
  var totals = calcAllTotals(d);
  var colSet = {};
  (d.collections||[]).forEach(function(c){
    if (c.status==='approved' || c.status==='pending-ed') colSet[c.tenantId] = true;
  });
  var list = (d.tenants||[]).filter(function(t){
    var st = t.status || 'active';
    if (fStatus && st !== fStatus) return false;
    if (fType && t.type !== fType) return false;
    if (fArr) {
      var bal = totals[t.id] || {};
      var owe = (bal.rent||0) + (bal.loan||0) + (bal.arrangement||0);
      var hasArr = owe > 0;
      if (fArr === 'yes' && !hasArr) return false;
      if (fArr === 'no'  && hasArr) return false;
    }
    if (fCol) {
      var inCol = !!colSet[t.id];
      if (fCol === 'yes' && !inCol) return false;
      if (fCol === 'no'  && inCol) return false;
    }
    return true;
  }).sort(function(a,b){ return tenantName(a).localeCompare(tenantName(b)); });

  var rows = list.map(function(t){
    var bal = totals[t.id] || {};
    var owe = (bal.rent||0) + (bal.loan||0) + (bal.arrangement||0);
    return [
      t.id,
      t.first||'', t.last||'',
      typeLabels[t.type] || t.type || '',
      t.status || 'active',
      t.unit || '',
      t.street || '', t.community || '', t.province || '', t.postalCode || '',
      t.phone || '', t.email || '',
      t.dob || t.date_of_birth || '',
      t.bandNumber || '',
      (t.rent != null ? Number(t.rent).toFixed(2) : ''),
      t.invPref || '',
      t.autoPay ? (t.autoPayType || 'yes') : 'no',
      t.hydroAcct || '',
      t.gasAcct || '',
      bal.rent || 0,
      bal.loan || 0,
      bal.arrangement || 0,
      owe,
      colSet[t.id] ? 'yes' : 'no'
    ];
  });

  exportStdCSV('Tenants', [
    'Tenant ID','First Name','Last Name','Type','Status','Unit',
    'Street','Community','Province','Postal Code',
    'Phone','Email','Date of Birth','Band #',
    'Monthly Rent','Invoice Preference','Auto-Pay',
    'Hydro Acct','Gas Acct',
    'Rent Balance','Loan Balance','Arrangement Balance','Total Owing',
    'In Collections'
  ], rows);
}

function exportRentLedger(){
  var d = getData();
  var tid = (document.getElementById('rentTenantSelect')||{}).value || '';
  if (!tid) { toast('Select a tenant first.'); return; }
  var t = getTenant(tid);
  if (!t) { toast('Tenant not found.'); return; }

  var fDate   = (document.getElementById('rfilt_date')  ||{}).value || 'all';
  var fType   = (document.getElementById('rfilt_type')  ||{}).value || '';
  var fStatus = (document.getElementById('rfilt_status')||{}).value || '';
  var fMin    = parseFloat((document.getElementById('rfilt_amt_min')||{}).value);
  var fMax    = parseFloat((document.getElementById('rfilt_amt_max')||{}).value);

  var cutoff = null;
  var todayD = new Date();
  if (fDate === 'this_month') cutoff = new Date(todayD.getFullYear(), todayD.getMonth(), 1);
  else if (fDate === '30')    cutoff = new Date(todayD.getTime() - 30*24*60*60*1000);
  else if (fDate === '90')    cutoff = new Date(todayD.getTime() - 90*24*60*60*1000);

  // Running balance is across ALL rows; filters narrow display
  var allRows = d.rentLedger.filter(function(r){ return r.tenantId === tid; })
                             .sort(function(a,b){ return a.date.localeCompare(b.date); });
  var balance = 0;
  allRows.forEach(function(r){ balance += r.charge - r.payment; r._runningBalance = balance; });

  var rows = allRows.filter(function(r){
    if (cutoff && new Date(r.date) < cutoff) return false;
    if (fType && (r.type || '') !== fType) return false;
    if (fStatus) {
      var st = r.status || '';
      if (fStatus === 'active' && (st === 'reversed' || st === 'voided' || st === 'overdue')) return false;
      if (fStatus === 'paid'    && r.type !== 'payment') return false;
      if (fStatus === 'voided'  && st !== 'reversed' && st !== 'voided') return false;
      if (fStatus === 'overdue' && st !== 'overdue') return false;
    }
    var amt = (r.charge||0) + (r.payment||0);
    if (!isNaN(fMin) && amt < fMin) return false;
    if (!isNaN(fMax) && amt > fMax) return false;
    return true;
  }).map(function(r){
    return [
      r.date, r.type || '', r.desc || '',
      r.charge || 0, r.payment || 0, r._runningBalance,
      methodLabel(r.method), r.status || '', r.ref || ''
    ];
  });

  exportStdCSV('Rent-Ledger-'+tenantName(t).replace(/\s+/g,'-'),
    ['Date','Type','Description','Charge','Payment','Running Balance','Method','Status','Reference'],
    rows
  );
}

function exportArrangements(){
  var d = getData();
  var filterTid = (document.getElementById('arrTenantSelect')||{}).value || 'all';
  var fStatus = (document.getElementById('afilt_status')||{}).value || '';
  var fLedger = (document.getElementById('afilt_ledger')||{}).value || '';
  var fFreq   = (document.getElementById('afilt_freq')  ||{}).value || '';
  var fMin    = parseFloat((document.getElementById('afilt_amt_min')||{}).value);
  var fMax    = parseFloat((document.getElementById('afilt_amt_max')||{}).value);

  var list = (d.arrangements||[]).filter(function(a){
    if (filterTid !== 'all' && a.tenantId !== filterTid) return false;
    if (fStatus) {
      if (fStatus === 'active' && !(a.status === 'approved' || a.status === 'active')) return false;
      if (fStatus !== 'active' && a.status !== fStatus) return false;
    }
    if (fLedger && (a.ledger||'').toLowerCase() !== fLedger) return false;
    if (fFreq   && (a.frequency || 'monthly') !== fFreq) return false;
    var amt = parseFloat(a.totalOwing) || 0;
    if (!isNaN(fMin) && amt < fMin) return false;
    if (!isNaN(fMax) && amt > fMax) return false;
    return true;
  });

  var rows = list.map(function(a){
    var t = getTenant(a.tenantId);
    var paid = d.arrPayments.filter(function(p){ return p.arrId === a.id; }).reduce(function(s,p){ return s+p.amount; }, 0);
    var remaining = Math.max(0, a.totalOwing - paid);
    var pct = a.totalOwing > 0 ? (paid/a.totalOwing*100) : 0;
    return [
      a.id, t?tenantName(t):'', a.tenantId,
      a.ledger || '', a.status || '', a.frequency || 'monthly',
      a.totalOwing || 0, paid, remaining, pct.toFixed(1),
      a.monthlyPayment || 0, a.startDate || '', a.ref || '', a.notes || ''
    ];
  });

  exportStdCSV('Arrangements',
    ['Arrangement ID','Tenant','Tenant ID','Ledger','Status','Frequency','Total Owing','Paid to Date','Remaining','% Repaid','Scheduled Payment','Start Date','Reference','Notes'],
    rows
  );
}

function exportLoans(){
  var d = getData();
  var tid = (document.getElementById('loanTenantSelect')||{}).value || 'all';
  var fStatus  = (document.getElementById('lfilt_status') ||{}).value || '';
  var fPurpose = (document.getElementById('lfilt_purpose')||{}).value || '';
  var fMin     = parseFloat((document.getElementById('lfilt_amt_min')||{}).value);
  var fMax     = parseFloat((document.getElementById('lfilt_amt_max')||{}).value);

  var list = (d.loanList||[]).filter(function(l){
    if (tid !== 'all' && l.tenantId !== tid) return false;
    if (fStatus && l.status !== fStatus) return false;
    if (fPurpose && (l.type||'') !== fPurpose) return false;
    var p = parseFloat(l.principal) || 0;
    if (!isNaN(fMin) && p < fMin) return false;
    if (!isNaN(fMax) && p > fMax) return false;
    return true;
  });

  var rows = list.map(function(l){
    var t = getTenant(l.tenantId);
    var paid = d.loanPayments.filter(function(p){ return p.loanId === l.id && p.status !== 'reversed'; })
                              .reduce(function(s,p){ return s+p.amount; }, 0);
    var remaining = Math.max(0, l.principal - paid);
    var pct = l.principal > 0 ? (paid/l.principal*100) : 0;
    return [
      l.id, t?tenantName(t):'', l.tenantId,
      l.type || '', l.status || '',
      l.principal || 0, paid, remaining, pct.toFixed(1),
      l.payment || 0, l.frequency || 'monthly', l.annualRate || 0,
      l.termMonths || 0, l.startDate || '', l.notes || ''
    ];
  });

  exportStdCSV('Loans',
    ['Loan ID','Tenant','Tenant ID','Purpose','Status','Principal','Paid to Date','Remaining','% Repaid','Scheduled Payment','Frequency','Annual Rate %','Term (Months)','Start Date','Notes'],
    rows
  );
}

function exportJournal(){
  var d = getData();
  var tid = (document.getElementById('journalTenantSelect')||{}).value || 'all';
  var openingBals = (d.rentLedger||[]).filter(function(r){ return r.type==='opening' || r.type==='opening_balance'; });
  var all = (d.journalEntries||[]).concat(openingBals);
  var _seen={}; all=all.filter(function(r){if(_seen[r.id])return false;_seen[r.id]=true;return true;});
  if (tid !== 'all') all = all.filter(function(r){ return r.tenantId === tid; });

  var fStatus = (document.getElementById('jfilt_status')||{}).value || '';
  var fLedger = (document.getElementById('jfilt_ledger')||{}).value || '';
  var fDate   = (document.getElementById('jfilt_date')  ||{}).value || 'all';
  var fMin    = parseFloat((document.getElementById('jfilt_amt_min')||{}).value);
  var fMax    = parseFloat((document.getElementById('jfilt_amt_max')||{}).value);

  var cutoff = null;
  var todayD = new Date();
  if (fDate === 'this_month') cutoff = new Date(todayD.getFullYear(), todayD.getMonth(), 1);
  else if (fDate === '30')    cutoff = new Date(todayD.getTime() - 30*24*60*60*1000);
  else if (fDate === '90')    cutoff = new Date(todayD.getTime() - 90*24*60*60*1000);

  var list = all.filter(function(r){
    if (cutoff && new Date(r.date) < cutoff) return false;
    if (fStatus && (r.status||'') !== fStatus) return false;
    if (fLedger && (r.ledger || 'rent') !== fLedger) return false;
    var amt = (r.charge||0) + (r.payment||0);
    if (!isNaN(fMin) && amt < fMin) return false;
    if (!isNaN(fMax) && amt > fMax) return false;
    return true;
  }).sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });

  var rows = list.map(function(r){
    var t = getTenant(r.tenantId);
    return [
      r.date, t?tenantName(t):'', r.tenantId,
      r.desc || '', r.ledger || 'rent', r.type || '',
      r.charge || 0, r.payment || 0,
      r.postedBy || r.enteredBy || '', r.status || '', r.ref || ''
    ];
  });

  exportStdCSV('Journal-Entries',
    ['Date','Tenant','Tenant ID','Memo','Ledger','Type','Debit','Credit','Posted By','Status','Reference'],
    rows
  );
}

function exportCollections(){
  var d = getData();
  var fStatus = (document.getElementById('cfilt_status') ||{}).value || '';
  var fDate   = (document.getElementById('cfilt_date')   ||{}).value || 'all';
  var fMin    = parseFloat((document.getElementById('cfilt_amt_min')||{}).value);
  var fMax    = parseFloat((document.getElementById('cfilt_amt_max')||{}).value);
  var fSearch = ((document.getElementById('cfilt_search')||{}).value || '').trim().toLowerCase();

  var cutoff = null;
  var todayD = new Date();
  if (fDate === '30')       cutoff = new Date(todayD.getTime() - 30*24*60*60*1000);
  else if (fDate === '90')  cutoff = new Date(todayD.getTime() - 90*24*60*60*1000);
  else if (fDate === '365') cutoff = new Date(todayD.getTime() - 365*24*60*60*1000);

  var list = (d.collections||[]).filter(function(c){
    if (cutoff && c.dateFlagged && new Date(c.dateFlagged) < cutoff) return false;
    if (fStatus) {
      if (fStatus === 'active') {
        if (c.status === 'resolved' || c.status === 'cancelled') return false;
      } else if ((c.status||'') !== fStatus) {
        return false;
      }
    }
    var amt = parseFloat(c.amountAtReferral) || 0;
    if (!isNaN(fMin) && amt < fMin) return false;
    if (!isNaN(fMax) && amt > fMax) return false;
    if (fSearch) {
      var t = getTenant(c.tenantId);
      var hay = ((t?tenantName(t):'') + ' ' + (c.agency||'') + ' ' + (c.ref||'') + ' ' + (c.notes||'')).toLowerCase();
      if (hay.indexOf(fSearch) === -1) return false;
    }
    return true;
  }).sort(function(a,b){ return (b.dateFlagged||'').localeCompare(a.dateFlagged||''); });

  var totals = calcAllTotals(d);
  var rows = list.map(function(c){
    var t = getTenant(c.tenantId);
    var bal = totals[c.tenantId] || {};
    var curBalance = (bal.rent||0) + (bal.loan||0) + (bal.arrangement||0);
    return [
      c.id, t?tenantName(t):'', c.tenantId,
      c.dateFlagged || '', c.amountAtReferral || 0, curBalance,
      c.agency || '', c.ref || '', c.status || '', c.notes || ''
    ];
  });

  exportStdCSV('Collections',
    ['Collection ID','Tenant','Tenant ID','Date Flagged','Amount at Referral','Current Balance','Agency','Reference','Status','Notes'],
    rows
  );
}


function exportTransactions() {
  // Honor the currently-applied filters so the CSV matches the UI
  var filterTenant = (document.getElementById('txn-filter-tenant')||{}).value || 'all';
  var filterLedger = (document.getElementById('txn-filter-ledger')||{}).value || 'all';
  var filterType   = (document.getElementById('txn-filter-type')  ||{}).value || 'all';
  var filterFrom   = (document.getElementById('txn-filter-from')  ||{}).value || '';
  var filterTo     = (document.getElementById('txn-filter-to')    ||{}).value || '';

  var txns = getAllTransactions();
  if (filterTenant !== 'all') txns = txns.filter(function(t){ return t.tenantId === filterTenant; });
  if (filterLedger !== 'all') txns = txns.filter(function(t){ return t.ledger   === filterLedger; });
  if (filterType === 'charge')  txns = txns.filter(function(t){ return t.charge > 0; });
  if (filterType === 'payment') txns = txns.filter(function(t){ return t.payment > 0; });
  if (filterFrom) txns = txns.filter(function(t){ return t.date >= filterFrom; });
  if (filterTo)   txns = txns.filter(function(t){ return t.date <= filterTo; });

  var rows = txns.map(function(t){
    var tn = getTenant(t.tenantId);
    return [
      t.date, tn?tenantName(tn):'', t.tenantId,
      t.ledger || '', t.desc || '',
      t.charge || 0, t.payment || 0,
      methodLabel(t.method), t.status || '', t.ref || ''
    ];
  });

  exportStdCSV('Transactions',
    ['Date','Tenant','Tenant ID','Ledger','Description','Charge','Payment','Method','Status','Reference'],
    rows
  );
}

function exportAudit() {
  var d = getData(); var log = d.auditLog||[];
  var csv = 'Timestamp,User,Action,Entity,EntityID,Description\n'+
    log.map(function(e){return [e.ts,e.user,e.action,e.entity,e.entityId,e.description]
      .map(function(v){return '"'+(v||'').toString().replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var blob = new Blob([csv],{type:'text/csv'});
  var a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=(window.NATION_CONFIG && window.NATION_CONFIG.short_name || '')+'-Audit-Log-'+today()+'.csv'; a.click();
}
