\set ON_ERROR_STOP on

-- Run after StudyLion v20 plus web migrations 0001-0005, before migration 0006,
-- and only in a disposable database.
INSERT INTO public.web_study_boards (userid) VALUES
  (940000000000001),
  (940000000000002);

INSERT INTO public.web_study_board_items (
  hour_rewardid,
  userid,
  x,
  y,
  created_at,
  updated_at
) VALUES
  (940000000001001, 940000000000001, 0, 1, '2026-08-01 01:02:03+00', '2026-08-02 01:02:03+00'),
  (940000000001002, 940000000000001, 0.123456789012345, 0.987654321098765, '2026-08-03 01:02:03+00', '2026-08-04 01:02:03+00'),
  (940000000001003, 940000000000002, 1, 0, '2026-08-05 01:02:03+00', '2026-08-06 01:02:03+00');
