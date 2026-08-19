function showAutoEngineModal() {
  var now = today();
  var defaultMonth = now.slice(0,7);
  var modal = document.getElementById('modalAutoEngine');
  if (modal) { openModal('modalAutoEngine'); return; }

  // Build modal dynamically
  var mo = document.createElement('div');
  mo.className = 'modal-ov';
  mo.id = 'modalAutoEngine';
  mo.innerHTML =
    '<div class="modal modal-lg">'+
    '<div class="modal-hdr"><div><h2>&#9654; Auto-Invoice &amp; Payment Engine</h2><p>Generate invoices and post auto-payments in bulk</p></div>'+
    '<button class="modal-close" onclick="closeModal(\'modalAutoEngine\')">&#x2715;</button></div>'+
    '<div class="modal-body">'+
      '<div class="ibox yellow">&#9888; <strong>Review carefully before running.</strong> This posts entries for all eligible tenants. Use Dry Run first to preview.</div>'+
      '<div class="fg c2" style="gap:14px;margin-top:16px;">'+
        '<div class="f"><label>Billing Month</label><input id="ae-month" type="month" value="'+defaultMonth+'"/></div>'+
        '<div class="f"><label>Mode</label>'+
          '<select id="ae-mode"><option value="dry">Dry Run (preview only)</option><option value="live">Live Run (posts entries)</option></select>'+
        '</div>'+
      '</div>'+
      '<div id="ae-results" style="margin-top:16px;"></div>'+
    '</div>'+
    '<div class="modal-footer">'+
      '<button class="btn btn-ghost" onclick="closeModal(\'modalAutoEngine\')">Close</button>'+
      '<button class="btn btn-ghost btn-sm" onclick="runEngineFromModal()">&#128269; Preview Run</button>'+
      '<button class="btn btn-primary" onclick="if(document.getElementById(\'ae-mode\').value===\'live\'&&confirm(\'Post entries for all eligible tenants?\'))runEngineFromModal();">&#9654; Run Engine</button>'+
    '</div></div>';
  document.body.appendChild(mo);
  mo.style.display = '';
  mo.classList.add('on');
}

function showRunStatementsModal() {
  var existing = document.getElementById('modalRunStatements');
  if (existing) document.body.removeChild(existing);

  var d = getData();
  var totals = calcAllTotals(d);
  var tenants = (d.tenants || []).filter(function(t){
    var st = t.status || 'active';
    return t.active !== false && st !== 'former' && st !== 'deceased';
  }).slice().sort(function(a,b){ return tenantName(a).localeCompare(tenantName(b)); });

  var rows = tenants.map(function(t){
    var v = totals[t.id] || {};
    var bal = (v.rent||0) + (v.loan||0) + (v.arrangement||0);
    var initials = ((t.first||'')[0]||'') + ((t.last||'')[0]||'');
    var searchVal = (tenantName(t) + ' ' + (t.unit||'')).toLowerCase();
    return '<label data-rs-search="'+escapeHtml(searchVal)+'" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);">'+
      '<input type="checkbox" class="rs-chk" data-tid="'+t.id+'" checked style="width:15px;height:15px;cursor:pointer;flex-shrink:0;" onchange="_rsUpdateCount()"/>'+
      '<div class="std-row-avatar" style="flex-shrink:0;">'+(initials||'?')+'</div>'+
      '<div style="flex:1;min-width:0;">'+
        '<div style="font-size:13px;font-weight:600;">'+tenantNameHtml(t)+'</div>'+
        '<div style="font-size:11px;color:var(--muted);">'+(t.unit||'No unit')+'</div>'+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0;font-size:13px;">'+
        (bal > 0 ? '<span class="amt-debit">'+fmt(bal)+'</span>' : '<span style="color:var(--success);font-weight:600;">Nil</span>')+
      '</div>'+
    '</label>';
  }).join('');

  var mo = document.createElement('div');
  mo.className = 'modal-ov';
  mo.id = 'modalRunStatements';
  mo.innerHTML =
    '<div class="modal modal-lg" style="max-width:560px;">'+
    '<div class="modal-hdr">'+
      '<div><h2>&#128438; Running Statements</h2>'+
      '<p>Select tenants to include in the batch print</p></div>'+
      '<button class="modal-close" onclick="closeModal(\'modalRunStatements\')">&#x2715;</button>'+
    '</div>'+
    '<div class="modal-body" style="padding:0;">'+
      '<div style="padding:10px 14px;border-bottom:1px solid var(--border);">'+
        '<input id="rs-search" type="text" placeholder="🔍 Search by name or unit…" oninput="_rsSearch(this.value)" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;outline:none;"/>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--border);">'+
        '<button class="btn btn-ghost btn-sm" onclick="_rsCheckAll(true)">Check All</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="_rsCheckAll(false)">Uncheck All</button>'+
        '<span id="rs-count" style="margin-left:auto;font-size:12px;color:var(--muted);">'+tenants.length+' of '+tenants.length+' selected</span>'+
      '</div>'+
      '<div id="rs-list" style="max-height:340px;overflow-y:auto;">'+
        (rows || '<div style="padding:30px;text-align:center;color:var(--muted);">No active tenants found.</div>')+
      '</div>'+
    '</div>'+
    '<div class="modal-footer">'+
      '<button class="btn btn-ghost" onclick="closeModal(\'modalRunStatements\')">Cancel</button>'+
      '<button class="btn btn-primary" onclick="finBatchStatementsDownload()">&#11015;&#65039; Download PDF</button>'+
    '</div>'+
    '</div>';

  document.body.appendChild(mo);
  mo.style.display = '';
  mo.classList.add('on');
}

function _rsSearch(q) {
  var labels = document.querySelectorAll('#rs-list label[data-rs-search]');
  var ql = (q || '').toLowerCase().trim();
  for (var i = 0; i < labels.length; i++) {
    labels[i].style.display = (!ql || labels[i].getAttribute('data-rs-search').indexOf(ql) >= 0) ? 'flex' : 'none';
  }
  _rsUpdateCount();
}

function _rsCheckAll(checked) {
  var labels = document.querySelectorAll('#rs-list label[data-rs-search]');
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].style.display === 'none') continue;
    var chk = labels[i].querySelector('.rs-chk');
    if (chk) chk.checked = checked;
  }
  _rsUpdateCount();
}

function _rsUpdateCount() {
  var labels = document.querySelectorAll('#rs-list label[data-rs-search]');
  var total = 0, selected = 0;
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].style.display === 'none') continue;
    total++;
    var chk = labels[i].querySelector('.rs-chk');
    if (chk && chk.checked) selected++;
  }
  var el = document.getElementById('rs-count');
  if (el) el.textContent = selected + ' of ' + total + ' selected';
}

function printBatchStatements() {
  var checked = document.querySelectorAll('.rs-chk:checked');
  if (!checked.length) { toast('No tenants selected.'); return; }

  var tids = [];
  for (var i=0; i<checked.length; i++) tids.push(checked[i].getAttribute('data-tid'));

  var d        = getData();
  var totals   = calcAllTotals(d);
  var nc       = window.NATION_CONFIG || {};
  var today_d  = new Date();
  var printDate = today_d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  var allTxns  = getAllTransactions();

  var logoSrc    = sessionStorage.getItem('clfn_logo_cache') || window.HLH_LOGO_DATA_URL || window.CLFN_LOGO_DATA_URL || '';
  var nationName = nc.display_name || nc.short_name || '';
  var nationAddr = nc.mailing_address || '';
  var nationPhone = nc.phone || '';
  var nationEmail = nc.email || '';

  var CSS = [
    '@page{size:letter;margin:38mm 16mm 22mm;}',
    '@page{@bottom-left{content:"CONFIDENTIAL";font-size:9px;color:#888;}@bottom-right{content:"Page " counter(page);font-size:9px;color:#888;}}',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0;padding:0;}',
    '.pg-hdr{position:fixed;top:0;left:0;right:0;background:#fff;border-bottom:2px solid '+window._themeAccentHex()+';padding:8px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}',
    '.pg-hdr-logo{height:44px;width:auto;}',
    '.pg-hdr-nation{font-size:11px;line-height:1.5;color:#666;}',
    '.pg-hdr-nation strong{font-size:11px;color:#111;display:block;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}',
    '.pg-hdr-title{text-align:right;}',
    '.pg-hdr-title h1{font-size:13px;font-weight:700;color:#111;margin:0 0 2px;}',
    '.pg-hdr-title .gen-date{font-size:9px;color:#888;}',
    '.content{padding:0;}',
    '.stmt{break-before:page;}',
    '.stmt:first-child{break-before:auto;}',
    '.section-hdr{color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:12px 0 3px;margin:0;border-bottom:1.5px solid '+window._themeAccentHex()+';}',
    '.tenant-block{padding:12px 0 14px;}',
    '.tenant-name{font-size:15px;font-weight:700;margin:0 0 2px;}',
    '.tenant-meta{font-size:11px;color:#666;}',
    '.tenant-addr{font-size:11px;color:#444;margin-top:6px;white-space:pre-line;}',
    '.bal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}',
    '.bal-cell{border:1px solid #ddd;border-radius:6px;padding:9px 12px;text-align:center;}',
    '.bal-lbl{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.4px;margin-bottom:4px;}',
    '.bal-val{font-size:17px;font-weight:700;}',
    '.dr{color:#b91c1c;}.cr{color:#15803d;}',
    'table{width:100%;border-collapse:collapse;}',
    'th{padding:6px 10px;text-align:left;font-size:11px;font-weight:700;border-bottom:2px solid #999;}',
    'td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11.5px;vertical-align:middle;}',
    '.r{text-align:right;}',
    '.empty{padding:12px 10px;color:#999;font-style:italic;}',
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
    + '<div class="gen-date">Generated: ' + printDate + '</div></div></div>';

  var body = '';

  for (var j = 0; j < tids.length; j++) {
    var tid = tids[j];
    var t = getTenant(tid);
    if (!t) continue;
    var v        = totals[tid] || {};
    var rentOwe  = v.rent || 0;
    var loanOwe  = v.loan || 0;
    var arrOwe   = v.arrangement || 0;
    var grandTot = rentOwe + loanOwe + arrOwe;

    // Tenant address
    var taddr = '';
    if (t.mailingAddress) {
      taddr = t.mailingAddress;
    } else {
      var tp = [];
      if (t.street) tp.push(t.street);
      var tcity = [t.community, t.province, t.postalCode].filter(Boolean).join('  ');
      if (tcity) tp.push(tcity);
      taddr = tp.join('\n');
    }
    var addrHtml = taddr ? '<div class="tenant-addr">' + taddr.replace(/\n/g, '<br>') + '</div>' : '';

    var entries = allTxns.filter(function(e){ return e.tenantId === tid; })
      .slice().sort(function(a, b){ return (a.date || '').localeCompare(b.date || ''); });

    var tableRows = entries.map(function(r) {
      return '<tr>'
        + '<td class="muted">' + (r.date || '') + '</td>'
        + '<td>' + (r.desc || '&mdash;') + '</td>'
        + '<td style="text-transform:capitalize;">' + (r.ledger || 'rent') + '</td>'
        + '<td class="r">' + (r.charge > 0 ? '<span class="dr">$' + r.charge.toFixed(2) + '</span>' : '&mdash;') + '</td>'
        + '<td class="r">' + (r.payment > 0 ? '<span class="cr">$' + r.payment.toFixed(2) + '</span>' : '&mdash;') + '</td>'
        + '<td>' + (r.method || '&mdash;') + '</td>'
        + '<td>' + (r.status || '&mdash;') + '</td>'
        + '</tr>';
    }).join('');

    body += '<div class="stmt">'
      + '<div class="tenant-block">'
      + '<div class="tenant-name">' + tenantNameHtml(t) + '</div>'
      + '<div class="tenant-meta">' + (t.unit || 'No unit') + (t.type ? '  &middot;  ' + (t.type || '').replace(/-/g, ' ') : '') + '</div>'
      + '<div class="tenant-meta" style="margin-top:2px;">As of ' + printDate + '</div>'
      + addrHtml
      + '</div>'
      + '<div class="section-hdr">Account Summary</div>'
      + '<div class="bal-grid">'
      + '<div class="bal-cell"><div class="bal-lbl">Rent Owing</div><div class="bal-val ' + (rentOwe > 0 ? 'dr' : 'cr') + '">$' + rentOwe.toFixed(2) + '</div></div>'
      + '<div class="bal-cell"><div class="bal-lbl">Arrangements</div><div class="bal-val ' + (arrOwe > 0 ? 'dr' : 'cr') + '">$' + arrOwe.toFixed(2) + '</div></div>'
      + '<div class="bal-cell"><div class="bal-lbl">Loans</div><div class="bal-val ' + (loanOwe > 0 ? 'dr' : 'cr') + '">$' + loanOwe.toFixed(2) + '</div></div>'
      + '<div class="bal-cell"><div class="bal-lbl">Total Owing</div><div class="bal-val ' + (grandTot > 0 ? 'dr' : 'cr') + '">$' + grandTot.toFixed(2) + '</div></div>'
      + '</div>'
      + '<div class="section-hdr">Transaction History</div>'
      + (entries.length
          ? '<table><thead><tr><th>Date</th><th>Description</th><th>Ledger</th><th class="r">Charge</th><th class="r">Payment</th><th>Method</th><th>Status</th></tr></thead><tbody>' + tableRows + '</tbody></table>'
          : '<p class="empty">No transactions on file.</p>')
      + '</div>';
  }

  var printBtn = '<div style="margin-top:24px;text-align:center;" class="no-print">'
    + '<button onclick="window.print()" style="background:#111;color:'+window._themeAccentHex()+';border:none;padding:10px 28px;font-size:13px;font-weight:700;border-radius:6px;cursor:pointer;">&#128424; Print / Save PDF</button>'
    + '</div>';

  var fullHTML = '<!DOCTYPE html><html><head>'
    + '<meta charset="UTF-8">'
    + '<title>Tenant Statements &mdash; ' + printDate + '</title>'
    + '<style>' + CSS + '</style>'
    + '</head><body>'
    + header
    + '<div class="content">' + body + '</div>'
    + printBtn
    + '</body></html>';

  var w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast('Print popup blocked. Please allow popups for this site.'); return; }
  w.document.write(fullHTML);
  w.document.close();
  setTimeout(function(){ w.print(); }, 400);
}

function _renderNoRentList(tenants, isAll) {
  var label = isAll
    ? '&#9888; <strong>' + tenants.length + ' active tenant' + (tenants.length === 1 ? '' : 's') + '</strong> have no monthly rent configured — nothing to post.'
    : '&#9888; <strong>' + tenants.length + ' tenant' + (tenants.length === 1 ? '' : 's') + '</strong> skipped — no monthly rent configured.';
  var rows = tenants.map(function(t) {
    var sid = t.id.replace(/'/g, "\\'");
    return '<tr>'+
      '<td style="font-weight:600;">' + tenantNameHtml(t) + '</td>'+
      '<td style="color:var(--muted);">' + (t.unit || '—') + '</td>'+
      '<td><button class="btn btn-ghost btn-sm" onclick="closeModal(\'modalBatchAccounting\');openFinanceCard(\'' + sid + '\')">Set Rent</button></td>'+
    '</tr>';
  }).join('');
  return '<div style="margin-bottom:12px;border:1px solid var(--warn-amber-border);border-radius:10px;overflow:hidden;">'+
    '<div style="background:var(--warn-amber-bg);padding:10px 14px;font-size:12px;">' + label + '</div>'+
    '<div style="max-height:220px;overflow-y:auto;">'+
      '<table class="tbl" style="margin:0;">'+
        '<thead><tr><th>Tenant</th><th>Address / Unit</th><th></th></tr></thead>'+
        '<tbody>' + rows + '</tbody>'+
      '</table>'+
    '</div>'+
  '</div>';
}

function showBatchAccountingModal() {
  var existing = document.getElementById('modalBatchAccounting');
  if (existing) document.body.removeChild(existing);

  var now = today();
  var defaultMonth = now.slice(0,7);

  var mo = document.createElement('div');
  mo.className = 'modal-ov';
  mo.id = 'modalBatchAccounting';
  mo.innerHTML =
    '<div class="modal modal-lg">'+
    '<div class="modal-hdr">'+
      '<div><h2>&#128202; Batch Accounting</h2><p>Preview and post pending accounting entries in bulk</p></div>'+
      '<button class="modal-close" onclick="closeModal(\'modalBatchAccounting\')">&#x2715;</button>'+
    '</div>'+
    '<div class="modal-body">'+
      '<div class="ibox yellow">&#9888; <strong>Always run Dry Run first.</strong> Live Post will write entries for all tenants in the selected period.</div>'+
      '<div class="fg c2" style="gap:14px;margin-top:16px;">'+
        '<div class="f"><label>Period (Month)</label><input id="ba-month" type="month" value="'+defaultMonth+'"/></div>'+
        '<div class="f"><label>Entry Type</label>'+
          '<select id="ba-type">'+
            '<option value="rent">Rent Charges</option>'+
            '<option value="arrangement">Arrangement Payments Due</option>'+
            '<option value="loan">Loan Payments Due</option>'+
            '<option value="all">All Types</option>'+
          '</select>'+
        '</div>'+
      '</div>'+
      '<div id="ba-results" style="margin-top:16px;"></div>'+
    '</div>'+
    '<div class="modal-footer">'+
      '<button class="btn btn-ghost" onclick="closeModal(\'modalBatchAccounting\')">Close</button>'+
      '<button class="btn btn-ghost" onclick="runBatchAccounting(true)">&#128269; Dry Run</button>'+
      '<button class="btn btn-primary" onclick="if(confirm(\'Post accounting entries for all eligible tenants in this period?\'))runBatchAccounting(false)">&#9654; Live Post</button>'+
    '</div>'+
    '</div>';
  document.body.appendChild(mo);
  mo.style.display = '';
  mo.classList.add('on');
}

function runBatchAccounting(dryRun) {
  var month = (document.getElementById('ba-month')||{}).value || today().slice(0,7);
  var type  = (document.getElementById('ba-type')||{}).value  || 'rent';
  var d = getData();
  var resultsEl = document.getElementById('ba-results');
  if (!resultsEl) return;

  // Determine the date range for the selected month
  var year  = parseInt(month.slice(0,4),10);
  var mon   = parseInt(month.slice(5,7),10);
  var monthStart = month + '-01';
  var monthEndDate = new Date(year, mon, 0);
  var monthEnd = year+'-'+String(mon).padStart(2,'0')+'-'+String(monthEndDate.getDate()).padStart(2,'0');

  var activeTenants = (d.tenants||[]).filter(function(t){
    var st = t.status||'active';
    return t.active !== false && st !== 'former' && st !== 'deceased';
  });

  // Build lookups from housing_units cache (set via Inventory > Edit Unit)
  var _unitRentById = {};   // unit id  → monthlyRent
  var _unitRentByName = {}; // assigned_name (lowercase) → monthlyRent (fallback when current_unit_id absent)
  (window._housingUnits || []).forEach(function(u) {
    var rent = u.data && u.data.monthlyRent != null ? Number(u.data.monthlyRent) : 0;
    if (rent > 0) {
      _unitRentById[u.id] = rent;
      if (u.assigned_name) _unitRentByName[u.assigned_name.toLowerCase().trim()] = rent;
    }
  });

  var rows = [];
  var noRentTenants = [];

  activeTenants.forEach(function(t){
    var tid = t.id;

    // Rent charges
    if (type === 'rent' || type === 'all') {
      // Priority: 1) finance tenant profile, 2) housing unit by ID, 3) by assigned_name, 4) last ledger charge
      var monthlyRent = parseFloat(t.rent || 0);
      if (!monthlyRent && t.currentUnitId) {
        monthlyRent = _unitRentById[t.currentUnitId] || 0;
      }
      if (!monthlyRent) {
        var _nameLc = tenantName(t).toLowerCase().trim();
        monthlyRent = _unitRentByName[_nameLc] || 0;
      }
      if (!monthlyRent) {
        var lastCharge = (d.rentLedger||[])
          .filter(function(r){ return r.tenantId === tid && r.type === 'invoice' && r.charge > 0; })
          .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); })[0];
        monthlyRent = lastCharge ? lastCharge.charge : 0;
      }
      if (monthlyRent > 0) {
        var alreadyCharged = (d.rentLedger||[]).some(function(r){
          return r.tenantId === tid && r.type === 'invoice' && (r.date||'').slice(0,7) === month;
        });
        rows.push({
          tenant: tenantName(t),
          unit: t.unit||'',
          type: 'Rent Charge',
          period: month,
          amount: monthlyRent,
          status: alreadyCharged ? 'already-posted' : 'pending'
        });
      } else {
        noRentTenants.push(t);
      }
    }

    // Arrangement payments due
    if (type === 'arrangement' || type === 'all') {
      (d.arrangements||[]).filter(function(a){
        return a.tenantId===tid && (a.status==='active' || a.status==='approved');
      }).forEach(function(a){
        var due = parseFloat(a.monthlyPayment||0);  // field is monthlyPayment, not monthlyAmount
        if (due > 0) {
          var alreadyPosted = (d.arrPayments||[]).some(function(p){
            return p.arrId===a.id && (p.date||'').slice(0,7) === month;
          });
          rows.push({
            tenant: tenantName(t),
            unit: t.unit||'',
            type: 'Arrangement Due',
            period: month,
            amount: due,
            status: alreadyPosted ? 'already-posted' : 'pending'
          });
        }
      });
    }

    // Loan payments due
    if (type === 'loan' || type === 'all') {
      (d.loanList||[]).filter(function(l){ return l.tenantId===tid && l.status==='approved'; }).forEach(function(l){
        // l.payment is always 0 (client-computed, not persisted) — calculate from loan terms
        var due = parseFloat(calcPaymentAmt(l.principal, l.rate, l.term, l.freq||'monthly')) || 0;
        if (due > 0) {
          var alreadyPosted = (d.loanPayments||[]).some(function(p){
            return p.loanId===l.id && (p.date||'').slice(0,7) === month;
          });
          rows.push({
            tenant: tenantName(t),
            unit: t.unit||'',
            type: 'Loan Payment Due',
            period: month,
            amount: due,
            status: alreadyPosted ? 'already-posted' : 'pending'
          });
        }
      });
    }
  });

  var pending = rows.filter(function(r){ return r.status === 'pending'; });
  var posted  = rows.filter(function(r){ return r.status === 'already-posted'; });
  var totalAmt = pending.reduce(function(s,r){ return s + r.amount; }, 0);

  if (dryRun) {
    // Show preview only
    var html = '<div style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;">'+
      '<div style="background:var(--success-bg);border:1px solid var(--success-border);border-radius:8px;padding:8px 14px;font-size:12px;">'+
        '<strong style="color:var(--success);">'+pending.length+'</strong> entries to post'+
      '</div>'+
      '<div style="background:var(--warn-amber-bg);border:1px solid var(--warn-amber-border);border-radius:8px;padding:8px 14px;font-size:12px;">'+
        '<strong>'+fmt(totalAmt)+'</strong> total amount'+
      '</div>'+
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:12px;">'+
        '<strong>'+posted.length+'</strong> already posted (will be skipped)'+
      '</div>'+
    '</div>';

    // Show missing-rent list if any tenants are unconfigured (all-empty or partial)
    if (noRentTenants.length && (type === 'rent' || type === 'all')) {
      html += _renderNoRentList(noRentTenants, !rows.length);
    }

    if (!rows.length && !noRentTenants.length) {
      if (!activeTenants.length) {
        html += '<div class="ibox" style="color:var(--muted);">No active tenants found in the system.</div>';
      } else {
        html += '<div class="ibox" style="color:var(--muted);">No entries found for the selected type and period.</div>';
      }
    } else if (rows.length && !pending.length) {
      html += '<div class="ibox" style="color:var(--success);">&#10003; All accounting entries for this period are already posted — nothing to do.</div>';
    } else if (pending.length) {
      html += '<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;">'+
        '<table class="tbl">'+
          '<thead><tr>'+
            '<th>Tenant</th><th>Unit</th><th>Type</th><th>Period</th>'+
            '<th style="text-align:right;">Amount</th><th>Action</th>'+
          '</tr></thead>'+
          '<tbody>'+
          pending.map(function(r){
            return '<tr>'+
              '<td style="font-weight:600;">'+r.tenant+'</td>'+
              '<td>'+r.unit+'</td>'+
              '<td>'+r.type+'</td>'+
              '<td>'+r.period+'</td>'+
              '<td style="text-align:right;font-weight:700;color:var(--danger);">'+fmt(r.amount)+'</td>'+
              '<td><span class="pill pill-gray" style="font-size:10px;">Will Post</span></td>'+
            '</tr>';
          }).join('')+
          '</tbody>'+
        '</table>'+
      '</div>';
    }
    resultsEl.innerHTML = html;
    return;
  }

  // Live run — post pending entries
  if (!pending.length) {
    resultsEl.innerHTML = '<div class="ibox" style="color:var(--success);">&#10003; Nothing to post for this period.</div>';
    return;
  }

  var posted2 = 0;
  var now2 = monthStart; // post on first of month
  pending.forEach(function(r){
    var t2 = (d.tenants||[]).find(function(t){ return tenantName(t) === r.tenant && t.unit === r.unit; });
    if (!t2) return;
    if (r.type === 'Rent Charge') {
      var entry = {id:uid(), tenantId:t2.id, date:now2, type:'invoice',
        desc:'Rent charge — '+month, charge:r.amount, payment:0,
        ledger:'rent', method:'', status:'pending', enteredBy:(window.HOUSING_SESSION&&window.HOUSING_SESSION.name)||'Batch'};
      d.rentLedger.push(entry);
      posted2++;
    }
    // Arrangement/Loan due notices are informational — skip auto-posting ledger entries
  });

  if (posted2 > 0) {
    saveData(d);
    toast('Posted '+posted2+' accounting entr'+(posted2===1?'y':'ies')+'.');
  }
  resultsEl.innerHTML = '<div class="ibox" style="color:var(--success);">&#10003; Posted '+posted2+' entr'+(posted2===1?'y':'ies')+'. Refresh the ledger to see changes.</div>';
}

function runEngineFromModal() {
  var month = document.getElementById('ae-month').value;
  var isDry = document.getElementById('ae-mode').value === 'dry';
  var results = runAutoEngine(month, isDry);
  var el = document.getElementById('ae-results');
  var html = '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">'+(isDry?'Preview Results':'Run Results')+' \u2014 '+month+'</div>';

  if (results.invoiced.length) {
    html += '<div style="margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;">&#128196; Invoices '+(isDry?'(would generate)':'Generated')+' ('+results.invoiced.length+')</div>'+
      results.invoiced.map(function(r){return '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">'+
        '<span>'+r.tenant+' &mdash; '+r.unit+'</span><span class="amt-debit">'+fmt(r.amount)+'</span></div>';}).join('')+'</div>';
  }
  if (results.paid.length) {
    html += '<div style="margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;">&#10003; Payments '+(isDry?'(would post)':'Posted')+' ('+results.paid.length+')</div>'+
      results.paid.map(function(r){return '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">'+
        '<span>'+r.tenant+' &mdash; '+r.unit+'<br><span style="color:var(--muted);">'+r.lines.join(' \u00B7 ')+'</span></span><span class="amt-credit">'+fmt(r.total)+'</span></div>';}).join('')+'</div>';
  }
  if (results.skipped.length) {
    html += '<div style="margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px;">&#8212; Skipped ('+results.skipped.length+')</div>'+
      results.skipped.map(function(r){return '<div style="font-size:12px;padding:3px 0;color:var(--muted);">'+r.tenant+' \u2014 '+r.reasons.join(', ')+'</div>';}).join('')+'</div>';
  }
  if (!results.invoiced.length && !results.paid.length) {
    html += '<div class="ibox" style="color:var(--muted);">No eligible tenants found for this period.</div>';
  }
  el.innerHTML = html;
}

