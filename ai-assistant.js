/* ========================================================================
 * ai-assistant.js - Housing Assistant chat widget (staff-facing)
 * ------------------------------------------------------------------------
 * A self-contained floating chat widget that lets staff ask natural-language
 * questions about housing data. It talks ONLY to the `ai-assistant` Supabase
 * Edge Function (which holds the Anthropic key and enforces role-scoped,
 * read-only data access) - never to Anthropic directly, and never with any
 * key in the browser.
 *
 * Self-contained IIFE (mirrors reno-questionnaire.js): injects its own DOM and
 * a scoped <style> block, uses one delegated click handler, exposes
 * window.openHousingAssistant() / closeHousingAssistant().
 *
 * Gating: only mounts when signed in (HOUSING_SESSION) AND the `ai_assistant`
 * module is on (moduleOn('ai_assistant')).
 * ===================================================================== */
(function () {
  'use strict';

  var MOUNTED = false;
  var OPEN = false;
  // Conversation history sent to the function: [{role, content}]
  var history = [];

  function moduleEnabled() {
    try { return (typeof moduleOn === 'function') ? moduleOn('ai_assistant') : true; }
    catch (e) { return true; }
  }
  function signedIn() {
    return !!(window.HOUSING_SESSION && window.HOUSING_SESSION.accessToken);
  }

  // ---- styles (scoped under #haWidget) ---------------------------------
  function injectStyles() {
    if (document.getElementById('ha-styles')) return;
    var css = [
      '#haFab{position:fixed;right:18px;bottom:18px;z-index:9998;width:56px;height:56px;border-radius:50%;',
      'border:none;cursor:pointer;background:var(--accent,#f4c20d);color:#1a1a1a;font-size:24px;',
      'box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;}',
      '#haFab:hover{filter:brightness(.95);}',
      '#haPanel{position:fixed;right:18px;bottom:84px;z-index:9999;width:380px;max-width:calc(100vw - 24px);',
      'height:560px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;display:none;',
      'flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);border:1px solid #e3e3e3;}',
      '#haPanel.ha-open{display:flex;}',
      '#haHdr{background:#1a1a1a;color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;}',
      '#haHdr .ha-title{font-weight:600;font-size:15px;display:flex;align-items:center;gap:8px;}',
      '#haHdr .ha-sub{font-size:11px;opacity:.7;font-weight:400;}',
      '#haClose{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;}',
      '#haBody{flex:1;overflow-y:auto;padding:14px;background:#f7f7f8;}',
      '.ha-msg{margin:0 0 10px;display:flex;}',
      '.ha-msg.ha-user{justify-content:flex-end;}',
      '.ha-bubble{max-width:84%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;}',
      '.ha-user .ha-bubble{background:var(--accent,#f4c20d);color:#1a1a1a;border-bottom-right-radius:4px;}',
      '.ha-bot .ha-bubble{background:#fff;color:#222;border:1px solid #e6e6e6;border-bottom-left-radius:4px;}',
      '.ha-bot .ha-bubble table{border-collapse:collapse;margin:6px 0;font-size:12.5px;}',
      '.ha-bot .ha-bubble td,.ha-bot .ha-bubble th{border:1px solid #ddd;padding:3px 7px;text-align:left;}',
      '.ha-bot .ha-bubble code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;}',
      '.ha-typing .ha-bubble{color:#888;font-style:italic;}',
      '#haFoot{border-top:1px solid #eee;padding:10px;background:#fff;}',
      '#haSuggest{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}',
      '.ha-chip{background:#f0f0f0;border:1px solid #e0e0e0;border-radius:14px;padding:4px 10px;font-size:11.5px;',
      'cursor:pointer;color:#333;}',
      '.ha-chip:hover{background:#e6e6e6;}',
      '#haForm{display:flex;gap:8px;align-items:flex-end;}',
      '#haInput{flex:1;resize:none;border:1px solid #d8d8d8;border-radius:10px;padding:9px 11px;font-size:13.5px;',
      'font-family:inherit;max-height:96px;line-height:1.4;}',
      '#haInput:focus{outline:none;border-color:var(--accent,#f4c20d);}',
      '#haSend{background:var(--accent,#f4c20d);color:#1a1a1a;border:none;border-radius:10px;padding:9px 14px;',
      'font-weight:600;cursor:pointer;font-size:13.5px;}',
      '#haSend:disabled{opacity:.5;cursor:default;}',
      '#haDisclaim{font-size:10.5px;color:#999;margin:7px 2px 0;text-align:center;}',
      '@media (max-width:480px){#haPanel{right:8px;left:8px;width:auto;bottom:78px;height:calc(100vh - 96px);}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'ha-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---- minimal, safe rendering -----------------------------------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // Render a small markdown subset to HTML (all input escaped first).
  function renderMd(text) {
    var html = esc(text);
    // bold **x**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // inline code `x`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // markdown table blocks -> <table>
    html = html.replace(/(?:^\|.*\|\s*\n?)+/gm, function (block) {
      var rows = block.trim().split('\n').filter(function (r) { return r.indexOf('|') !== -1; });
      var out = '<table>';
      rows.forEach(function (r, i) {
        var cells = r.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
        // skip the |---|---| separator row
        if (cells.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; })) return;
        var tag = (i === 0) ? 'th' : 'td';
        out += '<tr>' + cells.map(function (c) { return '<' + tag + '>' + c + '</' + tag + '>'; }).join('') + '</tr>';
      });
      return out + '</table>';
    });
    return html;
  }

  function bodyEl() { return document.getElementById('haBody'); }

  function addMsg(role, text, opts) {
    opts = opts || {};
    var b = bodyEl();
    if (!b) return null;
    var wrap = document.createElement('div');
    wrap.className = 'ha-msg ' + (role === 'user' ? 'ha-user' : 'ha-bot') + (opts.typing ? ' ha-typing' : '');
    var bub = document.createElement('div');
    bub.className = 'ha-bubble';
    if (role === 'user' || opts.typing) bub.textContent = text;
    else bub.innerHTML = renderMd(text);
    wrap.appendChild(bub);
    b.appendChild(wrap);
    b.scrollTop = b.scrollHeight;
    return wrap;
  }

  function setSending(on) {
    var send = document.getElementById('haSend');
    var inp = document.getElementById('haInput');
    if (send) send.disabled = on;
    if (inp) inp.disabled = on;
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text) return;
    if (!signedIn()) { addMsg('bot', 'Please sign in to use the assistant.'); return; }

    addMsg('user', text);
    history.push({ role: 'user', content: text });
    var inp = document.getElementById('haInput');
    if (inp) { inp.value = ''; inp.style.height = 'auto'; }
    var sug = document.getElementById('haSuggest');
    if (sug) sug.style.display = 'none';

    setSending(true);
    var typing = addMsg('bot', 'Thinking...', { typing: true });

    try {
      var url = SUPABASE_URL + '/functions/v1/ai-assistant';
      var r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.HOUSING_SESSION.accessToken
        },
        body: JSON.stringify({ messages: history })
      });
      var data;
      try { data = await r.json(); } catch (_) { data = {}; }
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);

      if (!r.ok) {
        var msg = (data && data.error) || ('Request failed (' + r.status + ')');
        if (data && data.detail) msg += ' - ' + (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        addMsg('bot', 'Sorry, something went wrong: ' + msg);
        // drop the failed user turn so retry history stays clean
        history.pop();
        return;
      }
      var reply = (data && data.reply) || '(no response)';
      addMsg('bot', reply);
      history.push({ role: 'assistant', content: reply });
    } catch (e) {
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      addMsg('bot', 'Network error reaching the assistant. Check your connection and try again.');
      history.pop();
    } finally {
      setSending(false);
      if (inp) inp.focus();
    }
  }

  // Role-aware starter prompts. Mix of a how-to and a data question so staff
  // discover both abilities. The effective role is known client-side via
  // window.currentRole (falls back to the session role).
  function currentRoleNorm() {
    var r = (window.currentRole
      || (window.HOUSING_SESSION && HOUSING_SESSION.role)
      || '').toString().toLowerCase().trim();
    if (r === 'hm' || r === 'manager') return 'housing_manager';
    if (r === 'employee' || r === 'staff') return 'housing_employee_l1';
    return r;
  }
  var SUGGEST_BY_ROLE = {
    field_employee: [
      'How do I complete a maintenance request?',
      'Show my work orders to complete',
      'How do I add a progress report?'
    ],
    housing_manager: [
      'How do I approve an application?',
      'List applications awaiting review',
      'How do I assign a work order?',
      'How many vacant units do we have?'
    ],
    housing_employee_l2: [
      'How do I do an application?',
      'List applications awaiting review',
      'How do I create a maintenance request?'
    ],
    housing_employee_l1: [
      'How do I do an application?',
      'How do I create a maintenance request?',
      'How many vacant units do we have?'
    ],
    ed: [
      'List applications awaiting my approval',
      'How do I approve a renovation?',
      'Show recent activity in the audit log',
      'How many vacant units do we have?'
    ],
    super_user: [
      'How do I add a staff user?',
      'List applications awaiting approval',
      'How do I turn a module on or off?',
      'Show recent activity in the audit log'
    ],
    cfo: [
      'How do I record a rent payment?',
      'Show units with assigned tenants',
      'How do I create an invoice?'
    ],
    finance_l1: [
      'How do I record a rent payment?',
      'Show units with assigned tenants',
      'How do I set up a payment arrangement?'
    ]
  };
  var SUGGEST_DEFAULT = [
    'How do I do an application?',
    'How do I complete a maintenance request?',
    'How many vacant units do we have?'
  ];
  function suggestionsFor() {
    return SUGGEST_BY_ROLE[currentRoleNorm()] || SUGGEST_DEFAULT;
  }
  // (Re)render the starter chips for the current role into #haSuggest.
  function renderSuggestions() {
    var box = document.getElementById('haSuggest');
    if (!box) return;
    box.style.display = '';
    box.innerHTML = suggestionsFor().map(function (s) {
      return '<span class="ha-chip" data-ha-suggest="' + esc(s) + '">' + esc(s) + '</span>';
    }).join('');
  }

  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'haPanel';
    panel.innerHTML =
      '<div id="haHdr">' +
        '<div class="ha-title">' +
          '<span>Housing Assistant</span>' +
          '<span class="ha-sub">read-only</span>' +
        '</div>' +
        '<button id="haClose" title="Close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div id="haBody"></div>' +
      '<div id="haFoot">' +
        '<div id="haSuggest"></div>' +
        '<form id="haForm">' +
          '<textarea id="haInput" rows="1" placeholder="Ask about applications, units, tenants..."></textarea>' +
          '<button id="haSend" type="submit">Send</button>' +
        '</form>' +
        '<div id="haDisclaim">AI answers can be imperfect. Verify important details in the app.</div>' +
      '</div>';
    document.body.appendChild(panel);

    // delegated clicks
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'haClose') { window.closeHousingAssistant(); return; }
      var chip = t.getAttribute && t.getAttribute('data-ha-suggest');
      if (chip) { send(chip); }
    });
    // submit
    document.getElementById('haForm').addEventListener('submit', function (e) {
      e.preventDefault();
      send(document.getElementById('haInput').value);
    });
    // textarea: Enter sends, Shift+Enter newline; auto-grow
    var inp = document.getElementById('haInput');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp.value); }
    });
    inp.addEventListener('input', function () {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 96) + 'px';
    });
  }

  function mount() {
    if (MOUNTED) return;
    if (!signedIn() || !moduleEnabled()) return;
    injectStyles();
    var fab = document.createElement('button');
    fab.id = 'haFab';
    fab.title = 'Housing Assistant';
    fab.setAttribute('aria-label', 'Open Housing Assistant');
    fab.innerHTML = '&#128172;'; // speech balloon
    fab.addEventListener('click', function () {
      OPEN ? window.closeHousingAssistant() : window.openHousingAssistant();
    });
    document.body.appendChild(fab);
    buildPanel();
    MOUNTED = true;
  }

  window.openHousingAssistant = function () {
    if (!MOUNTED) mount();
    var p = document.getElementById('haPanel');
    if (!p) return;
    p.classList.add('ha-open');
    OPEN = true;
    // Render role-aware starter chips only while the conversation is empty.
    if (!history.length) renderSuggestions();
    if (!history.length && !bodyEl().children.length) {
      var who = (window.HOUSING_SESSION && HOUSING_SESSION.name) ? (', ' + HOUSING_SESSION.name.split(' ')[0]) : '';
      addMsg('bot', 'Hi' + who + '! Ask me about applications, units, tenants, work orders, contractors, or the audit log. I can only read data, not change it.');
    }
    var inp = document.getElementById('haInput');
    if (inp) setTimeout(function () { inp.focus(); }, 50);
  };

  window.closeHousingAssistant = function () {
    var p = document.getElementById('haPanel');
    if (p) p.classList.remove('ha-open');
    OPEN = false;
  };

  // Mount when DOM + session are ready.
  function tryMount() {
    if (signedIn()) mount();
    else setTimeout(tryMount, 1200); // session rehydrates shortly after load on sub-pages
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryMount, 600); });
  } else {
    setTimeout(tryMount, 600);
  }
})();
