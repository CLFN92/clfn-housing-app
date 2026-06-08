function generateVoucherFor(txnObj) {
  setTimeout(function(){ openVoucher(txnObj); }, 200);
}

function openVoucher(txn) {
  currentVoucherData = txn;
  var tn = getTenant(txn.tenantId);
  var isPayment = txn.payment > 0;
  var denomHtml = '';
  if (txn.denominations) {
    denomHtml = '<div class="voucher-row"><span class="lbl">Denominations</span><span style="font-size:12px;">'+
      Object.entries(txn.denominations).filter(function(kv){return parseFloat(kv[1])>0;})
        .map(function(kv){return kv[0]+' \u00D7 '+kv[1];}).join(', ')+'</span></div>';
  }
  var voucherNum = 'VCH-'+Date.now().toString().slice(-8);
  var ledgerLabels = {rent:'Rent',arrangement:'Payment Arrangement',loan:'Loan',combined:'Rent + Arrangement + Loan',journal:'Journal Entry',overpayment:'Credit / Overpayment'};
  var html = '<div class="voucher">'+
    '<div class="voucher-hdr"><div>'+
      '<div style="font-size:16px;color:#fff;">'+(window.NATION_CONFIG && window.NATION_CONFIG.display_name || "")+'</div>'+
      '<div style="font-size:11px;color:var(--gray);">Housing Finance \u2014 Transaction Voucher</div></div>'+
      '<div style="text-align:right;"><div style="font-size:11px;color:var(--gray);">Voucher #</div>'+
      '<div style="color:var(--yellow);font-weight:700;font-size:13px;">'+voucherNum+'</div></div></div>'+
    '<div class="voucher-body">'+
      '<div class="voucher-row"><span class="lbl">Date</span><span>'+txn.date+'</span></div>'+
      '<div class="voucher-row"><span class="lbl">Tenant</span><span><strong>'+(tn?tenantName(tn):txn.tenantId)+'</strong>'+(tn?' \u2014 '+tn.unit:'')+' </span></div>'+
      '<div class="voucher-row"><span class="lbl">Ledger</span><span>'+(ledgerLabels[txn.ledger]||txn.ledger)+'</span></div>'+
      '<div class="voucher-row"><span class="lbl">Description</span><span>'+txn.desc+'</span></div>'+
      (txn.charge>0?'<div class="voucher-row"><span class="lbl">Charge / Debit</span><span class="txn-type-charge">'+fmt(txn.charge)+'</span></div>':'')+
      (txn.payment>0?'<div class="voucher-row"><span class="lbl">Payment / Credit</span><span class="txn-type-payment">'+fmt(txn.payment)+'</span></div>':'')+
      (txn.allocations&&txn.allocations.length>1?
        '<div class="voucher-row" style="flex-direction:column;align-items:flex-start;gap:6px;"><span class="lbl">Applied To</span>'+
        txn.allocations.map(function(a){
          return '<div style="display:flex;justify-content:space-between;width:100%;font-size:12px;padding:5px 10px;background:var(--bg);border-radius:5px;">'+
            '<span>'+a.label+'</span><strong>'+fmt(a.amount)+'</strong></div>';
        }).join('')+'</div>'
      : '')+
      '<div class="voucher-row"><span class="lbl">Payment Method</span><span>'+methodLabel(txn.method)+'</span></div>'+
      denomHtml+
      '<div class="voucher-row"><span class="lbl">Status</span><span>'+txn.status+'</span></div>'+
      '<div class="voucher-row"><span class="lbl">Generated</span><span>'+new Date().toLocaleString('en-CA')+'</span></div>'+
    '</div>'+
    '<div class="voucher-total">'+
      '<span style="font-size:13px;color:var(--gray);">'+(isPayment?'Payment Received':'Charge Posted')+'</span>'+
      '<div style="font-size:26px;color:var(--yellow);">'+fmt(isPayment?txn.payment:txn.charge)+'</div></div>'+
  '</div>';
  document.getElementById('voucherContent').innerHTML = html;
  document.getElementById('voucher-notes').value = '';
  var voidBtn = document.getElementById('voidInvoiceBtn');
  if (voidBtn) voidBtn.style.display = 'none';
  openModal('modalVoucher');
}


// SigWidget + DocLibrary factories live in shared.js (loaded via <script>
// tag in <head>). See shared.js for the full implementation.
//
// Consumers in this file: initVoucherSigs() uses window.SigWidget;
// showTicDetailTab() uses window.DocLibrary.


// \u2500\u2500 Voucher Signature Pads (using SigWidget.createPair) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// One createPair call handles both pads + the Customer Present toggle.
// Voucher-specific config (CURRENT_USER auto-fill, role-validation copy)
// is passed through opts \u2014 the factory is domain-agnostic.
//
// External API preserved:
//   initVoucherSigs()            called when modalVoucher opens
//   setSigMode('customer'|'internal')  still accepted (legacy terminology)
//   getSigDataURL('auth'|'verif')
//   clearVoucherSig / clearSig
//   lockVoucherSignatures
//   _sigMode     legacy global read by printVoucherWithSigs \u2014 derived getter
var _AUTHORIZING_ROLES = ['housing_manager', 'executive_director'];
window._voucherSig = null;  // the pair controller

function _canAuthorize() {
  return _AUTHORIZING_ROLES.indexOf(_currentRole) >= 0;
}

// Legacy terminology map. The pair controller uses 'yes'|'no'; older code
// in this file (notably printVoucherWithSigs) reads _sigMode as
// 'customer'|'internal'. A getter+setter on window keeps both in sync
// without touching the older code.
Object.defineProperty(window, '_sigMode', {
  get: function(){
    if (!window._voucherSig) return 'customer';
    return window._voucherSig.getMode() === 'yes' ? 'customer' : 'internal';
  },
  configurable: true
});

function _buildVoucherModes() {
  // Build the modes object fresh each time initVoucherSigs runs, so the
  // role check reflects the current user/role at voucher-open time.
  var canAuth = _canAuthorize();
  return {
    yes: {
      yesButtonText: '\u2713 Yes',
      noButtonText:  'No',
      description:   'Customer signs in person alongside employee',
      left: {
        title: '\uD83D\uDC65 Customer / Tenant',
        sub:   'Community member receiving the transaction',
        nameAuto: '',
        nameNote: '',
        nameNoteKind: ''
      },
      right: {
        title: '\uD83D\uDCBC Employee / Staff',
        sub:   'Staff member processing the transaction',
        nameAuto: CURRENT_USER,
        nameNote: '\u2713 Auto-filled from current user',
        nameNoteKind: 'success'
      }
    },
    no: {
      description:   'Internal record only \u2014 no customer present',
      left: {
        title: '\uD83D\uDCBC Employee / Recorder',
        sub:   'Staff member entering the transaction',
        nameAuto: CURRENT_USER,
        nameNote: '\u2713 Auto-filled from current user',
        nameNoteKind: 'success'
      },
      right: {
        title: '\u270D Authorizing Officer',
        sub:   'Housing Manager or ED \u2014 internal countersign',
        nameAuto: canAuth ? CURRENT_USER : '',
        nameNote: canAuth ? '\u2713 Your role qualifies as Authorizing Officer'
                          : '\u26A0 Manager or ED required to countersign',
        nameNoteKind: canAuth ? 'success' : 'warning'
      }
    }
  };
}

function initVoucherSigs() {
  // Clear mount points so stale widgets don't linger between vouchers
  var leftMount     = document.getElementById('sig-auth-mount');
  var rightMount    = document.getElementById('sig-verif-mount');
  var toggleMount   = document.getElementById('sig-presence-mount');
  if (leftMount)   leftMount.innerHTML   = '';
  if (rightMount)  rightMount.innerHTML  = '';
  if (toggleMount) toggleMount.innerHTML = '';
  if (!leftMount || !rightMount || !toggleMount || !window.SigWidget) return;

  window._voucherSig = window.SigWidget.createPair(leftMount, rightMount, {
    toggleMount:    toggleMount,
    toggleLabel:    '\uD83D\uDC64 Customer Present?',
    initialMode:    'yes',
    modes:          _buildVoucherModes(),
    leftTitleEl:    document.getElementById('sig-left-title'),
    leftSubEl:      document.getElementById('sig-left-sub'),
    leftNameInput:  document.getElementById('sig-auth-name'),
    leftNameNote:   document.getElementById('sig-auth-role-note'),
    rightTitleEl:   document.getElementById('sig-right-title'),
    rightSubEl:     document.getElementById('sig-right-sub'),
    rightNameInput: document.getElementById('sig-verif-name'),
    rightNameNote:  document.getElementById('sig-verif-role-note'),
    widgetOpts:     { height: 80 }
  });

  // Poll to reveal the Lock button once both pads are signed
  clearInterval(window._sigPollInterval);
  window._sigPollInterval = setInterval(function(){
    var modal = document.getElementById('modalVoucher');
    if (!modal || !modal.classList.contains('on')) {
      clearInterval(window._sigPollInterval);
      return;
    }
    var lockBtn = document.getElementById('sig-lock-btn');
    if (lockBtn && window._voucherSig) {
      lockBtn.style.display = window._voucherSig.isBothSigned() ? 'block' : 'none';
    }
  }, 400);

  var lockBtn = document.getElementById('sig-lock-btn'); if (lockBtn) lockBtn.style.display='none';
  var lockBadge = document.getElementById('sig-lock-badge'); if (lockBadge) lockBadge.style.display='none';
}

// Legacy setSigMode kept for compatibility \u2014 maps legacy names to pair modes
function setSigMode(mode) {
  if (!window._voucherSig) return;
  window._voucherSig.setMode(mode === 'internal' ? 'no' : 'yes');
}

function lockVoucherSignatures() {
  var pair = window._voucherSig;
  if (!pair || !pair.isBothSigned()) { toast('Both signatures required before locking.'); return; }
  var isInternal = (pair.getMode() === 'no');
  if (isInternal && !_canAuthorize()) {
    toast('\u26A0 Internal mode requires a Manager or ED as Authorizing Officer.'); return;
  }
  var authName  = (document.getElementById('sig-auth-name')||{}).value||'';
  var verifName = (document.getElementById('sig-verif-name')||{}).value||'';
  if (isInternal && authName && verifName && authName.trim().toLowerCase() === verifName.trim().toLowerCase()) {
    toast('\u26A0 Recorder and Authorizing Officer cannot be the same person.'); return;
  }
  pair.lock();
  ['auth','verif'].forEach(function(k){
    var nameEl = document.getElementById('sig-'+k+'-name');
    if (nameEl) nameEl.setAttribute('readonly','readonly');
  });
  var lockBtn=document.getElementById('sig-lock-btn'); if(lockBtn) lockBtn.style.display='none';
  var lockBadge=document.getElementById('sig-lock-badge'); if(lockBadge) lockBadge.style.display='inline-block';
  toast('\u2713 Voucher signatures locked.');
}

function clearVoucherSig(k) {
  var pair = window._voucherSig;
  if (!pair || pair.isLocked()) return;
  if (k === 'auth')  pair.left.clear();
  if (k === 'verif') pair.right.clear();
}

// Kept for backward compat with external call sites
// clearSig(k) for canvas pads is in shared-data.js; finance pair-widget clears via clearVoucherSig(k)

// Returns a PNG data URL for pad 'auth' or 'verif', regardless of method.
// Draw \u2192 the canvas; Type \u2192 italic-rendered name; Wet \u2192 null.
// Preserves legacy signature expected by printVoucherWithSigs/emailVoucher.
function getVoucherSigDataURL(k) {
  var pair = window._voucherSig;
  if (!pair) return null;
  var w = (k === 'auth') ? pair.left : (k === 'verif') ? pair.right : null;
  if (!w) return null;
  var url = w.getDataURL();
  return url || null;
}

function printVoucherWithSigs(){
  var vHtml=document.getElementById('voucherContent').innerHTML;
  var notes=(document.getElementById('voucher-notes')||{}).value||'';
  var isLocked = !!(window._voucherSig && window._voucherSig.isLocked && window._voucherSig.isLocked());
  var lockedNote=isLocked?'<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;font-size:11px;font-weight:700;color:#15803d;margin-bottom:16px;">&#10004; Signatures Locked — This voucher is finalized.</div>':'';

  // Nation branding
  var nc = window.NATION_CONFIG || {};
  var logoSrc    = sessionStorage.getItem('clfn_logo_cache') || window.CLFN_LOGO_DATA_URL || '';
  var nationName = nc.display_name || nc.short_name || '';
  var nationAddr = nc.mailing_address || '';
  var nationPhone = nc.phone || '';
  var nationEmail = nc.email || '';

  // Tenant address for invoice block
  var voucherTenantName = '';
  var voucherTenantAddr = '';
  if (currentVoucherData) {
    var vt = getTenant(currentVoucherData.tenantId);
    if (vt) {
      voucherTenantName = tenantName(vt);
      if (vt.mailingAddress) {
        voucherTenantAddr = vt.mailingAddress;
      } else {
        var vaddrParts = [];
        if (vt.street) vaddrParts.push(vt.street);
        var vcityLine = [vt.community, vt.province, vt.postalCode].filter(Boolean).join('  ');
        if (vcityLine) vaddrParts.push(vcityLine);
        voucherTenantAddr = vaddrParts.join('\n');
      }
    }
  }

  // Voucher reference and date
  var voucherRef = currentVoucherData && currentVoucherData.id
    ? 'VCH-' + currentVoucherData.id.slice(-8).toUpperCase()
    : 'VCH-' + Date.now().toString().slice(-8);
  var voucherDate = (currentVoucherData && currentVoucherData.date) || new Date().toLocaleDateString('en-CA');
  var generatedOn = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  var printCSS = [
    '@page{size:letter;margin:42mm 16mm 22mm;}',
    '@page{@bottom-left{content:"CONFIDENTIAL";font-size:9px;color:var(--gray);}@bottom-right{content:"Page " counter(page);font-size:9px;color:var(--gray);}}',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:0;padding:0;}',
    '.pg-hdr{position:fixed;top:0;left:0;right:0;background:#fff;border-bottom:2px solid #F8E41A;padding:10px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}',
    '.pg-hdr-logo{height:44px;width:auto;}',
    '.pg-hdr-nation{font-size:11px;line-height:1.5;color:#666;}',
    '.pg-hdr-nation strong{font-size:11px;color:#111;display:block;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}',
    '.pg-hdr-title{text-align:right;}',
    '.pg-hdr-title h1{font-size:13px;font-weight:700;color:#111;margin:0 0 2px;}',
    '.pg-hdr-title .gen-date{font-size:9px;color:var(--gray);}',
    '.content{padding:16px 0 0;}',
    '.inv-meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;border:1px solid #ddd;border-radius:6px;padding:12px 16px;margin-bottom:16px;}',
    '.inv-meta-lbl{font-size:10px;color:var(--gray);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;}',
    '.inv-meta-val{font-size:13px;font-weight:700;color:#111;}',
    '.inv-meta-addr{font-size:11px;color:#444;margin-top:4px;white-space:pre-line;}',
    '.voucher-hdr{display:none;}',
    '.voucher{border-radius:0;}',
    '.voucher-body{border:1px solid #ddd;border-top:none;padding:0;}',
    '.voucher-row{display:flex;justify-content:space-between;align-items:center;padding:9px 16px;border-bottom:1px solid #eee;font-size:13px;}',
    '.lbl{color:var(--gray);font-size:12px;}',
    '.voucher-total{background:#111;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;}',
    '.txn-type-charge{color:#ef4444;font-weight:700;}.txn-type-payment{color:#22c55e;font-weight:700;}',
    '.amt-credit{color:#22c55e;font-weight:600;}.amt-debit{color:#ef4444;font-weight:600;}',
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
    + '<div class="pg-hdr-title"><h1>Transaction Voucher</h1>'
    + '<div class="gen-date">Generated: ' + generatedOn + '</div></div></div>';

  var invMeta = '<div class="inv-meta">'
    + '<div>'
    + '<div class="inv-meta-lbl">Voucher Number</div>'
    + '<div class="inv-meta-val">' + voucherRef + '</div>'
    + '<div class="inv-meta-lbl" style="margin-top:10px;">Transaction Date</div>'
    + '<div class="inv-meta-val">' + voucherDate + '</div>'
    + '</div>'
    + '<div>'
    + '<div class="inv-meta-lbl">Billed To</div>'
    + '<div class="inv-meta-val">' + voucherTenantName + '</div>'
    + (voucherTenantAddr ? '<div class="inv-meta-addr">' + voucherTenantAddr.replace(/\n/g, '<br>') + '</div>' : '')
    + '</div>'
    + '</div>';

  var notesBlock = notes
    ? '<div style="margin-top:16px;font-size:12px;"><strong>Notes:</strong> ' + notes + '</div>'
    : '';

  var printBtn = '<div style="margin-top:16px;text-align:center;" class="no-print">'
    + '<button onclick="window.print()" style="background:#111;color:#F8E41A;border:none;padding:10px 28px;font-size:14px;font-weight:700;border-radius:6px;cursor:pointer;">&#128424; Print</button></div>';

  var fullHTML = '<!DOCTYPE html><html><head>'
    + '<meta charset="UTF-8">'
    + '<title>Transaction Voucher</title>'
    + '<style>' + printCSS + '</style>'
    + '</head><body>'
    + header
    + '<div class="content">'
    + lockedNote
    + invMeta
    + vHtml
    + notesBlock
    + printBtn
    + '</div>'
    + '</body></html>';

  try {
    var stale = document.getElementById('_voucherPrintFrame');
    if (stale) stale.parentNode.removeChild(stale);
    var iframe = document.createElement('iframe');
    iframe.id = '_voucherPrintFrame';
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(fullHTML);
    doc.close();
    var printed = false;
    function doPrint() {
      if (printed) return;
      printed = true;
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        _voucherFallbackPopup(fullHTML);
      }
      setTimeout(function(){
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    }
    iframe.onload = doPrint;
    setTimeout(doPrint, 500);
  } catch (err) {
    _voucherFallbackPopup(fullHTML);
  }
}

function _voucherFallbackPopup(fullHTML) {
  var w;
  try { w = window.open('', '_blank', 'width=720,height=900'); } catch (e) { w = null; }
  if (!w) {
    toast('Print popup blocked. Please allow popups for this site and try again.');
    return;
  }
  w.document.open();
  w.document.write(fullHTML);
  w.document.close();
  setTimeout(function(){ try { w.focus(); w.print(); } catch(e) {} }, 400);
}

document.addEventListener('DOMContentLoaded', function() {
  var _origOpenModal2 = openModal;
  openModal = function(id, extra) {
    _origOpenModal2(id, extra);
    if (id === 'modalVoucher') {
      setTimeout(function(){ initVoucherSigs(); }, 100);
    }
  };
});

function emailVoucher() {
  if (!currentVoucherData) return;
  var email = (document.getElementById('voucher-email')||{}).value || 'finance@clfn.ca';
  var notes = (document.getElementById('voucher-notes')||{}).value || '';
  var tn = getTenant(currentVoucherData.tenantId);
  var subject = 'Transaction Voucher \u2014 '+(tn?tenantName(tn):currentVoucherData.tenantId)+' \u2014 '+currentVoucherData.date;
  var body = 'Transaction Voucher\n\nTenant: '+(tn?tenantName(tn):currentVoucherData.tenantId)+
    '\nDate: '+currentVoucherData.date+'\nDescription: '+currentVoucherData.desc+
    (currentVoucherData.charge>0?'\nCharge: '+fmt(currentVoucherData.charge):'')+
    (currentVoucherData.payment>0?'\nPayment: '+fmt(currentVoucherData.payment):'')+
    '\nMethod: '+methodLabel(currentVoucherData.method)+
    (notes?'\n\nNotes: '+notes:'')+
    '\n\nGenerated: '+new Date().toLocaleString('en-CA')+
    '\n'+(window.NATION_CONFIG && window.NATION_CONFIG.short_name || "")+' Housing Finance Module';
  window.location.href = 'mailto:'+email+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

function resolveCollectionFromTIC(tid) {
  var d = getData();
  var c = d.collections.find(function(x){ return x.tenantId === tid && x.status !== 'resolved'; });
  if (!c) { toast('No active collections flag found for this tenant.'); return; }
  showConfirm('Resolve Case', 'Mark this collections file as resolved?', function() {
    c.status = 'resolved';
    saveData(d); renderCollections(); renderDashboard(); renderTenantProfile(tid);
    toast('Collections file marked as resolved.');
  }, 'Resolve', false);
}

function resolveCollection(id) {
  var d = getData();
  var c = d.collections.find(function(x){return x.id===id;});
  if(c) c.status='resolved';
  saveData(d);
  renderCollections();
  renderDashboard();
}

