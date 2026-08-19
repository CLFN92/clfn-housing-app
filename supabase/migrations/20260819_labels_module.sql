-- ============================================================================
-- Labels module -- per-nation printable unit labels with config, emergency
-- contacts, and print history / reprint (stale) tracking.
-- Runs in EACH NATION's own Supabase project (database-per-nation). Run in that
-- project's SQL Editor. Idempotent.
--
-- Architecture notes (adapted from the original single-DB spec):
--   * Tables live in the nation DB, keyed by nation_id text (default 'clfn'),
--     matching every other table here. No FK to a control-plane `nations` table.
--   * The nation LOGO and DISPLAY NAME come from the client (NATION_CONFIG +
--     saved theme), so they are NOT part of the DB fingerprint.
--   * label_content()/label_fingerprint() are computed in Postgres ONLY, so the
--     hash stored at print time and compared later cannot drift.
-- ============================================================================

-- ---- 1. Config (one row per nation) ---------------------------------------
create table if not exists public.label_config (
  nation_id        text primary key default 'clfn',
  department_label text,
  housing_email    text,
  housing_phone    text,
  cta_text         text    not null default 'SCAN TO REPORT AN ISSUE',
  qr_base_url      text,                         -- e.g. clfn.fnhub.app ; slug appends
  qr_error_level   text    not null default 'M', -- L | M | Q | H
  default_community text,
  accent_colour    text    not null default '#F8E41A',
  label_width_in   numeric not null default 2.00,
  label_height_in  numeric not null default 1.00,
  updated_at       timestamptz not null default now(),
  updated_by       text
);
alter table public.label_config add constraint label_config_err_level_ck
  check (qr_error_level in ('L','M','Q','H')) not valid;

-- ---- 2. Emergency contacts (2-3 active per nation) -------------------------
create table if not exists public.label_emergency_contacts (
  id         uuid primary key default gen_random_uuid(),
  nation_id  text not null default 'clfn',
  label      text not null,
  phone      text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);
create index if not exists label_ec_nation_idx on public.label_emergency_contacts (nation_id, sort_order);

-- Enforce 2..3 ACTIVE contacts, checked at statement end (a client-side
-- delete-then-insert trips a per-row rule mid-way; a constraint trigger fired
-- once per statement, deferrable, does not).
create or replace function public._label_ec_guard() returns trigger
language plpgsql as $$
declare n int;
begin
  select count(*) into n from public.label_emergency_contacts
   where nation_id = coalesce(new.nation_id, old.nation_id) and is_active;
  -- Allow 0 (a nation that has not set contacts up yet); block 1, and 4+.
  if n = 1 or n > 3 then
    raise exception 'A nation must have 2 or 3 active emergency contacts (found %).', n;
  end if;
  return null;
end $$;
drop trigger if exists label_ec_guard on public.label_emergency_contacts;
create constraint trigger label_ec_guard
  after insert or update or delete on public.label_emergency_contacts
  deferrable initially deferred
  for each row execute function public._label_ec_guard();

-- Swap the whole active set in ONE transaction (so the 2..3 rule is only
-- evaluated once, at commit). Payload: [{label, phone}, ...].
create or replace function public.set_emergency_contacts(p_contacts jsonb, p_nation text default 'clfn')
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; i int := 0;
begin
  -- SECURITY DEFINER bypasses RLS, so gate on role here too (ED / super_user).
  if get_my_role() not in ('ed','super_user') then
    raise exception 'Only the ED can change emergency contacts.';
  end if;
  delete from public.label_emergency_contacts where nation_id = p_nation;
  for item in select * from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) loop
    insert into public.label_emergency_contacts(nation_id, label, phone, sort_order, is_active)
    values (p_nation, item->>'label', item->>'phone', i, true);
    i := i + 1;
  end loop;
end $$;

-- ---- 3. Print history (insert-only) ---------------------------------------
create table if not exists public.unit_label_prints (
  id          uuid primary key default gen_random_uuid(),
  nation_id   text not null default 'clfn',
  unit_id     text not null,
  batch_id    uuid not null,
  output      text not null,          -- laser_sheet | roll | metal_pdf
  substrate   text,
  content     jsonb not null,
  fingerprint text not null,
  printed_at  timestamptz not null default now(),
  printed_by  text default auth.uid()::text,
  notes       text
);
create index if not exists ulp_unit_idx on public.unit_label_prints (unit_id, printed_at desc);

-- ---- 4. Content + fingerprint (DB-computed, deterministic) -----------------
-- The label's data-bearing content: what, if changed, makes an installed label
-- wrong. Logo + nation name are client-side and deliberately excluded.
create or replace function public.label_content(p_unit_id text, p_nation text default 'clfn')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'address',   trim(coalesce(u.num,'') || ' ' || coalesce(u.street,'')),
    'community', c.default_community,
    'cta',       c.cta_text,
    'dept',      c.department_label,
    'email',     c.housing_email,
    'phone',     c.housing_phone,
    'accent',    c.accent_colour,
    'contacts',  coalesce((
       select jsonb_agg(jsonb_build_object('label', e.label, 'phone', e.phone) order by e.sort_order)
       from public.label_emergency_contacts e
       where e.nation_id = p_nation and e.is_active), '[]'::jsonb)
  )
  from public.housing_units u
  left join public.label_config c on c.nation_id = p_nation
  where u.id = p_unit_id;
$$;

create or replace function public.label_fingerprint(p_unit_id text, p_nation text default 'clfn')
returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce(public.label_content(p_unit_id, p_nation), '{}'::jsonb)::text);
$$;

-- Config + contacts for the editor / print run, in one call.
create or replace function public.get_label_config(p_nation text default 'clfn')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'config', coalesce(to_jsonb(c.*), '{}'::jsonb),
    'contacts', coalesce((
       select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label, 'phone', e.phone,
                                           'sort_order', e.sort_order, 'is_active', e.is_active)
              order by e.sort_order)
       from public.label_emergency_contacts e where e.nation_id = p_nation and e.is_active), '[]'::jsonb)
  )
  from public.label_config c where c.nation_id = p_nation;
$$;

-- Log a print run; returns the shared batch id.
create or replace function public.record_label_prints(
  p_unit_ids text[], p_output text, p_substrate text default null,
  p_notes text default null, p_nation text default 'clfn')
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := gen_random_uuid(); uid text;
begin
  if not is_housing_role() then
    raise exception 'Only housing staff can record label prints.';
  end if;
  if p_output not in ('laser_sheet','roll','metal_pdf') then
    raise exception 'Unknown output %', p_output;
  end if;
  foreach uid in array coalesce(p_unit_ids, '{}'::text[]) loop
    insert into public.unit_label_prints(nation_id, unit_id, batch_id, output, substrate, content, fingerprint, notes)
    values (p_nation, uid, b, p_output, p_substrate,
            coalesce(public.label_content(uid, p_nation), '{}'::jsonb),
            public.label_fingerprint(uid, p_nation), p_notes);
  end loop;
  return b;
end $$;

-- ---- 5. Reprint worklist (never_printed | stale | current) -----------------
create or replace view public.v_unit_label_status
with (security_invoker = true) as
select u.id as unit_id,
  case when lp.fingerprint is null then 'never_printed'
       when lp.fingerprint = public.label_fingerprint(u.id) then 'current'
       else 'stale' end as label_status,
  lp.printed_at as last_printed_at
from public.housing_units u
left join lateral (
  select fingerprint, printed_at from public.unit_label_prints p
  where p.unit_id = u.id order by p.printed_at desc limit 1
) lp on true
where coalesce(u.archived, false) = false;

-- ---- 6. RLS ----------------------------------------------------------------
-- Config + contacts: read = any staff; write = ED / super_user. Print history:
-- insert = any housing role; no update/delete (insert-only).
alter table public.label_config enable row level security;
alter table public.label_emergency_contacts enable row level security;
alter table public.unit_label_prints enable row level security;

drop policy if exists label_config_read on public.label_config;
create policy label_config_read on public.label_config for select to authenticated using (is_housing_role());
drop policy if exists label_config_write on public.label_config;
create policy label_config_write on public.label_config for all to authenticated
  using (get_my_role() in ('ed','super_user')) with check (get_my_role() in ('ed','super_user'));

drop policy if exists label_ec_read on public.label_emergency_contacts;
create policy label_ec_read on public.label_emergency_contacts for select to authenticated using (is_housing_role());
drop policy if exists label_ec_write on public.label_emergency_contacts;
create policy label_ec_write on public.label_emergency_contacts for all to authenticated
  using (get_my_role() in ('ed','super_user')) with check (get_my_role() in ('ed','super_user'));

drop policy if exists ulp_read on public.unit_label_prints;
create policy ulp_read on public.unit_label_prints for select to authenticated using (is_housing_role());
drop policy if exists ulp_insert on public.unit_label_prints;
create policy ulp_insert on public.unit_label_prints for insert to authenticated with check (is_housing_role());

grant select, insert, update, delete on public.label_config, public.label_emergency_contacts to authenticated, service_role;
grant select, insert on public.unit_label_prints to authenticated, service_role;
grant select on public.v_unit_label_status to authenticated, service_role;

-- Seed a single config row so the editor has something to load.
insert into public.label_config (nation_id) values ('clfn') on conflict (nation_id) do nothing;
