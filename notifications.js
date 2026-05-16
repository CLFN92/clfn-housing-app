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
  },
  {
    key:                   'sow_tenant_copy',
    label:                 'Tenant Copy of SOW (PDF)',
    description:           'Sent to the tenant on SOW submit (only if the tenant has an email on file and the preparer ticks the inline checkbox). PDF of the SOW is attached.',
    recipientType:         'tenant',
    defaultRecipientRoles: [],
    defaultCcRoles:        [],
    wired:                 true,
    placeholders:          ['tenantName','unitAddress','projectNumber','totalCost','condition','contractor','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — Scope of Work for {unitAddress}',
      bodyHtml: '<p>Hello {tenantName},</p>'
              + '<p>A Scope of Work has been prepared for <strong>{unitAddress}</strong> and a copy is attached to this email for your records.</p>'
              + '<p>Project #: <strong>{projectNumber}</strong><br/>'
              +    'Estimated cost: <strong>{totalCost}</strong><br/>'
              +    'Condition: <strong>{condition}</strong><br/>'
              +    'Contractor: <strong>{contractor}</strong></p>'
              + '<p>If you have any questions, please reply to this email or contact the {nationShort} Housing office.</p>'
              + '<p>Thank you,<br/>{nationShort} Housing</p>'
    }
  },
  {
    key:                   'sow_work_order_to_contractor',
    label:                 'Work Order to Contractor (PDF)',
    description:           'Sent to the assigned contractor when an HM or ED approves the SOW (only if the contractor has an email on file and the approver ticks the inline checkbox). PDF work order is attached.',
    recipientType:         'contractor',
    defaultRecipientRoles: [],
    defaultCcRoles:        [],
    wired:                 true,
    placeholders:          ['contractorName','unitAddress','projectNumber','totalCost','tenantName','startDate','endDate','nationShort','appLink'],
    defaults: {
      subject:  '{nationShort} Housing — Work Order: {unitAddress} ({projectNumber})',
      bodyHtml: '<p>Hello {contractorName},</p>'
              + '<p>A Work Order has been approved for the project below and is attached to this email for your records.</p>'
              + '<p>Unit address: <strong>{unitAddress}</strong><br/>'
              +    'Project #: <strong>{projectNumber}</strong><br/>'
              +    'Tenant: <strong>{tenantName}</strong><br/>'
              +    'Estimated value: <strong>{totalCost}</strong><br/>'
              +    'Start date: <strong>{startDate}</strong><br/>'
              +    'Target completion: <strong>{endDate}</strong></p>'
              + '<p>Please review the attached Work Order. Work may only proceed on the items listed; any change to scope requires written approval before commencing. Invoices must reference this Work Order and unit address.</p>'
              + '<p>If you have any questions, please reply to this email or contact the {nationShort} Housing office.</p>'
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

// Build tokens for the tenant-copy variant of the SOW email. Reuses the
// SOW builder fields but adds the tenantName + projectNumber tokens the
// tenant-facing template uses. `unit` is the housing_units row (for the
// fallback address derivation); `tenantName` is the resolved tenant name
// — taken from the SOW form field if entered, else from unit.assignedName.
function _emailTokensForSowTenant(sow, unit, tenantName) {
  var base = _emailTokensForSow(sow, unit && unit.id);
  base.tenantName    = tenantName || (sow && sow.tenantName) || (unit && unit.assignedName) || '—';
  base.projectNumber = (sow && sow.project_number) || '—';
  return base;
}

// Build tokens for the work-order-to-contractor email. Mirrors the tenant
// builder but keys on contractorName instead, and surfaces the start/end
// dates the contractor cares about. `contractor` is the contractors row;
// `tenantName` falls back to unit.assignedName.
function _emailTokensForWorkOrder(sow, unit, contractor) {
  var base = _emailTokensForSow(sow, unit && unit.id);
  base.contractorName = (contractor && contractor.name) || (sow && sow.contractor) || '—';
  base.tenantName     = (sow && sow.tenantName) || (unit && unit.assignedName) || '—';
  base.projectNumber  = (sow && sow.project_number) || '—';
  base.startDate      = (sow && sow.startDate) || '—';
  base.endDate        = (sow && sow.endDate)   || '—';
  return base;
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

// ── Shared PDF scaffolding ──────────────────────────────────────────────────
// Called by each _generate*PdfBase64 function. Returns a ctx object with
// the pdf instance, layout constants, mutable cursor state (ctx.y /
// ctx.pageNum), and six shared layout primitives. ctx.finish() stamps the
// final page footer and returns the base64 string.
function _makePdfDoc() {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not available');
  var pdf      = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  var pageW    = pdf.internal.pageSize.getWidth();
  var pageH    = pdf.internal.pageSize.getHeight();
  var marginL  = 14, marginR = 14, marginT = 14, marginB = 14;
  var contentW = pageW - marginL - marginR;

  var ctx = {
    pdf: pdf, pageW: pageW, pageH: pageH,
    marginL: marginL, marginR: marginR, marginT: marginT, marginB: marginB,
    contentW: contentW,
    y: marginT, pageNum: 1
  };

  ctx.drawFooter = function() {
    pdf.setFontSize(8);
    pdf.setTextColor(140);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Page ' + ctx.pageNum, pageW - marginR, pageH - 6, { align: 'right' });
    pdf.setTextColor(0);
  };
  ctx.needSpace = function(h) {
    if (ctx.y + h > pageH - marginB) {
      ctx.drawFooter();
      pdf.addPage();
      ctx.pageNum++;
      ctx.y = marginT;
    }
  };
  ctx.sectionHeader = function(title) {
    ctx.needSpace(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(String(title).toUpperCase(), marginL, ctx.y + 3);
    pdf.setDrawColor(248, 228, 26);
    pdf.setLineWidth(0.8);
    pdf.line(marginL, ctx.y + 4.5, pageW - marginR, ctx.y + 4.5);
    pdf.setDrawColor(0);
    pdf.setTextColor(0);
    ctx.y += 7;
  };
  ctx.row = function(label, value) {
    var labelW = 55, colGap = 3;
    var valueX = marginL + labelW + colGap;
    var valueW = contentW - labelW - colGap;
    var v = (value == null || value === '') ? '—' : String(value);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    var labelLines = pdf.splitTextToSize(label, labelW);
    var valueLines = pdf.splitTextToSize(v, valueW);
    var rowH = Math.max(labelLines.length, valueLines.length) * 4 + 1;
    ctx.needSpace(rowH + 1);
    pdf.setTextColor(110);
    pdf.text(labelLines, marginL, ctx.y + 3);
    pdf.setTextColor(20);
    pdf.text(valueLines, valueX, ctx.y + 3);
    ctx.y += rowH;
    pdf.setDrawColor(230);
    pdf.setLineWidth(0.1);
    pdf.line(marginL, ctx.y, pageW - marginR, ctx.y);
    pdf.setDrawColor(0);
    ctx.y += 1.5;
  };
  ctx.paragraph = function(text, fontSize) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(fontSize || 9);
    pdf.setTextColor(40);
    var lines = pdf.splitTextToSize(String(text), contentW);
    ctx.needSpace(lines.length * 4 + 2);
    pdf.text(lines, marginL, ctx.y + 3);
    ctx.y += lines.length * 4 + 2;
    pdf.setTextColor(0);
  };
  ctx.gap = function(h) { ctx.y += (h || 3); };
  ctx.finish = function() {
    ctx.drawFooter();
    var dataUri = pdf.output('datauristring');
    return dataUri.substring(dataUri.indexOf(',') + 1);
  };

  return ctx;
}

async function _generateApplicationPdfBase64() {
  await _loadJsPdf();
  var ctx         = _makePdfDoc();
  var pdf         = ctx.pdf, pageW = ctx.pageW, pageH = ctx.pageH;
  var marginL     = ctx.marginL, marginR = ctx.marginR, marginT = ctx.marginT;
  var contentW    = ctx.contentW;
  var needSpace   = ctx.needSpace.bind(ctx);
  var sectionHeader = ctx.sectionHeader.bind(ctx);
  var row         = ctx.row.bind(ctx);
  var paragraph   = ctx.paragraph.bind(ctx);
  var gap         = ctx.gap.bind(ctx);

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
  pdf.text((short ? short + ' ' : '') + 'Housing Application', marginL, ctx.y + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  if (nation) pdf.text(nation, marginL, ctx.y + 10);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(20);
  pdf.text(fullName, pageW - marginR, ctx.y + 5, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  pdf.text(appId,             pageW - marginR, ctx.y + 10, { align: 'right' });
  pdf.text('Date: ' + today,  pageW - marginR, ctx.y + 15, { align: 'right' });
  ctx.y += 17;
  pdf.setDrawColor(248, 228, 26);
  pdf.setLineWidth(1);
  pdf.line(marginL, ctx.y, pageW - marginR, ctx.y);
  pdf.setDrawColor(0);
  pdf.setTextColor(0);
  ctx.y += 6;

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

  var consented    = (document.getElementById('consent_share_programs') || {}).checked;
  var _tParsed     = _termsParseHtml(typeof getTermsBody === 'function' ? getTermsBody('housing_application') : '');
  var termsIntro   = _tParsed.intro || ('By signing below, I hereby apply for housing assistance from the '
    + (nation ? nation + ' ' : '') + (short ? '(' + short + ') ' : '')
    + 'Housing Program and declare the following:');
  var terms        = _tParsed.items.length ? _tParsed.items : [
    'All information provided in this application is true, accurate, and complete to the best of my knowledge.',
    'I understand that providing false or misleading information may result in immediate disqualification and removal from the housing waitlist.',
    'I consent to ' + (short || 'CLFN') + ' collecting, using, and sharing my personal information for the purpose of assessing this application, in accordance with applicable privacy legislation (PIPEDA).',
    'I understand that my application will be scored according to the ' + (short || 'CLFN') + ' Housing Scoring Rubric and that priority is determined by score, not date of application alone.',
    'I agree to notify the ' + (short || 'CLFN') + ' Housing Department within 30 days of any change in household composition, income, address, or contact information.',
    'I understand that acceptance into ' + (short || 'CLFN') + ' housing is conditional upon satisfying all outstanding arrears or entering into a formal payment arrangement approved by ' + (short || 'CLFN') + ' prior to occupancy.',
    'I agree to comply with all ' + (short || 'CLFN') + ' Housing policies, lease agreements, and community by-laws as a condition of tenancy.',
    'I authorize ' + (short || 'CLFN') + ' to verify any information in this application with relevant third parties including employers, financial institutions, and utility providers.'
  ];

  paragraph(termsIntro);
  gap(1);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(40);
  terms.forEach(function(t, i) {
    var lines = pdf.splitTextToSize((i + 1) + '. ' + t, contentW - 4);
    needSpace(lines.length * 4 + 1.5);
    pdf.text(lines, marginL + 3, ctx.y + 3);
    ctx.y += lines.length * 4 + 1.5;
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
    pdf.rect(marginL, ctx.y, contentW, boxH, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(21, 128, 61);
    pdf.text('[X] Consent to Share — ' + (short || '') + ' Programs — CONFIRMED', marginL + 3, ctx.y + 5);
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
    pdf.text(cLines, marginL + 3, ctx.y + 10);
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    var capturedBy = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION && HOUSING_SESSION.email)
      ? ' · Captured by ' + HOUSING_SESSION.email : '';
    pdf.text('Recorded: ' + today + capturedBy, marginL + 3, ctx.y + boxH - 2);
    pdf.setTextColor(0);
    pdf.setDrawColor(0);
    ctx.y += boxH + 4;
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
    pdf.text(String(label).toUpperCase(), x, ctx.y + 3);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(20);
    pdf.text('Name: ' + (name || '—'), x, ctx.y + 8);
    pdf.text('Date: ' + (date || '—'), x, ctx.y + 12);
    pdf.setDrawColor(180);
    pdf.setLineWidth(0.2);
    pdf.rect(x, ctx.y + 14, sigW, sigBlockH - 14);
    if (imgUrl) {
      try { pdf.addImage(imgUrl, 'PNG', x + 1, ctx.y + 15, sigW - 2, sigBlockH - 16); }
      catch (e) { /* ignore unreadable canvas */ }
    } else {
      pdf.setFontSize(7);
      pdf.setTextColor(180);
      pdf.text('(unsigned)', x + sigW / 2, ctx.y + sigBlockH - 3, { align: 'center' });
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
  ctx.y += sigBlockH + 4;

  return ctx.finish();
}

// ── SOW PDF generator ─────────────────────────────────────────────────────
// Mirrors _generateApplicationPdfBase64 but emits a Scope of Work doc. Reads
// from the live SOW modal form fields (the modal is still open at notify
// time, same as the application-confirmation flow). Selectable text, sharp
// at any zoom; tenant + staff signatures embedded as PNG images.
async function _generateSowPdfBase64() {
  await _loadJsPdf();
  var ctx         = _makePdfDoc();
  var pdf         = ctx.pdf, pageW = ctx.pageW, pageH = ctx.pageH;
  var marginL     = ctx.marginL, marginR = ctx.marginR, marginT = ctx.marginT;
  var contentW    = ctx.contentW;
  var needSpace   = ctx.needSpace.bind(ctx);
  var sectionHeader = ctx.sectionHeader.bind(ctx);
  var row         = ctx.row.bind(ctx);
  var paragraph   = ctx.paragraph.bind(ctx);
  var gap         = ctx.gap.bind(ctx);

  function fld(id) {
    var e = document.getElementById(id);
    return (e && e.value && String(e.value).trim()) ? String(e.value).trim() : '';
  }
  function chk(id) {
    var e = document.getElementById(id); return e ? !!e.checked : false;
  }
  function fmtCur(v) {
    if (v == null || v === '') return '';
    if (typeof formatCurrency === 'function') {
      var n = parseFloat(String(v).replace(/[^0-9.\-]/g,'')) || 0;
      return formatCurrency(n);
    }
    return String(v);
  }
  function getSig(canvasId) {
    if (typeof getSigDataURL === 'function') {
      try { return getSigDataURL(canvasId); } catch (e) { return ''; }
    }
    var c = document.getElementById(canvasId);
    try { return c ? c.toDataURL('image/png') : ''; } catch (e) { return ''; }
  }

  var today    = new Date().toLocaleDateString('en-CA');
  var nation   = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.name)) || '';
  var short    = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var projNum  = (window._sowEditingProjectNumber) || '—';
  var unitAddr = fld('sow_address') || '—';

  // Header
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text((short ? short + ' ' : '') + 'Scope of Work', marginL, ctx.y + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  if (nation) pdf.text(nation + ' — Housing Department', marginL, ctx.y + 10);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(20);
  pdf.text(unitAddr,           pageW - marginR, ctx.y + 5,  { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  pdf.text(projNum,            pageW - marginR, ctx.y + 10, { align: 'right' });
  pdf.text('Date: ' + today,   pageW - marginR, ctx.y + 15, { align: 'right' });
  ctx.y += 17;
  pdf.setDrawColor(248, 228, 26);
  pdf.setLineWidth(1);
  pdf.line(marginL, ctx.y, pageW - marginR, ctx.y);
  pdf.setDrawColor(0);
  pdf.setTextColor(0);
  ctx.y += 6;

  // Unit Information
  sectionHeader('Unit Information');
  row('Unit Address',     unitAddr);
  row('Current Tenant',   fld('sow_tenant_name'));
  row('Project Number',   projNum);
  row('Date Prepared',    fld('sow_date'));
  row('Prepared By',      fld('sow_prepared_by'));
  row('Contractor',       fld('sow_contractor'));
  gap();

  // Condition & Schedule
  sectionHeader('Condition Assessment & Schedule');
  row('Overall Condition',     fld('sow_condition'));
  row('Estimated Total Cost',  fmtCur(fld('sow_total_cost')) || '—');
  row('Target Start Date',     fld('sow_start_date'));
  row('Target Completion',     fld('sow_end_date'));
  gap();

  // Scope of Work items — table-style rows using the row() helper.
  sectionHeader('Scope of Work Items');
  var items = (typeof collectSowItems === 'function') ? collectSowItems() : [];
  var filtered = items.filter(function(it){ return it.category || it.description || it.cost; });
  if (filtered.length) {
    filtered.forEach(function(it){
      var cost = it.cost ? fmtCur(it.cost) : '—';
      row((it.category || '—'),
          (it.description || '—') + '  ·  ' + cost);
    });
  } else {
    row('Scope Items', 'No line items added.');
  }
  gap();

  // Health & Safety hazards
  var hazards = [
    {id:'sow_mold',       label:'Mould / Mildew'},
    {id:'sow_asbestos',   label:'Asbestos Risk'},
    {id:'sow_electrical', label:'Electrical Hazard'},
    {id:'sow_structural', label:'Structural Concern'},
    {id:'sow_plumbing',   label:'Plumbing / Sewage'},
    {id:'sow_fire',       label:'Fire Safety'}
  ].filter(function(h){ return chk(h.id); }).map(function(h){ return h.label; });
  if (hazards.length) {
    sectionHeader('Health & Safety Concerns');
    paragraph(hazards.join(' · '));
    gap();
  }

  // Notes
  var sowNotes = fld('sow_notes');
  if (sowNotes) {
    sectionHeader('Additional Notes');
    paragraph(sowNotes);
    gap();
  }

  // Tenant Accountability
  var acctFlags = [];
  if (chk('sow_rent_arrears'))  acctFlags.push('Rent arrears');
  if (chk('sow_tenant_damage')) acctFlags.push('Tenant damage');
  if (chk('sow_negligence'))    acctFlags.push('Negligence');
  if (chk('sow_vandalism'))     acctFlags.push('Vandalism');
  if (chk('sow_police_report')) acctFlags.push('Police report on file');
  var acctNotes = fld('sow_accountability_notes');
  if (acctFlags.length || acctNotes) {
    sectionHeader('Tenant Accountability');
    if (acctFlags.length) paragraph(acctFlags.join(' · '));
    if (acctNotes)        paragraph(acctNotes);
    gap();
  }

  // Signatures
  sectionHeader('Signatures');
  var tenantSig    = getSig('sow_sig_canvas_tenant');
  var staffSig     = getSig('sow_sig_canvas_staff');
  var tenantName   = fld('sow_sig_tenant_name') || fld('sow_tenant_name') || '—';
  var tenantDate   = fld('sow_sig_tenant_date') || '—';
  var staffName    = fld('sow_sig_staff_name')  || fld('sow_prepared_by') || '—';
  var staffDate    = fld('sow_sig_staff_date')  || today;

  var sigBlockH = 26;
  var sigGap    = 6;
  var sigW      = (contentW - sigGap) / 2;
  needSpace(sigBlockH + 6);

  function drawSig(x, title, name, date, imgUrl) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(60);
    pdf.text(title, x, ctx.y + 4);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(110);
    pdf.text((name || '—') + '  ·  ' + (date || '—'), x, ctx.y + 9);
    pdf.setDrawColor(200);
    pdf.setLineWidth(0.2);
    pdf.rect(x, ctx.y + 11, sigW, sigBlockH - 11);
    if (imgUrl) {
      try { pdf.addImage(imgUrl, 'PNG', x + 1, ctx.y + 12, sigW - 2, sigBlockH - 13); }
      catch (e) { /* ignore unreadable canvas */ }
    } else {
      pdf.setFontSize(7);
      pdf.setTextColor(180);
      pdf.text('(unsigned)', x + sigW / 2, ctx.y + sigBlockH - 3, { align: 'center' });
    }
    pdf.setDrawColor(0);
    pdf.setTextColor(0);
  }
  drawSig(marginL,                'Tenant Signature',        tenantName, tenantDate, tenantSig);
  drawSig(marginL + sigW + sigGap,'Housing Staff Signature', staffName,  staffDate,  staffSig);
  ctx.y += sigBlockH + 4;

  return ctx.finish();
}

// Resolve the tenant's email from the tenants table by looking up the
// unit's assigned_name. Returns '' on any error / no match. The tenants
// table is the source of truth (TIC reads from it) and unit.assignedName
// is trigger-synced from housing_units.assigned_name — same join that
// the TIC's _ticResolveTenant uses, just slimmed down for one column.
async function _resolveTenantEmailForUnit(unit) {
  if (!unit || !unit.assignedName) return '';
  if (typeof SUPABASE_URL === 'undefined' || typeof HOUSING_HEADERS === 'undefined') return '';
  try {
    var url = SUPABASE_URL
            + '/rest/v1/tenants?select=email&full_name=eq.'
            + encodeURIComponent(unit.assignedName);
    var r = await fetch(url, { headers: HOUSING_HEADERS });
    if (!r.ok) {
      console.warn('[notify] tenant email lookup HTTP ' + r.status);
      return '';
    }
    var rows = await r.json();
    var email = (rows && rows[0] && rows[0].email) || '';
    return String(email || '').trim();
  } catch (e) {
    console.warn('[notify] tenant email lookup error:', e);
    return '';
  }
}

// Wired from saveSOW() in housing-modals-sow.js when the preparer ticks
// the inline "Email a copy to the tenant" checkbox on the submit
// confirmation. Sends the SOW PDF to the tenant's email + any active
// staff in CC roles configured on the Settings -> Notifications tab.
// Silent skip when there's no tenant email AND no CC roles configured.
async function notifySowTenantCopy(sow, unit) {
  if (!sow) return;
  var eventKey = 'sow_tenant_copy';

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

  // Tenant email — silent skip if nothing on file.
  var tenantEmail = await _resolveTenantEmailForUnit(unit);
  _addEmail(tenantEmail);

  // Additional staff recipients: primary + CC role checkboxes from the
  // Settings -> Notifications tab. Both default to empty for this event.
  var extraRoles = _emailEventRecipientRoles(eventKey).concat(_emailEventCcRoles(eventKey));
  if (extraRoles.length) {
    var extraRecipients = await _resolveActiveStaffForRoles(extraRoles);
    extraRecipients.forEach(function(r){ _addEmail(r.email); });
  }

  if (!emails.length) {
    console.log('[notify] sow_tenant_copy skipped - no tenant email or CC recipients for SOW ' + (sow.project_number || '—'));
    return;
  }

  var tenantName = (sow.tenantName) || (unit && unit.assignedName) || '';
  var rendered = _renderEmailTemplate(eventKey, _emailTokensForSowTenant(sow, unit, tenantName));
  if (!rendered) return;

  // Generate the SOW PDF. Best-effort — never block delivery on PDF.
  var pdfBase64 = null;
  try {
    pdfBase64 = await _generateSowPdfBase64();
  } catch (e) {
    console.warn('[notify] SOW PDF generation failed, sending without attachment:', e);
  }

  var attachments;
  var bodyHtml = rendered.bodyHtml;
  if (pdfBase64) {
    attachments = [{
      name:         'SOW ' + (sow.project_number || 'scope') + '.pdf',
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
      entity_type: 'sow',
      entity_id:   sow.project_number || '—'
    };
  }, eventKey);
}

// ── Work Order PDF generator ──────────────────────────────────────────────
// Mirrors printWorkOrder's structure (contractor-facing variant of the SOW
// PDF). Reads from the live SOW modal form fields. Different from the SOW
// PDF: surfaces line-item quoted prices (not estimates), includes the
// Work Authorization notice, and has signature lines for both the
// contractor representative and the authorized housing signatory.
async function _generateWorkOrderPdfBase64() {
  await _loadJsPdf();
  var ctx         = _makePdfDoc();
  var pdf         = ctx.pdf, pageW = ctx.pageW, pageH = ctx.pageH;
  var marginL     = ctx.marginL, marginR = ctx.marginR, marginT = ctx.marginT;
  var contentW    = ctx.contentW;
  var needSpace   = ctx.needSpace.bind(ctx);
  var sectionHeader = ctx.sectionHeader.bind(ctx);
  var row         = ctx.row.bind(ctx);
  var paragraph   = ctx.paragraph.bind(ctx);
  var gap         = ctx.gap.bind(ctx);

  function fld(id) {
    var e = document.getElementById(id);
    return (e && e.value && String(e.value).trim()) ? String(e.value).trim() : '';
  }
  function fmtCur(v) {
    if (v == null || v === '') return '';
    if (typeof formatCurrency === 'function') {
      var n = parseFloat(String(v).replace(/[^0-9.\-]/g,'')) || 0;
      return formatCurrency(n);
    }
    return String(v);
  }

  var today    = new Date().toLocaleDateString('en-CA');
  var nation   = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.name)) || '';
  var short    = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var projNum  = (window._sowEditingProjectNumber) || '—';
  var unitAddr = fld('sow_address') || '—';

  // Header
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text((short ? short + ' ' : '') + 'Work Order', marginL, ctx.y + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  if (nation) pdf.text(nation + ' — Housing Department', marginL, ctx.y + 10);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(20);
  pdf.text(unitAddr,           pageW - marginR, ctx.y + 5,  { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  pdf.text(projNum,            pageW - marginR, ctx.y + 10, { align: 'right' });
  pdf.text('Date: ' + today,   pageW - marginR, ctx.y + 15, { align: 'right' });
  ctx.y += 17;
  pdf.setDrawColor(248, 228, 26);
  pdf.setLineWidth(1);
  pdf.line(marginL, ctx.y, pageW - marginR, ctx.y);
  pdf.setDrawColor(0);
  pdf.setTextColor(0);
  ctx.y += 6;

  // Project Information
  sectionHeader('Project Information');
  row('Unit Address',     unitAddr);
  row('Tenant',           fld('sow_tenant_name'));
  row('Contractor',       fld('sow_contractor'));
  row('Issued By',        fld('sow_prepared_by'));
  row('Start Date',       fld('sow_start_date'));
  row('Completion Date',  fld('sow_end_date'));
  row('Project Number',   projNum);
  gap();

  // Scope of Work — use quoted price when available, fall back to estimate.
  sectionHeader('Scope of Work');
  var items = (typeof collectSowItems === 'function') ? collectSowItems() : [];
  var filtered = items.filter(function(it){ return it.category || it.description || it.quote || it.cost; });
  var quoteTotal = 0;
  var hasQuotes  = false;
  if (filtered.length) {
    filtered.forEach(function(it){
      var price;
      if (it.quote && parseFloat(it.quote) > 0) {
        quoteTotal += parseFloat(it.quote);
        hasQuotes   = true;
        price       = fmtCur(it.quote);
      } else {
        price = 'Pending';
      }
      row((it.category || '—'),
          (it.description || '—') + '  ·  ' + price);
    });
    if (hasQuotes) {
      row('Total Quoted Amount', fmtCur(quoteTotal));
    } else {
      row('Pricing', 'To be confirmed by contractor.');
    }
  } else {
    row('Scope Items', 'No line items added.');
  }
  gap();

  // Work Authorization notice
  sectionHeader('Work Authorization');
  var _woParsed    = _termsParseHtml(typeof getTermsBody === 'function' ? getTermsBody('work_order') : '');
  var woTermsIntro = _woParsed.intro;
  var woTermsItems = _woParsed.items;
  if (woTermsIntro) paragraph(woTermsIntro);
  if (woTermsItems.length) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(40);
    woTermsItems.forEach(function(t, i) {
      var lines = pdf.splitTextToSize((i + 1) + '. ' + t, contentW - 4);
      needSpace(lines.length * 4 + 1.5);
      pdf.text(lines, marginL + 3, ctx.y + 3);
      ctx.y += lines.length * 4 + 1.5;
    });
    pdf.setTextColor(0);
  } else {
    paragraph(
      'The contractor is authorized to perform only the work described above. '
      + 'Any additional work or changes to scope must be approved in writing by ' + (short || 'CLFN')
      + ' Housing before work commences. Invoices must reference this Work Order and unit address. '
      + 'Payment is subject to satisfactory completion and inspection.'
    );
  }
  gap();

  // Notes
  var sowNotes = fld('sow_notes');
  if (sowNotes) {
    sectionHeader('Additional Notes');
    paragraph(sowNotes);
    gap();
  }

  // Signature blocks — empty lines; this is a printed/signed artifact.
  sectionHeader('Authorization');
  var sigBlockH = 26;
  var sigGap    = 6;
  var sigW      = (contentW - sigGap) / 2;
  needSpace(sigBlockH + 6);
  function sigBox(x, role) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(60);
    pdf.text(role, x, ctx.y + 4);
    pdf.setDrawColor(160);
    pdf.setLineWidth(0.3);
    // Signature line
    pdf.line(x, ctx.y + 16, x + sigW, ctx.y + 16);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(120);
    pdf.text('Signature', x, ctx.y + 20);
    pdf.text('Date: ____________', x + sigW, ctx.y + 20, { align: 'right' });
    pdf.text('Print name: ____________________________', x, ctx.y + 25);
    pdf.setDrawColor(0);
    pdf.setTextColor(0);
  }
  sigBox(marginL,                'Contractor Representative');
  sigBox(marginL + sigW + sigGap,(short || 'CLFN') + ' Housing — Authorized Signatory');
  ctx.y += sigBlockH + 4;

  return ctx.finish();
}

// Resolve the contractor's email + name from the in-memory cache first,
// falling back to Supabase REST if the cache is empty (sub-pages may not
// have loaded contractors yet). Returns { email, name } or null.
async function _resolveContractorForEmail(contractorId) {
  if (!contractorId) return null;
  var cache = window._contractors || [];
  for (var i = 0; i < cache.length; i++) {
    if (cache[i] && cache[i].id === contractorId) {
      var e = (cache[i].email || '').trim();
      return e ? { email: e, name: cache[i].name || '' } : null;
    }
  }
  if (typeof SUPABASE_URL === 'undefined' || typeof HOUSING_HEADERS === 'undefined') return null;
  try {
    var url = SUPABASE_URL
            + '/rest/v1/contractors?select=name,email&id=eq.'
            + encodeURIComponent(contractorId);
    var r = await fetch(url, { headers: HOUSING_HEADERS });
    if (!r.ok) {
      console.warn('[notify] contractor email lookup HTTP ' + r.status);
      return null;
    }
    var rows = await r.json();
    var row  = rows && rows[0];
    var em   = row && (row.email || '').trim();
    return em ? { email: em, name: row.name || '' } : null;
  } catch (e) {
    console.warn('[notify] contractor email lookup error:', e);
    return null;
  }
}

// Wired from saveSOW() when the save transitions the SOW into an approved
// state (hm_approved or ed_approved) AND the approver ticked the inline
// checkbox on the post-save "send work order?" confirm. Silent skip when
// no contractor is assigned, no email on file, or save is fire-and-forget
// and any step throws. CC roles configurable via Settings -> Notifications.
async function notifyWorkOrderToContractor(sow, unit, contractor) {
  if (!sow) return;
  var eventKey = 'sow_work_order_to_contractor';

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

  if (contractor && contractor.email) _addEmail(contractor.email);

  // Additional staff recipients: primary + CC role checkboxes.
  var extraRoles = _emailEventRecipientRoles(eventKey).concat(_emailEventCcRoles(eventKey));
  if (extraRoles.length) {
    var extraRecipients = await _resolveActiveStaffForRoles(extraRoles);
    extraRecipients.forEach(function(r){ _addEmail(r.email); });
  }

  if (!emails.length) {
    console.log('[notify] sow_work_order_to_contractor skipped - no contractor email or CC recipients for SOW ' + (sow.project_number || '—'));
    return;
  }

  var rendered = _renderEmailTemplate(eventKey, _emailTokensForWorkOrder(sow, unit, contractor));
  if (!rendered) return;

  var pdfBase64 = null;
  try {
    pdfBase64 = await _generateWorkOrderPdfBase64();
  } catch (e) {
    console.warn('[notify] Work Order PDF generation failed, sending without attachment:', e);
  }

  var attachments;
  var bodyHtml = rendered.bodyHtml;
  if (pdfBase64) {
    attachments = [{
      name:         'Work Order ' + (sow.project_number || 'wo') + '.pdf',
      contentType:  'application/pdf',
      contentBytes: pdfBase64
    }];
  } else {
    bodyHtml += '<p style="color:#888;font-size:12px;font-style:italic;">'
              + '(Work Order PDF could not be generated automatically. Reply to this email to request one.)'
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
      entity_type: 'sow',
      entity_id:   sow.project_number || '—'
    };
  }, eventKey);
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
  // editor pane reads consistently. Applicant- and tenant-type events
  // ALSO show a static info line above the grid noting the implicit
  // recipient — the grid then adds additional staff roles on top.
  var primaryBlock = '';
  if (cfg.recipientType === 'applicant') {
    primaryBlock +=
        '<div class="ntf-recipients-fixed">'
      +   'Always sends to the <strong>applicant&#39;s email</strong> from the application form '
      +   '(plus the <strong>co-applicant&#39;s email</strong> if it differs).'
      + '</div>';
  } else if (cfg.recipientType === 'tenant') {
    primaryBlock +=
        '<div class="ntf-recipients-fixed">'
      +   'Always sends to the <strong>tenant&#39;s email</strong> from their Tenant Information Card '
      +   '(silent skip if no email is on file).'
      + '</div>';
  } else if (cfg.recipientType === 'contractor') {
    primaryBlock +=
        '<div class="ntf-recipients-fixed">'
      +   'Always sends to the <strong>assigned contractor&#39;s email</strong> from their contractor record '
      +   '(silent skip if no email is on file).'
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
    +   '<label class="ntf-label">Recipients' + (cfg.recipientType === 'applicant' || cfg.recipientType === 'tenant' || cfg.recipientType === 'contractor'
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
  if (eventKey === 'sow_tenant_copy') {
    return _emailTokensForSowTenant({
      address:        '123 Test Street',
      project_number: '123 Test Street-SOW-001',
      totalCost:      '$15,000',
      condition:      'Habitable - needs work',
      contractor:     'Sample Contractor Ltd.',
      tenantName:     'Jane Sample'
    }, null, 'Jane Sample');
  }
  if (eventKey === 'sow_work_order_to_contractor') {
    return _emailTokensForWorkOrder({
      address:        '123 Test Street',
      project_number: '123 Test Street-SOW-001',
      totalCost:      '$15,000',
      tenantName:     'Jane Sample',
      startDate:      '2026-06-01',
      endDate:        '2026-07-15'
    }, null, { name: 'Sample Contractor Ltd.' });
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
  var isImplicitRecipient = cfg && (cfg.recipientType === 'applicant' || cfg.recipientType === 'tenant' || cfg.recipientType === 'contractor');
  if (!isImplicitRecipient && !roles.length) {
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


// ════════════════════════════════════════════════════════════════════════
// Settings → Terms & Conditions tab
// ────────────────────────────────────────────────────────────────────────
// Two-column layout mirroring the Notifications tab:
//   Left  - document list (Housing Application T&C, Work Order T&C)
//   Right - rich text editor (toolbar + contenteditable body)
// Saved to housing_settings key='terms_and_conditions' as
//   { housing_application: { bodyHtml: '...' }, work_order: { bodyHtml: '...' } }
// Loaded automatically at boot alongside all other settings rows.
// Public accessor: getTermsBody(docKey) - used by PDF generators.
// ════════════════════════════════════════════════════════════════════════

var TERMS_DOCS_REGISTRY = [
  {
    key:         'housing_application',
    label:       'Housing Application — Terms & Conditions',
    description: 'Printed on the applicant declaration page of every housing application PDF.',
    defaultBody: '<p>By signing below, I hereby apply for housing assistance from the Constance Lake First Nation (CLFN) Housing Program and declare the following:</p>'
               + '<ol>'
               + '<li><strong>Truthful Information.</strong> All information provided in this application is true, accurate, and complete to the best of my knowledge. I understand that providing false or misleading information may result in immediate disqualification, removal from the housing waitlist, and — where tenancy has already commenced — may constitute grounds for termination of my housing agreement.</li>'
               + '<li><strong>Eligibility.</strong> I confirm that I am a registered Band member of Constance Lake First Nation, am 18 years of age or older, and meet the eligibility requirements set out in the CLFN Housing Policy. I understand that all registered Band members are eligible regardless of on- or off-reserve residency, and that ownership of property off-reserve does not affect my eligibility.</li>'
               + '<li><strong>Privacy and Consent.</strong> I consent to CLFN collecting, using, retaining, and sharing my personal information for the purpose of assessing this application, administering housing services, and meeting reporting obligations, in accordance with PIPEDA and the OCAP® principles of the First Nations Information Governance Centre (FNIGC).</li>'
               + '<li><strong>Assessment and Priority.</strong> I understand that my application will be assessed against the criteria set out in the CLFN Housing Policy, and that placement priority is determined by assessed need and unit availability — not by date of application alone.</li>'
               + '<li><strong>Duty to Update.</strong> I agree to notify the CLFN Housing Department within thirty (30) days of any change in household composition, income, employment, address, contact information, or any other matter that may affect my eligibility or assessment. Failure to notify may result in re-assessment or removal from the waitlist.</li>'
               + '<li><strong>Arrears and Good Standing.</strong> I understand that I must be in good standing with CLFN, or actively working toward good standing through a written payment arrangement approved by the Housing Department, as a condition of placement. I acknowledge that CLFN follows a supportive arrears model providing up to twelve (12) months under a payment arrangement before eviction proceedings may be initiated, and that the minimum monthly payment under such an arrangement is regular rent plus fifty percent (50%) of monthly rent applied against arrears.</li>'
               + '<li><strong>Utilities and Band Payment Recovery.</strong> I authorize CLFN to recover unpaid utilities, rent, damage charges, or other housing-related debts from any monetary payments administered by the Band to me, including but not limited to per capita distributions, honoraria, and program benefits, as provided under the CLFN Housing Policy.</li>'
               + '<li><strong>Compliance.</strong> I agree to comply with the CLFN Housing Policy, my Housing Agreement or lease, the Governance and Administration Policy, and all applicable community by-laws as a condition of tenancy.</li>'
               + '<li><strong>Verification.</strong> I authorize CLFN to verify any information provided in this application with relevant third parties, including employers, financial institutions, utility providers, previous landlords, and other First Nations housing authorities where applicable.</li>'
               + '<li><strong>Acknowledgement of Policy.</strong> I acknowledge that I have been offered access to the current CLFN Housing Policy and Governance and Administration Policy, and that I am responsible for familiarizing myself with their contents.</li>'
               + '</ol>'
  },
  {
    key:         'work_order',
    label:       'Work Order — Terms & Conditions',
    description: 'Printed in the Work Authorization section of every contractor work order PDF.',
    defaultBody: '<p>By accepting this Work Order, the contractor agrees to the following terms and conditions:</p>'
               + '<ol>'
               + '<li><strong>Authorized Scope.</strong> The contractor is authorized to perform only the work described in this Work Order. Any additional work or changes to scope require prior written approval from CLFN Housing before work commences.</li>'
               + '<li><strong>Invoicing.</strong> All invoices must reference this Work Order number and the unit address. Payment is subject to satisfactory completion and inspection by CLFN Housing staff.</li>'
               + '<li><strong>Quality and Standards.</strong> All work must be performed in a good and workmanlike manner, in compliance with applicable building codes, health and safety regulations, and CLFN Housing standards.</li>'
               + '<li><strong>Timeline.</strong> Work must commence and be completed within the dates specified in this Work Order. Any anticipated delays must be reported promptly to CLFN Housing in writing before the affected date.</li>'
               + '<li><strong>Workplace Safety and Insurance.</strong> The contractor assumes full responsibility for workplace safety and must maintain current WSIB clearance and general liability insurance throughout the project. Certificates must be provided to CLFN Housing upon request.</li>'
               + '<li><strong>Deficiencies.</strong> The contractor is responsible for correcting any deficiencies identified during inspection at no additional cost to CLFN.</li>'
               + '<li><strong>Compliance.</strong> The contractor must comply with all applicable federal, provincial, and First Nations regulations, as well as CLFN community by-laws, while on-reserve.</li>'
               + '</ol>'
  }
];

function _termsDocConfig(docKey) {
  for (var i = 0; i < TERMS_DOCS_REGISTRY.length; i++) {
    if (TERMS_DOCS_REGISTRY[i].key === docKey) return TERMS_DOCS_REGISTRY[i];
  }
  return null;
}

// Public accessor for PDF generators. Falls back to the registry default
// when no ED override has been saved yet.
function getTermsBody(docKey) {
  var saved = (window._appSettings && window._appSettings.terms_and_conditions
            && window._appSettings.terms_and_conditions[docKey]) || {};
  if (saved.bodyHtml != null && saved.bodyHtml !== '') return saved.bodyHtml;
  var cfg = _termsDocConfig(docKey);
  return cfg ? cfg.defaultBody : '';
}

var _termsSelectedDoc = null;

function renderTermsTab() {
  var body = document.getElementById('terms_panel_body');
  if (!body) return;

  if (!_termsSelectedDoc) _termsSelectedDoc = TERMS_DOCS_REGISTRY[0] && TERMS_DOCS_REGISTRY[0].key;

  body.innerHTML =
      '<div class="ntf-grid">'
    +   '<div class="ntf-event-list" id="terms_doc_list">' + _termsRenderDocListHtml() + '</div>'
    +   '<div class="ntf-editor"     id="terms_editor">'   + _termsRenderEditorHtml(_termsSelectedDoc) + '</div>'
    + '</div>';

  _termsWireDocListClicks();
  _termsWireEditor();
}

function _termsRenderDocListHtml() {
  return TERMS_DOCS_REGISTRY.map(function(doc) {
    var isActive = doc.key === _termsSelectedDoc;
    return '<button type="button" data-terms-doc="' + _ntfEsc(doc.key) + '" '
         + 'class="ntf-event-item' + (isActive ? ' is-active' : '') + '">'
         + '<span class="ntf-dot ntf-dot-on" title="Active"></span>'
         + '<div class="ntf-event-text">'
         +   '<div class="ntf-event-label">' + _ntfEsc(doc.label) + '</div>'
         +   '<div class="ntf-event-desc">'  + _ntfEsc(doc.description || '') + '</div>'
         + '</div>'
         + '</button>';
  }).join('');
}

function _termsRenderEditorHtml(docKey) {
  var cfg = _termsDocConfig(docKey);
  if (!cfg) return '<div class="empty-state-italic">Select a document from the list to edit it.</div>';

  var saved    = (window._appSettings && window._appSettings.terms_and_conditions
               && window._appSettings.terms_and_conditions[docKey]) || {};
  var bodyHtml = (saved.bodyHtml != null && saved.bodyHtml !== '') ? saved.bodyHtml : cfg.defaultBody;

  var toolbar =
      '<div class="ntf-toolbar" role="toolbar" aria-label="Formatting">'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="bold"                title="Bold (Ctrl+B)"><b>B</b></button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="italic"              title="Italic (Ctrl+I)"><i>I</i></button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="underline"           title="Underline (Ctrl+U)"><u>U</u></button>'
    +   '<span class="ntf-tool-sep"></span>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="formatBlock-p"       title="Paragraph">&para;</button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="insertUnorderedList" title="Bulleted list">&bull;</button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="insertOrderedList"   title="Numbered list">1.</button>'
    +   '<span class="ntf-tool-sep"></span>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="createLink"          title="Insert link">&#128279;</button>'
    +   '<button type="button" class="ntf-tool" data-ntf-cmd="unlink"              title="Remove link">&#10005;&#128279;</button>'
    + '</div>';

  return ''
    + '<div class="ntf-editor-header">'
    +   '<div class="ntf-editor-title">' + _ntfEsc(cfg.label) + '</div>'
    +   '<div class="ntf-editor-meta">Paste from Word supported &mdash; formatting is preserved, styles are stripped.</div>'
    + '</div>'
    + '<div class="ntf-field">'
    +   '<label class="ntf-label">Body</label>'
    +   toolbar
    +   '<div id="terms_body" class="ntf-body" contenteditable="true">' + bodyHtml + '</div>'
    + '</div>'
    + '<div class="ntf-actions">'
    +   '<button type="button" class="btn btn-primary" onclick="saveTermsDoc()">Save</button>'
    +   '<button type="button" class="btn btn-ghost"   onclick="resetTermsDoc()">Reset to Default</button>'
    + '</div>';
}

function _termsWireDocListClicks() {
  var list = document.getElementById('terms_doc_list');
  if (!list) return;
  list.querySelectorAll('[data-terms-doc]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _termsSelectedDoc = btn.getAttribute('data-terms-doc');
      list.innerHTML = _termsRenderDocListHtml();
      var ed = document.getElementById('terms_editor');
      if (ed) ed.innerHTML = _termsRenderEditorHtml(_termsSelectedDoc);
      _termsWireDocListClicks();
      _termsWireEditor();
    });
  });
}

function _termsWireEditor() {
  var editorEl = document.getElementById('terms_editor');
  var bodyEl   = document.getElementById('terms_body');
  if (!editorEl || !bodyEl) return;

  // Scope toolbar wiring to this editor container so it targets terms_body,
  // not ntf_body, even when both sections have been rendered.
  editorEl.querySelectorAll('.ntf-tool').forEach(function(btn) {
    if (btn.getAttribute('data-ntf-bound') === '1') return;
    btn.setAttribute('data-ntf-bound', '1');
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      _ntfRunToolbarCmd(btn.getAttribute('data-ntf-cmd'), bodyEl);
    });
  });

  // Paste handler: strip Word MSO styles on paste, preserve semantic markup.
  if (!bodyEl.getAttribute('data-paste-wired')) {
    bodyEl.setAttribute('data-paste-wired', '1');
    bodyEl.addEventListener('paste', function(e) {
      e.preventDefault();
      var html = (e.clipboardData && e.clipboardData.getData('text/html')) || '';
      if (!html) {
        var text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        html = '<p>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                           .replace(/\n\n+/g,'</p><p>').replace(/\n/g,'<br>') + '</p>';
      }
      document.execCommand('insertHTML', false, _ntfSanitizeBodyHtml(html));
    });
  }
}

function saveTermsDoc() {
  var role = window.currentRole || window._realRole;
  if (role !== 'ed') { showToast('Only the Executive Director can edit terms & conditions'); return; }
  if (!_termsSelectedDoc) { showToast('Select a document first'); return; }

  var bodyEl = document.getElementById('terms_body');
  if (!bodyEl) { showToast('Editor not ready'); return; }

  var bodyHtml = _ntfSanitizeBodyHtml(bodyEl.innerHTML || '');
  if (!bodyHtml || bodyHtml === '<br>' || bodyHtml.replace(/<[^>]+>/g, '').trim() === '') {
    showToast('Body cannot be empty'); bodyEl.focus(); return;
  }

  var all  = (window._appSettings && window._appSettings.terms_and_conditions) || {};
  var next = Object.assign({}, all);
  next[_termsSelectedDoc] = { bodyHtml: bodyHtml };

  fetch(SUPABASE_URL + '/rest/v1/housing_settings', {
    method:  'POST',
    headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body:    JSON.stringify({ key: 'terms_and_conditions', value: next })
  }).then(function(r) {
    if (!r.ok) { showToast('Save failed — check connection'); return; }
    if (!window._appSettings) window._appSettings = {};
    window._appSettings.terms_and_conditions = next;
    if (typeof auditEntry === 'function') {
      auditEntry('SETTINGS', 'terms_save', 'Terms & Conditions updated: ' + _termsSelectedDoc, window.currentRole || 'ed');
    }
    showToast('✓ Terms & Conditions saved');
  }).catch(function(e) {
    console.warn('[terms] save failed:', e);
    showToast('Save failed — see console');
  });
}

function resetTermsDoc() {
  if (!_termsSelectedDoc) return;
  var cfg    = _termsDocConfig(_termsSelectedDoc);
  var bodyEl = document.getElementById('terms_body');
  if (cfg && bodyEl) bodyEl.innerHTML = cfg.defaultBody;
  showToast('Reverted to default. Click Save to persist.');
}

// Parse saved T&C HTML into parts for both renderers.
// Returns:
//   intro     — plain text of the opening paragraph (for jsPDF)
//   introHtml — innerHTML of the opening paragraph (for HTML print)
//   items     — plain text of each <li> (for jsPDF numbered list)
//   itemsHtml — innerHTML of each <li>, preserving <strong> etc. (for HTML print)
function _termsParseHtml(html) {
  var result = { intro: '', introHtml: '', items: [], itemsHtml: [] };
  if (!html) return result;
  try {
    var doc  = new DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html');
    var root = doc.getElementById('r');
    if (!root) return result;
    var nodes = Array.prototype.slice.call(root.childNodes);
    nodes.forEach(function(node) {
      if (!node.tagName) return;
      var tag = node.tagName.toUpperCase();
      if ((tag === 'P' || tag === 'DIV') && !result.intro) {
        result.intro    = (node.textContent || '').trim();
        result.introHtml = node.innerHTML || '';
      } else if (tag === 'OL' || tag === 'UL') {
        var lis = node.querySelectorAll('li');
        lis.forEach(function(li) {
          var text = (li.textContent || '').trim();
          if (text) {
            result.items.push(text);
            result.itemsHtml.push(li.innerHTML || text);
          }
        });
      }
    });
  } catch (e) {
    console.warn('[terms] parse failed:', e);
  }
  return result;
}
