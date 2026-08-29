#!/usr/bin/env bash
#
# Install/refresh the per-video Tamilagaval systemd oneshot timers on a
# fresh dev box. Idempotent — running twice does nothing harmful.
#
# Precondition: /home/devuser/bin/tamilagaval-video-post-premiere-audit.sh
# and /home/devuser/bin/tamilagaval-post-pinned-comment.sh must exist and be
# executable. Both are shipped in-repo at scripts/ — see deploy/README.md
# for the bootstrap sequence.
#
# All units run as devuser (the executing user by convention). Timers use
# absolute UTC OnCalendar timestamps + Persistent=false, so if the box was
# down at fire time the timer does not re-fire on next boot; that's the
# right semantics for per-video one-shots that reference specific
# release-day timing.
#
# Requires sudo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${SCRIPT_DIR}/systemd"
SYSTEMD_DIR=/etc/systemd/system

if [ ! -d "${UNIT_DIR}" ]; then
  echo "no ${UNIT_DIR} — run from a fresh checkout of poo-vaasam" >&2
  exit 1
fi

echo "==> installing units from ${UNIT_DIR} → ${SYSTEMD_DIR}"
count=0
for f in "${UNIT_DIR}"/tamilagaval-*.{service,timer}; do
  [ -f "$f" ] || continue
  sudo install -m 0644 -o root -g root "$f" "${SYSTEMD_DIR}/$(basename "$f")"
  count=$((count + 1))
done
echo "  installed ${count} unit files"

echo "==> systemctl daemon-reload"
sudo systemctl daemon-reload

echo "==> enable --now every tamilagaval-*.timer"
for t in "${UNIT_DIR}"/tamilagaval-*.timer; do
  [ -f "$t" ] || continue
  name=$(basename "$t")
  sudo systemctl enable --now "$name" 2>&1 | sed 's/^/  /'
done

echo "==> current tamilagaval timer schedule"
systemctl list-timers 'tamilagaval-*' --all --no-pager | head -20

echo "==> done. Confirm with: systemctl status <unit>"
