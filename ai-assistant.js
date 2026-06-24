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

// ── Keyboard: Enter to send ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('ai_chat_input');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSendMessage(); }
    });
  }
});
