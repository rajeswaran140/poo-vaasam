# deploy/

DR + fresh-server bootstrap for Tamilagaval. Two things live here:

## `systemd/` — per-video oneshot timers

Post-premiere audits and pinned-comment automation for the @Tamilagaval
YouTube channel. Each release gets a `tamilagaval-<slug>-audit.{service,timer}`
pair (fires 72 h after premiere) and optionally a `tamilagaval-<slug>-pinned.*`
pair (fires ~6 min after premiere, posts a comment from `/home/devuser/pinned-comments/<VIDEO_ID>.txt`).

Install on a fresh box:

```bash
# 1. Prereqs (both scripts live in scripts/ and get symlinked into ~/bin)
sudo ln -sf $(pwd)/scripts/tamilagaval-video-post-premiere-audit.sh \
  /home/devuser/bin/tamilagaval-video-post-premiere-audit.sh
sudo ln -sf $(pwd)/scripts/tamilagaval-post-pinned-comment.sh \
  /home/devuser/bin/tamilagaval-post-pinned-comment.sh
mkdir -p /home/devuser/reports /home/devuser/pinned-comments

# 2. Install + enable every unit
./deploy/install-systemd.sh
```

Adding a new video's timer pair: copy an existing `.service`/`.timer`, swap
the slug + VIDEO_ID + OnCalendar, `daemon-reload`, `enable --now` — or just
`install-systemd.sh` again.

## `backup-ssm.sh` — encrypted SSM secret export

Dumps every SSM SecureString under the two Tamilagaval-relevant prefixes
(`/amplify/d3rkmepk4popv0/master/*` and `/tamilagaval/*`) to a single
AES-256-CBC encrypted file. Losing SSM without a copy costs weeks of pain
(Anthropic re-issue, YouTube OAuth re-consent flow, VAPID regeneration, …).

```bash
# 1. Set a strong passphrase in your private profile (NOT committed)
echo 'export SSM_BACKUP_PASSPHRASE="…"' >> ~/.config/private.env
source ~/.config/private.env

# 2. Run — writes to /home/devuser/backups/ssm/ssm-backup-<ts>.json.enc
./deploy/backup-ssm.sh

# 3. Mirror off-box (choose one)
aws s3 cp /home/devuser/backups/ssm/ssm-backup-*.json.enc s3://my-offsite-bucket/
rclone copy /home/devuser/backups/ssm/ backblaze:tamilagaval-dr/ssm/
```

Recommended cadence: **weekly** cron (secrets rotate; a stale backup is a
false-safety signal). Include the run in a periodic reminder script.

Restore procedure lives in the script's header comment.

## `../.env.template`

Inventory of every Amplify env var + SSM secret Tamilagaval reads at
runtime. Not consumed by the app — it exists so a `git clone` + reading
this file is enough to rebuild the runtime settings on a fresh Amplify
project. Update it every time a new env-driven setting is added to the code.
