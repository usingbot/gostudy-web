CREATE TABLE IF NOT EXISTS public.web_study_boards (
  userid bigint PRIMARY KEY CHECK (userid > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.web_study_board_items (
  hour_rewardid bigint PRIMARY KEY CHECK (hour_rewardid > 0),
  userid bigint NOT NULL
    REFERENCES public.web_study_boards (userid)
    ON DELETE CASCADE,
  x double precision NOT NULL CHECK (x >= 0 AND x <= 1),
  y double precision NOT NULL CHECK (y >= 0 AND y <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_study_board_items_userid_idx
  ON public.web_study_board_items (userid);
