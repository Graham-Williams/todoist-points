# DEPLOY.md — self-hosting runbook

Production runs in Docker on the home server, alongside km-tracker, and is
reachable **only** through the existing Cloudflare Tunnel at
**https://todoist-points.graham-williams.com**, gated by Cloudflare Access
(one-time PIN). The app itself has no auth — Access is the only lock on the door.

## Box layout

- Server: Ubuntu home server, reached via Tailscale SSH: `ssh graham@100.101.1.28`
- App dir: `~/todoist-points` (a clone of this repo)
- Data: `~/todoist-points/data/todoist-points.db` (SQLite, bind-mounted into the container at `/data`)
- Secrets: `~/todoist-points/.env` (gitignored; holds `TODOIST_API_TOKEN`)

## First deploy

```bash
ssh graham@100.101.1.28
git clone https://github.com/Graham-Williams/todoist-points.git ~/todoist-points
cd ~/todoist-points
cp .env.example .env        # then edit: set the real TODOIST_API_TOKEN
mkdir -p data               # create it yourself so it's owned by your user (uid 1000
                            # matches the container's non-root `node` user), not root
# optional: copy an existing DB into ./data/todoist-points.db (a fresh one
# self-initializes on first run)
docker compose up -d --build
```

Sanity check from the box (no host ports, so curl via the shared network):

```bash
docker run --rm --network km-tracker_default curlimages/curl -s http://todoist-points:3000/ | head
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

## Rules

- **Never publish host ports** (`ports:` in compose). The app has no auth;
  a published port would expose it on the LAN and bypass Cloudflare Access.
- Deploy from `main` only (feature branches are for review, merged via PR).
- `.env` and `data/` never leave the box and are never committed.
