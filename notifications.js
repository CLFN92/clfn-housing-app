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
    key:          'application_submitted',
    label:        'New Application Submitted',
    description:  'Sent to all active Housing Managers when a new applicant submits.',
    recipientRole:'housing_manager',
    wired:        true,
    placeholders: ['applicantName','applicantId','score','tier','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — New Application Submitted: {applicantName}',
      bodyHtml: '<p>A new housing application has been submitted by <strong>{applicantName}</strong> ({applicantId}).</p>'
              + '<p>Score: <strong>{score}</strong> · Tier: <strong>{tier}</strong></p>'
              + '<p>Please log in to the {nationShort} Housing app to review and recommend.</p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  },
  {
    key:          'file_update_submitted',
    label:        'File Update Submitted',
    description:  'Sent to all active Housing Managers when an existing tenant submits a file update.',
    recipientRole:'housing_manager',
    wired:        true,
    placeholders: ['applicantName','applicantId','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — File Update Requires Your Review: {applicantName}',
      bodyHtml: '<p>A file update has been submitted for <strong>{applicantName}</strong> ({applicantId}) and requires your review and approval in the {nationShort} Housing app.</p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  }
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
// application_submitted) and emails every active Housing Manager.
async function notifyApplicationSubmitted(app) {
  if (!app) return;
  var eventKey  = (app.appType === 'existing_tenant') ? 'file_update_submitted' : 'application_submitted';
  var cfg       = _emailEventConfig(eventKey);
  if (!cfg)     return;
  var recipients = await _sbLoadActiveStaffByRole(cfg.recipientRole);
  if (!recipients.length) {
    console.warn('[notify] no active ' + cfg.recipientRole + ' to email for ' + (app.id || 'new app'));
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
