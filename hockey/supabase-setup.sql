-- =========================================================
-- Hockey Stats Tracker — Supabase setup
-- Run this ONCE in your Supabase project's SQL Editor.
-- Model: anyone can READ (parents), only signed-in staff can WRITE.
-- =========================================================

create table if not exists hk_settings (
  id          int primary key,
  team_name   text not null default 'Our Team',
  season      text not null default '',
  updated_at  timestamptz not null default now()
);
insert into hk_settings (id) values (1) on conflict do nothing;

create table if not exists hk_players (
  id          text primary key,          -- client-generated id
  num         text not null,
  name        text not null,
  pos         text not null default 'F', -- F / D / G
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists hk_games (
  id          text primary key,          -- client-generated id
  opponent    text not null,
  date        text not null default '',  -- YYYY-MM-DD
  loc         text not null default 'home',
  final       boolean not null default false,
  absent      jsonb not null default '[]'::jsonb,  -- player ids out of lineup
  events      jsonb not null default '[]'::jsonb,  -- goals / opp goals / penalties
  updated_at  timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table hk_settings enable row level security;
alter table hk_players  enable row level security;
alter table hk_games    enable row level security;

-- Parents / public: read-only
create policy "public read settings" on hk_settings for select using (true);
create policy "public read players"  on hk_players  for select using (true);
create policy "public read games"    on hk_games    for select using (true);

-- Signed-in staff: full write
create policy "staff write settings" on hk_settings for all to authenticated using (true) with check (true);
create policy "staff write players"  on hk_players  for all to authenticated using (true) with check (true);
create policy "staff write games"    on hk_games    for all to authenticated using (true) with check (true);

-- =========================================================
-- After running this:
-- 1. Supabase Dashboard -> Authentication -> Users -> "Add user"
--    Create your own login (email + password). That account is the
--    only way to edit stats; parents never need one.
-- 2. Dashboard -> Authentication -> Sign In / Up:
--    turn OFF public sign-ups so nobody else can register.
-- 3. Copy Project URL + anon (public) key from Settings -> API
--    into the CONFIG block at the top of index.html.
-- =========================================================
