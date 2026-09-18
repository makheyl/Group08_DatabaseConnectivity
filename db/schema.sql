-- ============================================================================
--  Bayanihan: Disaster Rescue — game data store  (v2: player_id)
--  UPHSL capstone prototype · SDG 11 (Sustainable Cities and Communities)
--
--  Target: Supabase (PostgreSQL 15+)
--  Run in the dashboard:  SQL Editor → New query → paste → Run
--
--  WARNING — this script RESETS the store. It drops game_runs and everything
--  built on it, then recreates the lot. Any rows already saved are destroyed.
--
--  IDENTIFIERS
--    player_id  uuid  the player's unique id. Generated once on the player's
--                     device and kept in their browser, so the same person
--                     keeps one id across every run they play. This is the
--                     unique identifier the game keys on.
--    run_id     uuid  the row's own primary key — one per finished mission.
--                     A player has many runs, so player_id repeats and cannot
--                     itself be the primary key.
--
--  PRIVACY (Part B compliance)
--    Gameplay results only. No passwords, keys, addresses, birthdates,
--    student numbers or contact details are stored anywhere. player_id is a
--    random UUID with nothing personal encoded in it, and player_name is a
--    callsign the player types in — neither identifies a real person.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Reset
-- ----------------------------------------------------------------------------
drop view  if exists public.player_stats;
drop view  if exists public.leaderboard;
drop table if exists public.game_runs cascade;

create extension if not exists pgcrypto;   -- gen_random_uuid()


-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
create table public.game_runs (
    run_id             uuid        primary key default gen_random_uuid(),
    player_id          uuid        not null,

    -- required fields --------------------------------------------------------
    player_name        text        not null,
    score              integer     not null,
    level              text        not null default 'San Isidro',
    created_at         timestamptz not null default now(),

    -- mission result ---------------------------------------------------------
    residents_rescued  smallint    not null default 0,
    residents_lost     smallint    not null default 0,
    time_remaining     smallint    not null default 0,   -- seconds left on the clock
    completion_status  text        not null default 'partial',
    remarks            text,

    -- integrity rules --------------------------------------------------------
    constraint player_name_length   check (char_length(btrim(player_name)) between 1 and 24),
    constraint score_range          check (score between 0 and 1000000),
    constraint rescued_range        check (residents_rescued between 0 and 64),
    constraint lost_range           check (residents_lost between 0 and 64),
    constraint time_range           check (time_remaining between 0 and 3600),
    constraint remarks_length       check (remarks is null or char_length(remarks) <= 200),
    constraint level_length         check (char_length(level) between 1 and 40),
    constraint completion_status_allowed
        check (completion_status in ('cleared', 'partial', 'recalled', 'failed'))
);

comment on table  public.game_runs is
    'One row per completed rescue mission. Gameplay results only — no personal data.';
comment on column public.game_runs.run_id            is 'Primary key — unique id of this single run.';
comment on column public.game_runs.player_id         is 'Unique id of the player. Random UUID held on their device; repeats across their runs.';
comment on column public.game_runs.player_name       is 'Player-chosen callsign, 1-24 chars. Display only, not an identity.';
comment on column public.game_runs.score             is 'Final mission score.';
comment on column public.game_runs.level             is 'Stage / map the run was played on.';
comment on column public.game_runs.residents_rescued is 'Residents delivered to the evacuation centre.';
comment on column public.game_runs.residents_lost    is 'Residents swept away before rescue.';
comment on column public.game_runs.time_remaining    is 'Seconds left on the mission clock when it ended.';
comment on column public.game_runs.completion_status is 'cleared | partial | recalled | failed';
comment on column public.game_runs.remarks           is 'Short after-action verdict shown to the player.';


-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------
create index game_runs_score_idx    on public.game_runs (score desc, created_at desc);
create index game_runs_player_idx   on public.game_runs (player_id, created_at desc);
create index game_runs_created_idx  on public.game_runs (created_at desc);
create index game_runs_level_idx    on public.game_runs (level, score desc);


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
--    The anon key ships inside the game and is public by design, so RLS is
--    the real protection. Anyone may post a run and read the board; nobody
--    may edit or delete through the public API — no such policy exists.
-- ----------------------------------------------------------------------------
alter table public.game_runs enable row level security;

create policy "anyone may submit a run"
    on public.game_runs for insert
    to anon, authenticated
    with check (true);

create policy "anyone may read the board"
    on public.game_runs for select
    to anon, authenticated
    using (true);


-- ----------------------------------------------------------------------------
-- 4. Views — one row per player_id
-- ----------------------------------------------------------------------------

-- Each player's single best run.
create view public.leaderboard as
select distinct on (player_id)
       player_id,
       player_name,
       score,
       residents_rescued,
       residents_lost,
       time_remaining,
       completion_status,
       level,
       created_at
from   public.game_runs
order  by player_id, score desc, created_at asc;

-- Career totals per player.
create view public.player_stats as
select player_id,
       max(player_name)                     as latest_name,
       count(*)                             as runs_played,
       max(score)                           as best_score,
       round(avg(score))                    as average_score,
       sum(residents_rescued)               as total_rescued,
       sum(residents_lost)                  as total_lost,
       count(*) filter (where completion_status = 'cleared') as clears,
       min(created_at)                      as first_played,
       max(created_at)                      as last_played
from   public.game_runs
group  by player_id;

-- Views must run as the caller so the table's RLS still applies to them.
alter view public.leaderboard  set (security_invoker = on);
alter view public.player_stats set (security_invoker = on);

grant select on public.leaderboard  to anon, authenticated;
grant select on public.player_stats to anon, authenticated;

comment on view public.leaderboard  is 'Best run per player_id, highest score first.';
comment on view public.player_stats is 'Career totals per player_id.';


-- ----------------------------------------------------------------------------
-- 5. Sample rows — delete before the defense demo
-- ----------------------------------------------------------------------------
insert into public.game_runs
    (player_id, player_name, score, level, residents_rescued, residents_lost,
     time_remaining, completion_status, remarks)
values
    ('11111111-1111-4111-8111-111111111111', 'Rescue Unit 7', 12480, 'San Isidro', 8, 0, 74, 'cleared',  'Barangay cleared'),
    ('11111111-1111-4111-8111-111111111111', 'Rescue Unit 7',  9010, 'San Isidro', 7, 1, 40, 'partial',  'Mission closed with losses'),
    ('22222222-2222-4222-8222-222222222222', 'Alpha Boat',     8110, 'San Isidro', 6, 1, 22, 'partial',  'Mission closed with losses'),
    ('33333333-3333-4333-8333-333333333333', 'Tanod Rico',     5230, 'San Isidro', 4, 2,  0, 'recalled', 'Recall ordered');


-- ============================================================================
--  QUERIES FOR THE DOCUMENTATION
-- ============================================================================

-- Leaderboard — one entry per player
-- select player_name, score, residents_rescued, completion_status
-- from   public.leaderboard
-- order  by score desc
-- limit  10;

-- Every run by one player, newest first
-- select created_at, score, residents_rescued, completion_status
-- from   public.game_runs
-- where  player_id = '11111111-1111-4111-8111-111111111111'
-- order  by created_at desc;

-- Does a player improve with practice? (run number vs score)
-- select player_id,
--        row_number() over (partition by player_id order by created_at) as attempt,
--        score
-- from   public.game_runs
-- order  by player_id, attempt;

-- How many distinct players have tested the build?
-- select count(distinct player_id) as players, count(*) as runs
-- from   public.game_runs;

-- Clear rate across all runs
-- select completion_status,
--        count(*)                                           as runs,
--        round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
-- from   public.game_runs
-- group  by completion_status
-- order  by runs desc;

-- Is the five-minute clock fair?
-- select round(avg(residents_rescued), 2) as avg_rescued,
--        round(avg(residents_lost), 2)    as avg_lost,
--        round(avg(time_remaining), 1)    as avg_seconds_left,
--        count(*)                         as sample_size
-- from   public.game_runs;
