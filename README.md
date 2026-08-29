# Go Study web

The React frontend runs on Vite while a same-origin Express backend handles Discord OAuth and PostgreSQL-backed sessions.

## Local setup

Prerequisites: Node.js 20 or newer and PostgreSQL.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Apply the SQL files in `migrations/` in numeric order. Migration `0003_create_reward_seen_rewards.sql` must run before deploying an application build that reads unseen-reward state. Migration `0004_create_admin_roles.sql` requires the StudyLion v19 Chalk functions and the `gostudy_web` role to exist first. Migration `0005_create_board_shop.sql` requires StudyLion schema v20 and its private board-purchase Chalk wrapper.
4. In the Discord developer portal, register `http://localhost:3000/auth/discord/callback` as an OAuth redirect URI.
5. Start Express with `npm run dev:server`.
6. In another terminal, start Vite with `npm run dev`.

Vite listens on port 3000 and proxies `/api` and `/auth` to Express on port 8787. The OAuth request uses only Discord's `identify` scope.

## Authenticated data API

- `GET /api/dashboard` returns verified-time progress, the four most recent inventory instances, and `newRewardCount`.
- `GET /api/inventory?limit=20&cursor=<hourRewardId>` returns legacy rewards as a bounded, descending keyset page in `items`, Shop-owned instances in `shopItems` on the first page, and `nextCursor`; every legacy reward includes `isNew`.
- `GET /api/catalog` returns the reward catalog ordered by its selection order.
- `GET /api/shop` returns the enabled Board Shop catalog and the authenticated user's current Chalk balance.
- `POST /api/shop/purchase` buys one independent board-item instance using a lowercase UUIDv4 request ID.
- `POST /api/rewards/seen` atomically marks a batch of 1–50 owned reward instances as seen after Inventory renders them.

All product endpoints derive the Discord user ID from the server session. Inventory IDs are serialized as decimal strings.

## New reward state

Migration `0003_create_reward_seen_rewards.sql` takes a `SHARE` lock on `public.gostudy_hour_rewards`, creates the web-owned seen table, and baselines every existing positive reward as seen. The lock makes the cutover exact: concurrent reward inserts wait, so rewards committed after the migration become new. Do not run the migration while holding a long-running transaction that writes hourly rewards.

The `gostudy_web` role receives only `SELECT` and `INSERT` on `public.web_reward_seen_rewards`. Mark-seen writes require an authenticated session and an `Origin` exactly matching `APP_URL`; the server rejects the whole batch if any submitted reward does not belong to that session user. No bot-owned table is modified.

## Study Board API

- `GET /api/board` returns the authenticated user's placed inventory instances.
- `POST /api/board/items` places one owned inventory instance at normalized `x` and `y` coordinates.
- `PATCH /api/board/items/:hourRewardId` saves a placed item's normalized position.
- `DELETE /api/board/items/:hourRewardId` idempotently removes the current user's placement.

Board writes require the request `Origin` to match `APP_URL`. Ownership is derived from the authenticated session and verified against the product inventory tables. A board can contain at most 100 item instances. The web database role needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on `public.web_study_boards` and `public.web_study_board_items`; product-table access remains read-only.

## Admin Panel and web roles

An authenticated user without a row in `public.web_user_roles` is an ordinary `user`. Stored roles are `owner`, `admin`, and `tester`; only owner and admin can access `/admin` or protected admin APIs. The server reads the effective role from PostgreSQL on every protected request and always derives the actor Discord ID from the server session.

The Admin Panel supports exact canonical Discord-user-ID lookup only. A displayed username, global name, or avatar is a best-known projection from that user's latest unexpired website session, not proof of current Discord membership. Session identifiers, session JSON, OAuth state, and secrets are never returned.

Admin mutations require an authenticated owner/admin session, an exact same-origin `Origin`, JSON media type, a strict body no larger than 16 KiB, and canonical input. They are limited to 30 attempts per authenticated actor per 10 minutes in this one-process private-alpha deployment. Horizontal deployment requires a shared rate-limit store.

Chalk adjustments call only the four narrow v19 admin/read functions. The server namespaces a client UUIDv4 as `admin:<actor_userid>:<requestId>`, and the UI retains that UUID for retries whose result is unknown. The runtime role has no generic Chalk mutation privilege and no direct Chalk-table or role-table mutation privilege.

### Deploying migration 0004

Create the trusted owner role outside tracked application migrations if it does not already exist:

```sql
CREATE ROLE gostudy_web_owner NOLOGIN;
```

After applying `migrations/0004_create_admin_roles.sql` with a deployment role, transfer every web security object to that NOLOGIN role:

```sql
ALTER TABLE public.web_user_roles OWNER TO gostudy_web_owner;
ALTER TABLE public.web_role_audit OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_role_audit_auditid_seq OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_role_audit_mutation()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_bootstrap_owner(bigint)
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_change_user_role(bigint, bigint, text, text, text)
  OWNER TO gostudy_web_owner;
```

Do not grant `gostudy_web` membership in `gostudy_web_owner`. From a controlled deployment session authorized as `gostudy_web_owner`, bootstrap the one initial owner exactly once, substituting the intended canonical Discord user ID:

```sql
SELECT public.web_bootstrap_owner(:OWNER_DISCORD_USERID::bigint);
```

The bootstrap function is not executable by `gostudy_web`; a second bootstrap fails. Normal role operations cannot create, change, delete, or transfer the owner role.

Disposable PostgreSQL coverage lives in `tests/integration/chapter2b_v19_setup.sql` and `tests/integration/chapter2b_admin.sql`. Load the current StudyLion schema v19 into a throwaway database, run the setup file, apply migration 0004, and then run the admin integration file. Never point this sequence at `lion_data`.

## Board Shop and migration 0005

`public.web_board_shop_catalog` is the only effective price source. The initial catalog contains Basic Decoration, Sticky Note, GIF Slot, and Photo Frame at 1, 2, 3, and 5 Chalk respectively. The browser sends only an item key and a lowercase UUIDv4 request ID; it never sends a price or user ID.

`public.web_purchase_board_item(bigint,text,text)` is a `SECURITY DEFINER` transaction boundary. It validates canonical input, takes a transaction-scoped advisory lock for the request ID, returns an exact prior result for an identical replay, reads the enabled catalog row, delegates the exact database price to the v20 Chalk wrapper, inserts an immutable purchase audit row, and inserts one independently addressable owned-item row. PostgreSQL rolls the delegated debit back if either later insert fails. Reusing a request ID with another user or item fails deterministically.

The runtime role has read-only access to the three Shop tables and can execute only the web purchase function for Shop mutations. It cannot execute the underlying price-taking Chalk wrapper or directly mutate Shop storage. The existing narrow `gostudy_admin_get_chalk_account(bigint)` read grant from migration 0004 supplies the Shop balance without exposing Chalk-table writes.

### Deploying migration 0005

Apply migration 0005 with a controlled deployment role, then transfer every web-owned Shop object to the existing `gostudy_web_owner` NOLOGIN role:

```sql
ALTER TABLE public.web_board_shop_catalog OWNER TO gostudy_web_owner;
ALTER TABLE public.web_board_purchases OWNER TO gostudy_web_owner;
ALTER TABLE public.web_owned_board_items OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_owned_board_items_owned_itemid_seq
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_reject_board_purchase_mutation()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_purchase_board_item(bigint, text, text)
  OWNER TO gostudy_web_owner;
```

Grant the web owner, not the runtime role, permission to delegate the exact server-side catalog price to Chalk:

```sql
GRANT EXECUTE
ON FUNCTION public.gostudy_purchase_board_item_chalk(bigint, bigint, text, text)
TO gostudy_web_owner;
```

Do not make `gostudy_web` a member of `gostudy_web_owner` or `gostudy_chalk_owner`, and do not grant `gostudy_web` direct execution of `gostudy_purchase_board_item_chalk`. Keep the app unavailable to purchase traffic until the ownership transfer and owner-only wrapper grant are complete.

Inventory returns legacy study rewards in `items` and purchased board instances in `shopItems`. Legacy rewards keep their existing Add to Board behavior. Shop items deliberately show “Board support coming next” because the current board schema accepts only legacy `hourRewardId` values.

Disposable v20 coverage lives in `tests/integration/chapter3b_v20_setup.sql` and `tests/integration/chapter3b_board_shop.sql`. Load StudyLion schema v20 and web migrations 0001–0004 into a throwaway database, run the setup, apply migration 0005, and then run the Shop integration file. Never run this sequence against `lion_data`.

## Production

Set `NODE_ENV=production`, use HTTPS values for `APP_URL` and `DISCORD_REDIRECT_URI`, set `TRUST_PROXY` for the actual reverse-proxy topology, and use certificate verification for PostgreSQL. `npm run build` builds both the Vite app and Express server; `npm start` serves the API, auth routes, and built frontend from one origin.
