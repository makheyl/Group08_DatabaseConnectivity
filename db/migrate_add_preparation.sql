-- ============================================================================
--  Migration — bring an EXISTING game_runs table up to the current code.
--
--  Use this instead of db/schema.sql when the Supabase project already has a
--  game_runs table you want to keep. schema.sql drops and recreates the table;
--  this script only adds what is missing and never deletes a row.
--
--  Safe to run more than once. Every step checks before it acts.
--
--  Run in the dashboard:  SQL Editor -> New query -> paste -> Run
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. What is actually there right now?
--    Run this on its own first if you want to look before you change anything.
-- ----------------------------------------------------------------------------
-- select column_name, data_type
-- from   information_schema.columns
-- where  table_schema = 'public' and table_name = 'game_runs'
-- order  by ordinal_position;


-- ----------------------------------------------------------------------------
-- 1. The preparation-phase columns
--    Existing rows predate the preparation phase, so they get empty defaults:
--    no recorded loadout, no rating, no triage counts.
-- ----------------------------------------------------------------------------
alter table public.game_runs add column if not exists packed     text[]   not null default '{}';
alter table public.game_runs add column if not exists stars      smallint not null default 0;
alter table public.game_runs add column if not exists high_saved smallint not null default 0;
alter table public.game_runs add column if not exists high_total smallint not null default 0;

comment on column public.game_runs.packed     is 'Supply ids carried on this run, chosen in the preparation phase.';
comment on column public.game_runs.stars      is 'Rating awarded, 0-3.';
comment on column public.game_runs.high_saved is 'High-priority residents (elderly, child, injured) delivered.';
comment on column public.game_runs.high_total is 'High-priority residents on the roster for this run.';


-- ----------------------------------------------------------------------------
-- 2. The matching integrity rules
--    Added only if absent, so re-running this file is harmless.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stars_range') then
    alter table public.game_runs
      add constraint stars_range check (stars between 0 and 3);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'packed_size') then
    alter table public.game_runs
      add constraint packed_size
      check (array_length(packed, 1) is null or array_length(packed, 1) <= 8);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'high_counts') then
    alter table public.game_runs
      add constraint high_counts check (high_saved between 0 and high_total);
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
--    Harmless if it is already on and the policies already exist. The anon key
--    ships inside the game, so RLS is the thing actually protecting the table.
-- ----------------------------------------------------------------------------
alter table public.game_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'game_runs'
                   and policyname = 'anyone may submit a run') then
    create policy "anyone may submit a run"
      on public.game_runs for insert to anon, authenticated with check (true);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'game_runs'
                   and policyname = 'anyone may read the board') then
    create policy "anyone may read the board"
      on public.game_runs for select to anon, authenticated using (true);
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 4. Views
--    leaderboard gains stars and packed, so its column list changes and it has
--    to be dropped rather than replaced. Dropping a view destroys no data.
-- ----------------------------------------------------------------------------
drop view if exists public.preparation_effect;
drop view if exists public.player_stats;
drop view if exists public.leaderboard;

create view public.leaderboard as
select distinct on (player_id)
       player_id, player_name, score,
       residents_rescued, residents_lost, time_remaining,
       completion_status, stars, packed, level, created_at
from   public.game_runs
order  by player_id, score desc, created_at asc;

create view public.player_stats as
select player_id,
       max(player_name)       as latest_name,
       count(*)               as runs_played,
       max(score)             as best_score,
       round(avg(score))      as average_score,
       sum(residents_rescued) as total_rescued,
       sum(residents_lost)    as total_lost,
       count(*) filter (where completion_status = 'cleared') as clears,
       min(created_at)        as first_played,
       max(created_at)        as last_played
from   public.game_runs
group  by player_id;

create view public.preparation_effect as
select case
         when packed @> array['salbabida','lubid','botika'] then 'all three tools'
         when packed && array['salbabida','lubid','botika'] then 'some tools'
         else 'no rescue tools'
       end                              as loadout,
       count(*)                         as runs,
       round(avg(residents_rescued), 2) as avg_rescued,
       round(avg(residents_lost), 2)    as avg_lost,
       round(avg(stars), 2)             as avg_stars,
       sum(high_saved)                  as high_saved,
       sum(high_total)                  as high_total,
       case when sum(high_total) > 0
            then round(100.0 * sum(high_saved) / sum(high_total), 1)
       end                              as high_saved_pct
from   public.game_runs
group  by 1;

alter view public.leaderboard        set (security_invoker = on);
alter view public.player_stats       set (security_invoker = on);
alter view public.preparation_effect set (security_invoker = on);

grant select on public.leaderboard        to anon, authenticated;
grant select on public.player_stats       to anon, authenticated;
grant select on public.preparation_effect to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. Check it worked
-- ----------------------------------------------------------------------------
-- select count(*) as rows_kept from public.game_runs;
--
-- select column_name
-- from   information_schema.columns
-- where  table_schema = 'public' and table_name = 'game_runs'
--   and  column_name in ('packed','stars','high_saved','high_total')
-- order  by column_name;        -- expect all four
