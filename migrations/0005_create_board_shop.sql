BEGIN;

CREATE TABLE public.web_board_shop_catalog (
  item_key text PRIMARY KEY,
  display_name text NOT NULL,
  item_type text NOT NULL,
  price_chalk bigint NOT NULL,
  enabled boolean NOT NULL DEFAULT TRUE,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_board_shop_catalog_item_key_canonical
    CHECK (
      char_length(item_key) BETWEEN 1 AND 64
      AND item_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  CONSTRAINT web_board_shop_catalog_display_name_canonical
    CHECK (
      char_length(display_name) BETWEEN 1 AND 100
      AND display_name = btrim(display_name)
    ),
  CONSTRAINT web_board_shop_catalog_item_type_valid
    CHECK (item_type IN ('decoration', 'sticky_note', 'gif', 'photo_frame')),
  CONSTRAINT web_board_shop_catalog_price_valid
    CHECK (price_chalk BETWEEN 1 AND 1000000),
  CONSTRAINT web_board_shop_catalog_sort_order_valid
    CHECK (sort_order >= 0)
);

INSERT INTO public.web_board_shop_catalog (
  item_key,
  display_name,
  item_type,
  price_chalk,
  sort_order
) VALUES
  ('basic-decoration', 'Basic Decoration', 'decoration', 1, 10),
  ('sticky-note', 'Sticky Note', 'sticky_note', 2, 20),
  ('gif-slot', 'GIF Slot', 'gif', 3, 30),
  ('photo-frame', 'Photo Frame', 'photo_frame', 5, 40);

CREATE TABLE public.web_board_purchases (
  purchaseid uuid PRIMARY KEY,
  userid bigint NOT NULL,
  item_key text NOT NULL,
  price_chalk bigint NOT NULL,
  chalk_transactionid bigint NOT NULL,
  chalk_balance bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_board_purchases_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_board_purchases_price_positive
    CHECK (price_chalk > 0),
  CONSTRAINT web_board_purchases_chalk_transaction_positive
    CHECK (chalk_transactionid > 0),
  CONSTRAINT web_board_purchases_chalk_balance_nonnegative
    CHECK (chalk_balance >= 0),
  CONSTRAINT web_board_purchases_item_key_fkey
    FOREIGN KEY (item_key)
    REFERENCES public.web_board_shop_catalog (item_key)
    ON DELETE RESTRICT,
  CONSTRAINT web_board_purchases_chalk_transaction_unique
    UNIQUE (chalk_transactionid)
);

CREATE INDEX web_board_purchases_user_history
  ON public.web_board_purchases (userid, created_at DESC, purchaseid DESC);

CREATE TABLE public.web_owned_board_items (
  owned_itemid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userid bigint NOT NULL,
  item_key text NOT NULL,
  purchaseid uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT web_owned_board_items_userid_positive
    CHECK (userid > 0),
  CONSTRAINT web_owned_board_items_item_key_fkey
    FOREIGN KEY (item_key)
    REFERENCES public.web_board_shop_catalog (item_key)
    ON DELETE RESTRICT,
  CONSTRAINT web_owned_board_items_purchase_fkey
    FOREIGN KEY (purchaseid)
    REFERENCES public.web_board_purchases (purchaseid)
    ON DELETE RESTRICT,
  CONSTRAINT web_owned_board_items_purchase_unique
    UNIQUE (purchaseid)
);

CREATE INDEX web_owned_board_items_user_history
  ON public.web_owned_board_items (userid, acquired_at DESC, owned_itemid DESC);

CREATE FUNCTION public.web_reject_board_purchase_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'Go Study board purchase records are immutable.'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER web_reject_board_purchase_update_delete
BEFORE UPDATE OR DELETE ON public.web_board_purchases
FOR EACH ROW EXECUTE FUNCTION public.web_reject_board_purchase_mutation();

CREATE TRIGGER web_reject_board_purchase_truncate
BEFORE TRUNCATE ON public.web_board_purchases
FOR EACH STATEMENT EXECUTE FUNCTION public.web_reject_board_purchase_mutation();

CREATE FUNCTION public.web_purchase_board_item(
  _userid bigint,
  _item_key text,
  _request_id text
)
RETURNS TABLE (
  purchaseid uuid,
  userid bigint,
  item_key text,
  display_name text,
  item_type text,
  price_chalk bigint,
  owned_itemid bigint,
  chalk_transactionid bigint,
  chalk_balance bigint,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  _purchase_id uuid;
  _existing_purchase public.web_board_purchases%ROWTYPE;
  _catalog_item public.web_board_shop_catalog%ROWTYPE;
  _owned_item_id bigint;
  _chalk_result record;
BEGIN
  IF _userid IS NULL OR _userid <= 0 THEN
    RAISE EXCEPTION 'Board Shop userid must be positive.'
      USING ERRCODE = '22023';
  END IF;

  IF _item_key IS NULL
     OR char_length(_item_key) < 1
     OR char_length(_item_key) > 64
     OR _item_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Board Shop item key must be canonical.'
      USING ERRCODE = '22023';
  END IF;

  IF _request_id IS NULL OR _request_id !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'Board Shop request ID must be a lowercase UUIDv4.'
      USING ERRCODE = '22023';
  END IF;

  _purchase_id := _request_id::uuid;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gostudy:web:shop:' || _request_id, 0)
  );

  SELECT purchases.*
  INTO _existing_purchase
  FROM public.web_board_purchases AS purchases
  WHERE purchases.purchaseid = _purchase_id;

  IF FOUND THEN
    IF _existing_purchase.userid <> _userid
       OR _existing_purchase.item_key <> _item_key THEN
      RAISE EXCEPTION 'Board Shop request ID was already used with a different payload.'
        USING ERRCODE = 'GSB03';
    END IF;

    SELECT owned.owned_itemid
    INTO STRICT _owned_item_id
    FROM public.web_owned_board_items AS owned
    WHERE owned.purchaseid = _purchase_id;

    RETURN QUERY
    SELECT
      _existing_purchase.purchaseid,
      _existing_purchase.userid,
      _existing_purchase.item_key,
      catalog.display_name,
      catalog.item_type,
      _existing_purchase.price_chalk,
      _owned_item_id,
      _existing_purchase.chalk_transactionid,
      _existing_purchase.chalk_balance,
      TRUE
    FROM public.web_board_shop_catalog AS catalog
    WHERE catalog.item_key = _existing_purchase.item_key;
    RETURN;
  END IF;

  SELECT catalog.*
  INTO _catalog_item
  FROM public.web_board_shop_catalog AS catalog
  WHERE catalog.item_key = _item_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Board Shop item was not found.'
      USING ERRCODE = 'GSB01';
  END IF;

  IF NOT _catalog_item.enabled THEN
    RAISE EXCEPTION 'Board Shop item is disabled.'
      USING ERRCODE = 'GSB02';
  END IF;

  SELECT chalk.*
  INTO STRICT _chalk_result
  FROM public.gostudy_purchase_board_item_chalk(
    _userid,
    _catalog_item.price_chalk,
    'shop:' || _userid::text || ':' || _request_id,
    _request_id
  ) AS chalk;

  INSERT INTO public.web_board_purchases (
    purchaseid,
    userid,
    item_key,
    price_chalk,
    chalk_transactionid,
    chalk_balance
  ) VALUES (
    _purchase_id,
    _userid,
    _catalog_item.item_key,
    _catalog_item.price_chalk,
    _chalk_result.transactionid,
    _chalk_result.account_balance
  );

  INSERT INTO public.web_owned_board_items (
    userid,
    item_key,
    purchaseid
  ) VALUES (
    _userid,
    _catalog_item.item_key,
    _purchase_id
  )
  RETURNING web_owned_board_items.owned_itemid
  INTO _owned_item_id;

  RETURN QUERY
  SELECT
    _purchase_id,
    _userid,
    _catalog_item.item_key,
    _catalog_item.display_name,
    _catalog_item.item_type,
    _catalog_item.price_chalk,
    _owned_item_id,
    _chalk_result.transactionid::bigint,
    _chalk_result.account_balance::bigint,
    FALSE;
END;
$$;

REVOKE ALL ON TABLE
  public.web_board_shop_catalog,
  public.web_board_purchases,
  public.web_owned_board_items
FROM PUBLIC;

REVOKE ALL ON SEQUENCE public.web_owned_board_items_owned_itemid_seq
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_reject_board_purchase_mutation()
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.web_purchase_board_item(bigint, text, text)
FROM PUBLIC;

GRANT SELECT
ON TABLE
  public.web_board_shop_catalog,
  public.web_board_purchases,
  public.web_owned_board_items
TO gostudy_web;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE
  public.web_board_shop_catalog,
  public.web_board_purchases,
  public.web_owned_board_items
FROM gostudy_web;

REVOKE ALL ON SEQUENCE public.web_owned_board_items_owned_itemid_seq
FROM gostudy_web;

GRANT EXECUTE
ON FUNCTION public.web_purchase_board_item(bigint, text, text)
TO gostudy_web;

REVOKE EXECUTE
ON FUNCTION public.gostudy_purchase_board_item_chalk(bigint, bigint, text, text)
FROM gostudy_web;

COMMIT;
