/* ============================================================
 * ai-assistant.js — CLFN Housing Suite
 * AI chat panel + draft-note assist via Supabase Edge Function
 *
 * Load order: ... housing-init.js → THIS FILE
 *
 * Exposes globals:
 *   toggleAIChat()   — open / close the floating chat panel
 *   aiDraftNote()    — auto-draft approval notes for current app + action
 *   aiSendMessage()  — send the typed chat message
 * ============================================================ */

'use strict';

var _aiHistory   = [];
var _aiPanelOpen = false;

var AI_EDGE_URL  = (window.SUPABASE_URL || '') + '/functions/v1/ai-chat';

// ── Core: call Edge Function ─────────────────────────────────────────────────
// Sends the signed-in user's access token (the Edge Function verifies the JWT
// and that the caller is active staff). Falls back to the anon key only if no
// session is present, which the function will reject with 401.
function _aiCall(payload) {
  var token = (window.HOUSING_SESSION && window.HOUSING_SESSION.accessToken)
    || window.SUPABASE_ANON || '';
  return fetch(AI_EDGE_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify(payload),
  }).then(function(r) { return r.json(); });
}

// ── Draft Note ───────────────────────────────────────────────────────────────
// Called by the "Draft with AI" button inside the approval modal.
function aiDraftNote() {
  if (window.CLFN_MODULES && !CLFN_MODULES.isEnabled('ai_assistant')) {
    showToast('AI Assistant is disabled for this nation.', { type: 'error' }); return;
  }
  var app = window._currentScorecardApp;
  if (!app) { showToast('No application selected.', { type: 'error' }); return; }

  var action = (window._pendingApprovalAction || {}).action || '';
  var unitEl  = document.getElementById('approvalModal_unit_display');
  var unit    = unitEl ? unitEl.textContent.trim() : '';

  var btn = document.getElementById('ai_draft_btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Drafting…'; }

  _aiCall({
    type:    'draft',
    message: 'Draft the note.',
    context: {
      app:    app,
      action: action,
      unit:   unit,
      role:   window._effectiveRole || '',
    },
    history: [],
  }).then(function(data) {
    if (data.error) throw new Error(data.error);
    var notesEl = document.getElementById('approvalModal_notes');
    if (notesEl) { notesEl.value = data.reply; notesEl.focus(); }
  }).catch(function(err) {
    showToast('AI draft failed: ' + err.message, { type: 'error' });
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span style="color:var(--yellow)">✦</span> Draft with AI'; }
  });
}

// ── Chat Panel: open / close / toggle ────────────────────────────────────────
function openAIChat() {
  if (window.CLFN_MODULES && !CLFN_MODULES.isEnabled('ai_assistant')) return;
  var panel = document.getElementById('ai_chat_panel');
  if (panel) panel.style.display = 'flex';
  _aiPanelOpen = true;
  // Greet on first open
  if (_aiHistory.length === 0) {
    _appendAIMessage('assistant', 'Hi! I can help you look up applications, check unit availability, or answer housing policy questions. What do you need?');
  }
  setTimeout(function() {
    var inp = document.getElementById('ai_chat_input');
    if (inp) inp.focus();
  }, 80);
}

function closeAIChat() {
  var panel = document.getElementById('ai_chat_panel');
  if (panel) panel.style.display = 'none';
  _aiPanelOpen = false;
}

function toggleAIChat() {
  _aiPanelOpen ? closeAIChat() : openAIChat();
}

// ── Chat: send a message ─────────────────────────────────────────────────────
function aiSendMessage() {
  var inp = document.getElementById('ai_chat_input');
  if (!inp) return;
  var msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';

  _appendAIMessage('user', msg);
  _aiHistory.push({ role: 'user', content: msg });

  var sendBtn = document.getElementById('ai_chat_send');
  if (sendBtn) sendBtn.disabled = true;
  _appendAIMessage('assistant', '…', 'ai_typing_msg');

  // Flatten SOW cache (keyed by unit_id) into an array for context
  var sowList = [];
  try {
    var sowCache = window._sowCache || {};
    Object.keys(sowCache).forEach(function(uid) {
      var d = sowCache[uid];
      if (!d || typeof d !== 'object') return;
      var items = Array.isArray(d.items) ? d.items
                : Array.isArray(d.sow_items) ? d.sow_items
                : Array.isArray(d.line_items) ? d.line_items : [];
      var total = items.reduce(function(s, i) {
        return s + (parseFloat(i.cost || i.amount || i.total || 0) || 0);
      }, 0);
      sowList.push({ unit_id: uid, contractor: d.contractor_name || d.contractor || '',
                     status: d.status || '', total: total, item_count: items.length });
    });
  } catch(e) { console.warn('[AI] SOW build error:', e); }

  var ctx = {
    role:        window._effectiveRole || window.currentRole || '',
    apps:        (window.applications  || []).map(function(a) {
      return {
        id: a.id, fn: a.fn, ln: a.ln, status: a.status,
        score: a.score || a.total_score, tier: a.tier,
        bedrooms: a.bed_req || a.bedrooms, household_size: a.household_size || a.adults,
        app_type: a.app_type || a.type,
        assignedUnit: a.assignedUnit, assignedAddress: a.assignedAddress,
        submittedAt: a.submittedAt,
      };
    }),
    units:       (window.housingUnits  || []).map(function(u) {
      return {
        id: u.id, address: (u.num ? u.num + ' ' + u.street : u.address || u.unit_address),
        bedrooms: u.bedrooms, bathrooms: u.bathrooms, type: u.type,
        status: u.status, accessible: u.accessible, isElders: u.isElders,
        funder: u.funder, assignedTo: u.assignedTo, assignedName: u.assignedName,
      };
    }),
    sows:        sowList,
    rfqs:        Object.keys(window._rfqCache || {}).map(function(id) {
      var r = window._rfqCache[id];
      return { id: id, unit_id: r.unit_id, status: r.status, contractor: r.contractor_name || '',
               total: r.total_amount || r.total || 0, created_at: r.created_at };
    }),
    contractors: (window._contractors || []).map(function(c) {
      return { name: c.name, trade: c.trade, phone: c.phone, email: c.email, status: c.status };
    }),
    renoProgress: (function() {
      var rp = window._renoProgress || {};
      return Object.keys(rp).map(function(uid) {
        var d = rp[uid];
        return { unit_id: uid, overallPct: d.overallPct || 0, phases: d.phases || [] };
      });
    }()),
  };

  _aiCall({
    type:    'chat',
    message: msg,
    context: ctx,
    history: _aiHistory.slice(0, -1),
  }).then(function(data) {
    if (data.error) throw new Error(data.error);
    _removeTyping();
    _appendAIMessage('assistant', data.reply);
    _aiHistory.push({ role: 'assistant', content: data.reply });
  }).catch(function(err) {
    _removeTyping();
    _appendAIMessage('assistant', 'Sorry, something went wrong: ' + err.message);
  }).finally(function() {
    if (sendBtn) sendBtn.disabled = false;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _removeTyping() {
  var t = document.getElementById('ai_typing_msg');
  if (t) t.remove();
}

function _appendAIMessage(role, text, id) {
  var msgs = document.getElementById('ai_chat_messages');
  if (!msgs) return;

  var wrap   = document.createElement('div');
  var isUser = role === 'user';
  wrap.style.cssText = 'display:flex;flex-direction:column;' +
    (isUser ? 'align-items:flex-end;' : 'align-items:flex-start;') +
    'margin-bottom:8px;';
  if (id) wrap.id = id;

  // Assistant replies may include ```chart {json}``` blocks — pull them out and
  // render real charts; the bubble keeps the surrounding prose.
  var charts = [];
  var displayText = text;
  if (!isUser && typeof text === 'string') {
    displayText = text.replace(/```chart\s*([\s\S]*?)```/g, function (_m, json) {
      try { charts.push(JSON.parse(json.trim())); return ''; }
      catch (e) { return _m; }   // leave unparseable blocks as text
    }).trim();
  }
  // No explicit chart blocks? Derive charts from any count/breakdown tables so
  // visuals appear without needing the ai-chat function redeploy.
  if (!isUser && !charts.length) charts = _aiDeriveChartSpecs(text).slice(0, 8);

  var bubble = document.createElement('div');
  bubble.style.cssText = [
    'max-width:85%;padding:9px 13px;border-radius:12px;font-size:13px;',
    'line-height:1.5;white-space:pre-wrap;word-break:break-word;',
    isUser
      ? 'background:var(--yellow);color:#fff;border-bottom-right-radius:3px;'
      : 'background:#2f3033;border:1px solid #444;color:#e8e8e5;border-bottom-left-radius:3px;',
  ].join('');
  bubble.textContent = displayText;

  if (displayText || !charts.length) wrap.appendChild(bubble);
  charts.forEach(function (spec) { _aiRenderChart(wrap, spec); });

  // Export-to-PDF affordance on substantive assistant replies (reports etc.).
  if (!isUser && id !== 'ai_typing_msg' && ((displayText && displayText.length > 60) || charts.length)) {
    var pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.textContent = '⬇ Export PDF';
    pdfBtn.style.cssText = 'align-self:flex-start;margin-top:6px;background:none;border:1px solid #555;color:#aaa;border-radius:6px;font-size:11px;font-weight:700;padding:3px 9px;cursor:pointer;font-family:DM Sans,sans-serif;';
    pdfBtn.addEventListener('click', function(){ _aiExportReplyPdf(text); });
    wrap.appendChild(pdfBtn);
  }

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Charts (lazy-loaded Chart.js, CSP-allowed cdnjs) ──────────────────────────
function _aiLoadChartJs(cb) {
  if (window.Chart) { cb(); return; }
  if (window._aiChartCbs) { window._aiChartCbs.push(cb); return; }
  window._aiChartCbs = [cb];
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
  s.onload  = function () { (window._aiChartCbs || []).forEach(function (f) { try { f(); } catch (e) {} }); window._aiChartCbs = null; };
  s.onerror = function () { window._aiChartCbs = null; };
  document.head.appendChild(s);
}

var _AI_CHART_PALETTE = ['#F8E41A','#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#84cc16','#f97316','#94a3b8','#14b8a6'];

function _aiRenderChart(wrap, spec) {
  if (!spec || !spec.type) return;
  var holder = document.createElement('div');
  holder.style.cssText = 'background:#fff;border:1px solid #444;border-radius:10px;padding:10px;margin-top:8px;width:85%;max-width:100%;box-sizing:border-box;';
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;max-height:280px;';
  holder.appendChild(canvas);
  wrap.appendChild(holder);
  _aiLoadChartJs(function () {
    if (!window.Chart) { holder.textContent = 'Chart unavailable.'; return; }
    var isPie = spec.type === 'pie' || spec.type === 'doughnut';
    var labels = spec.labels || [];
    try {
      var datasets = (spec.datasets || []).map(function (d, i) {
        var color = isPie
          ? labels.map(function (_l, k) { return _AI_CHART_PALETTE[k % _AI_CHART_PALETTE.length]; })
          : _AI_CHART_PALETTE[i % _AI_CHART_PALETTE.length];
        return Object.assign({
          backgroundColor: color,
          borderColor: isPie ? '#fff' : color,
          borderWidth: isPie ? 1 : (spec.type === 'line' ? 2 : 1),
          fill: spec.type === 'line' ? false : undefined
        }, d);
      });
      new window.Chart(canvas.getContext('2d'), {
        type: spec.type,
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            title:  { display: !!spec.title, text: spec.title || '', color: '#111' },
            legend: { display: isPie || (spec.datasets || []).length > 1, labels: { color: '#333' } }
          },
          scales: isPie ? {} : { x: { ticks: { color: '#333' } }, y: { ticks: { color: '#333' }, beginAtZero: true } }
        }
      });
    } catch (e) { holder.textContent = 'Could not render chart.'; }
  });
}

// ── Export an assistant reply as a branded PDF ───────────────────────────────
function _aiLoadScript(src, cb){ var s=document.createElement('script'); s.src=src; s.onload=cb; s.onerror=cb; document.head.appendChild(s); }
function _aiLoadPdfLibs(cb){
  if (window._aiPdfReady) { cb(); return; }
  _aiLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', function(){
    _aiLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js', function(){
      window._aiPdfReady = true; cb();
    });
  });
}
// Render a chart spec to a PNG data URL via an offscreen Chart.js canvas.
function _aiChartToImage(spec, cb){
  _aiLoadChartJs(function(){
    if (!window.Chart) { cb(null); return; }
    try {
      var canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 350;
      var isPie = spec.type === 'pie' || spec.type === 'doughnut';
      var labels = spec.labels || [];
      var datasets = (spec.datasets || []).map(function (d, i) {
        var color = isPie ? labels.map(function (_l, k) { return _AI_CHART_PALETTE[k % _AI_CHART_PALETTE.length]; }) : _AI_CHART_PALETTE[i % _AI_CHART_PALETTE.length];
        return Object.assign({ backgroundColor: color, borderColor: isPie ? '#fff' : color, borderWidth: 1 }, d);
      });
      var chart = new window.Chart(canvas.getContext('2d'), {
        type: spec.type, data: { labels: labels, datasets: datasets },
        options: { animation: false, responsive: false, plugins: { title: { display: !!spec.title, text: spec.title || '' }, legend: { display: isPie || (spec.datasets || []).length > 1 } } }
      });
      var img = canvas.toDataURL('image/png'); chart.destroy(); cb(img);
    } catch (e) { cb(null); }
  });
}
function _aiPdfClean(s){
  return String(s == null ? '' : s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}]/gu, '')
    .replace(/\*\*/g, '').replace(/`/g, '').replace(/•/g, '').trim();
}
// Parse a number out of a markdown cell (handles $, %, commas).
function _aiParseNum(s){ if (s == null) return null; var m = String(s).replace(/[$,%\s]/g,'').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
// Markdown tables in order, each tagged with the nearest preceding heading.
function _aiMarkdownTables(md){
  var lines = String(md||'').split('\n'), out = [], lastHeading = '', i = 0;
  while (i < lines.length){
    var raw = (lines[i]||'').trim();
    var h = raw.match(/^#{1,6}\s+(.+)$/);
    if (h){ lastHeading = _aiPdfClean(h[1]); i++; continue; }
    if (raw.charAt(0) === '|'){
      var tbl = [];
      while (i < lines.length && (lines[i]||'').trim().charAt(0) === '|'){
        var cells = (lines[i]||'').trim().replace(/^\||\|$/g,'').split('|').map(function(c){ return c.trim(); });
        if (!cells.every(function(c){ return /^:?-{2,}:?$/.test(c) || c===''; })) tbl.push(cells);
        i++;
      }
      if (tbl.length >= 2) out.push({ header: tbl[0], rows: tbl.slice(1), title: lastHeading });
      continue;
    }
    i++;
  }
  return out;
}
// Turn a count/breakdown table into a bar-chart spec (or null if it isn't one).
function _aiTableToChartSpec(header, rows, title){
  if (!header || header.length < 2 || !rows || rows.length < 2) return null;
  var valCol = -1, valHeader = '';
  for (var c = 1; c < header.length; c++){
    if (/%|percent/i.test(header[c]||'')) continue;
    var nums = 0;
    rows.forEach(function(r){ if (_aiParseNum(r[c]) != null) nums++; });
    if (nums >= Math.ceil(rows.length * 0.6)) { valCol = c; valHeader = header[c]; break; }
  }
  if (valCol === -1) return null;
  var labels = [], data = [];
  rows.forEach(function(r){
    var label = _aiPdfClean(r[0]||'');
    if (!label || /^total\b/i.test(label)) return;
    var v = _aiParseNum(r[valCol]);
    if (v == null) return;
    labels.push(label); data.push(v);
  });
  if (labels.length < 2 || labels.length > 14) return null;
  return { type:'bar', title: _aiPdfClean(title || header[0] || ''), labels: labels, datasets: [{ label: _aiPdfClean(valHeader) || 'Count', data: data }] };
}
function _aiDeriveChartSpecs(md){
  return _aiMarkdownTables(md).map(function(t){ return _aiTableToChartSpec(t.header, t.rows, t.title); }).filter(Boolean);
}

function _aiExportReplyPdf(md){
  if (typeof md !== 'string' || !md.trim()) return;
  var explicit = [];
  var work = md.replace(/```chart\s*([\s\S]*?)```/g, function (_m, json) {
    try { explicit.push(JSON.parse(json.trim())); return '\n@@CHART' + (explicit.length - 1) + '@@\n'; }
    catch (e) { return ''; }
  }).replace(/```[\s\S]*?```/g, '');   // drop other code fences (ASCII bars etc.)
  // If the model didn't emit explicit charts, derive one per count table.
  var tableSpecs = explicit.length ? [] : _aiDeriveChartSpecs(work);
  _aiLoadPdfLibs(function () {
    if (!(window.jspdf && window.jspdf.jsPDF)) { if (typeof showToast==='function') showToast('PDF library failed to load.', { type:'error' }); return; }
    var allSpecs = explicit.concat(tableSpecs);
    var images = new Array(allSpecs.length).fill(null);
    var pending = allSpecs.length;
    function go(){ _aiBuildReplyPdf(work, images.slice(0, explicit.length), images.slice(explicit.length)); }
    if (!pending) { go(); return; }
    allSpecs.forEach(function (spec, i) {
      _aiChartToImage(spec, function (img) { images[i] = img; if (--pending === 0) go(); });
    });
  });
}
function _aiBuildReplyPdf(work, explicitImages, tableImages){
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'letter' });
  var pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  var margin = 16, y = 16, contentW = pageW - margin * 2;
  var nation = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.short)) || 'CLFN';
  var tm = work.match(/^#\s+(.+)$/m); var title = tm ? _aiPdfClean(tm[1]) : 'Report';
  var today = new Date().toISOString().slice(0, 10);

  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20);
  doc.text(nation + ' Housing', margin, y); y += 7;
  doc.setFontSize(16); doc.text(title, margin, y); y += 6;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(120);
  doc.text('Generated ' + today, margin, y); y += 3;
  doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 6;
  doc.setTextColor(25);

  function ensure(h){ if (y + h > pageH - 16) { doc.addPage(); y = 16; } }
  var lines = work.split('\n'), i = 0, _tblCount = 0;
  while (i < lines.length){
    var raw = (lines[i] || '').trim();
    if (!raw){ i++; continue; }
    var cm = raw.match(/^@@CHART(\d+)@@$/);
    if (cm){
      var img = explicitImages[parseInt(cm[1], 10)];
      if (img){ var iw = Math.min(contentW, 150), ih = iw * 0.5; ensure(ih + 4); try { doc.addImage(img, 'PNG', margin, y, iw, ih); } catch(e){} y += ih + 5; }
      i++; continue;
    }
    if (raw.charAt(0) === '|'){
      var tbl = [];
      while (i < lines.length && (lines[i]||'').trim().charAt(0) === '|'){
        var cells = (lines[i]||'').trim().replace(/^\||\|$/g, '').split('|').map(function (c){ return _aiPdfClean(c); });
        if (!cells.every(function (c){ return /^:?-{2,}:?$/.test(c) || c === ''; })) tbl.push(cells);
        i++;
      }
      if (tbl.length){
        ensure(12);
        doc.autoTable({ startY:y, head:[tbl[0]], body:tbl.slice(1), theme:'striped',
          styles:{ fontSize:8, cellPadding:2 },
          headStyles:{ fillColor:[17,17,15], textColor:[248,228,26], fontStyle:'bold', fontSize:8 },
          margin:{ left:margin, right:margin } });
        y = doc.lastAutoTable.finalY + 5;
        // Derived chart for this count table (when the model didn't emit one).
        if (tableImages && tableImages.length && _aiTableToChartSpec(tbl[0], tbl.slice(1), '')) {
          var tci = tableImages[_tblCount++];
          if (tci){ var tw = Math.min(contentW, 140), th = tw * 0.5; ensure(th + 4); try { doc.addImage(tci, 'PNG', margin, y, tw, th); } catch(e){} y += th + 5; }
        }
      }
      continue;
    }
    var h = raw.match(/^(#{1,3})\s+(.+)$/);
    if (h){
      var lvl = h[1].length, sz = lvl === 1 ? 14 : lvl === 2 ? 12 : 10.5;
      ensure(sz * 0.6 + 4); y += lvl === 1 ? 2 : 3;
      doc.setFont('helvetica','bold'); doc.setFontSize(sz); doc.text(_aiPdfClean(h[2]), margin, y);
      y += sz * 0.5; doc.setFont('helvetica','normal'); doc.setFontSize(10);
      i++; continue;
    }
    var isList = /^[-*]\s+/.test(raw) || /^\d+\.\s+/.test(raw);
    var isQuote = raw.charAt(0) === '>';
    var txt = _aiPdfClean(raw.replace(/^[-*>]\s*/, '').replace(/^\d+\.\s*/, ''));
    if (!txt){ i++; continue; }
    doc.setFont('helvetica', isQuote ? 'italic' : 'normal'); doc.setFontSize(10);
    var wrapped = doc.splitTextToSize((isList ? '• ' : '') + txt, contentW);
    ensure(wrapped.length * 5); doc.text(wrapped, margin, y); y += wrapped.length * 5 + 1;
    doc.setFont('helvetica','normal');
    i++;
  }
  var pages = doc.internal.getNumberOfPages();
  for (var p = 1; p <= pages; p++){
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(150);
    doc.text(nation + ' Housing', margin, pageH - 8);
    doc.text('Page ' + p + ' of ' + pages, pageW - margin, pageH - 8, { align:'right' });
  }
  doc.save(nation.replace(/[^a-zA-Z0-9]+/g, '_') + '_Report_' + today + '.pdf');
}

// ── Keyboard: Enter to send ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('ai_chat_input');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSendMessage(); }
    });
  }
});
