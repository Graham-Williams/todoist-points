# DEPLOY.md — self-hosting runbook

Production runs in Docker on the home server, alongside km-tracker, and is
reachable **only** through the existing Cloudflare Tunnel at
**https://todoist-points.graham-williams.com**.

**Sign-in — app-level shared password (the active model).** The app gates
itself in `src/middleware.ts`: set **`APP_PASSWORD`** (shared secret) +
**`SESSION_SECRET`** (cookie-signing key) and every request without a valid
signed session cookie is redirected to `/login`. One password → a ~30-day
session, so re-auth is rare. This **replaces** the Cloudflare-Access emailed-PIN
login. The legacy CF-Access JWT check is still in the code (env-gated on
`CF_ACCESS_AUD`/`CF_ACCESS_TEAM_DOMAIN`) but is **skipped whenever
`APP_PASSWORD` is set**, so the two never fight. With `APP_PASSWORD` empty the
gate is OFF and the app behaves as before (e.g. while still fronted by CF
Access). See the "Cutover" section below.

## Box layout

- Server: Ubuntu home server, reached via Tailscale SSH: `ssh graham@100.101.1.28`
- App dir: `~/todoist-points` (a clone of this repo)
- Data: `~/todoist-points/data/todoist-points.db` (SQLite, bind-mounted into the container at `/data`)
- Secrets: `~/todoist-points/.env` (gitignored, `chmod 600`). Holds:
  - `TODOIST_API_TOKEN` — Todoist API token.
  - `APP_PASSWORD` — shared sign-in password (set = gate ON).
  - `SESSION_SECRET` — random key that signs the session cookie
    (`openssl rand -hex 32`).
  - `CF_ACCESS_AUD` — *legacy*, the Cloudflare Access app's Audience (AUD) tag;
    only needed while still fronted by CF Access. Leave empty after cutover.

## First deploy

```bash
ssh graham@100.101.1.28
git clone https://github.com/Graham-Williams/todoist-points.git ~/todoist-points
cd ~/todoist-points
cp .env.example .env && chmod 600 .env
# then edit .env: set TODOIST_API_TOKEN, and for the password gate set
# APP_PASSWORD + SESSION_SECRET (openssl rand -hex 32). CF_ACCESS_AUD is only
# needed if you're still fronting with Cloudflare Access.
mkdir -p data               # create it yourself so it's owned by your user (uid 1000
                            # matches the container's non-root `node` user), not root
# optional: copy an existing DB into ./data/todoist-points.db (a fresh one
# self-initializes on first run)
docker compose up -d --build
```

Sanity check from the box (no host ports, no extra images — run node inside
the app container). Hit the dedicated **`/api/health`** endpoint, which is
exempt from the auth gate and returns **200** when the app is up:

```bash
docker compose exec todoist-points node -e "fetch('http://localhost:3000/api/health').then(r=>{console.log(r.status);process.exit(r.status===200?0:1)})"
```

To confirm the **gate is actually locked**, hit `/` (a page) — with the
password gate on it should **307-redirect to `/login`**; with the legacy CF
gate on it returns **403**:

```bash
docker compose exec todoist-points node -e "fetch('http://localhost:3000/',{redirect:'manual'}).then(r=>console.log(r.status))"
# 307 (password gate on) or 403 (CF gate on) = locked. 200 = OPEN, misconfigured.
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
- **App-level password gate (active):** `src/middleware.ts` + `src/lib/auth.ts`.
  When `APP_PASSWORD` is set, unauthenticated requests are redirected to
  `/login`; a correct password sets a `SESSION_SECRET`-signed, HttpOnly/Secure/
  SameSite=Lax cookie (~30-day). Failed logins are rate-limited (10/15 min per
  client IP). The `APP_HOST` Origin/Host CSRF pin still runs first for every
  mutating request (incl. the login POST).
- **Legacy Cloudflare Access (one-time PIN) + in-app JWT verification:** kept in
  code but **skipped when `APP_PASSWORD` is set**. While configured (CF gate on,
  password gate off) the compose file's `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`
  make `src/middleware.ts` verify the `Cf-Access-Jwt-Assertion` JWT on every
  request; requests without a valid JWT get 403.

## Cutover: Cloudflare Access → app password

1. On the box, edit `~/todoist-points/.env`: set `APP_PASSWORD=<shared secret>`
   and `SESSION_SECRET=$(openssl rand -hex 32)`; clear/remove `CF_ACCESS_AUD`.
2. `docker compose up -d --build` and confirm the health + locked checks above
   (`/api/health` → 200; `/` → 307 to `/login`).
3. Browse to `https://todoist-points.graham-williams.com`, sign in once, verify
   the session sticks.
4. Remove the Cloudflare **Access application** for the hostname (so visitors no
   longer get the one-time-PIN prompt). Leave the tunnel ingress + DNS as-is.

To roll back: clear `APP_PASSWORD`, restore `CF_ACCESS_AUD`, re-create the
Access app, redeploy.

**Revoking sessions / rotating the password.** Session cookies are signed with
`SESSION_SECRET` and are valid for ~30 days independent of `APP_PASSWORD`.
Changing `APP_PASSWORD` alone does NOT log out existing sessions. To force
everyone to re-authenticate (e.g. the password leaked, or someone should lose
access), **rotate `SESSION_SECRET`** (`openssl rand -hex 32`) and redeploy —
that invalidates every outstanding cookie immediately.

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

The service unit ships with `<user>` placeholders. **Before installing**, edit
`deploy/todoist-points-backup.service` and replace `<user>`: set `User=` to the
box's login user and `ExecStart=` to that user's absolute path to
`scripts/backup.sh` (i.e. `/home/<login-user>/todoist-points/scripts/backup.sh`).
Then:

```bash
sudo cp deploy/todoist-points-backup.service deploy/todoist-points-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now todoist-points-backup.timer
```

The units assume the repo at `/home/<user>/todoist-points` and run as user
`<user>`. (Edit `DB_PATH` etc. in `.env.backup` if your paths differ.)

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
