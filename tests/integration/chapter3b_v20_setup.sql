\set ON_ERROR_STOP on

-- Disposable PostgreSQL only. Load the current StudyLion schema v20 first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostudy_web') THEN
    CREATE ROLE gostudy_web NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostudy_web_owner') THEN
    CREATE ROLE gostudy_web_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostudy_chalk_owner') THEN
    CREATE ROLE gostudy_chalk_owner NOLOGIN;
  END IF;
END;
$$;

ALTER TABLE public.gostudy_chalk_accounts OWNER TO gostudy_chalk_owner;
ALTER TABLE public.gostudy_chalk_transactions OWNER TO gostudy_chalk_owner;
ALTER SEQUENCE public.gostudy_chalk_transactions_transactionid_seq
  OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_reject_chalk_ledger_mutation()
  OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_apply_chalk_transaction(
  bigint, bigint, text, text, bigint, text, text, bigint, text
) OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_admin_grant_chalk(
  bigint, bigint, bigint, text, text
) OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_admin_deduct_chalk(
  bigint, bigint, bigint, text, text
) OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_admin_get_chalk_account(bigint)
  OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_admin_list_chalk_transactions(
  bigint, bigint, integer
) OWNER TO gostudy_chalk_owner;
ALTER FUNCTION public.gostudy_purchase_board_item_chalk(
  bigint, bigint, text, text
) OWNER TO gostudy_chalk_owner;
