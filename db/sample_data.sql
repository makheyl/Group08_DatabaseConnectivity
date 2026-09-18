-- ============================================================================
--  Bayanihan: Disaster Rescue — sample rows
--
--  Optional. Run db/schema.sql first, then run this only when you want a
--  leaderboard with something already on it, for example while working on the
--  Top runs layout.
--
--  Do NOT run this before the defense demo. These are invented scores, and a
--  board that already has entries makes it harder to show that the run you
--  just played is the row that reached the database.
--
--  To clear them again:
--      delete from public.game_runs
--      where player_id in ('11111111-1111-4111-8111-111111111111',
--                          '22222222-2222-4222-8222-222222222222',
--                          '33333333-3333-4333-8333-333333333333');
-- ============================================================================

-- The loadouts below are deliberately varied so public.preparation_effect has
-- all three groups to compare when you are working on that query.
insert into public.game_runs
    (player_id, player_name, score, level, residents_rescued, residents_lost,
     time_remaining, completion_status, remarks, packed, stars, high_saved, high_total)
values
    ('11111111-1111-4111-8111-111111111111', 'Rescue Unit 7', 12480, 'San Isidro', 8, 0, 74, 'cleared',  'Barangay cleared',
     '{salbabida,botika,lubid,flashlight}', 3, 5, 5),
    ('11111111-1111-4111-8111-111111111111', 'Rescue Unit 7',  9010, 'San Isidro', 7, 1, 40, 'partial',  'Mission closed with losses',
     '{salbabida,botika,lubid,radyo}', 2, 4, 5),
    ('22222222-2222-4222-8222-222222222222', 'Alpha Boat',     8110, 'San Isidro', 6, 1, 22, 'partial',  'Mission closed with losses',
     '{salbabida,flashlight,tubig,relief}', 2, 3, 5),
    ('33333333-3333-4333-8333-333333333333', 'Tanod Rico',     5230, 'San Isidro', 4, 2,  0, 'recalled', 'Recall ordered',
     '{tubig,relief,kapote,flashlight}', 1, 1, 5);
