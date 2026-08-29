# Go Study web

The React frontend runs on Vite while a same-origin Express backend handles Discord OAuth and PostgreSQL-backed sessions.

## Local setup

Prerequisites: Node.js 20 or newer and PostgreSQL.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Apply the SQL files in `migrations/` in numeric order. Migration `0003_create_reward_seen_rewards.sql` must run before deploying an application build that reads unseen-reward state. Migration `0004_create_admin_roles.sql` requires the StudyLion v19 Chalk functions and the `gostudy_web` role to exist first. Migrations `0005_create_board_shop.sql` and `0006_create_board_objects_v2.sql` require StudyLion schema v20; deploy migration 0006 before deploying an application build that reads generic board objects.
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

- `GET /api/board` returns generic board objects as a `source: "reward" | "shop"` discriminated union. Every placement has a string `boardObjectId`; reward and owned-item BIGINT IDs also remain strings.
- `POST /api/board/items` retains the legacy reward placement body `{hourRewardId,x,y}`.
- `POST /api/board/owned-items` places one owned Sticky Note or Basic Decoration using the strict body `{ownedItemId,x,y}`. GIF Slot and Photo Frame remain unplaceable.
- `PATCH /api/board/objects/:boardObjectId` saves normalized coordinates for either source type.
- `DELETE /api/board/objects/:boardObjectId` idempotently removes only the placement.
- `PATCH /api/board/sticky-notes/:ownedItemId` saves a strict `{body}` plain-text note. Empty notes are allowed.
- `PATCH` and `DELETE /api/board/items/:hourRewardId` remain as reward-only compatibility routes.

Board writes require the request `Origin` to match `APP_URL`; JSON writes also require `application/json` and use a 16 KiB parser limit. User identity and catalog type come only from the session and database. The browser cannot choose `userid`, `object_type`, an arbitrary asset URL, or a Chalk mutation. A board can contain at most 100 objects across reward and Shop sources; placement serializes on the user's board row before counting.

Sticky Note text accepts at most 2,000 Unicode code points and 250 non-empty, whitespace-delimited words. The server is the canonical word-limit boundary. PostgreSQL independently enforces `char_length(body) <= 2000`; it intentionally does not duplicate the word rule because PostgreSQL and JavaScript whitespace classes can diverge for Unicode input. React renders the body only as a text child—HTML-like and Markdown-like input remains literal.

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

Inventory returns legacy study rewards in `items` and purchased board instances in `shopItems`. Legacy rewards keep their existing Add to Board behavior. Sticky Note and Basic Decoration instances show Add to Board or On Board; GIF Slot and Photo Frame continue to show “Board support coming next.” Adding, removing, or re-adding an owned item never invokes the purchase function and never spends or refunds Chalk.

Disposable v20 coverage lives in `tests/integration/chapter3b_v20_setup.sql` and `tests/integration/chapter3b_board_shop.sql`. Load StudyLion schema v20 and web migrations 0001–0004 into a throwaway database, run the setup, apply migration 0005, and then run the Shop integration file. Never run this sequence against `lion_data`.

## Generic board objects and migration 0006

Migration 0006 takes an `ACCESS EXCLUSIVE` lock on the legacy placement table inside one transaction, creates `web_study_board_objects`, copies every legacy row as a reward object without transforming coordinates or timestamps, compares row counts, and performs bidirectional `EXCEPT` checks over `(userid,hour_rewardid,x,y)`. Only after those assertions pass does it drop `web_study_board_items`; any failure rolls back the table creation, copy, and drop together.

Reward and owned-instance uniqueness use separate partial unique indexes. The generic source-shape check makes reward and Shop identifiers mutually exclusive, and a trigger proves every Shop object's session owner and `object_type` against the owned catalog item. No web-owned table has a foreign key to StudyLion reward tables. Shop placement and Sticky Note content reference `web_owned_board_items` with `ON DELETE RESTRICT`: removing a placement cannot delete ownership, purchase history, or note text, and a re-added note restores its prior text.

Sticky Note writes use the `SECURITY DEFINER` function `web_upsert_sticky_note(bigint,bigint,text)`. The runtime role can read note content but cannot mutate the note table directly. The function validates positive IDs, exact ownership, the `sticky-note` item key, and the database character bound before upserting.

Apply migration 0006 with a controlled deployment role while board writes are paused, then transfer its objects to `gostudy_web_owner` before serving the new application build:

```sql
ALTER TABLE public.web_study_board_objects OWNER TO gostudy_web_owner;
ALTER SEQUENCE public.web_study_board_objects_board_objectid_seq
  OWNER TO gostudy_web_owner;
ALTER TABLE public.web_sticky_notes OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_board_shop_object()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_sticky_note_owner()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_sticky_note(bigint, bigint, text)
  OWNER TO gostudy_web_owner;
```

Do not make `gostudy_web` a member of `gostudy_web_owner`. The migration grants only placement table access, coordinate-only UPDATE, identity-sequence use, note SELECT, and execution of the ownership-checking note function.

Disposable Chapter 4 coverage lives in `tests/integration/chapter4_legacy_board_setup.sql` and `tests/integration/chapter4_board_objects.sql`. Starting from StudyLion schema v20 and web migrations 0001–0005 in a throwaway database, load the legacy fixture, apply migration 0006, transfer ownership as the assertion script does, and run the Chapter 4 assertions. The suite proves exact legacy preservation, both uniqueness indexes, strict source/type ownership, note boundaries, remove/re-add persistence, and runtime permissions. Never run migration 0006 or the integration files against `lion_data` during validation.

## Production

Set `NODE_ENV=production`, use HTTPS values for `APP_URL` and `DISCORD_REDIRECT_URI`, set `TRUST_PROXY` for the actual reverse-proxy topology, and use certificate verification for PostgreSQL. `npm run build` builds both the Vite app and Express server; `npm start` serves the API, auth routes, and built frontend from one origin.
