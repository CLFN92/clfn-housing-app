-- ============================================================================
-- Labels module — printable 2"x1" unit labels, per-nation config, print history
-- and the reprint (stale) worklist. Runs on a NATION project (SQL Editor).
--
-- database-per-nation: this DB *is* the nation, so there is no nation_id and no
-- nations FK. The nation LOGO and display NAME are NOT stored here (they live on
-- the control-plane nations record / client NATION_CONFIG); the client supplies
-- them when rendering. The label fingerprint therefore covers config + emergency
-- contacts + unit address, NOT the client-side logo.
--
-- RLS mirrors the current app standard: gate on public.get_my_role() (the helper
-- that reads the staff table by auth.jwt() email); ED/super_user is enforced
-- additionally client-side (as the existing Maintenance QR panel does).
-- ============================================================================

-- ---- short unit slug for the /u/<slug> QR redirect --------------------------
alter table public.housing_units
  add column if not exists label_slug integer;
create unique index if not exists housing_units_label_slug_idx
  on public.housing_units (label_slug) where label_slug is not null;

-- Assign the next slug to a unit that lacks one (monotonic max+1; gaps are fine).
create or replace function public.assign_label_slug(p_unit_id text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s integer;
begin
  if public.get_my_role() is null then raise exception 'not permitted'; end if;
  select label_slug into s from public.housing_units where id = p_unit_id;
  if s is not null then return s; end if;
  update public.housing_units
     set label_slug = (select coalesce(max(label_slug), 0) + 1 from public.housing_units)
   where id = p_unit_id
   returning label_slug into s;
  return s;
end $$;
grant execute on function public.assign_label_slug(text) to authenticated;

-- ---- 1) nation_label_config (SINGLETON: exactly one row, id = true) ----------
create table if not exists public.nation_label_config (
  id                boolean primary key default true check (id),
  department_label  text,
  housing_email     text,
  housing_phone     text,
  cta_text          text default 'SCAN TO REPORT AN ISSUE',
  qr_base_url       text,
  qr_error_level    text default 'M' check (qr_error_level in ('L','M','Q','H')),
  default_community text,
  accent_colour     text,
  label_width_in    numeric(4,2) default 2.00,
  label_height_in   numeric(4,2) default 1.00,
  updated_at        timestamptz default now(),
  updated_by        text
);
insert into public.nation_label_config (id) values (true) on conflict (id) do nothing;

alter table public.nation_label_config enable row level security;
drop policy if exists label_config_read  on public.nation_label_config;
drop policy if exists label_config_write on public.nation_label_config;
create policy label_config_read  on public.nation_label_config
  for select using (public.get_my_role() is not null);
create policy label_config_write on public.nation_label_config
  for all using (public.get_my_role() in ('ed','housing_manager'))
          with check (public.get_my_role() in ('ed','housing_manager'));
grant select, insert, update on public.nation_label_config to authenticated;

-- get_label_config(): the config row as jsonb (logo + nation name are added by
-- the client from NATION_CONFIG; emergency contacts included here as an array).
create or replace function public.get_label_config()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'department_label',  cfg.department_label,
    'housing_email',     cfg.housing_email,
    'housing_phone',     cfg.housing_phone,
    'cta_text',          coalesce(cfg.cta_text, 'SCAN TO REPORT AN ISSUE'),
    'qr_base_url',       cfg.qr_base_url,
    'qr_error_level',    coalesce(cfg.qr_error_level, 'M'),
    'default_community', cfg.default_community,
    'accent_colour',     cfg.accent_colour,
    'label_width_in',    coalesce(cfg.label_width_in, 2.00),
    'label_height_in',   coalesce(cfg.label_height_in, 1.00),
    'updated_at',        cfg.updated_at,
    'updated_by',        cfg.updated_by,
    'emergency_contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'phone', c.phone,
                                          'sort_order', c.sort_order, 'is_active', c.is_active)
                       order by c.sort_order)
      from public.nation_emergency_contacts c), '[]'::jsonb)
  )
  from public.nation_label_config cfg where cfg.id = true;
$$;
grant execute on function public.get_label_config() to authenticated;

-- ---- 2) nation_emergency_contacts (ordered; min 2 / max 3 active) -----------
create table if not exists public.nation_emergency_contacts (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  phone       text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);
alter table public.nation_emergency_contacts enable row level security;
drop policy if exists emergency_contacts_read  on public.nation_emergency_contacts;
drop policy if exists emergency_contacts_write on public.nation_emergency_contacts;
create policy emergency_contacts_read  on public.nation_emergency_contacts
  for select using (public.get_my_role() is not null);
create policy emergency_contacts_write on public.nation_emergency_contacts
  for all using (public.get_my_role() in ('ed','housing_manager'))
          with check (public.get_my_role() in ('ed','housing_manager'));
grant select, insert, update, delete on public.nation_emergency_contacts to authenticated;

-- Deferred count rule: 2..3 active contacts, checked at COMMIT so a whole-set
-- swap (delete-then-insert) inside one transaction doesn't trip mid-way.
create or replace function public.check_emergency_contacts_count()
returns trigger language plpgsql as $$
declare n integer;
begin
  select count(*) into n from public.nation_emergency_contacts where is_active;
  if n < 2 or n > 3 then
    raise exception 'A nation must keep 2 or 3 active emergency contacts (found %).', n;
  end if;
  return null;
end $$;
drop trigger if exists trg_emergency_contacts_count on public.nation_emergency_contacts;
create constraint trigger trg_emergency_contacts_count
  after insert or update or delete on public.nation_emergency_contacts
  deferrable initially deferred
  for each row execute function public.check_emergency_contacts_count();

-- Swap the whole active set atomically (the deferred trigger validates at commit).
create or replace function public.set_emergency_contacts(p_contacts jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; i integer := 0;
begin
  if public.get_my_role() not in ('ed','housing_manager') then raise exception 'not permitted'; end if;
  delete from public.nation_emergency_contacts;
  for item in select * from jsonb_array_elements(p_contacts) loop
    insert into public.nation_emergency_contacts (label, phone, sort_order, is_active)
      values (item->>'label', item->>'phone', i, coalesce((item->>'is_active')::boolean, true));
    i := i + 1;
  end loop;
end $$;
grant execute on function public.set_emergency_contacts(jsonb) to authenticated;

-- ---- 3) unit_label_prints (print history; insert-only under RLS) ------------
create table if not exists public.unit_label_prints (
  id          uuid primary key default gen_random_uuid(),
  unit_id     text not null,
  batch_id    uuid not null,
  output      text not null check (output in ('laser_sheet','roll','metal_pdf')),
  substrate   text,
  content     jsonb,
  fingerprint text,
  printed_at  timestamptz not null default now(),
  -- app convention is the actor's email (the rest of the app stores email, not
  -- auth.uid(), so the print history reads back as a person, not a UUID).
  printed_by  text default (auth.jwt() ->> 'email'),
  notes       text
);
create index if not exists unit_label_prints_unit_idx on public.unit_label_prints (unit_id, printed_at desc);
create index if not exists unit_label_prints_batch_idx on public.unit_label_prints (batch_id);
alter table public.unit_label_prints enable row level security;
drop policy if exists label_prints_read   on public.unit_label_prints;
drop policy if exists label_prints_insert on public.unit_label_prints;
create policy label_prints_read   on public.unit_label_prints
  for select using (public.get_my_role() is not null);
create policy label_prints_insert on public.unit_label_prints
  for insert with check (public.get_my_role() is not null);
-- No update/delete policy: history is append-only.
grant select, insert on public.unit_label_prints to authenticated;

-- Label content + fingerprint computed ONLY in Postgres, so the hash stored at
-- print time and the hash compared later cannot drift with client changes.
create or replace function public.label_content(p_unit_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'unit_id',    u.id,
    'address',    trim(coalesce(u.num, '') || ' ' || coalesce(u.street, '')),
    'community',  coalesce(cfg.default_community, ''),
    'cta',        coalesce(cfg.cta_text, ''),
    'department', coalesce(cfg.department_label, ''),
    'email',      coalesce(cfg.housing_email, ''),
    'phone',      coalesce(cfg.housing_phone, ''),
    'accent',     coalesce(cfg.accent_colour, ''),
    'qr_base',    coalesce(cfg.qr_base_url, ''),
    'slug',       u.label_slug,
    'contacts',   coalesce((
      select jsonb_agg(jsonb_build_object('label', c.label, 'phone', c.phone) order by c.sort_order)
      from public.nation_emergency_contacts c where c.is_active), '[]'::jsonb)
  )
  from public.housing_units u, public.nation_label_config cfg
  where u.id = p_unit_id and cfg.id = true;
$$;
grant execute on function public.label_content(text) to authenticated;

create or replace function public.label_fingerprint(p_unit_id text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select md5(public.label_content(p_unit_id)::text);
$$;
grant execute on function public.label_fingerprint(text) to authenticated;

-- Log a print run (all units share one batch id); returns the batch id.
create or replace function public.record_label_prints(p_unit_ids text[], p_output text, p_substrate text, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare b uuid := gen_random_uuid(); uid text;
begin
  if public.get_my_role() is null then raise exception 'not permitted'; end if;
  foreach uid in array p_unit_ids loop
    insert into public.unit_label_prints (unit_id, batch_id, output, substrate, content, fingerprint, printed_by, notes)
      values (uid, b, p_output, p_substrate, public.label_content(uid), public.label_fingerprint(uid),
              auth.jwt() ->> 'email', p_notes);
  end loop;
  return b;
end $$;
grant execute on function public.record_label_prints(text[], text, text, text) to authenticated;

-- Reprint worklist: never_printed | stale | current, by comparing the last
-- printed fingerprint to the current one. Filter on 'stale' after a nation
-- changes an emergency number to get exactly the units whose installed labels
-- are now wrong.
create or replace view public.v_unit_label_status as
select
  u.id as unit_id,
  case
    when lp.fingerprint is null                              then 'never_printed'
    when lp.fingerprint = public.label_fingerprint(u.id)     then 'current'
    else 'stale'
  end                as label_status,
  lp.fingerprint     as last_fingerprint,
  lp.printed_at      as last_printed_at
from public.housing_units u
left join lateral (
  select p.fingerprint, p.printed_at
  from public.unit_label_prints p
  where p.unit_id = u.id
  order by p.printed_at desc
  limit 1
) lp on true;
grant select on public.v_unit_label_status to authenticated;
