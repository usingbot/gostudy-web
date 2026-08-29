# Go Study web

The React frontend runs on Vite while a same-origin Express backend handles Discord OAuth and PostgreSQL-backed sessions.

## Local setup

Prerequisites: Node.js 20 or newer and PostgreSQL.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Apply the SQL files in `migrations/` in numeric order. Migration `0003_create_reward_seen_rewards.sql` must run before deploying an application build that reads unseen-reward state. Migration `0004_create_admin_roles.sql` requires the StudyLion v19 Chalk functions and the `gostudy_web` role to exist first.
4. In the Discord developer portal, register `http://localhost:3000/auth/discord/callback` as an OAuth redirect URI.
5. Start Express with `npm run dev:server`.
6. In another terminal, start Vite with `npm run dev`.

Vite listens on port 3000 and proxies `/api` and `/auth` to Express on port 8787. The OAuth request uses only Discord's `identify` scope.

## Authenticated data API

- `GET /api/dashboard` returns verified-time progress, the four most recent inventory instances, and `newRewardCount`.
- `GET /api/inventory?limit=20&cursor=<hourRewardId>` returns a bounded, descending keyset page as `{items, nextCursor}`; every instance includes `isNew`.
- `GET /api/catalog` returns the reward catalog ordered by its selection order.
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

## Production

Set `NODE_ENV=production`, use HTTPS values for `APP_URL` and `DISCORD_REDIRECT_URI`, set `TRUST_PROXY` for the actual reverse-proxy topology, and use certificate verification for PostgreSQL. `npm run build` builds both the Vite app and Express server; `npm start` serves the API, auth routes, and built frontend from one origin.
