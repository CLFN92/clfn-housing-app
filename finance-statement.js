var _stmtTid = null;
var _stmtFilter = 'all';

function goToTenant(tid) {
  _stmtTid = tid;
  _stmtFilter = 'all';
  showPage('statement');
  renderStatementPage(tid);
}

function stmtGoBack() {
  finGoBack();
  if (typeof closeSidebarOnNav === 'function') closeSidebarOnNav();
}

function renderStatementPage(tid) {
  var t = getTenant(tid);
  if (!t) return;
  var d = getData();

  // Header
  document.getElementById('stmt-tenant-name').textContent = tenantName(t);
  document.getElementById('stmt-tenant-sub').textContent = t.unit + '  \u00B7  ' + t.type.replace(/-/g,' ');
  var _backBtn = document.getElementById('stmt-back-btn');
  if (_backBtn) {
    var _pageLabels = {home:'Home',tenants:'Tenants',rent:'Rent Ledger',arrangements:'Arrangements',loans:'Loans',journal:'Journal',reports:'Reports',collections:'Collections',transactions:'Transactions'};
    _backBtn.innerHTML = '&#8592; Back to ' + (_pageLabels[_prevPage] || 'Previous');
  }

  // Balance bar
  var totals = calcAllTotals(d);
  var v = totals[tid]||{};
  var loanBal = 0;
  d.loanList.filter(function(l){return l.tenantId===tid&&l.status==='approved';}).forEach(function(l){
    var paid = d.loanPayments.filter(function(p){return p.loanId===l.id&&p.status!=='reversed';}).reduce(function(s,p){return s+p.amount;},0);
    loanBal += Math.max(0, l.principal - paid);
  });
  var grand = Math.max(0,v.rent||0) + Math.max(0,v.arrangement||0) + loanBal;

  var bar = document.getElementById('stmt-balance-bar');
  bar.innerHTML = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">'+
    [
      {lbl:'Rent Owing', val:Math.max(0,v.rent||0), sub:v.rent<0?fmt(Math.abs(v.rent||0))+' credit':null, color:v.rent>0?'var(--danger)':'var(--success)'},
      {lbl:'Arrangement', val:Math.max(0,v.arrangement||0), color:v.arrangement>0?'var(--danger)':'var(--success)'},
      {lbl:'Loans', val:loanBal, color:loanBal>0?'var(--danger)':'var(--success)'},
      {lbl:'Total Owing', val:grand, color:'var(--yellow)', dark:true},
    ].map(function(tile){
      return '<div style="background:'+(tile.dark?'var(--dark)':'var(--surface)')+';border:1px solid var(--border);border-radius:10px;padding:12px 14px;text-align:center;">'+
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:'+(tile.dark?'#888':'var(--muted)')+';margin-bottom:4px;">'+tile.lbl+'</div>'+
        '<div style="font-size:20px;font-weight:700;color:'+tile.color+';">'+fmt(tile.val)+'</div>'+
        (tile.sub?'<div style="font-size:11px;color:var(--success);">'+tile.sub+'</div>':'')+
      '</div>';
    }).join('')+
  '</div>';

  // Quick-action strip
  var _qa = document.getElementById('stmt-quick-actions');
  if (_qa) {
    var _sid = (tid||'').replace(/'/g,"\\'");
    _qa.innerHTML =
      '<div style="display:flex;gap:7px;flex-wrap:wrap;">'+
        '<button class="btn btn-primary btn-sm" onclick="openPaymentForTenant(\''+_sid+'\')">&#128179; Record Payment</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="openInvoiceForTenant(\''+_sid+'\')">&#128196; Create Invoice</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="openNewArrForTenant(\''+_sid+'\')">&#128203; Arrangement</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="openNewLoanForTenant(\''+_sid+'\')">&#128176; New Loan</button>'+
      '</div>';
    _qa.style.display = '';
  }

  // Reset filter buttons
  document.querySelectorAll('.stmt-filter-btn').forEach(function(b){
    b.className = 'pill pill-gray stmt-filter-btn';
  });
  var activeBtn = document.querySelector('.stmt-filter-btn[data-filter="all"]');
  if (activeBtn) activeBtn.className = 'pill pill-blue stmt-filter-btn active';

  renderStatementEntries();
}

function setStmtFilter(filter, btn) {
  _stmtFilter = filter;
  document.querySelectorAll('.stmt-filter-btn').forEach(function(b){
    b.className = 'pill pill-gray stmt-filter-btn';
  });
  if (btn) btn.className = 'pill pill-blue stmt-filter-btn active';
  renderStatementEntries();
}

function renderStatementEntries() {
  var tid = _stmtTid;
  if (!tid) return;
  var d = getData();
  var search = ((document.getElementById('stmt-search')||{}).value||'').toLowerCase();

  // Collect all entries across all three ledgers
  var entries = [];

  // Rent ledger
  d.rentLedger.filter(function(r){return r.tenantId===tid;}).forEach(function(r){
    entries.push({
      date:r.date, ledger:'rent', ledgerLabel:'\uD83C\uDFE0 Rent',
      desc:r.desc, charge:r.charge||0, payment:r.payment||0,
      method:r.method, status:r.status, id:r.id,
      type:r.type, ref:r.ref, raw:r
    });
  });

  // Arrangements
  var arrs = d.arrangements.filter(function(a){return a.tenantId===tid;});
  arrs.forEach(function(a){
    // Arrangement header entry
    entries.push({
      date:a.startDate||a.date||'\u2014', ledger:'arrangement', ledgerLabel:'\uD83D\uDCCB Arrangement',
      desc:'Arrangement Created: '+a.ref+' ('+fmt(a.totalOwing)+')',
      charge:a.totalOwing, payment:0, method:'', status:a.status,
      id:a.id, type:'arrangement-header', ref:a.ref, raw:a
    });
    // Payments
    d.arrPayments.filter(function(p){return p.arrId===a.id;}).forEach(function(p){
      entries.push({
        date:p.date, ledger:'arrangement', ledgerLabel:'\uD83D\uDCCB Arrangement',
        desc:'Arrangement Payment \u2014 '+a.ref,
        charge:0, payment:p.amount, method:p.method, status:p.status||'posted',
        id:p.id, type:'arr-payment', ref:a.ref, raw:p, arrId:a.id
      });
    });
  });

  // Loans
  d.loanList.filter(function(l){return l.tenantId===tid;}).forEach(function(l){
    var typeLabel = {renovation:'Renovation Loan','rent-to-own':'Rent-to-Own',utilities:'Utilities',other:'Loan'}[l.type]||'Loan';
    entries.push({
      date:l.startDate||l.date||'\u2014', ledger:'loans', ledgerLabel:'\uD83D\uDCB0 Loans',
      desc:typeLabel+' Approved \u2014 '+fmt(l.principal),
      charge:l.principal, payment:0, method:'', status:l.status,
      id:l.id, type:'loan-header', ref:'', raw:l
    });
    d.loanPayments.filter(function(p){return p.loanId===l.id;}).forEach(function(p){
      entries.push({
        date:p.date, ledger:'loans', ledgerLabel:'\uD83D\uDCB0 Loans',
        desc:typeLabel+' Payment',
        charge:0, payment:p.amount, method:p.method, status:p.status||'posted',
        id:p.id, type:'loan-payment', ref:'', raw:p, loanId:l.id
      });
    });
  });

  // Sort by date desc
  entries.sort(function(a,b){ return b.date.localeCompare(a.date); });

  // Filter by ledger
  if (_stmtFilter !== 'all') {
    entries = entries.filter(function(e){ return e.ledger === _stmtFilter; });
  }

  // Search
  if (search) {
    entries = entries.filter(function(e){
      return (e.desc+e.date+e.ref+e.method+e.status).toLowerCase().includes(search);
    });
  }

  // Running balance per ledger
  var rentBal = 0;
  var rentEntries = d.rentLedger.filter(function(r){return r.tenantId===tid&&r.status!=='reversed';})
    .sort(function(a,b){return a.date.localeCompare(b.date);});
  var rentBalMap = {};
  rentEntries.forEach(function(r){
    rentBal += (r.charge||0) - (r.payment||0);
    rentBalMap[r.id] = rentBal;
  });

  // Render rows
  var ledgerColors = {rent:'#3b82f6',arrangement:'#f59e0b',loans:'#8b5cf6'};
  var tbody = document.getElementById('stmt-body');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted);">No entries found.</td></tr>';
    return;
  }

  window._stmtEntryCache = {};
  tbody.innerHTML = entries.map(function(e){
    window._stmtEntryCache[e.id] = e;
    var isReversed = e.status==='reversed';
    var bal = e.ledger==='rent' && rentBalMap[e.id] !== undefined ? fmt(rentBalMap[e.id]) : '\u2014';
    var balColor = e.ledger==='rent' && rentBalMap[e.id] > 0 ? 'color:var(--danger)' : 'color:var(--success)';
    var canClick = (e.type==='invoice'||e.type==='payment'||e.type==='arr-payment'||e.type==='loan-payment');
    var canReverse = !isReversed && (e.type==='payment'||e.type==='arr-payment'||e.type==='loan-payment');
    var reverseBtn = '';
    if (canReverse) {
      if (e.type==='payment') reverseBtn = '<button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--danger);" onclick="stmtReverse(\'rent\',\''+e.id+'\')">&#8634;</button>';
      if (e.type==='arr-payment') reverseBtn = '<button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--danger);" onclick="stmtReverse(\'arr\',\''+e.id+'\')">&#8634;</button>';
      if (e.type==='loan-payment') reverseBtn = '<button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--danger);" onclick="stmtReverse(\'loan\',\''+e.id+'\')">&#8634;</button>';
    }
    return '<tr style="'+(isReversed?'opacity:.4;text-decoration:line-through;':'')+(canClick?'cursor:pointer;':'')+'" '+
      (canClick ? 'onclick="stmtOpenEntry(\''+e.id+'\')" title="Click to view voucher"' : '')+'>'+
      '<td style="white-space:nowrap;">'+e.date+'</td>'+
      '<td><span style="font-size:11px;background:'+ledgerColors[e.ledger]+'22;color:'+ledgerColors[e.ledger]+';padding:2px 7px;border-radius:10px;font-weight:600;">'+e.ledgerLabel+'</span></td>'+
      '<td style="max-width:220px;white-space:normal;font-size:12px;">'+e.desc+(e.ref?' <span style="color:var(--muted);font-size:10px;">'+e.ref+'</span>':'')+' </td>'+
      '<td>'+(e.charge>0?'<span class="amt-debit">'+fmt(e.charge)+'</span>':'\u2014')+'</td>'+
      '<td>'+(e.payment>0?'<span class="amt-credit">'+fmt(e.payment)+'</span>':'\u2014')+'</td>'+
      '<td style="'+balColor+';">'+bal+'</td>'+
      '<td style="font-size:12px;">'+methodLabel(e.method)+'</td>'+
      '<td>'+statusPill(e.status)+'</td>'+
      '<td style="white-space:nowrap;">'+
        (canClick?'<span style="font-size:11px;color:var(--muted);">&#128203;</span>':'')+
        reverseBtn+
      '</td>'+
    '</tr>';
  }).join('');
}

function stmtOpenEntry(eid) {
  var e = window._stmtEntryCache && window._stmtEntryCache[eid];
  if (!e) { if (typeof toast === 'function') toast('Entry not found.'); return; }
  // Open the appropriate voucher/invoice viewer
  if (e.type === 'invoice') {
    var cacheKey = 'inv_'+e.id;
    _invoiceCache[cacheKey] = {
      date:e.date, tenantId:_stmtTid, ledger:'rent', desc:e.desc,
      charge:e.charge, payment:0, method:'', status:e.status,
      id:e.id, ref:e.ref, invoiceBalance:e.charge, payments:[]
    };
    // Match payments for this invoice
    var matched = matchInvoicesToPayments(_stmtTid, getData());
    var ib = matched.find(function(x){return x.inv.id===e.id;});
    if (ib) {
      _invoiceCache[cacheKey].invoiceBalance = ib.remaining;
      _invoiceCache[cacheKey].payments = ib.payments;
      _invoiceCache[cacheKey].status = ib.remaining<=0.005?'paid':ib.payments.length?'partial':'unpaid';
    }
    openInvoiceById(cacheKey);
  } else {
    // Open payment voucher
    openVoucher({
      date:e.date, tenantId:_stmtTid, ledger:e.ledger,
      desc:e.desc, charge:e.charge||0, payment:e.payment||0,
      method:e.method, status:e.status, id:e.id,
      ref:e.ref||''
    });
  }
}

function stmtReverse(type, entryId) {
  showConfirm('Reverse Entry', 'Reverse this entry? A reversal will be posted to the ledger.', function() {
    var d = getData();
    if (type==='rent') {
      var r = d.rentLedger.find(function(x){return x.id===entryId;});
      if (r) { r.status='reversed'; auditLog('update','payment',entryId,'Reversed rent entry',{status:'posted'},{status:'reversed'}); }
    } else if (type==='arr') {
      var p = d.arrPayments.find(function(x){return x.id===entryId;});
      if (p) { p.status='reversed'; auditLog('update','arrPayment',entryId,'Reversed arrangement payment',{status:'posted'},{status:'reversed'}); }
    } else if (type==='loan') {
      var lp = d.loanPayments.find(function(x){return x.id===entryId;});
      if (lp) { lp.status='reversed'; auditLog('update','loanPayment',entryId,'Reversed loan payment',{status:'posted'},{status:'reversed'}); }
    }
    saveData(d);
    renderStatementEntries();
    renderDashboard();
  });
}

function printTenantStatement() {
  var tid = _stmtTid;
  var t   = getTenant(tid);
  if (!t) return;
  var d       = getData();
  var totals  = calcAllTotals(d);
  var v       = totals[tid] || {};
  var nc      = window.NATION_CONFIG || {};
  var today   = new Date();
  var monthYM = today.toISOString().slice(0, 7);
  var monthLabel  = today.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  var generatedOn = today.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  var logoSrc    = sessionStorage.getItem('clfn_logo_cache') || window.CLFN_LOGO_DATA_URL || '';
  var nationName = nc.display_name || nc.short_name || '';
  var nationAddr = nc.mailing_address || '';
  var nationPhone = nc.phone || '';
  var nationEmail = nc.email || '';

  var tenantAddr = '';
  if (t.mailingAddress) {
    tenantAddr = t.mailingAddress;
  } else {
    var addrParts = [];
    if (t.street) addrParts.push(t.street);
    var cityLine = [t.community, t.province, t.postalCode].filter(Boolean).join('  ');
    if (cityLine) addrParts.push(cityLine);
    tenantAddr = addrParts.join('\n');
  }

  var rentOwing = Math.max(0, v.rent || 0);
  var arrOwing  = Math.max(0, v.arrangement || 0);
  var approvedLoans = (d.loanList || []).filter(function(l){ return l.tenantId === tid && l.status === 'approved'; });
  var loanRows = approvedLoans.map(function(l) {
    var paid = (d.loanPayments || []).filter(function(p){ return p.loanId === l.id && p.status !== 'reversed'; })
      .reduce(function(s, p){ return s + p.amount; }, 0);
    return { label: (l.type || 'Loan'), balance: Math.max(0, (l.principal || 0) - paid) };
  });
  var loanTotal  = loanRows.reduce(function(s, r){ return s + r.balance; }, 0);
  var grandTotal = rentOwing + arrOwing + loanTotal;

  var outstandingCharges = (d.rentLedger || []).filter(function(r) {
    return r.tenantId === tid && (r.charge || 0) > 0
      && r.status !== 'reversed' && r.status !== 'paid';
  }).slice().sort(function(a, b){ return (a.date || '').localeCompare(b.date || ''); });
  var chargeTotal = outstandingCharges.reduce(function(s, r){ return s + (r.charge || 0); }, 0);

  var monthPayments = [];
  (d.rentLedger || []).filter(function(r){
    return r.tenantId === tid && (r.payment || 0) > 0
      && r.status !== 'reversed' && (r.date || '').slice(0, 7) === monthYM;
  }).forEach(function(r){
    monthPayments.push({ date: r.date, ledger: 'Rent', desc: r.desc || 'Rent Payment', method: r.method || '', amount: r.payment || 0 });
  });
  (d.arrPayments || []).filter(function(p){
    var arr = (d.arrangements || []).find(function(a){ return a.id === p.arrId; });
    return arr && arr.tenantId === tid && p.status !== 'reversed' && (p.date || '').slice(0, 7) === monthYM;
  }).forEach(function(p){
    var arr = (d.arrangements || []).find(function(a){ return a.id === p.arrId; });
    monthPayments.push({ date: p.date, ledger: 'Arrangement', desc: 'Arrangement Payment' + (arr && arr.ref ? ' — ' + arr.ref : ''), method: p.method || '', amount: p.amount || 0 });
  });
  (d.loanPayments || []).filter(function(p){
    var loan = (d.loanList || []).find(function(l){ return l.id === p.loanId; });
    return loan && loan.tenantId === tid && p.status !== 'reversed' && (p.date || '').slice(0, 7) === monthYM;
  }).forEach(function(p){
    var loan = (d.loanList || []).find(function(l){ return l.id === p.loanId; });
    monthPayments.push({ date: p.date, ledger: 'Loan', desc: 'Loan Payment' + (loan && loan.type ? ' — ' + loan.type : ''), method: p.method || '', amount: p.amount || 0 });
  });
  monthPayments.sort(function(a, b){ return (a.date || '').localeCompare(b.date || ''); });
  var paymentTotal = monthPayments.reduce(function(s, p){ return s + p.amount; }, 0);

  var CSS = [
    '@page{size:letter;margin:38mm 16mm 22mm;}',
    '@page{@bottom-left{content:"CONFIDENTIAL";font-size:9px;color:#888;}@bottom-right{content:"Page " counter(page);font-size:9px;color:#888;}}',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0;padding:0;}',
    '.pg-hdr{position:fixed;top:0;left:0;right:0;background:#fff;border-bottom:2px solid #F8E41A;padding:8px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}',
    '.pg-hdr-logo{height:44px;width:auto;}',
    '.pg-hdr-nation{font-size:11px;line-height:1.5;color:#666;}',
    '.pg-hdr-nation strong{font-size:11px;color:#111;display:block;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}',
    '.pg-hdr-title{text-align:right;}',
    '.pg-hdr-title h1{font-size:13px;font-weight:700;color:#111;margin:0 0 2px;}',
    '.pg-hdr-title .gen-date{font-size:9px;color:#888;}',
    '.content{padding:0;}',
    '.section{break-before:page;}',
    '.section:first-child{break-before:auto;}',
    '.section-hdr{color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:12px 0 3px;margin:0;border-bottom:1.5px solid #F8E41A;}',
    '.tenant-block{padding:12px 0 14px;}',
    '.tenant-name{font-size:15px;font-weight:700;margin:0 0 2px;}',
    '.tenant-meta{font-size:11px;color:#666;}',
    '.tenant-addr{font-size:11px;color:#444;margin-top:6px;white-space:pre-line;}',
    'table{width:100%;border-collapse:collapse;}',
    'th{padding:6px 10px;text-align:left;font-size:11px;font-weight:700;border-bottom:2px solid #999;}',
    'td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11.5px;vertical-align:middle;}',
    '.r{text-align:right;}',
    '.red{color:#dc2626;font-weight:700;}',
    '.green{color:#16a34a;font-weight:700;}',
    '.muted{color:#888;}',
    '.sum-row td{background:#f9f9f9;font-weight:700;border-top:2px solid #bbb;}',
    '.grand-row td{background:#111;color:#F8E41A;-webkit-print-color-adjust:exact;color-adjust:exact;font-weight:700;font-size:13px;}',
    '.empty{padding:12px 10px;color:#999;font-style:italic;border-bottom:1px solid #eee;}',
    '.pill{background:#e0f2fe;color:#0369a1;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700;}',
    '@media print{.no-print{display:none!important;}}',
  ].join('');

  var logoTag = logoSrc ? '<img src="' + logoSrc + '" class="pg-hdr-logo" alt="">' : '';
  var nch = '<strong>' + (nationName || 'Housing') + '</strong>';
  if (nationAddr) nch += '<br>' + nationAddr;
  if (nationPhone) nch += '<br>' + nationPhone;
  if (nationEmail) nch += '  &bull;  ' + nationEmail;

  var header = '<div class="pg-hdr">'
    + '<div style="display:flex;align-items:center;gap:14px;">' + logoTag
    + '<div class="pg-hdr-nation">' + nch + '</div></div>'
    + '<div class="pg-hdr-title"><h1>Statement of Account</h1>'
    + '<div class="gen-date">Generated: ' + generatedOn + '</div></div></div>';

  var addrHtml = tenantAddr
    ? '<div class="tenant-addr">' + tenantAddr.replace(/\n/g, '<br>') + '</div>' : '';

  function tenantBlock(subtitle) {
    return '<div class="tenant-block">'
      + '<div class="tenant-name">' + tenantName(t) + '</div>'
      + '<div class="tenant-meta">' + (t.unit || '') + (t.unit && t.type ? '  &middot;  ' : '') + (t.type || '').replace(/-/g, ' ') + '</div>'
      + (subtitle ? '<div class="tenant-meta" style="margin-top:2px;">' + subtitle + '</div>' : '')
      + addrHtml + '</div>';
  }

  function srow(lbl, val, cls) {
    return '<tr><td>' + lbl + '</td><td class="r ' + (cls || '') + '">' + val + '</td></tr>';
  }

  var summaryRows = '';
  summaryRows += srow('Monthly Rent', fmt(t.rent || 0));
  summaryRows += srow('Rent Outstanding', fmt(rentOwing), rentOwing > 0 ? 'red' : '');
  if (arrOwing > 0 || (d.arrangements || []).some(function(a){ return a.tenantId === tid; }))
    summaryRows += srow('Arrangement Balance', fmt(arrOwing), arrOwing > 0 ? 'red' : '');
  loanRows.forEach(function(lr) {
    summaryRows += srow('Loan — ' + lr.label, fmt(lr.balance), lr.balance > 0 ? 'red' : '');
  });
  summaryRows += '<tr class="grand-row"><td>Total Owing</td><td class="r">' + fmt(grandTotal) + '</td></tr>';

  var chargeRowsHtml = outstandingCharges.length
    ? outstandingCharges.map(function(r) {
        return '<tr><td class="muted">' + (r.date || '') + '</td>'
          + '<td>' + (r.desc || '') + '</td>'
          + '<td class="r red">' + fmt(r.charge || 0) + '</td>'
          + '<td class="muted">' + (r.ref || '—') + '</td>'
          + '<td>' + (r.status || 'unpaid') + '</td></tr>';
      }).join('')
      + '<tr class="sum-row"><td colspan="2">Total Outstanding Charges</td>'
      + '<td class="r red">' + fmt(chargeTotal) + '</td><td colspan="2"></td></tr>'
    : '<tr><td colspan="5" class="empty">No outstanding charges.</td></tr>';

  var payRowsHtml = monthPayments.length
    ? monthPayments.map(function(p) {
        return '<tr><td class="muted">' + (p.date || '') + '</td>'
          + '<td><span class="pill">' + p.ledger + '</span></td>'
          + '<td>' + (p.desc || '') + '</td>'
          + '<td class="muted">' + (p.method || '') + '</td>'
          + '<td class="r green">' + fmt(p.amount) + '</td></tr>';
      }).join('')
      + '<tr class="sum-row"><td colspan="3">Total Payments — ' + monthLabel + '</td>'
      + '<td></td><td class="r green">' + fmt(paymentTotal) + '</td></tr>'
    : '<tr><td colspan="5" class="empty">No payments recorded for ' + monthLabel + '.</td></tr>';

  var html = '<!DOCTYPE html><html><head>'
    + '<meta charset="UTF-8">'
    + '<title>Statement — ' + tenantName(t) + '</title>'
    + '<style>' + CSS + '</style>'
    + '</head><body>' + header
    + '<div class="content">'
    + '<div class="section">'
    + tenantBlock('As of ' + generatedOn)
    + '<div class="section-hdr">Account Summary</div>'
    + '<table><tbody>' + summaryRows + '</tbody></table>'
    + '</div>'
    + '<div class="section">'
    + tenantBlock('Outstanding Invoices &amp; Charges')
    + '<div class="section-hdr">Outstanding Invoices &amp; Charges</div>'
    + '<table><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th>Reference</th><th>Status</th></tr></thead>'
    + '<tbody>' + chargeRowsHtml + '</tbody></table>'
    + '</div>'
    + '<div class="section">'
    + tenantBlock('Payments — ' + monthLabel)
    + '<div class="section-hdr">Payments — ' + monthLabel + '</div>'
    + '<table><thead><tr><th>Date</th><th>Ledger</th><th>Description</th><th>Method</th><th class="r">Amount</th></tr></thead>'
    + '<tbody>' + payRowsHtml + '</tbody></table>'
    + '</div>'
    + '</div>'
    + '<div style="margin-top:24px;text-align:center;" class="no-print">'
    + '<button onclick="window.print()" style="background:#111;color:#F8E41A;border:none;padding:10px 28px;font-size:13px;font-weight:700;border-radius:6px;cursor:pointer;">&#128424; Print / Save PDF</button>'
    + '</div>'
    + '</body></html>';

  var w = window.open('', '_blank', 'width=920,height=780');
  if (!w) { toast('Print popup blocked. Please allow popups for this site.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(function(){ w.print(); }, 400);
}


function openNewArrForTenant(tid) {
  openModal('modalNewArrangement');
  setTimeout(function(){
    var s = document.getElementById('na-tenant'); if(s) s.value = tid;
  }, 60);
}

function openArrPaymentForTenant(arrId) {
  currentArrId = arrId;
  var d = getData();
  var arr = d.arrangements.find(function(a){return a.id===arrId;});
  var t = arr ? getTenant(arr.tenantId) : null;
  var paid = d.arrPayments.filter(function(p){return p.arrId===arrId;}).reduce(function(s,p){return s+p.amount;},0);
  var remaining = arr ? Math.max(0,arr.totalOwing-paid) : 0;
  var infoEl = document.getElementById('arrPaymentInfo');
  if (infoEl) {
    infoEl.style.display = 'flex';
    infoEl.innerHTML = '<strong>'+(t?tenantName(t):'')+'</strong> &nbsp;&middot;&nbsp; '+arr.ref+' &nbsp;&middot;&nbsp; Remaining: <strong>'+fmt(remaining)+'</strong>';
  }
  document.getElementById('ap-date').value = today();
  document.getElementById('ap-amount').value = arr ? arr.monthlyPayment.toFixed(2) : '';
  // Populate ap-tenant select
  populateModalSelects('modalArrPayment');
  setTimeout(function(){
    var ts = document.getElementById('ap-tenant'); if(ts && arr) ts.value = arr.tenantId;
    var as = document.getElementById('ap-arr-select');
    if (as) { as.innerHTML = '<option value="'+arrId+'">'+arr.ref+'</option>'; as.value = arrId; }
    if (t && t.autoPay) { var m = document.getElementById('ap-method'); if(m) m.value='auto'; }
  }, 60);
  openModal('modalArrPayment');
}

function openNewLoanForTenant(tid) {
  openModal('modalNewLoan');
  setTimeout(function(){
    var s = document.getElementById('ln-tenant'); if(s) s.value = tid;
  }, 60);
}

function openLoanPaymentForTenant(loanId) {
  var d = getData();
  var ln = d.loanList.find(function(l){return l.id===loanId;});
  var t = ln ? getTenant(ln.tenantId) : null;
  document.getElementById('lpay-loan').innerHTML = '<option value="'+loanId+'">'+(t?tenantName(t):'')+' \u2014 '+(ln?ln.type:'')+'</option>';
  document.getElementById('lpay-date').value = today();
  if (ln) document.getElementById('lpay-amount').value = ln.payment.toFixed(2);
  if (t && t.autoPay) document.getElementById('lpay-method').value = 'auto';
  openModal('modalLoanPayment');
}
