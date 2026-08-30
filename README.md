# Go Study web

The React frontend runs on Vite while a same-origin Express backend handles Discord OAuth and PostgreSQL-backed sessions.

## Local setup

Prerequisites: Node.js 20 or newer and PostgreSQL.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Apply the SQL files in `migrations/` in numeric order. Migration `0003_create_reward_seen_rewards.sql` must run before deploying an application build that reads unseen-reward state. Migration `0004_create_admin_roles.sql` requires the StudyLion v19 Chalk functions and the `gostudy_web` role to exist first. Migrations `0005_create_board_shop.sql` through `0009_create_photo_frames.sql` require StudyLion schema v20. Migration `0010_create_guild_publishing.sql` requires StudyLion schema v21, and `0011_create_guild_boards.sql` requires StudyLion schema v22. Deploy each migration before its matching application build.
4. In the Discord developer portal, register `http://localhost:3000/auth/discord/callback` as an OAuth redirect URI.
5. Start Express with `npm run dev:server`.
6. In another terminal, start Vite with `npm run dev`.

Vite listens on port 3000 and proxies `/api` and `/auth` to Express on port 8787. Discord OAuth requests the `identify` and `guilds` scopes.

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
- `POST /api/board/owned-items` places one owned Sticky Note, Basic Decoration, GIF Slot, or Photo Frame using the strict body `{ownedItemId,x,y}`.
- `PATCH /api/board/objects/:boardObjectId` saves normalized coordinates for either source type.
- `DELETE /api/board/objects/:boardObjectId` idempotently removes only the placement.
- `PATCH /api/board/sticky-notes/:ownedItemId` saves a strict `{body}` plain-text note. Empty notes are allowed.
- `PUT /api/board/gifs/:ownedItemId` accepts only `{giphyId}`, validates canonical syntax and exact owned `gif-slot` identity, and persists that ID without contacting GIPHY.
- `PUT /api/board/photo-frames/:ownedItemId/image` accepts `multipart/form-data` containing exactly one `image` file and requires `X-Photo-Revision: <nonnegative BIGINT>`. Use `0` for a frame with no image and the current response revision for replacement.
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

Inventory returns legacy study rewards in `items` and purchased board instances in `shopItems`. Legacy rewards keep their existing Add to Board behavior. Sticky Note, Basic Decoration, GIF Slot, and Photo Frame instances show Add to Board or On Board. Adding, removing, or re-adding an owned item never invokes the purchase function and never spends or refunds Chalk.

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

## GIPHY GIF Slots and migration 0007

`VITE_GIPHY_API_KEY` must be a dedicated GIPHY Web platform key. Vite embeds it in browser code, so it is browser-visible by design; never reuse a Discord secret, session secret, server credential, or a key assigned to another platform. `.env.example` contains only a placeholder. Express neither reads nor returns this key.

The custom picker sends direct browser Search requests to GIPHY with `cache: 'no-store'`. The official fetch SDK is not used because its public Search and Get-by-IDs methods retain response objects in an internal one-minute memory cache, which conflicts with this integration's no-media-URL-cache rule. The picker requests 24 G-rated GIFs at a time and displays the returned array in provider order: results are never filtered or reordered. Supported still and animated renditions are selected without rewriting their URLs. An unrenderable result remains in place with an unavailable card instead of being silently removed. Visible “Powered by GIPHY” attribution remains in the picker.

`GET /api/board` returns only each configured `giphyId`. The browser batches up to 100 unique configured IDs through GIPHY's direct Get GIFs by ID call, merges the response back into the existing board order, and renders loading, unavailable, and retry states. Reduced-motion users receive a still rendition when available and never receive the animated no-still fallback. Media URLs and GIF bytes load directly from GIPHY; Go Study does not persist them, proxy them, rewrite them, or add an application cache.

The selection route accepts only the canonical GIPHY ID. It proves exact session ownership and the `gif-slot` catalog type, then calls `web_upsert_board_gif` without contacting GIPHY. A syntactically valid ID that is missing or later removed from GIPHY remains safe durable identity and simply hydrates as unavailable in the browser. The client cannot submit title, dimensions, or URLs. `web_board_gifs` stores only `giphy_id` alongside Go Study ownership identity. A missing row remains a valid unconfigured slot.

`web_board_gifs` is keyed by `owned_itemid` and uses `ON DELETE RESTRICT`. Removing a board object deletes only its placement, so ownership and the selected GIF survive and reappear when the slot is re-added. The runtime role can read this table but cannot modify it directly; its only write path is the `SECURITY DEFINER` function with `search_path = pg_catalog`, positive/bounded input checks, and repeated exact ownership/type validation.

Apply migration 0007 with a controlled deployment role after migration 0006, then transfer every new object to the existing `gostudy_web_owner` NOLOGIN role before serving Chapter 5:

```sql
ALTER TABLE public.web_board_gifs OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_validate_board_gif_owner()
  OWNER TO gostudy_web_owner;
ALTER FUNCTION public.web_upsert_board_gif(
  bigint, bigint, text
) OWNER TO gostudy_web_owner;
```

Do not make `gostudy_web` a member of `gostudy_web_owner`, and do not grant it direct mutation on `web_board_gifs`. Keep GIF traffic paused until migration 0007, the ownership transfer, and the dedicated `VITE_GIPHY_API_KEY` Web key are configured in the frontend build environment.

Disposable Chapter 5 coverage lives in `tests/integration/chapter5_board_gifs.sql`. Starting from StudyLion schema v20, load `chapter3b_v20_setup.sql`, apply migrations 0001–0007, and run that assertion file. It proves empty-slot behavior, identity-only persistence, cross-user/type rejection, runtime privileges, definer ownership, no Chalk mutation, and selected-GIF persistence through remove/re-add. Never run this sequence against `lion_data`.

## Photo Frames, private R2, and migration 0009

Photo Frame storage uses a private Cloudflare R2 bucket through its S3-compatible API. Configure all four server-only variables in the Express environment; none may use a `VITE_` prefix:

```dotenv
R2_ACCOUNT_ID=replace-with-lowercase-32-character-account-id
R2_ACCESS_KEY_ID=replace-with-r2-access-key-id
R2_SECRET_ACCESS_KEY=replace-with-r2-secret-access-key
R2_BUCKET=replace-with-private-photo-frame-bucket
```

Create a dedicated R2 bucket and leave public access disabled. Create a narrow R2 API token with Object Read & Write permission scoped only to that bucket. Do not reuse an account-wide token. The server endpoint is `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with region `auto`; Helmet adds that exact configured origin to `img-src`, not an R2 wildcard.

Image bytes travel from the authenticated browser to Express and then to R2; the browser never receives R2 credentials or permission to choose a storage key. The multipart route accepts exactly one `image` file, limits it to 5 MiB while streaming, and ignores the untrusted filename, extension, and browser media type. Sharp actually decodes only JPEG, PNG, or WebP with a 24-megapixel input limit, rejects animation and unsupported/corrupt input, applies source orientation, strips EXIF and other metadata, resizes within 1600×1600 without enlargement, and emits only quality-85 WebP. Original bytes and filenames are never retained. The normalized output also has a 5 MiB bound and a recorded SHA-256 digest.

R2 keys have the generated form `photo-frames/<ownedItemId>/<random-uuid>.webp`; Discord user IDs are not used in paths. `server/photo-storage.ts` owns put, delete, and short-lived (30-minute) signed GET operations. The bucket stays private, signed URLs are ephemeral bearer access returned only for the current board read, and signed URLs are never stored in PostgreSQL. The browser loads the image directly from R2; Go Study does not proxy downloads.

Migration 0009 creates one `web_photo_frames` row per independently owned Photo Frame. The table binds state to `web_owned_board_items` with `ON DELETE RESTRICT`, independently validates exact `photo-frame` ownership, constrains generated keys, dimensions, byte size, digest, and positive revision, and has no foreign key to StudyLion-owned tables. The runtime role can select state but cannot mutate it directly. `web_replace_photo_frame_image` is the only write path: expected revision `0` inserts revision `1`; a matching positive revision replaces and increments it; a stale revision fails without mutation.

Replacement consistency is ordered as follows: normalize, upload the new generated object, call the revision-safe database function, best-effort delete the new object if the DB mutation fails, then best-effort delete the old object only after DB success. Failure to delete the old object leaves an orphan for later cleanup but never rolls back the successful user-visible replacement. Rapid replacements therefore cannot silently let an older revision overwrite newer state.

Removing a Photo Frame from the Study Board deletes only `web_study_board_objects` placement. It does not delete the purchase, owned item, `web_photo_frames` state, or R2 image. Re-adding the same `ownedItemId` restores the same stored image with a fresh signed URL. Uploading or replacing an image never calls the Shop purchase function and costs no Chalk.

### Deploying migration 0009

Do not execute deployment from a development validation session. The reviewed production sequence is:

1. Create a private R2 bucket with public access disabled.
2. Create bucket-scoped Object Read & Write credentials.
3. Configure the four server-only `R2_*` environment variables.
4. Back up `lion_data` using the established StudyLion procedure.
5. Apply `migrations/0009_create_photo_frames.sql` with a controlled deployment role.
6. Transfer the new table and functions to the existing `gostudy_web_owner` NOLOGIN role:

   ```sql
   ALTER TABLE public.web_photo_frames OWNER TO gostudy_web_owner;
   ALTER FUNCTION public.web_validate_photo_frame_owner()
     OWNER TO gostudy_web_owner;
   ALTER FUNCTION public.web_replace_photo_frame_image(
     bigint, bigint, text, integer, integer, bigint, text, bigint
   ) OWNER TO gostudy_web_owner;
   ```

7. Verify that `gostudy_web` has only table `SELECT` plus execution of the narrow replacement function, has no direct table mutation, and is not a member of `gostudy_web_owner`.
8. Build the application.
9. Perform a live JPEG/PNG/WebP upload, refresh, replace, remove, and re-add smoke test against the private bucket.
10. Commit only after code, migration, permissions, and smoke-test review.

Disposable Chapter 6 coverage lives in `tests/integration/chapter6_photo_frames.sql`. Start from StudyLion schema v20, run `chapter3b_v20_setup.sql`, apply web migrations 0001–0009, transfer ownership as the assertion script does, and run the Chapter 6 assertions. It tests exact ownership/type boundaries, constraints, revision conflicts, least privilege, no Chalk mutation, and placement removal/re-add persistence. Never run the migration or integration script against `lion_data` during validation. Unit and route tests mock storage and require no real R2 credentials.

## Guild Publishing foundation and migration 0010

Discord OAuth requests `identify guilds`. During the callback, Express uses the temporary access token to request `GET /users/@me` and `GET /users/@me/guilds`. It keeps only the user identity and guild IDs for which Discord reports owner status, Manage Guild (`1 << 5`), or Administrator (`1 << 3`) in the server-side session. The OAuth token and guild/member payloads are not returned to the browser or persisted as application data. Guild-management authorization is a session snapshot and refreshes at the next Discord login/session renewal; re-login after a Discord permission change.

An authenticated user can configure a guild only when that guild ID is present in the OAuth authorization snapshot and `public.gostudy_guilds` currently contains an active row. The Go Study web `owner` role is the sole global development/bootstrap override for active registered guilds. The ordinary web `admin` role does not grant Discord guild-management rights. Platform administration and Discord guild administration remain separate.

`public.web_guild_publications` owns only publication state: canonical unique slug, public/hidden state, normalized Discord invite code, audit actors, and timestamps. `public.web_guild_tags` owns an ordered normalized tag list with at most five admin-defined display tags. Guild name, icon, banner, description, and member count remain authoritative in StudyLion schema v21's bot-owned `public.gostudy_guilds`; the web application receives narrow `SELECT` only and never mutates that registry. There is deliberately no foreign key from web publication storage to the bot-owned table. The service and `web_upsert_guild_publication` both validate that an active registered guild exists.

Slugs are 3–64 lowercase ASCII letters, digits, and single separating hyphens. Invalid slugs are rejected rather than rewritten. The admin supplies an existing canonical `https://discord.gg/<code>` or `https://discord.com/invite/<code>` URL. Go Study does not ask the bot to create an invite; only the invite code is persisted. Tags are plain text, trimmed, 1–24 visible characters, unique case-insensitively, and capped at five. The function replaces publication settings and the complete ordered tag set in one transaction.

`GET /api/admin/servers` returns only active registered guilds the session may manage, or all active guilds for the owner override. `PUT /api/admin/servers/:guildid` requires authentication, exact same-origin, JSON media type, the 16 KiB parser limit, strict fields, a session-derived actor, and server-side guild authorization before invoking the database function. The server-side `getPublicGuilds` read model joins registry, publication, and tags and qualifies only active guilds whose publication is public. Chapter 7B does not expose `/servers` or a public gallery.

### Deploying migration 0010

Documented production sequence—do not execute it during development validation:

1. Confirm Discord OAuth allows the existing redirect URI and the application requests both `identify` and `guilds`.
2. Back up `lion_data` using the established StudyLion procedure.
3. Confirm the deployed StudyLion schema is v21 and includes the bot-owned guild registry.
4. Apply `migrations/0010_create_guild_publishing.sql` with a controlled deployment role.
5. Confirm `gostudy_web` and `gostudy_web_owner` have `SELECT` on `public.gostudy_guilds`, with no registry mutation privileges.
6. Transfer the web publication objects to the existing `gostudy_web_owner` NOLOGIN role:

   ```sql
   ALTER TABLE public.web_guild_publications OWNER TO gostudy_web_owner;
   ALTER TABLE public.web_guild_tags OWNER TO gostudy_web_owner;
   ALTER FUNCTION public.web_upsert_guild_publication(
     bigint, text, boolean, text, text[], bigint
   ) OWNER TO gostudy_web_owner;
   ```

7. Verify `gostudy_web` has only publication-table `SELECT`, guild-registry `SELECT`, and execution of the narrow upsert function; verify PUBLIC cannot execute it and the runtime role is not a member of the owner role.
8. Build and deploy the web application.
9. Re-login with Discord to refresh the server-side guild authorization snapshot.
10. Configure one test guild publication in `/admin/servers` and verify settings reload.
11. Keep the public server gallery unavailable until Chapter 7C.

Disposable Chapter 7B coverage lives in `tests/integration/chapter7b_guild_publishing.sql`. Create a throwaway database from the current StudyLion `data/schema.sql` v21, create the web runtime/owner roles using the established disposable setup, apply web migrations 0001–0010 in numeric order, and run the Chapter 7B assertions. The script checks schema version, constraints, unique slug, validation, atomic tags, active-guild enforcement, ownership transfer, and least privilege. Never point this sequence at `lion_data`.

## Persistent public guild boards and migration 0011

Each active, published guild has a finite public Study Board surface. `public.web_guild_boards` stores only its fixed theme, fixed-tier logical dimensions, optimistic revision, audit actors, and timestamps; it deliberately has no foreign key to bot-owned guild metadata or publication storage. A public guild without a row receives the canonical `midnight` theme, `3000 × 1800` starter canvas, revision `"0"`, and `objects: []`. Anonymous reads never create a row. The only other themes are `mint`, `cork`, and `paper`; all four backgrounds are fixed CSS-only designs. There is no custom CSS, arbitrary color or URL, R2 background, or upload path.

`GET /api/servers/:slug/board` is anonymous and independently requires an active bot registry row plus a public publication with the requested canonical slug. `GET /api/admin/servers/:guildid/board` and `PUT /api/admin/servers/:guildid/board/theme` require the same Chapter 7B Discord guild authorization: current owner, Administrator, or Manage Server authorization captured at login, with only the Go Study web `owner` role receiving a global active-guild override. An ordinary web `admin` has no override. The mutation actor always comes from the session.

`public.web_upsert_guild_board_theme(bigint,text,bigint,bigint)` is the guild-manager theme write path. A missing row accepts expected revision `0`, creates the starter canvas, and becomes revision `1`; an existing row accepts only its exact current revision, preserves dimensions, and increments it. A stale editor receives `GUILD_BOARD_REVISION_CONFLICT` and must reload instead of overwriting another administrator's save.

Canvas capacity uses four exact pairs: Starter `3000 × 1800`, Expanded `4500 × 2700`, Large `6000 × 3600`, and Mega `9000 × 5400`. `PUT /api/admin/servers/:guildid/board/capacity` and `public.web_expand_guild_board(bigint,integer,integer,bigint,bigint)` are reserved to the Go Study platform `owner`; the function independently verifies that role from `web_user_roles`. Guild managers and ordinary web admins cannot expand. Expansion must move to a strictly larger tier, adds logical space to the right and bottom from a stable top-left origin, and never changes existing or future object coordinates. Shrinking is not supported. Chapter 7D intentionally imposes no object-count limit.

Public and admin previews use the same transformed DOM viewport. The browser fits the board initially, supports 30–200% zoom, 100%, pointer/touch/middle-button and wheel panning, and Ctrl/Cmd-wheel pointer-centered zoom with bounded visual overscroll. Pan and zoom are ephemeral browser camera state: they are never sent to the API or persisted. The logical surface does not allocate a 9000 × 5400 bitmap.

### Deploying migration 0011

Documented production sequence—do not execute it during development validation:

1. Back up `lion_data` using the established StudyLion procedure.
2. Verify the deployed StudyLion schema is v22.
3. Apply `migrations/0011_create_guild_boards.sql` with a controlled deployment role.
4. Transfer the new table and function to the existing `gostudy_web_owner` NOLOGIN role:

   ```sql
   ALTER TABLE public.web_guild_boards OWNER TO gostudy_web_owner;
   ALTER FUNCTION public.web_upsert_guild_board_theme(
     bigint, text, bigint, bigint
   ) OWNER TO gostudy_web_owner;
   ALTER FUNCTION public.web_expand_guild_board(
     bigint, integer, integer, bigint, bigint
   ) OWNER TO gostudy_web_owner;
   ```

5. Verify `gostudy_web` has board-table `SELECT` and execution of only the two narrow board functions; verify it has no direct board mutation, PUBLIC cannot execute either function, it is not a member of `gostudy_web_owner`, and the bot guild-registry ACLs remain unchanged and read-only.
6. Build and deploy the web application.
7. Open one test guild's board editor from `/admin/servers`.
8. Select and save one fixed theme, then—while signed in as the Go Study owner—deliberately expand one tier and reload to verify the persisted revision and dimensions.
9. Open the guild's public page anonymously and verify the same theme, dimensions, pan/zoom controls, and honest empty state.
10. Do not add decorations until Chapter 7E.

Discord emoji and sticker board objects, their picker, placement, dragging, movement permissions, ownership, and Chalk costs are deferred to Chapter 7E. Chapter 7D has no decoration controls and returns an empty object array by design. Living Board vitality/decay is deferred until after Chapter 7E.

Disposable Chapter 7D coverage lives in `tests/integration/chapter7d_acl_snapshot.sql` and `tests/integration/chapter7d_guild_boards.sql`. In one isolated PostgreSQL database, load current StudyLion `data/schema.sql` v22, create non-superuser `gostudy_web` and NOLOGIN owner roles, run the established v20 ownership setup, and apply web migrations 0001–0010. Then, in one psql session, run the ACL snapshot, migration 0011, and Chapter 7D assertions in that order. The test proves constraints, all four themes and capacity tiers, active-guild enforcement, dimension-preserving theme saves, owner-only non-shrinking expansion, optimistic revisions and atomic conflicts, real non-owner runtime privileges, PUBLIC revocation, no bot-registry foreign key, and unchanged guild-registry ACLs. Drop the disposable cluster afterward; never point this sequence at `lion_data`.

## Production

Set `NODE_ENV=production`, use HTTPS values for `APP_URL` and `DISCORD_REDIRECT_URI`, set `TRUST_PROXY` for the actual reverse-proxy topology, and use certificate verification for PostgreSQL. `npm run build` builds both the Vite app and Express server; `npm start` serves the API, auth routes, and built frontend from one origin.
