# DEPLOY.md — self-hosting runbook

Production runs in Docker on the home server, alongside km-tracker, and is
reachable **only** through the existing Cloudflare Tunnel at
**https://todoist-points.graham-williams.com**, gated by Cloudflare Access
(one-time PIN). The app also verifies the Access JWT itself (see
`src/middleware.ts`) — so even in-network traffic that bypasses the tunnel
gets a 403 without a valid Access token.

## Box layout

- Server: Ubuntu home server, reached via Tailscale SSH: `ssh graham@100.101.1.28`
- App dir: `~/todoist-points` (a clone of this repo)
- Data: `~/todoist-points/data/todoist-points.db` (SQLite, bind-mounted into the container at `/data`)
- Secrets: `~/todoist-points/.env` (gitignored; holds `TODOIST_API_TOKEN` and
  `CF_ACCESS_AUD` — the latter is the Cloudflare Access application's Audience
  (AUD) tag for `todoist-points.graham-williams.com`, copied from the
  Cloudflare Zero Trust dashboard/API when the Access app is created)

## First deploy

```bash
ssh graham@100.101.1.28
git clone https://github.com/Graham-Williams/todoist-points.git ~/todoist-points
cd ~/todoist-points
cp .env.example .env && chmod 600 .env
# then edit .env: set the real TODOIST_API_TOKEN and CF_ACCESS_AUD (the
# Access app's AUD tag from the Cloudflare Zero Trust dashboard/API)
mkdir -p data               # create it yourself so it's owned by your user (uid 1000
                            # matches the container's non-root `node` user), not root
# optional: copy an existing DB into ./data/todoist-points.db (a fresh one
# self-initializes on first run)
docker compose up -d --build
```

Sanity check from the box (no host ports, no extra images — run node inside
the app container). An unauthenticated request must return **403**: the
in-app middleware rejects anything without a valid Cloudflare Access JWT, so
`403` means the app is up AND locked. A `200` here would mean the JWT
verification isn't active (check `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN`);
no response means the app isn't up.

```bash
docker compose exec todoist-points node -e "fetch('http://localhost:3000').then(r=>{console.log(r.status);process.exit(r.status===403?0:1)})"
```

## Redeploy (from main)

```bash
ssh graham@100.101.1.28
cd ~/todoist-points
git pull
docker compose up -d --build
```

The DB and `.env` live outside the image (volume + env file), so rebuilds are safe.

## How the tunnel / Access wiring works

- The `cloudflared` connector container belongs to the **km-tracker** compose
  project and joins the Docker bridge network `km-tracker_default`. This
  project's compose file joins that same (external) network, so the connector
  can reach this app at `http://todoist-points:3000` — the service name is the
  DNS alias, which is why it must not be renamed.
- The tunnel's **ingress rules live in the Cloudflare API** (the tunnel is
  remotely managed), not in any file on the box. Adding/repointing the public
  hostname `todoist-points.graham-williams.com` means: create the Cloudflare
  Access app for the hostname, append a tunnel ingress rule
  (`todoist-points.graham-williams.com` → `http://todoist-points:3000`, before
  the catch-all 404), and create a proxied CNAME to
  `<tunnel-id>.cfargotunnel.com`. See the personal-assistant CLAUDE.md
  (Cloudflare section) for token/IDs/procedure.
- **Cloudflare Access** (one-time PIN) fronts the hostname. Nothing reaches
  the app without passing Access.
- **In-app JWT verification (defense in depth):** the compose file sets
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` (from the box `.env`; it's the
  Access app's AUD tag) and `APP_HOST`. With those set, `src/middleware.ts`
  independently verifies the `Cf-Access-Jwt-Assertion` JWT on every request
  and pins the Origin/Host of mutating requests to `APP_HOST`. Requests
  without a valid Access JWT get a 403 — which is why 403 is the healthy
  sanity-check result above.

## Rules

- **Never publish host ports** (`ports:` in compose). The in-app JWT check is
  a backstop, not a reason to expose the app — a published port would still
  put it on the LAN and bypass Cloudflare Access at the edge.
- Deploy from `main` only (feature branches are for review, merged via PR).
- `.env` and `data/` never leave the box and are never committed.
