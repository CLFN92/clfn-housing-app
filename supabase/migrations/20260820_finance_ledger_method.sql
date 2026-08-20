-- Persist payment method + reference on rent-ledger rows. These were client-
-- only fields (method, cheque/EFT reference, cash denominations reference)
-- that vanished on every reload because finance_rent_ledger had no columns
-- for them. OPTIONAL: the app feature-detects these columns at boot
-- (window._finLedgerHasMethod) and keeps working without them — run this on
-- each nation project (SQL Editor or the control-plane Migrations tab) to
-- turn persistence on.
alter table public.finance_rent_ledger
  add column if not exists method    text,
  add column if not exists reference text;
