BEGIN;

CREATE TABLE public.web_user_roles (
  userid bigint PRIMARY KEY,
  role text NOT NULL,
  granted_by bigint,
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_user_roles_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_user_roles_role_valid
    CHECK (role IN ('owner', 'admin', 'tester')),
  CONSTRAINT web_user_roles_grant_source_valid
    CHECK (
      (role = 'owner' AND granted_by IS NULL)
      OR (
        role IN ('admin', 'tester')
        AND granted_by IS NOT NULL
        AND granted_by > 0
      )
    )
);

CREATE UNIQUE INDEX web_user_roles_single_owner
ON public.web_user_roles ((role))
WHERE role = 'owner';

CREATE TABLE public.web_role_audit (
  auditid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_userid bigint NOT NULL,
  old_role text NOT NULL,
  new_role text NOT NULL,
  actor_userid bigint,
  change_source text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_role_audit_target_positive
    CHECK (target_userid > 0),
  CONSTRAINT web_role_audit_old_role_valid
    CHECK (old_role IN ('owner', 'admin', 'tester', 'user')),
  CONSTRAINT web_role_audit_new_role_valid
    CHECK (new_role IN ('owner', 'admin', 'tester', 'user')),
  CONSTRAINT web_role_audit_role_changed
    CHECK (old_role <> new_role),
  CONSTRAINT web_role_audit_source_valid
    CHECK (change_source IN ('bootstrap', 'admin')),
  CONSTRAINT web_role_audit_reason_canonical
    CHECK (
      char_length(reason) BETWEEN 1 AND 500
      AND reason = btrim(reason)
    ),
  CONSTRAINT web_role_audit_change_shape_valid
    CHECK (
      (
        change_source = 'bootstrap'
        AND actor_userid IS NULL
        AND old_role = 'user'
        AND new_role = 'owner'
      )
      OR (
        change_source = 'admin'
        AND actor_userid IS NOT NULL
        AND actor_userid > 0
        AND old_role <> 'owner'
        AND new_role <> 'owner'
      )
    )
);

CREATE INDEX web_role_audit_target_history
  ON public.web_role_audit (target_userid, auditid DESC);

CREATE INDEX web_role_audit_actor_history
  ON public.web_role_audit (actor_userid, auditid DESC);

CREATE FUNCTION public.web_reject_role_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'Go Study role audit is immutable; create a new role change instead.'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER web_reject_role_audit_update_delete
BEFORE UPDATE OR DELETE ON public.web_role_audit
FOR EACH ROW EXECUTE FUNCTION public.web_reject_role_audit_mutation();

CREATE TRIGGER web_reject_role_audit_truncate
BEFORE TRUNCATE ON public.web_role_audit
FOR EACH STATEMENT EXECUTE FUNCTION public.web_reject_role_audit_mutation();

CREATE FUNCTION public.web_bootstrap_owner(
  _userid bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF _userid IS NULL OR _userid <= 0 THEN
    RAISE EXCEPTION 'Bootstrap owner userid must be positive.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gostudy:web:bootstrap-owner', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.web_user_roles AS roles
    WHERE roles.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'A Go Study owner already exists.'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.web_user_roles AS roles
    WHERE roles.userid = _userid
  ) THEN
    RAISE EXCEPTION 'Bootstrap owner userid already has a role.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.web_user_roles (
    userid,
    role,
    granted_by
  ) VALUES (
    _userid,
    'owner',
    NULL
  );

  INSERT INTO public.web_role_audit (
    target_userid,
    old_role,
    new_role,
    actor_userid,
    change_source,
    reason
  ) VALUES (
    _userid,
    'user',
    'owner',
    NULL,
    'bootstrap',
    'Initial owner bootstrap'
  );
END;
$$;

CREATE FUNCTION public.web_change_user_role(
  _target_userid bigint,
  _actor_userid bigint,
  _expected_role text,
  _new_role text,
  _reason text
)
RETURNS TABLE (
  userid bigint,
  old_role text,
  new_role text,
  changed boolean,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _current_role text;
  _actor_role text;
  _change_time timestamptz;
BEGIN
  IF _target_userid IS NULL OR _target_userid <= 0
     OR _actor_userid IS NULL OR _actor_userid <= 0 THEN
    RAISE EXCEPTION 'Role target and actor userids must be positive.'
      USING ERRCODE = '22023';
  END IF;

  IF _expected_role IS NULL OR _expected_role NOT IN (
    'owner', 'admin', 'tester', 'user'
  ) THEN
    RAISE EXCEPTION 'Invalid expected role.'
      USING ERRCODE = '22023';
  END IF;

  IF _new_role IS NULL OR _new_role NOT IN ('admin', 'tester', 'user') THEN
    RAISE EXCEPTION 'Invalid new role; owner changes are not supported.'
      USING ERRCODE = '22023';
  END IF;

  IF _reason IS NULL
     OR char_length(_reason) < 1
     OR char_length(_reason) > 500
     OR _reason IS DISTINCT FROM btrim(_reason) THEN
    RAISE EXCEPTION 'Role reason must be canonical and 1-500 characters.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'gostudy:web:role:' || LEAST(_target_userid, _actor_userid)::text,
      0
    )
  );

  IF _target_userid <> _actor_userid THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'gostudy:web:role:' || GREATEST(_target_userid, _actor_userid)::text,
        0
      )
    );
  END IF;

  SELECT roles.role
  INTO _current_role
  FROM public.web_user_roles AS roles
  WHERE roles.userid = _target_userid
  FOR UPDATE;

  IF NOT FOUND THEN
    _current_role := 'user';
  END IF;

  SELECT roles.role
  INTO _actor_role
  FROM public.web_user_roles AS roles
  WHERE roles.userid = _actor_userid;

  IF _actor_role IS NULL OR _actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Current actor may not manage roles.'
      USING ERRCODE = '42501';
  END IF;

  IF _current_role = 'owner' THEN
    RAISE EXCEPTION 'Owner roles cannot be modified by normal operations.'
      USING ERRCODE = '42501';
  END IF;

  IF _actor_role = 'admin' AND _current_role NOT IN ('user', 'tester') THEN
    RAISE EXCEPTION 'Admins cannot modify admins or owners.'
      USING ERRCODE = '42501';
  END IF;

  IF _current_role = _new_role THEN
    RETURN QUERY
    SELECT _target_userid, _current_role, _new_role, FALSE, NULL::timestamptz;
    RETURN;
  END IF;

  IF _current_role IS DISTINCT FROM _expected_role THEN
    RAISE EXCEPTION 'Target role changed since it was read.'
      USING ERRCODE = 'GSR01';
  END IF;

  IF _actor_role = 'admin' AND NOT (
    (_current_role = 'user' AND _new_role = 'tester')
    OR (_current_role = 'tester' AND _new_role = 'user')
  ) THEN
    RAISE EXCEPTION 'Admin role transition is not allowed.'
      USING ERRCODE = '42501';
  END IF;

  _change_time := pg_catalog.now();

  IF _new_role = 'user' THEN
    DELETE FROM public.web_user_roles AS roles
    WHERE roles.userid = _target_userid;
  ELSE
    INSERT INTO public.web_user_roles AS roles (
      userid,
      role,
      granted_by,
      granted_at,
      updated_at
    ) VALUES (
      _target_userid,
      _new_role,
      _actor_userid,
      _change_time,
      _change_time
    )
    ON CONFLICT ON CONSTRAINT web_user_roles_pkey DO UPDATE
    SET role = EXCLUDED.role,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at,
        updated_at = EXCLUDED.updated_at;
  END IF;

  INSERT INTO public.web_role_audit (
    target_userid,
    old_role,
    new_role,
    actor_userid,
    change_source,
    reason,
    created_at
  ) VALUES (
    _target_userid,
    _current_role,
    _new_role,
    _actor_userid,
    'admin',
    _reason,
    _change_time
  );

  RETURN QUERY
  SELECT _target_userid, _current_role, _new_role, TRUE, _change_time;
END;
$$;

REVOKE ALL ON FUNCTION public.web_reject_role_audit_mutation()
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_bootstrap_owner(bigint)
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_change_user_role(
  bigint, bigint, text, text, text
) FROM PUBLIC;

REVOKE ALL ON TABLE
  public.web_user_roles,
  public.web_role_audit
FROM PUBLIC;

REVOKE ALL ON SEQUENCE public.web_role_audit_auditid_seq
FROM PUBLIC;

GRANT SELECT
ON TABLE
  public.web_user_roles,
  public.web_role_audit
TO gostudy_web;

GRANT EXECUTE
ON FUNCTION public.web_change_user_role(bigint, bigint, text, text, text)
TO gostudy_web;

GRANT EXECUTE
ON FUNCTION
  public.gostudy_admin_grant_chalk(bigint, bigint, bigint, text, text),
  public.gostudy_admin_deduct_chalk(bigint, bigint, bigint, text, text),
  public.gostudy_admin_get_chalk_account(bigint),
  public.gostudy_admin_list_chalk_transactions(bigint, bigint, integer)
TO gostudy_web;

REVOKE EXECUTE
ON FUNCTION public.gostudy_apply_chalk_transaction(
  bigint, bigint, text, text, bigint, text, text, bigint, text
)
FROM gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE
  public.gostudy_chalk_accounts,
  public.gostudy_chalk_transactions
FROM gostudy_web;

COMMIT;
