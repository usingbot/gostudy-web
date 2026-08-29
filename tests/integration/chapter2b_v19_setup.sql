\set ON_ERROR_STOP on

-- Disposable PostgreSQL only. Load the current StudyLion schema v19 first.
CREATE ROLE gostudy_web NOLOGIN;
CREATE ROLE gostudy_web_owner NOLOGIN;
CREATE ROLE gostudy_chalk_owner NOLOGIN;

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
