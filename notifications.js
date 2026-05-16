/* ════════════════════════════════════════════════════════════════════════
 * notifications.js — CLFN Housing email notification framework
 * ────────────────────────────────────────────────────────────────────────
 * Owns:
 *   • EMAIL_EVENT_REGISTRY — single source of truth for every workflow
 *     notification: key, label, recipient role(s), placeholders, and the
 *     default subject + bodyHtml template.
 *   • _renderEmailTemplate — pulls the saved template (if any) for an
 *     event from _appSettings.email_templates, falls back to the registry
 *     default, and substitutes {placeholder} tokens with values from the
 *     application context.
 *   • _sbLoadActiveStaffByRole — staff-table lookup helper used by the
 *     per-event notify functions.
 *   • Per-event notify functions (notifyApplicationSubmitted today,
 *     more added as they get wired in).
 *
 * The actual HTTP call to the Edge Function lives in
 *   shared-data.js → window.sendNotification(opts)
 * — generic transport, kept shared because anything in the app can use it.
 *
 * Phase 2 will append the Settings → Notifications tab UI + rich text
 * editor + Send Test button to this same file.
 * ════════════════════════════════════════════════════════════════════════ */

// ── Event registry ─────────────────────────────────────────────────────────
// Adding a new workflow notification = add an entry here. The Settings tab
// (Phase 2) will auto-render it. Placeholders listed are the ones the
// renderer knows how to substitute for that event.
var EMAIL_EVENT_REGISTRY = [
  {
    key:                   'application_submitted',
    label:                 'New Application Submitted',
    description:           'Sent when a new applicant submits.',
    defaultRecipientRoles: ['housing_manager'],
    wired:                 true,
    placeholders:          ['applicantName','applicantId','score','tier','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — New Application Submitted: {applicantName}',
      bodyHtml: '<p>A new housing application has been submitted by <strong>{applicantName}</strong> ({applicantId}).</p>'
              + '<p>Score: <strong>{score}</strong> · Tier: <strong>{tier}</strong></p>'
              + '<p>Please log in to the {nationShort} Housing app to review and recommend.</p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  },
  {
    key:                   'file_update_submitted',
    label:                 'File Update Submitted',
    description:           'Sent when an existing tenant submits a file update.',
    defaultRecipientRoles: ['housing_manager'],
    wired:                 true,
    placeholders:          ['applicantName','applicantId','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — File Update Requires Your Review: {applicantName}',
      bodyHtml: '<p>A file update has been submitted for <strong>{applicantName}</strong> ({applicantId}) and requires your review and approval in the {nationShort} Housing app.</p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  }
];

// Role choices shown in the Recipients picker. Order is intentional —
// management roles first, finance last. Labels are pulled from
// CLFN_PERMS at render time so nation-configurable display names win.
var NTF_ROLE_CHOICES = [
  'ed',
  'housing_manager',
  'housing_employee_l2',
  'housing_employee_l1',
  'cfo',
  'finance_l1'
];

// Lookup helper — returns the registry entry by key, or undefined.
function _emailEventConfig(eventKey) {
  for (var i = 0; i < EMAIL_EVENT_REGISTRY.length; i++) {
    if (EMAIL_EVENT_REGISTRY[i].key === eventKey) return EMAIL_EVENT_REGISTRY[i];
  }
  return undefined;
}

// ── Template renderer ──────────────────────────────────────────────────────
// Returns { subject, bodyHtml } for the given event, with placeholders
// substituted from the app context. Unknown placeholders left untouched
// in the saved template are replaced with '—' so they never reach the
// recipient as raw {token}.
function _renderEmailTemplate(eventKey, app) {
  var cfg = _emailEventConfig(eventKey);
  if (!cfg) {
    console.warn('[notifications] unknown event:', eventKey);
    return null;
  }
  // Saved override (Settings → Notifications tab) wins; otherwise default.
  var saved = (window._appSettings && window._appSettings.email_templates
            && window._appSettings.email_templates[eventKey]) || {};
  var subject  = (saved.subject  != null && saved.subject  !== '') ? saved.subject  : cfg.defaults.subject;
  var bodyHtml = (saved.bodyHtml != null && saved.bodyHtml !== '') ? saved.bodyHtml : cfg.defaults.bodyHtml;

  var tokens = _emailTokens(app);
  return {
    subject:  _substitutePlaceholders(subject,  tokens),
    bodyHtml: _substitutePlaceholders(bodyHtml, tokens)
  };
}

// Build the placeholder token map from an application object. Adding a
// new placeholder = add a key here AND list it in the registry entry's
// `placeholders` array so the Settings UI can offer it.
function _emailTokens(app) {
  var natShort = (window.NATION_CONFIG && NATION_CONFIG.short) || 'CLFN';
  var name     = ((app && app.fn) || '') + ' ' + ((app && app.ln) || '');
  name = name.trim() || 'Applicant';
  // appLink — best-effort deep link to the housing app at the current
  // origin. If we ever host a public landing URL elsewhere, swap this out.
  var origin   = (typeof window !== 'undefined' && window.location)
                 ? (window.location.origin + (window.location.pathname.indexOf('/housing.html') >= 0 ? '/housing.html' : '/'))
                 : '/';
  return {
    applicantName: name,
    applicantId:   (app && app.id)    || '—',
    score:         (app && app.score != null) ? String(app.score) : '—',
    tier:          (app && app.tier)  || '—',
    nationShort:   natShort,
    appLink:       origin
  };
}

// Plain {token} substitution. Unknown tokens that survived editing get
// replaced with '—' so recipients never see raw braces.
function _substitutePlaceholders(template, tokens) {
  if (template == null) return '';
  return String(template).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, function(_match, key) {
    return (tokens && Object.prototype.hasOwnProperty.call(tokens, key))
      ? String(tokens[key])
      : '—';
  });
}

// ── Recipient resolution ───────────────────────────────────────────────────
// Pull active staff with the given role from the staff table.
// Returns [{name, email}, …] — empty array on any error so callers
// never blow up on transient network failures.
async function _sbLoadActiveStaffByRole(role) {
  if (!role) return [];
  try {
    var url = SUPABASE_URL
            + '/rest/v1/staff?select=name,email'
            + '&is_active=eq.true&role=eq.' + encodeURIComponent(role);
    var r = await fetch(url, { headers: HOUSING_HEADERS });
    if (!r.ok) { console.warn('[staff lookup] ' + role + ' failed:', await r.text()); return []; }
    var rows = await r.json();
    return (rows || []).filter(function(s){ return s && s.email; });
  } catch (e) {
    console.warn('[staff lookup] ' + role + ' error:', e);
    return [];
  }
}

// ── Per-event notify functions ─────────────────────────────────────────────
// Each function: resolve recipients, render template, fan out via
// window.sendNotification. Best-effort, never throws.

// Wired from finalSubmit() in housing-app.js. Picks the event based on
// app.appType (existing_tenant → file_update_submitted, else
// application_submitted) and emails every active staff member whose role
// is in the event's saved (or default) recipient list.
async function notifyApplicationSubmitted(app) {
  if (!app) return;
  var eventKey = (app.appType === 'existing_tenant') ? 'file_update_submitted' : 'application_submitted';
  var cfg      = _emailEventConfig(eventKey);
  if (!cfg) return;
  var roles    = _emailEventRecipientRoles(eventKey);
  if (!roles.length) {
    console.warn('[notify] no recipient roles configured for ' + eventKey);
    return;
  }
  var recipients = await _resolveActiveStaffForRoles(roles);
  if (!recipients.length) {
    console.warn('[notify] no active staff in roles ' + roles.join(',') + ' for ' + (app.id || 'new app'));
    return;
  }
  var rendered = _renderEmailTemplate(eventKey, app);
  if (!rendered) return;

  recipients.forEach(function(rcp){
    window.sendNotification({
      to:          rcp.email,
      to_name:     rcp.name || '',
      subject:     rendered.subject,
      bodyHtml:    rendered.bodyHtml,
      event:       eventKey,
      entity_type: 'application',
      entity_id:   app.id || '—'
    }).catch(function(err){
      console.warn('[notify] ' + eventKey + ' to ' + rcp.email + ' failed:', err);
    });
  });
}

// Returns the recipient role list for an event — saved override if the
// ED has set one, otherwise the registry default. Always returns an
// array (possibly empty).
function _emailEventRecipientRoles(eventKey) {
  var saved = (window._appSettings && window._appSettings.email_templates
            && window._appSettings.email_templates[eventKey]) || {};
  if (Array.isArray(saved.recipientRoles)) return saved.recipientRoles.slice();
  var cfg = _emailEventConfig(eventKey);
  return (cfg && Array.isArray(cfg.defaultRecipientRoles)) ? cfg.defaultRecipientRoles.slice() : [];
}

// Look up active staff across multiple roles + dedupe by email so a
// staffer with overlapping roles doesn't get two copies of the same
// notification. Order is by the role list passed in (first role's
// matches first), but within a role the order is whatever PostgREST
// returned (no specific guarantee).
async function _resolveActiveStaffForRoles(roles) {
  var seen = {};
  var out  = [];
  for (var i = 0; i < roles.length; i++) {
    var rcps = await _sbLoadActiveStaffByRole(roles[i]);
    for (var j = 0; j < rcps.length; j++) {
      var r = rcps[j];
      if (!r || !r.email) continue;
      var k = r.email.toLowerCase();
      if (seen[k]) continue;
      seen[k] = true;
      out.push(r);
    }
  }
  return out;
}


// ════════════════════════════════════════════════════════════════════════
// Settings -> Notifications tab UI (Phase 2)
// ────────────────────────────────────────────────────────────────────────
// Two-column layout:
//   • Left  - registry-driven event list, click to load template
//   • Right - editor pane (subject + placeholder chips + rich text body
//             + Save/Reset/Send Test buttons)
// All functions in this section are window-globals via plain function
// declarations so onclick="..." handlers in dynamically-rendered HTML
// can reach them (matches the rest of the app's pattern).
// ════════════════════════════════════════════════════════════════════════

// Currently selected event in the editor. Survives across tab re-renders
// in the same session so a misclick on Reset doesn't bounce the user.
var _ntfSelectedEvent = null;

function renderNotificationsTab() {
  var body = document.getElementById('notifications_panel_body');
  if (!body) return;

  // Default to the first event in the registry on first open.
  if (!_ntfSelectedEvent) _ntfSelectedEvent = EMAIL_EVENT_REGISTRY[0] && EMAIL_EVENT_REGISTRY[0].key;

  body.innerHTML =
      '<div class="ntf-grid">'
    +   '<div class="ntf-event-list" id="ntf_event_list">' + _ntfRenderEventListHtml() + '</div>'
    +   '<div class="ntf-editor"      id="ntf_editor">'    + _ntfRenderEditorHtml(_ntfSelectedEvent) + '</div>'
    + '</div>';

  _ntfWireEventListClicks();
  _ntfWireEditor();
}

// Left column — one row per registry entry. Wired (live) events get
// a green dot; pending events get a grey dot so the ED can pre-author
// templates that take effect once the firing point is wired in code.
function _ntfRenderEventListHtml() {
  return EMAIL_EVENT_REGISTRY.map(function(ev){
    var isActive = ev.key === _ntfSelectedEvent;
    var dotCls   = ev.wired ? 'ntf-dot ntf-dot-on' : 'ntf-dot ntf-dot-off';
    var status   = ev.wired ? 'Wired'              : 'Pending';
    return '<button type="button" data-ntf-event="' + _ntfEsc(ev.key) + '" '
         + 'class="ntf-event-item' + (isActive ? ' is-active' : '') + '">'
         + '<span class="' + dotCls + '" title="' + status + '"></span>'
         + '<div class="ntf-event-text">'
         +   '<div class="ntf-event-label">' + _ntfEsc(ev.label) + '</div>'
         +   '<div class="ntf-event-desc">'  + _ntfEsc(ev.description || '') + '</div>'
         + '</div>'
         + '</button>';
  }).join('');
}

// Right column — recipients picker + subject + placeholder chips +
// toolbar + contentEditable body. The current saved (or default)
// template is loaded into the fields; edits are not persisted until Save.
function _ntfRenderEditorHtml(eventKey) {
  var cfg = _emailEventConfig(eventKey);
  if (!cfg) return '<div class="empty-state-italic">Select a notification event from the list to edit it.</div>';

  // Saved override wins, otherwise registry default.
  var saved = (window._appSettings && window._appSettings.email_templates
            && window._appSettings.email_templates[eventKey]) || {};
  var subject  = (saved.subject  != null && saved.subject  !== '') ? saved.subject  : cfg.defaults.subject;
  var bodyHtml = (saved.bodyHtml != null && saved.bodyHtml !== '') ? saved.bodyHtml : cfg.defaults.bodyHtml;
  var roles    = _emailEventRecipientRoles(eventKey);
  var roleSet  = {}; roles.forEach(function(r){ roleSet[r] = true; });

  var roleChecks = NTF_ROLE_CHOICES.map(function(rk){
    var label = (typeof CLFN_PERMS !== 'undefined' && CLFN_PERMS.roleLabel)
                ? CLFN_PERMS.roleLabel(rk) : rk;
    var checked = roleSet[rk] ? ' checked' : '';
    return '<label class="ntf-role-check">'
         +   '<input type="checkbox" data-ntf-role="' + _ntfEsc(rk) + '"' + checked + '/>'
         +   '<span>' + _ntfEsc(label) + '</span>'
         + '</label>';
  }).join('');

  var chips = (cfg.placeholders || []).map(function(t){
    return '<button type="button" class="ntf-chip" data-ntf-token="' + _ntfEsc(t) + '" '
         + 'title="Insert {' + _ntfEsc(t) + '} at cursor">{' + _ntfEsc(t) + '}</button>';
  }).join('');

  var toolbar =
      '<div class="ntf-toolbar" role="toolbar" aria-label="Formatting">'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="bold"               title="Bold (Ctrl+B)"><b>B</b></button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="italic"             title="Italic (Ctrl+I)"><i>I</i></button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="underline"          title="Underline (Ctrl+U)"><u>U</u></button>'
    +   '<span class="ntf-tool-sep"></span>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="formatBlock-p"      title="Paragraph">&para;</button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="insertUnorderedList" title="Bulleted list">&bull;</button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="insertOrderedList"   title="Numbered list">1.</button>'
    +   '<span class="ntf-tool-sep"></span>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="createLink"          title="Insert link">&#128279;</button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="unlink"              title="Remove link">&#10005;&#128279;</button>'
    + '</div>';

  return ''
    + '<div class="ntf-editor-header">'
    +   '<div class="ntf-editor-title">' + _ntfEsc(cfg.label) + '</div>'
    +   '<div class="ntf-editor-meta">'
    +     'Status: <strong>' + (cfg.wired ? 'Wired (live)' : 'Pending wiring') + '</strong>'
    +   '</div>'
    + '</div>'
    + '<div class="ntf-field">'
    +   '<label class="ntf-label">Recipients <span class="ntf-label-hint">(active staff in any ticked role; deduped by email)</span></label>'
    +   '<div class="ntf-roles" id="ntf_roles">' + roleChecks + '</div>'
    + '</div>'
    + '<div class="ntf-field">'
    +   '<label class="ntf-label" for="ntf_subject">Subject</label>'
    +   '<input type="text" id="ntf_subject" class="ntf-input" value="' + _ntfEsc(subject) + '"/>'
    + '</div>'
    + '<div class="ntf-field">'
    +   '<label class="ntf-label">Available placeholders <span class="ntf-label-hint">(click to insert at cursor)</span></label>'
    +   '<div class="ntf-chips" id="ntf_chips">' + chips + '</div>'
    + '</div>'
    + '<div class="ntf-field">'
    +   '<label class="ntf-label">Body</label>'
    +   toolbar
    +   '<div id="ntf_body" class="ntf-body" contenteditable="true">' + bodyHtml + '</div>'
    + '</div>'
    + '<div class="ntf-actions">'
    +   '<button type="button" class="btn btn-primary" onclick="saveNotificationTemplate()">Save</button>'
    +   '<button type="button" class="btn btn-ghost"   onclick="resetNotificationTemplate()">Reset to Default</button>'
    +   '<button type="button" class="btn btn-ghost"   onclick="sendNotificationTest()">Send Test Email</button>'
    + '</div>';
}

function _ntfWireEventListClicks() {
  var list = document.getElementById('ntf_event_list');
  if (!list) return;
  list.querySelectorAll('[data-ntf-event]').forEach(function(btn){
    btn.addEventListener('click', function(){
      _ntfSelectedEvent = btn.getAttribute('data-ntf-event');
      // Re-render only what changed: list selection state + editor pane.
      list.innerHTML = _ntfRenderEventListHtml();
      var ed = document.getElementById('ntf_editor');
      if (ed) ed.innerHTML = _ntfRenderEditorHtml(_ntfSelectedEvent);
      _ntfWireEventListClicks();
      _ntfWireEditor();
    });
  });
}

// Wire the toolbar + placeholder chips. Idempotent so it can be re-run
// after a re-render without piling up listeners.
function _ntfWireEditor() {
  var bodyEl = document.getElementById('ntf_body');
  if (!bodyEl) return;

  // Toolbar
  document.querySelectorAll('.ntf-tool').forEach(function(btn){
    if (btn.getAttribute('data-ntf-bound') === '1') return;
    btn.setAttribute('data-ntf-bound', '1');
    btn.addEventListener('mousedown', function(e){
      // mousedown (not click) so the body editor doesn't lose its
      // selection before we run the command.
      e.preventDefault();
    });
    btn.addEventListener('click', function(e){
      e.preventDefault();
      var cmd = btn.getAttribute('data-ntf-cmd');
      _ntfRunToolbarCmd(cmd, bodyEl);
    });
  });

  // Placeholder chips
  document.querySelectorAll('.ntf-chip').forEach(function(chip){
    if (chip.getAttribute('data-ntf-bound') === '1') return;
    chip.setAttribute('data-ntf-bound', '1');
    chip.addEventListener('mousedown', function(e){ e.preventDefault(); });
    chip.addEventListener('click', function(e){
      e.preventDefault();
      var token = chip.getAttribute('data-ntf-token');
      _ntfInsertAtCursor('{' + token + '}', bodyEl);
    });
  });
}

function _ntfRunToolbarCmd(cmd, bodyEl) {
  bodyEl.focus();
  if (cmd === 'createLink') {
    var url = prompt('Link URL (https://...):', 'https://');
    if (!url) return;
    // Allow only safe schemes
    if (!/^(https?:|mailto:)/i.test(url)) {
      alert('Only http://, https://, and mailto: links are allowed.');
      return;
    }
    document.execCommand('createLink', false, url);
    return;
  }
  if (cmd === 'formatBlock-p') {
    document.execCommand('formatBlock', false, 'P');
    return;
  }
  if (cmd === 'unlink') {
    document.execCommand('unlink', false, null);
    return;
  }
  document.execCommand(cmd, false, null);
}

// Insert plain text at the current selection in the body editor. Used
// by the placeholder chips so the user can drop {applicantName} mid-
// sentence without copy-pasting.
function _ntfInsertAtCursor(text, bodyEl) {
  bodyEl.focus();
  var sel = window.getSelection();
  if (sel && sel.rangeCount && bodyEl.contains(sel.anchorNode)) {
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    // Move cursor to end of inserted text
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    // No selection inside the body — append at the end.
    bodyEl.appendChild(document.createTextNode(text));
  }
}

// Sanitise contentEditable HTML before persisting. Whitelist of safe
// inline/structural tags + a tight attribute filter on links. Anything
// not on the whitelist is replaced with its text content.
var _NTF_TAG_WHITELIST = {
  P:1, BR:1, DIV:1, SPAN:1,
  STRONG:1, B:1, EM:1, I:1, U:1,
  UL:1, OL:1, LI:1,
  A:1
};
function _ntfSanitizeBodyHtml(rawHtml) {
  var doc = new DOMParser().parseFromString('<div id="root">' + rawHtml + '</div>', 'text/html');
  var root = doc.getElementById('root');
  _ntfSanitizeNode(root);
  return root.innerHTML;
}
function _ntfSanitizeNode(node) {
  // Walk a snapshot so removals don't break iteration.
  var children = Array.prototype.slice.call(node.childNodes);
  children.forEach(function(child){
    if (child.nodeType === 1 /* element */) {
      var tag = child.tagName;
      if (!_NTF_TAG_WHITELIST[tag]) {
        // Replace with text content of the disallowed element.
        var text = document.createTextNode(child.textContent || '');
        node.replaceChild(text, child);
        return;
      }
      // Strip every attribute except whitelisted ones.
      var attrs = Array.prototype.slice.call(child.attributes);
      attrs.forEach(function(a){
        var ok = false;
        if (tag === 'A' && a.name === 'href') {
          ok = /^(https?:|mailto:)/i.test(a.value);
        }
        if (!ok) child.removeAttribute(a.name);
      });
      // Force target=_blank rel=noopener on surviving links so they open
      // in a new tab and can't tamper with the opener.
      if (tag === 'A' && child.getAttribute('href')) {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel',    'noopener');
      }
      _ntfSanitizeNode(child);
    } else if (child.nodeType !== 3 /* text */) {
      // Drop comments / processing instructions / etc.
      node.removeChild(child);
    }
  });
}

// Save the current editor state to housing_settings (key=email_templates).
// Uses the existing PostgREST upsert pattern from saveScoringModelED.
// ED-only: same gate as the rest of the editable settings surfaces.
function saveNotificationTemplate() {
  var role = window.currentRole || window._realRole;
  if (role !== 'ed') { showToast('Only the Executive Director can edit notification templates'); return; }
  var ed = _ntfReadEditorState();
  if (!ed) return;
  var all  = (window._appSettings && window._appSettings.email_templates) || {};
  // Clone so we don't mutate the cached copy until the upsert succeeds.
  var next = Object.assign({}, all);
  next[ed.eventKey] = {
    subject:        ed.subject,
    bodyHtml:       ed.bodyHtml,
    recipientRoles: ed.recipientRoles
  };

  fetch(SUPABASE_URL + '/rest/v1/housing_settings', {
    method:  'POST',
    headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body:    JSON.stringify({ key: 'email_templates', value: next })
  }).then(function(r){
    if (!r.ok) { showToast('Save failed - check connection'); return; }
    if (!window._appSettings) window._appSettings = {};
    window._appSettings.email_templates = next;
    if (typeof auditEntry === 'function') {
      auditEntry('SETTINGS', 'email_template_save',
        'Email template updated: ' + ed.eventKey + ' (recipients: ' + ed.recipientRoles.join(',') + ')',
        window.currentRole || 'ed');
    }
    showToast('✓ Template saved');
  }).catch(function(e){
    console.warn('[ntf] save failed:', e);
    showToast('Save failed - see console');
  });
}

// Reset the editor (NOT the saved template) to the registry defaults —
// subject, body, AND recipient role checkboxes. User must click Save
// to actually wipe the persisted override.
function resetNotificationTemplate() {
  if (!_ntfSelectedEvent) return;
  var cfg = _emailEventConfig(_ntfSelectedEvent);
  if (!cfg) return;
  var subj = document.getElementById('ntf_subject');
  var body = document.getElementById('ntf_body');
  if (subj) subj.value     = cfg.defaults.subject;
  if (body) body.innerHTML = cfg.defaults.bodyHtml;
  var defaultRoles = (cfg.defaultRecipientRoles || []).reduce(function(m,r){ m[r] = true; return m; }, {});
  var rolesEl = document.getElementById('ntf_roles');
  if (rolesEl) {
    rolesEl.querySelectorAll('input[type="checkbox"][data-ntf-role]').forEach(function(cb){
      cb.checked = !!defaultRoles[cb.getAttribute('data-ntf-role')];
    });
  }
  showToast('Reverted to default. Click Save to persist.');
}

// Send the current (unsaved) template to the logged-in user's email,
// substituted with mock data so they can preview without touching real
// applications. Tagged event=email_test in the audit log.
function sendNotificationTest() {
  var ed = _ntfReadEditorState();
  if (!ed) return;
  var session = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION) ? HOUSING_SESSION : null;
  var to      = session && session.email;
  if (!to) { showToast('No signed-in email to send to'); return; }

  var mockApp = {
    id:      'APP-TEST-0001',
    fn:      'Jane',
    ln:      'Sample',
    score:   42,
    tier:    'High Priority',
    appType: 'new_housing'
  };
  var tokens = _emailTokens(mockApp);
  var subject  = _substitutePlaceholders(ed.subject,  tokens);
  var bodyHtml = _substitutePlaceholders(ed.bodyHtml, tokens);

  showToast('Sending test to ' + to + '...');
  window.sendNotification({
    to:          to,
    to_name:     (session && session.name) || '',
    subject:     '[TEST] ' + subject,
    bodyHtml:    bodyHtml,
    event:       'email_test',
    entity_type: 'notification_test',
    entity_id:   ed.eventKey
  }).then(function(){
    showToast('✓ Test email sent to ' + to);
  }).catch(function(err){
    console.warn('[ntf] test send failed:', err);
    showToast('Test send failed - see console');
  });
}

// Read + sanitize the current editor state. Returns null on missing
// inputs so callers can early-return cleanly.
function _ntfReadEditorState() {
  if (!_ntfSelectedEvent) { showToast('Pick a notification event first'); return null; }
  var subjEl = document.getElementById('ntf_subject');
  var bodyEl = document.getElementById('ntf_body');
  if (!subjEl || !bodyEl) { showToast('Editor not ready'); return null; }
  var subject  = (subjEl.value || '').trim();
  var bodyHtml = _ntfSanitizeBodyHtml(bodyEl.innerHTML || '');
  if (!subject)  { showToast('Subject is required'); subjEl.focus(); return null; }
  if (!bodyHtml || bodyHtml === '<br>' || bodyHtml.replace(/<[^>]+>/g,'').trim() === '') {
    showToast('Body is required'); bodyEl.focus(); return null;
  }
  var roles = [];
  var rolesEl = document.getElementById('ntf_roles');
  if (rolesEl) {
    rolesEl.querySelectorAll('input[type="checkbox"][data-ntf-role]').forEach(function(cb){
      if (cb.checked) roles.push(cb.getAttribute('data-ntf-role'));
    });
  }
  if (!roles.length) {
    showToast('Pick at least one recipient role');
    return null;
  }
  return {
    eventKey:       _ntfSelectedEvent,
    subject:        subject,
    bodyHtml:       bodyHtml,
    recipientRoles: roles
  };
}

// Tiny HTML escaper used for everything we render into innerHTML where
// the text could contain <, >, &, etc. (Reuses the page-wide escapeHtml
// when available; falls back to a local impl for standalone tests.)
function _ntfEsc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : String(s));
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
