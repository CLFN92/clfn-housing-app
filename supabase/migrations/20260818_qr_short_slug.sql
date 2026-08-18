-- ============================================================================
-- Short maintenance-QR slugs. Runs on a NATION project (SQL Editor).
--
-- Gives each unit a short integer slug so the printed QR can encode
-- <base>/u/<slug> (e.g. clfn.ca/u/142) instead of the long
-- report.html?u=<id>&t=<uuid> URL — short enough that the printed QR modules
-- stay large enough to scan. The /u/<slug> link is resolved to the unit + token
-- by the tenant-mr Edge Function (action: resolve_slug) via the _redirects rule.
--
-- Optional/graceful: until this runs, the Maintenance QR labels simply fall
-- back to the existing long URL (denser QR). Running it upgrades every label to
-- the short URL. RLS gate matches the app standard (public.get_my_role()).
-- ============================================================================

alter table public.housing_units
  add column if not exists label_slug integer;
create unique index if not exists housing_units_label_slug_idx
  on public.housing_units (label_slug) where label_slug is not null;

-- Assign the next slug to a single unit that lacks one (monotonic; gaps are OK).
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

-- Assign slugs to ALL not-yet-slugged units in address order (used by the bulk
-- label print so it needs one call, not one per unit). Returns how many it set.
create or replace function public.assign_all_label_slugs()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare next_n integer; r record; cnt integer := 0;
begin
  if public.get_my_role() is null then raise exception 'not permitted'; end if;
  select coalesce(max(label_slug), 0) into next_n from public.housing_units;
  for r in select id from public.housing_units
             where label_slug is null and coalesce(archived, false) = false
             order by street, num loop
    next_n := next_n + 1;
    update public.housing_units set label_slug = next_n where id = r.id;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;
grant execute on function public.assign_all_label_slugs() to authenticated;
