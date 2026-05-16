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
    defaultCcRoles:        [],
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
    defaultCcRoles:        [],
    wired:                 true,
    placeholders:          ['applicantName','applicantId','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — File Update Requires Your Review: {applicantName}',
      bodyHtml: '<p>A file update has been submitted for <strong>{applicantName}</strong> ({applicantId}) and requires your review and approval in the {nationShort} Housing app.</p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  },
  {
    key:                   'sow_created',
    label:                 'Scope of Work Created',
    description:           'Sent on the first save of a new SOW (not on subsequent edits).',
    defaultRecipientRoles: ['housing_manager'],
    defaultCcRoles:        [],
    wired:                 true,
    placeholders:          ['unitAddress','totalCost','condition','contractor','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — New SOW Created: {unitAddress}',
      bodyHtml: '<p>A new Scope of Work has been created for <strong>{unitAddress}</strong> and requires your review.</p>'
              + '<p>Total cost: <strong>{totalCost}</strong></p>'
              + '<p>Condition: <strong>{condition}</strong></p>'
              + '<p>Contractor: <strong>{contractor}</strong></p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  },
  {
    key:                   'contractor_submitted',
    label:                 'New Contractor Submitted for Review',
    description:           'Sent when a new contractor record is submitted (not when saved as draft).',
    defaultRecipientRoles: ['housing_manager'],
    defaultCcRoles:        [],
    wired:                 true,
    placeholders:          ['contractorName','contractorTrade','contractorClassification','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — New Contractor Submitted: {contractorName}',
      bodyHtml: '<p>A new contractor application has been submitted and requires your review and recommendation.</p>'
              + '<p>Contractor: <strong>{contractorName}</strong></p>'
              + '<p>Trade: <strong>{contractorTrade}</strong></p>'
              + '<p>Classification: <strong>{contractorClassification}</strong></p>'
              + '<p><a href="{appLink}">Open {nationShort} Housing</a></p>'
    }
  },
  {
    key:                   'application_confirmation_to_applicant',
    label:                 'Applicant Confirmation (PDF Copy)',
    description:           'Sent to the applicant (and co-applicant if a separate email) on every submit, with a PDF copy of the application attached.',
    recipientType:         'applicant',
    defaultRecipientRoles: [],
    defaultCcRoles:        [],
    wired:                 true,
    placeholders:          ['applicantName','applicantId','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — Application Received: {applicantId}',
      bodyHtml: '<p>Hello {applicantName},</p>'
              + '<p>Thank you for submitting your housing application to {nationShort} Housing. We have received your submission and a copy is attached to this email for your records.</p>'
              + '<p>Your reference ID is <strong>{applicantId}</strong>. Please keep this for any future correspondence.</p>'
              + '<p>The {nationShort} Housing team will review your application and contact you with next steps. If you have any questions in the meantime, reply directly to this email.</p>'
              + '<p>Thank you,<br/>{nationShort} Housing</p>'
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
// substituted from the supplied tokens map. Unknown placeholders left
// untouched in the saved template are replaced with '—' so they never
// reach the recipient as raw {token}.
//
// Per-event notify functions build the tokens map via _emailTokensForApp,
// _emailTokensForSow, _emailTokensForContractor, etc. Adding a new
// entity type = add a token builder + use it from the notify function.
function _renderEmailTemplate(eventKey, tokens) {
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

  return {
    subject:  _substitutePlaceholders(subject,  tokens || {}),
    bodyHtml: _substitutePlaceholders(bodyHtml, tokens || {})
  };
}

// appLink token — best-effort deep link to the housing app at the
// current origin. Shared by every entity-specific token builder so
// recipients always have a way to open the app.
function _emailAppLink() {
  if (typeof window === 'undefined' || !window.location) return '/';
  return window.location.origin + (window.location.pathname.indexOf('/housing.html') >= 0 ? '/housing.html' : '/');
}

function _emailNationShort() {
  return (window.NATION_CONFIG && NATION_CONFIG.short) || 'CLFN';
}

// Build the placeholder token map from an application object.
function _emailTokensForApp(app) {
  var name = ((app && app.fn) || '') + ' ' + ((app && app.ln) || '');
  name = name.trim() || 'Applicant';
  return {
    applicantName: name,
    applicantId:   (app && app.id)    || '—',
    score:         (app && app.score != null) ? String(app.score) : '—',
    tier:          (app && app.tier)  || '—',
    nationShort:   _emailNationShort(),
    appLink:       _emailAppLink()
  };
}

// Build tokens from an SOW save payload. `unitId` falls back to a unit
// lookup for the address when the form's address field is blank.
function _emailTokensForSow(sow, unitId) {
  var addr = (sow && sow.address) || '';
  if (!addr && unitId && typeof housingUnits !== 'undefined') {
    var u = (housingUnits || []).find(function(x){ return x.id === unitId; });
    if (u) addr = ((u.num || '') + ' ' + (u.street || '')).trim();
  }
  if (!addr) addr = unitId || '—';
  return {
    unitAddress: addr,
    totalCost:   (sow && sow.totalCost)  || '—',
    condition:   (sow && sow.condition)  || '—',
    contractor:  (sow && sow.contractor) || '—',
    nationShort: _emailNationShort(),
    appLink:     _emailAppLink()
  };
}

// Build tokens from a contractor record.
function _emailTokensForContractor(ct) {
  var classLabels = {
    internal_indigenous:     'Internal - Indigenous',
    external_indigenous:     'External - Indigenous',
    external_non_indigenous: 'External - Non-Indigenous'
  };
  return {
    contractorName:           (ct && ct.name)  || '—',
    contractorTrade:          (ct && ct.trade) || '—',
    contractorClassification: (ct && classLabels[ct.classification]) || (ct && ct.classification) || '—',
    nationShort:              _emailNationShort(),
    appLink:                  _emailAppLink()
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
  var roles    = _emailEventRecipientRoles(eventKey).concat(_emailEventCcRoles(eventKey));
  if (!roles.length) {
    console.warn('[notify] no recipient roles configured for ' + eventKey);
    return;
  }
  var recipients = await _resolveActiveStaffForRoles(roles);
  if (!recipients.length) {
    console.warn('[notify] no active staff in roles ' + roles.join(',') + ' for ' + (app.id || 'new app'));
    return;
  }
  var rendered = _renderEmailTemplate(eventKey, _emailTokensForApp(app));
  if (!rendered) return;

  await _sendSerially(recipients, function(rcp){
    return {
      to:          rcp.email,
      to_name:     rcp.name || '',
      subject:     rendered.subject,
      bodyHtml:    rendered.bodyHtml,
      event:       eventKey,
      entity_type: 'application',
      entity_id:   app.id || '—'
    };
  }, eventKey);
}

// Send a list of payloads serially (one Graph call at a time) so the
// app stays under Microsoft Graph's MailboxConcurrency throttle (~4
// concurrent sends per app per mailbox). Continues on per-recipient
// failure so one bad address doesn't block the rest.
async function _sendSerially(recipients, payloadBuilder, eventKey) {
  for (var i = 0; i < recipients.length; i++) {
    var rcp = recipients[i];
    try {
      await window.sendNotification(payloadBuilder(rcp));
    } catch (err) {
      console.warn('[notify] ' + eventKey + ' to ' + (rcp.email || rcp) + ' failed:', err);
    }
  }
}

// Wired from saveSOW() in housing-modals-sow.js, only on the FIRST save
// of a SOW (subsequent edits do not re-notify). Emails every active
// staff member whose role is in the saved (or default) recipient list.
async function notifySowCreated(sow, unitId) {
  if (!sow) return;
  var eventKey = 'sow_created';
  var roles    = _emailEventRecipientRoles(eventKey).concat(_emailEventCcRoles(eventKey));
  if (!roles.length) {
    console.warn('[notify] no recipient roles configured for ' + eventKey);
    return;
  }
  var recipients = await _resolveActiveStaffForRoles(roles);
  if (!recipients.length) {
    console.warn('[notify] no active staff in roles ' + roles.join(',') + ' for SOW on ' + (unitId || 'unknown unit'));
    return;
  }
  var rendered = _renderEmailTemplate(eventKey, _emailTokensForSow(sow, unitId));
  if (!rendered) return;

  await _sendSerially(recipients, function(rcp){
    return {
      to:          rcp.email,
      to_name:     rcp.name || '',
      subject:     rendered.subject,
      bodyHtml:    rendered.bodyHtml,
      event:       eventKey,
      entity_type: 'sow',
      entity_id:   unitId || '—'
    };
  }, eventKey);
}

// Wired from saveContractor() in shared-data.js, only when a contractor
// is submitted (status === 'pending_review'). Drafts do not notify
// because there's nothing for an approver to act on yet.
async function notifyContractorSubmitted(ct) {
  if (!ct) return;
  var eventKey = 'contractor_submitted';
  var roles    = _emailEventRecipientRoles(eventKey).concat(_emailEventCcRoles(eventKey));
  if (!roles.length) {
    console.warn('[notify] no recipient roles configured for ' + eventKey);
    return;
  }
  var recipients = await _resolveActiveStaffForRoles(roles);
  if (!recipients.length) {
    console.warn('[notify] no active staff in roles ' + roles.join(',') + ' for contractor ' + (ct.id || ct.name || 'unknown'));
    return;
  }
  var rendered = _renderEmailTemplate(eventKey, _emailTokensForContractor(ct));
  if (!rendered) return;

  await _sendSerially(recipients, function(rcp){
    return {
      to:          rcp.email,
      to_name:     rcp.name || '',
      subject:     rendered.subject,
      bodyHtml:    rendered.bodyHtml,
      event:       eventKey,
      entity_type: 'contractor',
      entity_id:   ct.id || '—'
    };
  }, eventKey);
}

// ── Applicant confirmation w/ PDF attachment ───────────────────────────────
// Wired from finalSubmit() in housing-app.js. Sends a copy of the just-
// submitted application as a PDF to the applicant's email (and the
// co-applicant's email if it's set and different). Silent skip if the
// applicant didn't provide an email — the audit log records the no-op.
async function notifyApplicationConfirmation(app) {
  if (!app) return;
  var eventKey = 'application_confirmation_to_applicant';

  // Collect the applicant's email + co-applicant's email if distinct,
  // PLUS any active staff in the configured CC roles. All deduped by
  // lowercased email so a staffer who happens to also be the applicant
  // doesn't get two copies.
  var seen   = {};
  var emails = [];
  function _addEmail(addr) {
    if (!addr) return;
    var clean = String(addr).trim().toLowerCase();
    if (!clean || seen[clean]) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return;
    seen[clean] = true;
    emails.push(clean);
  }
  _addEmail(app.email);
  _addEmail(app.co_email);

  // Additional staff recipients: primary + CC role checkboxes from the
  // Settings -> Notifications tab. Both default to empty for this event
  // (applicant is the only required recipient). Combined + deduped
  // against the applicant emails already collected above.
  var extraRoles = _emailEventRecipientRoles(eventKey).concat(_emailEventCcRoles(eventKey));
  if (extraRoles.length) {
    var extraRecipients = await _resolveActiveStaffForRoles(extraRoles);
    extraRecipients.forEach(function(r){ _addEmail(r.email); });
  }

  if (!emails.length) {
    console.log('[notify] application_confirmation skipped - no applicant email or CC recipients on ' + (app.id || 'app'));
    return;
  }

  // Render template (reuses applicant token builder — same placeholder set).
  var rendered = _renderEmailTemplate(eventKey, _emailTokensForApp(app));
  if (!rendered) return;

  // Generate the PDF from the live form (the just-submitted form is still
  // in the DOM at this point). If the PDF generator fails for any reason,
  // we still send the email — just without the attachment, with a note in
  // the body. Best-effort: never block delivery on PDF rendering.
  var pdfBase64 = null;
  try {
    pdfBase64 = await _generateApplicationPdfBase64();
  } catch (e) {
    console.warn('[notify] PDF generation failed, sending without attachment:', e);
  }

  var attachments;
  var bodyHtml = rendered.bodyHtml;
  if (pdfBase64) {
    attachments = [{
      name:         'Application ' + (app.id || 'submitted') + '.pdf',
      contentType:  'application/pdf',
      contentBytes: pdfBase64
    }];
  } else {
    bodyHtml += '<p style="color:#888;font-size:12px;font-style:italic;">'
              + '(PDF copy could not be generated automatically. Reply to this email to request one.)'
              + '</p>';
  }

  await _sendSerially(emails.map(function(e){ return { email: e }; }), function(rcp){
    return {
      to:          rcp.email,
      to_name:     '',
      subject:     rendered.subject,
      bodyHtml:    bodyHtml,
      attachments: attachments,
      event:       eventKey,
      entity_type: 'application',
      entity_id:   app.id || '—'
    };
  }, eventKey);
}

// Lazy-load a CDN script and resolve once it's available. Used to pull
// in jsPDF and html2canvas on demand — neither is loaded on every page,
// so the application-confirmation flow grabs them when first needed.
function _loadScriptOnce(src, isAvailable) {
  return new Promise(function(resolve, reject){
    if (isAvailable && isAvailable()) return resolve();
    var s = document.createElement('script');
    s.src     = src;
    s.onload  = function(){ resolve(); };
    s.onerror = function(){ reject(new Error('script load failed: ' + src)); };
    document.head.appendChild(s);
  });
}
async function _loadJsPdf() {
  await _loadScriptOnce(
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    function(){ return !!(window.jspdf && window.jspdf.jsPDF); }
  );
}
// Generate the applicant confirmation PDF as a text-rendered (vector)
// document using jsPDF's native text + line primitives. Walks the live
// form fields the same way printApplicationPreview() does, but emits
// selectable text rather than rasterised HTML. Signature canvases are
// embedded as small PNG images at the end (the only raster content).
// Output is typically ~20-60 KB and the text stays sharp at any zoom.
async function _generateApplicationPdfBase64() {
  await _loadJsPdf();
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not available');

  var pdf       = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  var pageW     = pdf.internal.pageSize.getWidth();   // 210
  var pageH     = pdf.internal.pageSize.getHeight();  // 297
  var marginL = 14, marginR = 14, marginT = 14, marginB = 14;
  var contentW  = pageW - marginL - marginR;
  var y         = marginT;
  var pageNum   = 1;

  // ── Layout primitives ─────────────────────────────────────────────
  function drawFooter() {
    pdf.setFontSize(8);
    pdf.setTextColor(140);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Page ' + pageNum, pageW - marginR, pageH - 6, { align: 'right' });
    pdf.setTextColor(0);
  }
  function needSpace(h) {
    if (y + h > pageH - marginB) {
      drawFooter();
      pdf.addPage();
      pageNum++;
      y = marginT;
    }
  }
  function sectionHeader(title) {
    needSpace(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(String(title).toUpperCase(), marginL, y + 3);
    pdf.setDrawColor(248, 228, 26);   // CLFN yellow
    pdf.setLineWidth(0.8);
    pdf.line(marginL, y + 4.5, pageW - marginR, y + 4.5);
    pdf.setDrawColor(0);
    pdf.setTextColor(0);
    y += 7;
  }
  function row(label, value) {
    var labelW = 55;
    var gap    = 3;
    var valueX = marginL + labelW + gap;
    var valueW = contentW - labelW - gap;
    var v      = (value == null || value === '') ? '—' : String(value);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    var labelLines = pdf.splitTextToSize(label, labelW);
    var valueLines = pdf.splitTextToSize(v,    valueW);
    var rowH = Math.max(labelLines.length, valueLines.length) * 4 + 1;
    needSpace(rowH + 1);

    pdf.setTextColor(110);
    pdf.text(labelLines, marginL, y + 3);
    pdf.setTextColor(20);
    pdf.text(valueLines, valueX, y + 3);

    y += rowH;
    pdf.setDrawColor(230);
    pdf.setLineWidth(0.1);
    pdf.line(marginL, y, pageW - marginR, y);
    pdf.setDrawColor(0);
    y += 1.5;
  }
  function paragraph(text, fontSize) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(fontSize || 9);
    pdf.setTextColor(40);
    var lines = pdf.splitTextToSize(String(text), contentW);
    needSpace(lines.length * 4 + 2);
    pdf.text(lines, marginL, y + 3);
    y += lines.length * 4 + 2;
    pdf.setTextColor(0);
  }
  function gap(h) { y += (h || 3); }

  // ── Form readers ──────────────────────────────────────────────────
  function fld(id) {
    var e = document.getElementById(id);
    return (e && e.value && String(e.value).trim()) ? String(e.value).trim() : '';
  }
  function chk(id) {
    var e = document.getElementById(id); return e ? !!e.checked : false;
  }
  function yn(v) { return v ? 'Yes' : 'No'; }
  function fmtPhone(v) {
    return (typeof formatPhone === 'function' && v) ? formatPhone(v) : (v || '');
  }
  function fmtCur(v) {
    if (v == null || v === '') return '';
    if (typeof formatCurrency === 'function' && typeof parseCurrency === 'function') {
      return formatCurrency(parseCurrency(v));
    }
    return '$' + v;
  }
  function dollarQ(sel) {
    var e = document.querySelector(sel); return e ? fmtCur(e.value) : '';
  }
  function getSig(canvasId) {
    if (typeof getSigDataURL === 'function') {
      try { return getSigDataURL(canvasId); } catch (e) { return ''; }
    }
    var c = document.getElementById(canvasId);
    try { return c ? c.toDataURL('image/png') : ''; } catch (e) { return ''; }
  }

  var today   = new Date().toLocaleDateString('en-CA');
  var appId   = (typeof currentAppId !== 'undefined' && currentAppId) ? currentAppId : '—';
  var nation  = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.name)) || '';
  var short   = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var fnVal   = fld('fn');
  var lnVal   = fld('ln');
  var fullName= (fnVal + ' ' + lnVal).trim() || '—';
  var hasCoApp= (document.getElementById('co_status') || {}).value === 'yes';
  var hasHouse= chk('hasHouseToggle');
  var hasArr  = chk('arrToggle');

  // ── HEADER ────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text((short ? short + ' ' : '') + 'Housing Application', marginL, y + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  if (nation) pdf.text(nation, marginL, y + 10);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(20);
  pdf.text(fullName, pageW - marginR, y + 5, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  pdf.text(appId,             pageW - marginR, y + 10, { align: 'right' });
  pdf.text('Date: ' + today,  pageW - marginR, y + 15, { align: 'right' });
  y += 17;
  pdf.setDrawColor(248, 228, 26);
  pdf.setLineWidth(1);
  pdf.line(marginL, y, pageW - marginR, y);
  pdf.setDrawColor(0);
  pdf.setTextColor(0);
  y += 6;

  // ── 1. APPLICANT INFORMATION ──────────────────────────────────────
  sectionHeader('Applicant Information');
  row('First Name',             fld('fn'));
  row('Last Name',              fld('ln'));
  row('Date of Birth',          fld('dob'));
  row('Band Number',            fld('band'));
  row('On Reserve Status',      fld('reserve'));
  row('Marital Status',         fld('marital'));
  row('Cell Phone',             fmtPhone(fld('phone')));
  row('Email Address',          fld('email'));
  row('Application Date',       fld('appDate'));
  row('Accessibility Needs',    fld('accessibility'));
  row('Housing Classification',
    typeof getHousingClassification === 'function' ? getHousingClassification() : '');
  gap();

  // ── 2. CURRENT ADDRESS ────────────────────────────────────────────
  sectionHeader('Current Address');
  row('Street Address',           fld('street'));
  row('City',                     fld('city'));
  row('Province',                 fld('prov'));
  row('Postal Code',              fld('postal'));
  row('Expected Occupancy Date',  fld('occDate'));
  gap();

  // ── 3. CURRENT HOUSING & ARREARS ──────────────────────────────────
  sectionHeader('Current Housing & Arrears');
  row('Currently Has a House', yn(hasHouse));
  if (hasHouse) {
    row('Home Condition',       fld('homeCondition'));
    row('Est. Renovation Cost', dollarQ('#homeCondBlk input[type="number"]'));
  }
  row('Arrears Owed to ' + (short || 'CLFN'), yn(hasArr));
  var arrNums  = document.querySelectorAll('#arrBlk input[type="number"]');
  var arrDates = document.querySelectorAll('#arrBlk input[type="date"]');
  var arrSel   = document.querySelector('#arrBlk select');
  row('Amount Owed',        hasArr ? fmtCur(arrNums[0] && arrNums[0].value) : 'N/A');
  row('Monthly Payment',    hasArr ? fmtCur(arrNums[1] && arrNums[1].value) : 'N/A');
  row('Plan Duration',      hasArr ? (arrNums[3] && arrNums[3].value ? arrNums[3].value + ' months' : '—') : 'N/A');
  row('Payment Frequency',  hasArr ? (arrSel ? arrSel.value : '') : 'N/A');
  row('Agreement Date',     hasArr ? (arrDates[0] ? arrDates[0].value : '') : 'N/A');
  gap();

  // ── 4. EMPLOYMENT & INCOME ────────────────────────────────────────
  sectionHeader('Employment & Income');
  var incomeRows = 0;
  document.querySelectorAll('#incomeList .rrow').forEach(function(r, i){
    var sels = r.querySelectorAll('select');
    var nums = r.querySelectorAll('input[type="number"]');
    var txts = r.querySelectorAll('input[type="text"]');
    var person = sels[0] ? sels[0].value : '';
    var type   = sels[1] ? sels[1].value : '';
    var amt    = nums[0] && nums[0].value ? fmtCur(nums[0].value) : '';
    var emp    = txts[0] ? txts[0].value : '';
    row(person || ('Income ' + (i + 1)),
        type + (amt ? ' — ' + amt : '') + (emp ? ' · ' + emp : ''));
    incomeRows++;
  });
  if (!incomeRows) row('Income / Employment', '');
  gap();

  // ── 5. CO-APPLICANT ───────────────────────────────────────────────
  sectionHeader('Co-Applicant');
  row('Co-Applicant', hasCoApp ? 'Yes' : 'No');
  if (hasCoApp) {
    row('First Name',     fld('co_fn'));
    row('Last Name',      fld('co_ln'));
    row('Date of Birth',  fld('co_dob'));
    row('Band Number',    fld('co_band'));
    row('Reserve Status', fld('co_reserve'));
    row('Cell Phone',     fmtPhone(fld('co_cell')));
    row('Email',          fld('co_email'));
  }
  gap();

  // ── 6. HOUSEHOLD MEMBERS ──────────────────────────────────────────
  sectionHeader('Household Members');
  var habRows = 0;
  document.querySelectorAll('#habList .rrow').forEach(function(r, i){
    var txts = r.querySelectorAll('input[type="text"]');
    var dt   = r.querySelector('input[type="date"]');
    var sel  = r.querySelector('select');
    var nm   = [(txts[0] ? txts[0].value : ''), (txts[1] ? txts[1].value : '')]
                 .filter(Boolean).join(' ') || ('Member ' + (i + 1));
    row(nm, (sel ? sel.value : '') + (dt && dt.value ? ' · DOB: ' + dt.value : ''));
    habRows++;
  });
  if (!habRows) row('Household Members', '');
  gap();

  // ── 7. REFERENCES ─────────────────────────────────────────────────
  sectionHeader('References');
  var refRows = 0;
  document.querySelectorAll('#refList .rrow').forEach(function(r, i){
    var txts = r.querySelectorAll('input[type="text"]');
    var tels = r.querySelectorAll('input[type="tel"]');
    var ems  = r.querySelectorAll('input[type="email"]');
    var sel  = r.querySelector('select');
    var nm   = [(txts[0] ? txts[0].value : ''), (txts[1] ? txts[1].value : '')]
                 .filter(Boolean).join(' ') || ('Reference ' + (i + 1));
    row(nm, (sel ? sel.value : '')
          + (tels[0] && tels[0].value ? ' · ' + fmtPhone(tels[0].value) : '')
          + (ems[0]  && ems[0].value  ? ' · ' + ems[0].value : ''));
    refRows++;
  });
  if (!refRows) row('References', '');
  gap();

  // ── 8. PETS ───────────────────────────────────────────────────────
  var petRows = document.querySelectorAll('#petList .rrow');
  if (petRows.length) {
    sectionHeader('Pets');
    petRows.forEach(function(r, i){
      var txts = r.querySelectorAll('input[type="text"]');
      var sels = r.querySelectorAll('select');
      var ta   = r.querySelector('textarea');
      var nm   = txts[0] ? txts[0].value : ('Pet ' + (i + 1));
      row(nm, [(sels[0] ? sels[0].value : ''),
               (sels[1] ? sels[1].value : ''),
               (ta      ? ta.value      : '')].filter(Boolean).join(' · '));
    });
    gap();
  }

  // ── 9. SUPPORTING DOCUMENTS ───────────────────────────────────────
  sectionHeader('Supporting Documents Submitted');
  var docLabels = ['Government Issued Photo ID', 'Proof of Band Membership',
                   'Income / Employment Letter', 'Last 2 Pay Stubs',
                   'Utility Bills',              'Arrears Payment Agreement'];
  document.querySelectorAll('#step6 input[type="checkbox"]').forEach(function(cb, i){
    row(docLabels[i] || ('Doc ' + (i + 1)), cb.checked ? 'Included' : 'Not included');
  });
  gap();

  // ── TERMS & CONDITIONS ────────────────────────────────────────────
  needSpace(20);
  sectionHeader('Terms & Conditions — Applicant Declaration');
  paragraph('By signing below, I hereby apply for housing assistance from the '
    + (nation ? nation + ' ' : '')
    + (short  ? '(' + short + ') ' : '')
    + 'Housing Program and declare the following:');
  gap(1);

  var consented = (document.getElementById('consent_share_programs') || {}).checked;
  var terms = [
    'All information provided in this application is true, accurate, and complete to the best of my knowledge.',
    'I understand that providing false or misleading information may result in immediate disqualification and removal from the housing waitlist.',
    'I consent to ' + (short || 'CLFN') + ' collecting, using, and sharing my personal information for the purpose of assessing this application, in accordance with applicable privacy legislation (PIPEDA).'
  ];
  if (consented) {
    terms.push('I consent to ' + (short || 'CLFN') + ' Housing sharing relevant information from this application with other '
      + (nation || 'CLFN')
      + ' programs and departments — including but not limited to Health, Education, Wellness, Ontario Works, and Finance — strictly for the purpose of supporting and coordinating services connected to my housing application. Sharing will occur only with authorized staff, on a need-to-know basis, in accordance with applicable privacy legislation (PIPEDA). I may withdraw this consent in writing to the Housing Manager at any time.');
  }
  terms.push('I understand that my application will be scored according to the ' + (short || 'CLFN') + ' Housing Scoring Rubric and that priority is determined by score, not date of application alone.');
  terms.push('I agree to notify the ' + (short || 'CLFN') + ' Housing Department within 30 days of any change in household composition, income, address, or contact information.');
  terms.push('I understand that acceptance into ' + (short || 'CLFN') + ' housing is conditional upon satisfying all outstanding arrears or entering into a formal payment arrangement approved by ' + (short || 'CLFN') + ' prior to occupancy.');
  terms.push('I agree to comply with all ' + (short || 'CLFN') + ' Housing policies, lease agreements, and community by-laws as a condition of tenancy.');
  terms.push('I authorize ' + (short || 'CLFN') + ' to verify any information in this application with relevant third parties including employers, financial institutions, and utility providers.');

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(40);
  terms.forEach(function(t, i) {
    var lines = pdf.splitTextToSize((i + 1) + '. ' + t, contentW - 4);
    needSpace(lines.length * 4 + 1.5);
    pdf.text(lines, marginL + 3, y + 3);
    y += lines.length * 4 + 1.5;
  });
  pdf.setTextColor(0);
  gap();

  // ── CONSENT CONFIRMED BOX (when ticked) ───────────────────────────
  if (consented) {
    var boxH = 26;
    needSpace(boxH + 2);
    pdf.setFillColor(240, 253, 244);
    pdf.setDrawColor(21, 128, 61);
    pdf.setLineWidth(0.5);
    pdf.rect(marginL, y, contentW, boxH, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(21, 128, 61);
    pdf.text('[X] Consent to Share — CLFN Programs — CONFIRMED', marginL + 3, y + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(40);
    var cLines = pdf.splitTextToSize(
      'The applicant has consented to ' + (short || 'CLFN')
      + ' Housing sharing relevant information from this application with other '
      + (nation || 'CLFN')
      + ' programs and departments — including Health, Education, Wellness, Ontario Works, and Finance — in support of this housing application.',
      contentW - 6
    );
    pdf.text(cLines, marginL + 3, y + 10);
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    var capturedBy = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION && HOUSING_SESSION.email)
      ? ' · Captured by ' + HOUSING_SESSION.email : '';
    pdf.text('Recorded: ' + today + capturedBy, marginL + 3, y + boxH - 2);
    pdf.setTextColor(0);
    pdf.setDrawColor(0);
    y += boxH + 4;
  }

  // ── SIGNATURES ────────────────────────────────────────────────────
  var sigBlockH = 34;
  needSpace(sigBlockH + 10);
  sectionHeader('Signatures');

  var sigCount  = hasCoApp ? 3 : 2;
  var sigGap    = 4;
  var sigW      = (contentW - (sigCount - 1) * sigGap) / sigCount;
  var sigAppImg = getSig('sig_canvas_app');
  var sigCoImg  = getSig('sig_canvas_co');
  var sigStaImg = getSig('sig_canvas_staff');
  var sigName   = fld('sig_name') || fullName;
  var sigDate   = fld('sig_date') || today;
  var coFn      = fld('co_fn');
  var coLn      = fld('co_ln');
  var coSigName = fld('sig_co_name') || ((coFn + ' ' + coLn).trim() || '—');
  var staffName = fld('sig_staff') || '—';
  var staffDate = fld('sig_recv')  || today;

  function drawSig(x, label, name, date, imgUrl) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text(String(label).toUpperCase(), x, y + 3);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(20);
    pdf.text('Name: ' + (name || '—'), x, y + 8);
    pdf.text('Date: ' + (date || '—'), x, y + 12);
    pdf.setDrawColor(180);
    pdf.setLineWidth(0.2);
    pdf.rect(x, y + 14, sigW, sigBlockH - 14);
    if (imgUrl) {
      try { pdf.addImage(imgUrl, 'PNG', x + 1, y + 15, sigW - 2, sigBlockH - 16); }
      catch (e) { /* ignore unreadable canvas */ }
    } else {
      pdf.setFontSize(7);
      pdf.setTextColor(180);
      pdf.text('(unsigned)', x + sigW / 2, y + sigBlockH - 3, { align: 'center' });
    }
    pdf.setDrawColor(0);
    pdf.setTextColor(0);
  }

  var sigX = marginL;
  drawSig(sigX, 'Applicant', sigName, sigDate, sigAppImg);
  sigX += sigW + sigGap;
  if (hasCoApp) {
    drawSig(sigX, 'Co-Applicant', coSigName, sigDate, sigCoImg);
    sigX += sigW + sigGap;
  }
  drawSig(sigX, 'Received by — Housing Staff', staffName, staffDate, sigStaImg);
  y += sigBlockH + 4;

  // Footer on the final page
  drawFooter();

  var dataUri = pdf.output('datauristring');
  var base64  = dataUri.substring(dataUri.indexOf(',') + 1);
  console.log('[notify/pdf] generated base64 length:', base64.length,
              '(~' + Math.round(base64.length * 0.75 / 1024) + 'KB,', pageNum,
              'page' + (pageNum === 1 ? '' : 's') + ')');
  return base64;
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

// Same shape for the optional CC role list. Empty by default for every
// event; the ED can opt-in via the Settings -> Notifications tab.
function _emailEventCcRoles(eventKey) {
  var saved = (window._appSettings && window._appSettings.email_templates
            && window._appSettings.email_templates[eventKey]) || {};
  if (Array.isArray(saved.ccRoles)) return saved.ccRoles.slice();
  var cfg = _emailEventConfig(eventKey);
  return (cfg && Array.isArray(cfg.defaultCcRoles)) ? cfg.defaultCcRoles.slice() : [];
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
  // Recipients block - unified layout across every event:
  //   1) Primary Recipients - either the applicant's email (fixed, for
  //      applicant-type events) OR a role checklist (everyone else).
  //   2) Optional CC - always a role checklist, defaulting to nothing
  //      ticked. Anyone ticked here gets a copy in addition to the
  //      primary recipient(s). Deduped at send time.
  var primaryRoles = _emailEventRecipientRoles(eventKey);
  var ccRoles      = _emailEventCcRoles(eventKey);

  function _buildRoleChecks(checkedRoles, gridDataAttr) {
    var set = {}; (checkedRoles || []).forEach(function(r){ set[r] = true; });
    return NTF_ROLE_CHOICES.map(function(rk){
      var label = (typeof CLFN_PERMS !== 'undefined' && CLFN_PERMS.roleLabel)
                  ? CLFN_PERMS.roleLabel(rk) : rk;
      var checked = set[rk] ? ' checked' : '';
      return '<label class="ntf-role-check">'
           +   '<input type="checkbox" ' + gridDataAttr + '="' + _ntfEsc(rk) + '"' + checked + '/>'
           +   '<span>' + _ntfEsc(label) + '</span>'
           + '</label>';
    }).join('');
  }

  // Primary block. Every event renders the role checkbox grid so the
  // editor pane reads consistently. Applicant-type events ALSO show a
  // static info line above the grid noting the applicant's email is
  // always included as a primary recipient — the grid then adds
  // additional staff roles on top of the applicant.
  var primaryBlock = '';
  if (cfg.recipientType === 'applicant') {
    primaryBlock +=
        '<div class="ntf-recipients-fixed">'
      +   'Always sends to the <strong>applicant&#39;s email</strong> from the application form '
      +   '(plus the <strong>co-applicant&#39;s email</strong> if it differs).'
      + '</div>';
  }
  primaryBlock += '<div class="ntf-roles" id="ntf_roles">'
               + _buildRoleChecks(primaryRoles, 'data-ntf-role')
               + '</div>';

  // Optional CC block — identical structure across every event so the
  // editor pane reads consistently. Different data-attr so the reader
  // can tell the two grids apart.
  var ccBlock = '<div class="ntf-roles" id="ntf_cc_roles">'
              + _buildRoleChecks(ccRoles, 'data-ntf-cc-role')
              + '</div>';

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
    +   '<label class="ntf-label">Recipients' + (cfg.recipientType === 'applicant'
          ? ''
          : ' <span class="ntf-label-hint">(active staff in any ticked role)</span>') + '</label>'
    +   primaryBlock
    + '</div>'
    + '<div class="ntf-field">'
    +   '<label class="ntf-label">Optional CC <span class="ntf-label-hint">(active staff in any ticked role; deduped against the primary recipients)</span></label>'
    +   ccBlock
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
    recipientRoles: ed.recipientRoles,
    ccRoles:        ed.ccRoles
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
      var _detail = 'Email template updated: ' + ed.eventKey
                  + ' (recipients: ' + (ed.recipientRoles.join(',') || '-')
                  + '; cc: '         + (ed.ccRoles.join(',')        || '-')
                  + ')';
      auditEntry('SETTINGS', 'email_template_save', _detail, window.currentRole || 'ed');
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
  // Restore both checkbox grids from registry defaults. For applicant-
  // type events there's no primary grid (no #ntf_roles in the DOM), so
  // the querySelectorAll is a no-op there.
  var defaultRoles = (cfg.defaultRecipientRoles || []).reduce(function(m,r){ m[r] = true; return m; }, {});
  var rolesEl = document.getElementById('ntf_roles');
  if (rolesEl) {
    rolesEl.querySelectorAll('input[type="checkbox"][data-ntf-role]').forEach(function(cb){
      cb.checked = !!defaultRoles[cb.getAttribute('data-ntf-role')];
    });
  }
  var defaultCc = (cfg.defaultCcRoles || []).reduce(function(m,r){ m[r] = true; return m; }, {});
  var ccEl = document.getElementById('ntf_cc_roles');
  if (ccEl) {
    ccEl.querySelectorAll('input[type="checkbox"][data-ntf-cc-role]').forEach(function(cb){
      cb.checked = !!defaultCc[cb.getAttribute('data-ntf-cc-role')];
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

  var tokens   = _ntfMockTokensForEvent(ed.eventKey);
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

// Mock data for Send Test — picks the right token builder per event so
// every notification can be previewed against representative-looking
// values. Add a new branch here when adding a new entity type.
function _ntfMockTokensForEvent(eventKey) {
  if (eventKey === 'application_submitted'
   || eventKey === 'file_update_submitted'
   || eventKey === 'application_confirmation_to_applicant') {
    return _emailTokensForApp({
      id: 'APP-TEST-0001', fn: 'Jane', ln: 'Sample',
      score: 42, tier: 'High Priority', appType: 'new_housing'
    });
  }
  if (eventKey === 'sow_created') {
    return _emailTokensForSow({
      address:    '123 Test Street',
      totalCost:  '$15,000',
      condition:  'Habitable - needs work',
      contractor: 'Sample Contractor Ltd.'
    }, 'TEST-UNIT');
  }
  if (eventKey === 'contractor_submitted') {
    return _emailTokensForContractor({
      id:             'CT-TEST-0001',
      name:           'Sample Contractor Ltd.',
      trade:          'General Contractor',
      classification: 'internal_indigenous'
    });
  }
  // Fallback — only the always-available tokens are populated.
  return {
    nationShort: _emailNationShort(),
    appLink:     _emailAppLink()
  };
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
  // Read both checkbox grids. Primary (#ntf_roles) is required for
  // non-applicant events; applicant-type events have no primary grid
  // because the applicant's email is the fixed primary recipient.
  // CC (#ntf_cc_roles) is always optional.
  var cfg   = _emailEventConfig(_ntfSelectedEvent);
  var roles = [];
  var rolesEl = document.getElementById('ntf_roles');
  if (rolesEl) {
    rolesEl.querySelectorAll('input[type="checkbox"][data-ntf-role]').forEach(function(cb){
      if (cb.checked) roles.push(cb.getAttribute('data-ntf-role'));
    });
  }
  var ccRoles = [];
  var ccEl = document.getElementById('ntf_cc_roles');
  if (ccEl) {
    ccEl.querySelectorAll('input[type="checkbox"][data-ntf-cc-role]').forEach(function(cb){
      if (cb.checked) ccRoles.push(cb.getAttribute('data-ntf-cc-role'));
    });
  }
  if ((!cfg || cfg.recipientType !== 'applicant') && !roles.length) {
    showToast('Pick at least one recipient role');
    return null;
  }
  return {
    eventKey:       _ntfSelectedEvent,
    subject:        subject,
    bodyHtml:       bodyHtml,
    recipientRoles: roles,
    ccRoles:        ccRoles
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


// ════════════════════════════════════════════════════════════════════════
// Settings -> Config tab (display-only reference)
// ────────────────────────────────────────────────────────────────────────
// Shows the non-secret values used at app setup time (today: the
// Microsoft Graph email pipeline IDs). All values are read from
// shared-config.js constants - the actual sending continues to use
// the Supabase Edge Function secrets, which are NEVER exposed here.
// Editing is via the deep-link to the Supabase Dashboard.
// ════════════════════════════════════════════════════════════════════════

async function renderConfigPanel() {
  var body = document.getElementById('config_panel_body');
  if (!body) return;

  var gc = window.CLFN_GRAPH_CONFIG || {};

  // Project ref from the Supabase URL drives the deep-link to the
  // Edge Function secrets page. Falls back to the dashboard root if
  // we can't parse the project ref.
  var projectRef = '';
  if (typeof SUPABASE_URL === 'string') {
    var m = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (m) projectRef = m[1];
  }
  var secretsUrl = projectRef
    ? 'https://supabase.com/dashboard/project/' + projectRef + '/settings/functions'
    : 'https://supabase.com/dashboard';
  var entraUrl = 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/'
               + encodeURIComponent(gc.clientId || '');

  // Pipeline health — recent email_sent rows from the audit log.
  var health = await _renderPipelineHealth();

  body.innerHTML =
      '<div class="cfg-section">'
    +   '<div class="cfg-section-title">Email pipeline (Microsoft Graph)</div>'
    +   '<div class="cfg-section-sub">Reference only. Update the actual secrets via the Supabase Dashboard.</div>'

    +   '<div class="cfg-grid">'
    +     _cfgRow('Entra app',          gc.appName  || '—')
    +     _cfgRow('Tenant ID',          gc.tenantId || '—', { mono: true, copy: true })
    +     _cfgRow('Client ID',          gc.clientId || '—', { mono: true, copy: true })
    +     _cfgRow('FROM mailbox',       gc.fromUser || '—', { mono: true, copy: true })
    +     _cfgRow('Reply-To',           gc.replyTo  || '—', { mono: true })
    +     _cfgRow('Client secret',      'Stored in Supabase secrets - not shown', { muted: true })
    +   '</div>'

    +   '<div class="cfg-health">' + health + '</div>'

    +   '<div class="cfg-actions">'
    +     '<a class="btn btn-primary" href="' + _ntfEsc(secretsUrl) + '" target="_blank" rel="noopener">Open Supabase Edge Function Secrets</a>'
    +     '<a class="btn btn-ghost"   href="' + _ntfEsc(entraUrl)   + '" target="_blank" rel="noopener">Open Entra App Registration</a>'
    +   '</div>'
    + '</div>';
}

function _cfgRow(label, value, opts) {
  opts = opts || {};
  var valClass = 'cfg-value' + (opts.mono ? ' is-mono' : '') + (opts.muted ? ' is-muted' : '');
  var copyBtn  = opts.copy
    ? ' <button type="button" class="cfg-copy" onclick="_cfgCopyValue(this)" title="Copy">&#128203;</button>'
    : '';
  return '<div class="cfg-row">'
       +   '<div class="cfg-label">' + _ntfEsc(label) + '</div>'
       +   '<div class="' + valClass + '"><span class="cfg-value-text">' + _ntfEsc(value) + '</span>' + copyBtn + '</div>'
       + '</div>';
}

function _cfgCopyValue(btn) {
  try {
    var txt = btn.parentNode.querySelector('.cfg-value-text');
    var val = txt ? (txt.textContent || '') : '';
    if (!val) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(function(){ showToast('Copied'); });
    } else {
      // Fallback for older browsers
      var ta = document.createElement('textarea');
      ta.value = val; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Copied');
    }
  } catch (e) {
    console.warn('[cfg] copy failed:', e);
  }
}

// Pipeline health card — queries housing_audit_log for recent email_sent
// rows. Best-effort: any error renders as "status unknown" so the panel
// stays usable when the API is unreachable.
async function _renderPipelineHealth() {
  try {
    var sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var url = SUPABASE_URL + '/rest/v1/housing_audit_log'
            + '?select=created_at,action,detail'
            + '&entity_type=eq.notification'
            + '&created_at=gte.' + encodeURIComponent(sinceIso)
            + '&order=created_at.desc&limit=50';
    var r = await fetch(url, { headers: HOUSING_HEADERS });
    if (!r.ok) return _healthBlock('unknown', 'Could not load recent send history.');
    var rows = await r.json();
    if (!rows.length) return _healthBlock('warn', 'No sends in the last 7 days.');
    var last = rows[0];
    var when = new Date(last.created_at);
    var ageMin = Math.round((Date.now() - when.getTime()) / 60000);
    var ageLabel = ageMin < 60 ? (ageMin + ' min ago')
                 : ageMin < 1440 ? (Math.round(ageMin / 60) + ' h ago')
                 : (Math.round(ageMin / 1440) + ' d ago');
    return _healthBlock('ok',
        '<strong>Last send:</strong> ' + _ntfEsc(when.toLocaleString()) + ' (' + ageLabel + ')<br/>'
      + _ntfEsc(last.detail || '') + '<br/>'
      + '<span class="cfg-health-meta">' + rows.length + ' send' + (rows.length === 1 ? '' : 's') + ' in the last 7 days.</span>');
  } catch (e) {
    console.warn('[cfg] pipeline health load failed:', e);
    return _healthBlock('unknown', 'Could not load recent send history.');
  }
}

function _healthBlock(level, html) {
  var cls = 'cfg-health-box cfg-health-' + level;
  var icon = level === 'ok' ? '&#9989;' : level === 'warn' ? '&#9888;&#65039;' : '&#10067;';
  return '<div class="' + cls + '">'
       +   '<div class="cfg-health-icon">' + icon + '</div>'
       +   '<div class="cfg-health-body">' + html + '</div>'
       + '</div>';
}
