-- Capital Projects module (Phase CAP): housing_projects + housing_project_lots.
--
-- A capital project is a funded initiative (e.g. "develop 20 lots",
-- "build 5 houses"). Promoted columns are the ones the list page filters and
-- orders on; everything else (description, milestones[], expenses[],
-- allocation snapshot) rides the data jsonb blob, camelCase, mirroring the
-- housing_units / housing_rfq pattern:
--   data: {
--     description: "",
--     milestones: [ { id, name, targetDate, done, completedDate, notes } ],
--     expenses:   [ { id, date, vendor, description, amount,
--                     milestoneId|null, enteredBy, createdAt } ],
--     allocation: { basis: 'actuals'|'budget', total, unitCount,
--                   perUnit: [ { unitId, amount } ],
--                   allocatedBy, allocatedAt } | null
--   }
--
-- Lots are their own table (not rows in the project blob) because units
-- reference them (unit.data.lotId), they can pre-exist / outlive unit
-- creation, and their status flips (raw -> serviced -> built) from multiple
-- contexts. housing_units.id is TEXT (address slug), so unit_id is TEXT.
--
-- Naming: "project" already means SOW elsewhere (SOW-YYYY-NN project
-- numbers). Capital project reference numbers use the CP-YYYY-NN format and
-- are generated client-side (unique constraint + collision retry, like RFQs).

create table if not exists public.housing_projects (
  id             uuid primary key default gen_random_uuid(),
  project_number text unique,
  name           text not null,
  type           text not null default 'house_build',   -- lot_development | house_build | mixed
  status         text not null default 'planning',      -- planning | active | on_hold | completed | cancelled
  funding_source text,                                  -- BUDGET_POOLS id or free text
  budget         numeric,
  start_date     date,
  target_date    date,
  archived       boolean not null default false,
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.housing_project_lots (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.housing_projects(id) on delete cascade,
  lot_number        text not null,
  address           text,
  legal_description text,
  status            text not null default 'raw',        -- raw | serviced | built
  unit_id           text references public.housing_units(id) on delete set null,
  notes             text,
  data              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_housing_project_lots_project
  on public.housing_project_lots (project_id);
create index if not exists idx_housing_project_lots_unit
  on public.housing_project_lots (unit_id);

comment on table public.housing_projects is
  'Capital projects (lot development / house builds). Milestones + expenses + allocation snapshot live in data jsonb.';
comment on table public.housing_project_lots is
  'Lots created/tracked by a capital project. unit_id links the housing unit later built on the lot.';

alter table public.housing_projects enable row level security;
alter table public.housing_project_lots enable row level security;

-- Active staff (any role with get_my_role() set) can read; writes are the
-- same staff pool, with fine-grained gating (manageProjects /
-- allocateProjectCosts approval authorities) enforced client-side per the
-- app's current trust model. Projects are soft-archived (archived flag), so
-- no DELETE policy on housing_projects; lots may be removed while drafting a
-- project, so lots get DELETE.
drop policy if exists housing_projects_select_staff on public.housing_projects;
create policy housing_projects_select_staff on public.housing_projects
  for select using (public.get_my_role() is not null);

drop policy if exists housing_projects_insert_staff on public.housing_projects;
create policy housing_projects_insert_staff on public.housing_projects
  for insert with check (public.get_my_role() is not null);

drop policy if exists housing_projects_update_staff on public.housing_projects;
create policy housing_projects_update_staff on public.housing_projects
  for update using (public.get_my_role() is not null);

drop policy if exists housing_project_lots_select_staff on public.housing_project_lots;
create policy housing_project_lots_select_staff on public.housing_project_lots
  for select using (public.get_my_role() is not null);

drop policy if exists housing_project_lots_insert_staff on public.housing_project_lots;
create policy housing_project_lots_insert_staff on public.housing_project_lots
  for insert with check (public.get_my_role() is not null);

drop policy if exists housing_project_lots_update_staff on public.housing_project_lots;
create policy housing_project_lots_update_staff on public.housing_project_lots
  for update using (public.get_my_role() is not null);

drop policy if exists housing_project_lots_delete_staff on public.housing_project_lots;
create policy housing_project_lots_delete_staff on public.housing_project_lots
  for delete using (public.get_my_role() is not null);

grant select, insert, update on public.housing_projects to authenticated;
grant select, insert, update, delete on public.housing_project_lots to authenticated;
