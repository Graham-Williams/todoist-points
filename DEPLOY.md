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

## Automated backups (off-box, issue #6)

The points ledger DB lives at `~/todoist-points/data/todoist-points.db` on the
host and is the **source of truth** for this app — spends, rewards, and
manual-review decisions exist *only* here (they are not re-derivable from
Todoist). Backups are automated by `scripts/backup.sh`, driven by a systemd
timer. The script runs on the **host** (not in the container) and mirrors
km-tracker's backup design:

- Takes a **consistent** snapshot using SQLite's online backup API via `python3`
  (stdlib only — no `sqlite3` CLI, no pip deps), safe to run while the app
  (better-sqlite3, WAL mode) is writing.
- Keeps **frequent local snapshots** in `data/backups/`, deduplicated by sha256
  (an unchanged DB doesn't create a new file), pruned to the newest
  `LOCAL_RETENTION` (default 100).
- Pushes snapshots **off-box to Google Drive** via `rclone` on a throttled
  cadence (only when the DB changed *and* at least `DRIVE_PUSH_INTERVAL_MIN`
  minutes — default 15 — since the last push), pruning the recent ring buffer on
  Drive to the newest `DRIVE_RETENTION` (default 50).
- Maintains a **`daily/` long-tail tier** on Drive: at most one snapshot per UTC
  day, retained for the newest `DAILY_RETENTION` days (default 30) — defends
  against a logical corruption that goes unnoticed for a day or two after the
  recent ring buffer has rotated out.
- Always keeps local snapshots even if the Drive push can't run. If rclone isn't
  set up yet (not installed, or the remote isn't configured), it logs a warning
  and **exits 0** — the local snapshot is already safe, so the systemd unit won't
  be marked failed on every timer tick during setup. It only exits non-zero when
  a *configured* remote actually errors.

The timer fires every 5 minutes (frequent local snapshots); the script itself
throttles the off-box push to ~15 minutes. **No secrets live in the repo** — the
rclone OAuth token is stored only in `~/.config/rclone/rclone.conf`, and
`.env.backup` is gitignored (it contains no secrets either).

> The home server already runs km-tracker's identical backup for its own DB, so
> rclone + a `gdrive` remote are likely **already configured** on the box. If so,
> skip steps 1–2 and reuse the same `gdrive` remote — just point this app at its
> own folder (`gdrive:todoist-points-backups`, auto-created on first copy).

### 1. Install rclone (skip if km-tracker already set it up)

```bash
sudo apt-get update && sudo apt-get install -y rclone
```

Or download the official release `.deb` and verify its SHA256 before installing
(see https://github.com/rclone/rclone/releases for the current version).

### 2. Configure a Google Drive remote named `gdrive` (headless; skip if it exists)

On a **headless** box rclone can't open a browser, so you authorize on a machine
that has one (Graham's Mac) and paste the token back. On the **box**:

```bash
rclone config
# n) New remote ; name> gdrive ; Storage> drive (Google Drive)
# client_id/client_secret> (blank)
# scope> 2   ← drive.file (rclone can only see/touch files it created)
# Edit advanced config> n ; Use auto config?> n   ← say No on a headless box
```

rclone prints a command to run on a machine **with a browser**. On the **Mac**
(rclone installed locally) run `rclone authorize "drive"`, consent in the
browser, copy the JSON token blob, and paste it back into the box prompt. Finish
(`Shared Drive?> n`, `y` to confirm, `q` to quit). Verify + lock down:

```bash
rclone lsd gdrive:
chmod 600 ~/.config/rclone/rclone.conf   # holds the OAuth token
```

The destination folder (`todoist-points-backups`) is auto-created on the first copy.

### 3. Configure the backup

```bash
cd ~/todoist-points
cp .env.backup.example .env.backup
# Confirm RCLONE_DEST=gdrive:todoist-points-backups (default is already this)
chmod 600 .env.backup   # the script refuses to source it if group/other-writable
```

`.env.backup` is gitignored — never commit it. (No secrets in it; the OAuth
token lives in rclone's config.)

### 4. Install the systemd units

```bash
sudo cp deploy/todoist-points-backup.service deploy/todoist-points-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now todoist-points-backup.timer
```

The units assume the repo at `/home/graham/todoist-points` and run as user
`graham`. (Edit `DB_PATH` etc. in `.env.backup` if your paths differ.)

### 5. Verify

```bash
systemctl list-timers | grep todoist-points-backup   # scheduled?
sudo systemctl start todoist-points-backup.service    # run once now
journalctl -u todoist-points-backup.service --no-pager -n 50
ls -1 data/backups/                                    # a local snapshot appears
rclone lsf gdrive:todoist-points-backups               # and shows up on Drive
```

To **restore**: stop the app (`docker compose down`), copy a snapshot back over
`data/todoist-points.db` (it's a plain SQLite file — delete any stale
`todoist-points.db-wal` / `-shm` alongside it first), then `docker compose up -d`.

### Manual one-off backup (without the timer)

```bash
sqlite3 ~/todoist-points/data/todoist-points.db ".backup ~/todoist-points/data/todoist-points.$(date +%F).db"
```

## Rules

- **Never publish host ports** (`ports:` in compose). The in-app JWT check is
  a backstop, not a reason to expose the app — a published port would still
  put it on the LAN and bypass Cloudflare Access at the edge.
- Deploy from `main` only (feature branches are for review, merged via PR).
- `.env` and `data/` never leave the box and are never committed.
