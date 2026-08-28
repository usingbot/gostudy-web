BEGIN;

LOCK TABLE public.gostudy_hour_rewards IN SHARE MODE;

CREATE TABLE public.web_reward_seen_rewards (
  userid bigint NOT NULL CHECK (userid > 0),
  hour_rewardid bigint NOT NULL CHECK (hour_rewardid > 0),
  seen_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (userid, hour_rewardid)
);

INSERT INTO public.web_reward_seen_rewards (
  userid,
  hour_rewardid
)
SELECT
  userid,
  rewardid
FROM public.gostudy_hour_rewards
WHERE userid > 0
  AND rewardid > 0;

GRANT SELECT, INSERT
ON TABLE public.web_reward_seen_rewards
TO gostudy_web;

COMMIT;
