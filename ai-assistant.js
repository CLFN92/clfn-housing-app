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
function _aiCall(payload) {
  return fetch(AI_EDGE_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + (window.SUPABASE_ANON || ''),
    },
    body: JSON.stringify(payload),
  }).then(function(r) { return r.json(); });
}

// ── Draft Note ───────────────────────────────────────────────────────────────
// Called by the "Draft with AI" button inside the approval modal.
function aiDraftNote() {
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

  var ctx = {
    role:  window._effectiveRole || '',
    apps:  (window.applications  || []).map(function(a) {
      return { id: a.id, fn: a.fn, ln: a.ln, status: a.status,
               score: a.total_score, bedrooms: a.bed_req };
    }),
    units: (window.housingUnits  || []).map(function(u) {
      return { id: u.id, address: u.address || u.unit_address,
               bedrooms: u.bedrooms, status: u.status };
    }),
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

  var bubble = document.createElement('div');
  bubble.style.cssText = [
    'max-width:85%;padding:9px 13px;border-radius:12px;font-size:13px;',
    'line-height:1.5;white-space:pre-wrap;word-break:break-word;',
    isUser
      ? 'background:var(--yellow);color:#111;border-bottom-right-radius:3px;'
      : 'background:#1e1e1c;border:1px solid var(--border);color:var(--text);border-bottom-left-radius:3px;',
  ].join('');
  bubble.textContent = text;

  wrap.appendChild(bubble);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
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
