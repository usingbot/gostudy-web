CREATE TABLE IF NOT EXISTS public.web_sessions (
  sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS web_sessions_expire_idx
  ON public.web_sessions (expire);
