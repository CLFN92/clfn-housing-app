/* ============================================================================
 * finance-pdf-jspdf.js -- jsPDF statement generator (Phase 1 of the finance
 * PDF migration; see docs/FINANCE-JSPDF-MIGRATION.md).
 *
 * Replaces the HTML print-window "Statement of Account" with a jsPDF document,
 * so the statement can be DOWNLOADED as a real PDF or EMAILED to the tenant
 * (print windows can't hand you the bytes). Branded per-nation: logo + name +
 * contact from NATION_CONFIG/theme, accent from the runtime _themeAccentHex()
 * helper (jsPDF takes hex strings; CSS var() would not work here).
 *
 * Data is collected the same way printTenantStatement() does (finance-statement.js).
 * ==========================================================================*/
(function () {
  'use strict';

  function _load(cb, onerr) {
    function haveAll() { return window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable; }
    if (haveAll()) return cb();
    function add(src, next) { var s = document.createElement('script'); s.src = src; s.onload = next; s.onerror = function () { (onerr || function () {})(); }; document.head.appendChild(s); }
    var jsSrc = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    var atSrc = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
    if (window.jspdf && window.jspdf.jsPDF) { add(atSrc, cb); }
    else { add(jsSrc, function () { add(atSrc, cb); }); }
  }

  function accent() { return (typeof window._themeAccentHex === 'function') ? window._themeAccentHex() : '#9A4A1F'; }
  function money(n) { return (typeof fmt === 'function') ? fmt(n) : ('$' + (Number(n) || 0).toFixed(2)); }
  function nationLogo() {
    var s = null;
    try { s = sessionStorage.getItem('clfn_logo_cache'); } catch (e) {}
    var logo = s || (window._appSettings && _appSettings.theme && _appSettings.theme.logo)
      || (window.NATION_CONFIG && NATION_CONFIG.logo) || window.CLFN_LOGO_DATA_URL || '';
    // jsPDF addImage can't rasterize SVG -- only use PNG/JPEG data URLs.
    return /^data:image\/(png|jpe?g)/i.test(logo || '') ? logo : '';
  }

  // hex '#rrggbb' -> [r,g,b] for jsPDF setter functions.
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return [0, 0, 0];
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Build the statement jsPDF doc for a tenant id. Returns { doc, tenant } or null.
  function buildStatement(tid) {
    var t = (typeof getTenant === 'function') ? getTenant(tid) : null;
    if (!t) return null;
    var d = getData();
    var totals = (typeof calcAllTotals === 'function') ? calcAllTotals(d) : {};
    var v = totals[tid] || {};
    var nc = window.NATION_CONFIG || {};
    var today = new Date();
    var monthYM = today.toISOString().slice(0, 7);
    var monthLabel = today.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
    var generatedOn = today.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    var rentOwing = Math.max(0, v.rent || 0);
    var arrOwing = Math.max(0, v.arrangement || 0);
    var approvedLoans = (d.loanList || []).filter(function (l) { return l.tenantId === tid && l.status === 'approved'; });
    var loanTotal = approvedLoans.reduce(function (s, l) {
      var paid = (d.loanPayments || []).filter(function (p) { return p.loanId === l.id && p.status !== 'reversed'; }).reduce(function (a, p) { return a + p.amount; }, 0);
      return s + Math.max(0, (l.principal || 0) - paid);
    }, 0);
    var grandTotal = rentOwing + arrOwing + loanTotal;

    var charges = (d.rentLedger || []).filter(function (r) {
      return r.tenantId === tid && (r.charge || 0) > 0 && r.status !== 'reversed' && r.status !== 'paid';
    }).slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var chargeTotal = charges.reduce(function (s, r) { return s + (r.charge || 0); }, 0);

    var pays = [];
    (d.rentLedger || []).filter(function (r) { return r.tenantId === tid && (r.payment || 0) > 0 && r.status !== 'reversed' && (r.date || '').slice(0, 7) === monthYM; })
      .forEach(function (r) { pays.push({ date: r.date, ledger: 'Rent', desc: r.desc || 'Rent Payment', method: r.method || '', amount: r.payment || 0 }); });
    (d.arrPayments || []).forEach(function (p) {
      var a = (d.arrangements || []).find(function (x) { return x.id === p.arrId; });
      if (a && a.tenantId === tid && p.status !== 'reversed' && (p.date || '').slice(0, 7) === monthYM) pays.push({ date: p.date, ledger: 'Arrangement', desc: 'Arrangement Payment' + (a.ref ? ' - ' + a.ref : ''), method: p.method || '', amount: p.amount || 0 });
    });
    (d.loanPayments || []).forEach(function (p) {
      var l = (d.loanList || []).find(function (x) { return x.id === p.loanId; });
      if (l && l.tenantId === tid && p.status !== 'reversed' && (p.date || '').slice(0, 7) === monthYM) pays.push({ date: p.date, ledger: 'Loan', desc: 'Loan Payment' + (l.type ? ' - ' + l.type : ''), method: p.method || '', amount: p.amount || 0 });
    });
    pays.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var payTotal = pays.reduce(function (s, p) { return s + p.amount; }, 0);

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'letter' });
    var pageW = doc.internal.pageSize.getWidth();
    var M = 14, aH = accent(), aRGB = rgb(aH), logo = nationLogo();
    var nationName = nc.display_name || nc.short || 'Housing';
    var contact = [nc.mailing_address, nc.phone, (nc.email || nc.housing_email)].filter(Boolean).join('   ');

    function header() {
      var y = 12;
      if (logo) { try { doc.addImage(logo, 'PNG', M, y - 2, 16, 16); } catch (e) {} }
      var tx = logo ? M + 20 : M;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
      doc.text(String(nationName).toUpperCase(), tx, y + 2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 110, 110);
      if (contact) doc.text(String(contact), tx, y + 6.5, { maxWidth: pageW / 2 });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
      doc.text('Statement of Account', pageW - M, y + 1, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
      doc.text('Generated: ' + generatedOn, pageW - M, y + 6, { align: 'right' });
      doc.setDrawColor(aRGB[0], aRGB[1], aRGB[2]); doc.setLineWidth(0.7); doc.line(M, y + 12, pageW - M, y + 12);
    }
    function footer(data) {
      var ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(8); doc.setTextColor(140, 140, 140); doc.setFont('helvetica', 'normal');
      doc.text('CONFIDENTIAL', M, ph - 8);
      doc.text('Page ' + data.pageNumber, pageW - M, ph - 8, { align: 'right' });
    }

    // Tenant block + Total Owing summary (drawn once, above the first table).
    var startY = 34;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
    doc.text(String((typeof tenantName === 'function') ? tenantName(t) : (t.name || '')), M, startY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 100, 100);
    doc.text([t.unit, (t.type || '').replace(/-/g, ' ')].filter(Boolean).join('  -  '), M, startY + 5.5);
    // Total Owing box (accent), right-aligned.
    var boxW = 62, boxX = pageW - M - boxW, boxY = startY - 6, boxH = 16;
    doc.setFillColor(aRGB[0], aRGB[1], aRGB[2]); doc.rect(boxX, boxY, boxW, boxH, 'F');
    var onAcc = (typeof window._themeOnAccentHex === 'function') ? rgb(window._themeOnAccentHex()) : [255, 255, 255];
    doc.setTextColor(onAcc[0], onAcc[1], onAcc[2]);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('TOTAL OWING', boxX + boxW / 2, boxY + 5, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(money(grandTotal), boxX + boxW / 2, boxY + 12, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
    doc.text('Rent ' + money(rentOwing) + '   Arrangements ' + money(arrOwing) + '   Loans ' + money(loanTotal), M, startY + 12);

    var tableStart = startY + 18;

    // Outstanding charges.
    doc.autoTable({
      startY: tableStart, margin: { top: 30, left: M, right: M },
      head: [['Date', 'Outstanding Invoices & Charges', 'Amount']],
      body: charges.length ? charges.map(function (r) { return [r.date || '', r.desc || '', money(r.charge || 0)]; })
        : [[{ content: 'No outstanding charges.', colSpan: 3, styles: { textColor: [150, 150, 150], fontStyle: 'italic' } }]],
      foot: charges.length ? [['', 'Total Outstanding', money(chargeTotal)]] : null,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: aRGB, textColor: (typeof window._themeOnAccentHex === 'function') ? rgb(window._themeOnAccentHex()) : [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right', cellWidth: 30 } },
      didDrawPage: function (data) { header(); footer(data); }
    });

    // Payments this month.
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8, margin: { top: 30, left: M, right: M },
      head: [['Date', 'Ledger', 'Payments - ' + monthLabel, 'Method', 'Amount']],
      body: pays.length ? pays.map(function (p) { return [p.date || '', p.ledger, p.desc, p.method, money(p.amount)]; })
        : [[{ content: 'No payments recorded for ' + monthLabel + '.', colSpan: 5, styles: { textColor: [150, 150, 150], fontStyle: 'italic' } }]],
      foot: pays.length ? [['', '', '', 'Total Payments', money(payTotal)]] : null,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: aRGB, textColor: (typeof window._themeOnAccentHex === 'function') ? rgb(window._themeOnAccentHex()) : [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 24 }, 4: { halign: 'right', cellWidth: 26 } },
      didDrawPage: function (data) { header(); footer(data); }
    });

    return { doc: doc, tenant: t, grandTotal: grandTotal, monthLabel: monthLabel };
  }

  function fileName(t) {
    var nm = ((typeof tenantName === 'function') ? tenantName(t) : (t.name || 'tenant')).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    return 'Statement-' + nm + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
  }

  // Download the current statement tenant's PDF.
  window.finStatementDownload = function () {
    var tid = window._stmtTid; if (!tid) { if (typeof toast === 'function') toast('Open a tenant statement first'); return; }
    _load(function () {
      var r = buildStatement(tid);
      if (!r) { if (typeof toast === 'function') toast('Could not build the statement'); return; }
      r.doc.save(fileName(r.tenant));
    }, function () { if (typeof toast === 'function') toast('Could not load the PDF engine (offline?)'); });
  };

  // Email the current statement to the tenant (PDF attachment) via the nation's
  // own email provider through the existing send-notification pipeline.
  window.finStatementEmail = function () {
    var tid = window._stmtTid; if (!tid) { if (typeof toast === 'function') toast('Open a tenant statement first'); return; }
    _load(function () {
      var r = buildStatement(tid);
      if (!r) { if (typeof toast === 'function') toast('Could not build the statement'); return; }
      var email = (r.tenant.email || '').trim();
      if (!email) { if (typeof toast === 'function') toast('No email on file for this tenant'); return; }
      var b64 = '';
      try { b64 = r.doc.output('datauristring').split(',')[1]; } catch (e) { if (typeof toast === 'function') toast('Could not render the PDF'); return; }
      var nm = (typeof tenantName === 'function') ? tenantName(r.tenant) : (r.tenant.name || '');
      var nationName = (window.NATION_CONFIG && NATION_CONFIG.display_name) || 'Housing';
      if (typeof window.sendNotification !== 'function') { if (typeof toast === 'function') toast('Email is not available on this page'); return; }
      window.sendNotification({
        to: email, to_name: nm,
        subject: 'Your ' + nationName + ' statement of account (' + r.monthLabel + ')',
        html: '<p>Hello ' + nm + ',</p><p>Please find your current statement of account attached. Your total owing is <b>' + money(r.grandTotal) + '</b> as of ' + new Date().toLocaleDateString('en-CA') + '.</p><p>If you have questions about your account, please contact the housing office.</p>',
        attachments: [{ name: fileName(r.tenant), contentType: 'application/pdf', contentBytes: b64 }]
      }).then(function () {
        if (typeof toast === 'function') toast('Statement emailed to ' + email);
        if (typeof auditEntry === 'function') auditEntry(tid, 'statement_emailed', 'Statement of account emailed to ' + email, window.currentRole || 'staff');
      }).catch(function () { if (typeof toast === 'function') toast('Could not send the email'); });
    }, function () { if (typeof toast === 'function') toast('Could not load the PDF engine (offline?)'); });
  };
})();
