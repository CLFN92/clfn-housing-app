# Finance PDF migration: HTML print windows → jsPDF

## Why

Finance is the last module still generating documents via **HTML print windows**
(`window.open` + `document.write` + `window.print()`). The rest of the app
(applicant PDF, SOW/work orders, RFQ contracts, Capital Projects claims, the
Labels metal PDF) uses **jsPDF**. Moving finance to jsPDF gives us:

1. **The PDF bytes** — `doc.output('datauristring')` / base64 — so a document can
   be **emailed to the tenant** or **uploaded to Storage / filed on the ledger**,
   not just sent to the user's printer. This is the real unlock.
2. **Deterministic, branded output** — identical on every browser/OS, no browser
   print-header/URL, no "Save as PDF" click, no pop-up-blocker failures.
3. **Per-nation theming without the token gap** — a print window can't read the
   app's CSS `var()` tokens; jsPDF reads them at runtime via `_themeAccentHex()`
   (already used by finance-statement / finance-voucher for the accent).
4. **Consistency** — one PDF engine and one branded header/footer across the app.

## Scope (phased)

Convert the **tenant-facing, want-to-email** documents first; leave internal
print-once worksheets as print windows unless there's demand.

| Document | File(s) today | Phase | Notes |
|---|---|---|---|
| Rent **statement** | `finance-statement.js` | 1 | highest value — email to tenant |
| **Receipt / voucher** | `finance-vouchers.js` | 1 | email/attach on payment |
| **Invoice** PDF | `finance-invoices.js` / `finance-pdf.js` | 2 | already partly structured |
| Cash sheet | `finance-payments.js` | 3 (optional) | internal; print window is fine |
| Batch worksheet | `finance-batch.js` | 3 (optional) | internal |

## Reuse what already exists (do NOT invent a new pattern)

- **Loader**: reuse the app's jsPDF lazy-loader pattern (see `notifications.js`
  `ensureJsPdf` / `labels.js` `_loadJsPdf`) — cdnjs `jspdf` 2.5.1 (CSP-allowlisted,
  SW-precached) + `jspdf-autotable` 3.5.31 for tables.
- **Branded header/footer helper**: the RFQ contract + Capital Projects claim
  PDFs already build a nation header (logo + name + address) and a
  "Page X of Y" footer. Extract/reuse a shared `_finPdfHeader(doc, title)` /
  `_finPdfFooter(doc)` rather than re-implementing per document.
- **Branding sources** (all per-nation, no literals):
  - logo → the saved theme logo (`_appSettings.theme.logo`) else `NATION_CONFIG.logo`
    else the platform default (same resolution `labels.js` `nationLogo()` uses),
  - nation name/address → `NATION_CONFIG.display_name` / mailing fields,
  - accent → `window._themeAccentHex()`; accent-ink → `_themeAccentInkHex()`;
    on-accent → `_themeOnAccentHex()` (these resolve the CSS tokens to hex at
    runtime — jsPDF takes hex strings directly).
- **Tables**: `doc.autoTable({...})` with `headStyles.fillColor` = the accent hex
  and `styles` for body — mirrors the RFQ/claim tables.
- **Money/format**: reuse the existing finance `fmt()` / currency helpers.

## Output + delivery

Each generator returns a jsPDF `doc`, and callers choose:

- **Download** (unchanged UX): `doc.save('Statement-' + name + '.pdf')`.
- **Email**: `var b64 = doc.output('datauristring').split(',')[1];` then send via
  the existing pipeline — `sendNotification` with an `attachments:[{name, contentType:'application/pdf', contentBytes:b64}]` item (the Edge Function already
  supports `attachments[]`; the applicant-PDF flow does exactly this). Add one
  registry event, e.g. `rent_statement_to_tenant` / `payment_receipt_to_tenant`
  in `notifications.js` `EMAIL_EVENT_REGISTRY` (+ `recipientType:'tenant'`,
  default recipients), and a `notify…` helper.
- **File on the ledger** (optional): `uploadFileResilient()` to Storage +
  `sbSaveFileMeta` so it shows in the tenant's Documents (DocLibrary), like the
  work-order/lease PDFs.

## Migration steps (per document)

1. Build `_generate<Doc>Pdf(ctx) → jsPDF doc` using the shared header/footer +
   autoTable, reading branding from the runtime helpers above.
2. Repoint the existing button: `…Pdf(ctx).save(name)` for download.
3. Add the **Email** affordance (checkbox on the existing confirm, or a new
   "Email to tenant" button) → `doc.output` base64 → `notify…()`.
4. Remove the old `window.open`/`document.write` block for that doc.
5. QA at 100% zoom; confirm the accent recolors when the nation theme changes
   (switch theme, regenerate — header/table accent must follow).

## Acceptance

- Statement + receipt generate identical PDFs across browsers, no print dialog.
- "Email to tenant" delivers the PDF as an attachment via the nation's own email
  provider (Graph/Resend), logged in the audit + Documents tab.
- Header logo + name + address + accent all come from the nation config/theme —
  no hardcoded CLFN values, and they change when the nation/theme changes.
- Tables paginate with a repeating header and "Page X of Y".

## Effort

- Phase 1 (statement + receipt, incl. the shared header/footer helper + one email
  event): **medium** — ~1–2 focused sessions.
- Phase 2 (invoice): **small–medium** (reuse Phase-1 helpers).
- Phase 3 (cash sheet / batch): optional; skip unless emailing them is wanted.
