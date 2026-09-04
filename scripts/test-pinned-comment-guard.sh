#!/usr/bin/env bash
# Unit tests for the premiere-state guard in tamilagaval-post-pinned-comment.sh.
#
# Why this exists: twice (HOZ3FGrI2xk 2026-08-28, Vu1pcY7cp8M 2026-08-31) the
# pinned comment was posted manually BEFORE the premiere started, which made the
# scheduled systemd run abort on the idempotency guard. The automation has never
# actually posted a comment. `premiere_has_started` is the fix; these tests pin
# down its boundaries — especially the one that matters:
#   the timer fires ~6 min after premiere START, while the premiere is still LIVE.
#   Guarding on liveBroadcastContent=="none" would break the real use case.
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/tamilagaval-post-pinned-comment.sh"

TAMILAGAVAL_LIB_ONLY=1 . "$SCRIPT" || { echo "FATAL: cannot source $SCRIPT as a library"; exit 1; }
if ! declare -F premiere_has_started >/dev/null; then
  echo "FATAL: premiere_has_started() not defined by $SCRIPT"; exit 1
fi

PASS=0; FAIL=0
check() { # check <desc> <expected 0|1> <lsd-json>
  local desc="$1" want="$2" lsd="$3" got
  premiere_has_started "$lsd" && got=0 || got=1
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); printf 'ok   %s\n' "$desc"
  else FAIL=$((FAIL+1)); printf 'FAIL %s (want %s, got %s)\n' "$desc" "$want" "$got"; fi
}

# --- the bug we are fixing -------------------------------------------------
check "upcoming premiere (scheduled, never started) is REFUSED" 1 \
  '{"scheduledStartTime":"2026-09-02T12:15:00Z","activeLiveChatId":"Cg0KC1Z1MXBjWTdjcDhN"}'

# --- the case that must keep working --------------------------------------
# Real Vu1p values: timer fired 12:21:10, actualEndTime was 12:22:54 => LIVE.
check "premiere in progress (started, not ended) is ALLOWED" 0 \
  '{"scheduledStartTime":"2026-09-02T12:15:00Z","actualStartTime":"2026-09-02T12:15:05Z"}'

check "premiere finished is ALLOWED" 0 \
  '{"scheduledStartTime":"2026-09-02T12:15:00Z","actualStartTime":"2026-09-02T12:15:05Z","actualEndTime":"2026-09-02T12:22:54Z"}'

# --- ordinary uploads are not premieres at all -----------------------------
check "plain upload (no liveStreamingDetails) is ALLOWED" 0 'ABSENT'
check "plain upload (empty object) is ALLOWED"            0 '{}'
check "plain upload (null) is ALLOWED"                    0 'null'

# --- malformed input must fail closed, never open --------------------------
check "empty string fails closed (REFUSED)"   1 ''
check "garbage fails closed (REFUSED)"        1 'not-json'

echo "---"; echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
