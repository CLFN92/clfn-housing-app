-- ═══════════════════════════════════════════════════════════════════════════
-- CLFN Housing Suite — RFQ Module migration
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- Review all statements before executing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Main RFQ table ───────────────────────────────────────────────────────
create table if not exists housing_rfq (
  id                       text primary key,          -- RFQ-{year}-{4-digit-seq}
  sow_unit_id              text not null,             -- FK to housing_units.id
  sow_project_number       text not null,             -- links to housing_sow.data.sows[].project_number
  status                   text not null default 'draft',
                                                      -- draft | issued | closed | awarded | cancelled
  issued_at                timestamptz,
  closes_at                timestamptz,               -- bid deadline
  recipient_contractor_ids text[]       default '{}', -- housing_contractors.id values
  awarded_contractor_id    text,
  award_amount             numeric,
  award_notes              text,
  data                     jsonb        not null default '{}'::jsonb,
    -- data keys:
    --   scope_snapshot   []  -- line-item snapshot from SOW at issue time
    --   cover_letter     str -- editable cover letter for this RFQ
    --   contact_person   str -- CLFN contact name
    --   contact_email    str
    --   submission_method str -- 'email' | 'office' | 'both'
    --   bids             []  -- manually entered bid records {contractor_id, amount, notes, received_at}
  created_by               text,                      -- staff email
  created_at               timestamptz  default now(),
  updated_at               timestamptz  default now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
create index if not exists housing_rfq_sow_idx
  on housing_rfq (sow_unit_id, sow_project_number);

create index if not exists housing_rfq_status_idx
  on housing_rfq (status);

create index if not exists housing_rfq_year_idx
  on housing_rfq (left(id, 8));               -- fast next-sequence lookup

-- ── 3. Settings rows ────────────────────────────────────────────────────────
-- rfq_threshold: dollar amount above which an RFQ is required.
-- Default 10000; ED can change in Settings without a code deploy.
insert into housing_settings (key, value)
values ('rfq_threshold', to_jsonb(10000))
on conflict (key) do nothing;

-- rfq_terms: full T&C text displayed in the RFQ document.
-- Managed via Settings → Terms & Conditions (rich-text editor, same as lease/housing-app T&C).
insert into housing_settings (key, value)
values (
  'rfq_terms',
  to_jsonb(
    '<p>By submitting a bid in response to this Request for Quotes, the contractor agrees to the following terms and conditions:</p>'
    '<ol>'
    '<li><strong>Bid Validity.</strong> All bids submitted in response to this RFQ shall remain valid and irrevocable for a minimum of sixty (60) calendar days from the bid closing date.</li>'
    '<li><strong>Compliance with Scope.</strong> Bids must address the full scope of work as described. Partial bids will not be considered unless explicitly invited.</li>'
    '<li><strong>WSIB and Insurance.</strong> The contractor must provide a current WSIB clearance certificate and proof of general liability insurance (minimum $2,000,000) with this bid. Failure to include these documents will result in disqualification.</li>'
    '<li><strong>No Award Guarantee.</strong> Submission of a bid does not guarantee award. Constance Lake First Nation reserves the right to reject any or all bids, to cancel this RFQ at any time, and to award the work to the contractor deemed most advantageous to the community, price and other factors considered.</li>'
    '<li><strong>Indigenous Preference.</strong> In accordance with the CLFN Housing Policy, preference will be given to Indigenous-owned and CLFN-member-owned businesses where qualifications and price are competitive.</li>'
    '<li><strong>Confidentiality.</strong> All bid information submitted is confidential and will not be disclosed to other bidders.</li>'
    '<li><strong>Accuracy.</strong> All information submitted must be accurate and complete. Misrepresentation will result in immediate disqualification and may affect future eligibility.</li>'
    '<li><strong>Governing Authority.</strong> This RFQ and any resulting contract are governed by the inherent jurisdiction of Constance Lake First Nation and applicable federal and provincial law.</li>'
    '</ol>'
  )
)
on conflict (key) do nothing;

-- rfq_cover_letter: email body template sent to each contractor.
-- Merge fields: {contractorName}, {rfqNumber}, {projectAddress}, {closingDate},
--               {contactPerson}, {contactEmail}, {submissionMethod}, {rfqLink}
insert into housing_settings (key, value)
values (
  'rfq_cover_letter',
  to_jsonb(
    'Dear {contractorName},\n\nConstance Lake First Nation Housing Department invites your firm to submit a competitive bid for the above-referenced project.\n\nRFQ Number:    {rfqNumber}\nProject:       {projectAddress}\nBids close:    {closingDate}\n\nThe full RFQ document, including scope of work, bid form, and terms and conditions, is available at the link below:\n\n{rfqLink}\n\nTo be considered, your bid package must be received by the closing date and include:\n  • Completed bid form (all line items priced)\n  • Current WSIB clearance certificate\n  • Proof of general liability insurance (min. $2,000,000)\n  • List of at least two comparable projects completed in the last three years\n  • Proposed start date and estimated timeline\n\nSubmission: {submissionMethod}\n\nFor questions, contact {contactPerson} at {contactEmail}.\n\nThank you for your interest in working with Constance Lake First Nation.\n\n{contactPerson}\nConstance Lake First Nation — Housing Department'
  )
)
on conflict (key) do nothing;

-- ── 4. RLS (uncomment and adjust to match your existing bucket policies) ────
-- alter table housing_rfq enable row level security;
--
-- create policy "Authenticated staff can read RFQs"
--   on housing_rfq for select to authenticated using (true);
--
-- create policy "Authenticated staff can write RFQs"
--   on housing_rfq for all to authenticated
--   using (true) with check (true);

-- ── 5. Audit log append-only guard (matches housing_audit_log pattern) ──────
-- If your audit log table already has a trigger blocking UPDATE/DELETE,
-- no changes needed — auditEntry() only ever INSERTs.

-- ═══════════════════════════════════════════════════════════════════════════
-- End of migration. Verify row counts after running:
--   select count(*) from housing_rfq;                   -- should be 0
--   select key, value from housing_settings
--     where key in ('rfq_threshold','rfq_terms','rfq_cover_letter');
-- ═══════════════════════════════════════════════════════════════════════════
