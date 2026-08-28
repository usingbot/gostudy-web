# Go Study web

The React frontend runs on Vite while a same-origin Express backend handles Discord OAuth and PostgreSQL-backed sessions.

## Local setup

Prerequisites: Node.js 20 or newer and PostgreSQL.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Apply `migrations/0001_create_web_sessions.sql` and `migrations/0002_create_study_board.sql` to the database in order.
4. In the Discord developer portal, register `http://localhost:3000/auth/discord/callback` as an OAuth redirect URI.
5. Start Express with `npm run dev:server`.
6. In another terminal, start Vite with `npm run dev`.

Vite listens on port 3000 and proxies `/api` and `/auth` to Express on port 8787. The OAuth request uses only Discord's `identify` scope.

## Authenticated data API

- `GET /api/dashboard` returns verified-time progress and the four most recent inventory instances.
- `GET /api/inventory?limit=20&cursor=<hourRewardId>` returns a bounded, descending keyset page as `{items, nextCursor}`.
- `GET /api/catalog` returns the reward catalog ordered by its selection order.

All three endpoints derive the Discord user ID from the server session. Inventory IDs are serialized as decimal strings.

## Study Board API

- `GET /api/board` returns the authenticated user's placed inventory instances.
- `POST /api/board/items` places one owned inventory instance at normalized `x` and `y` coordinates.
- `PATCH /api/board/items/:hourRewardId` saves a placed item's normalized position.
- `DELETE /api/board/items/:hourRewardId` idempotently removes the current user's placement.

Board writes require the request `Origin` to match `APP_URL`. Ownership is derived from the authenticated session and verified against the product inventory tables. A board can contain at most 100 item instances. The web database role needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on `public.web_study_boards` and `public.web_study_board_items`; product-table access remains read-only.

## Production

Set `NODE_ENV=production`, use HTTPS values for `APP_URL` and `DISCORD_REDIRECT_URI`, set `TRUST_PROXY` for the actual reverse-proxy topology, and use certificate verification for PostgreSQL. `npm run build` builds both the Vite app and Express server; `npm start` serves the API, auth routes, and built frontend from one origin.
