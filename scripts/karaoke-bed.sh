#!/usr/bin/env bash
#
# karaoke-bed — make a karaoke bed from a finished master, on this box.
#
#   scripts/karaoke-bed.sh path/to/master.wav
#   scripts/karaoke-bed.sh --s3 audio/mastering/<key>.wav
#   scripts/karaoke-bed.sh master.wav --out /tmp/bed.wav
#
# WHY THIS EXISTS. The Mastering Studio can MASTER a karaoke bed (peak mode,
# `pipelineFor` returns two stages for one) but it cannot MAKE one — the bed is
# expected to arrive already vocal-free. So every paid order needed the
# separation done by hand, outside the tool.
#
# AND IT USES THE BETTER METHOD. Measured 2026-09-19: Suno's exported stems,
# summed, cancel against their own source by only 5.7 dB — they are resynthesised
# approximations, not extractions. `htdemucs` on the master cancels by 33.6 dB.
# A separated bed is the record with the voice removed; a stem-summed bed is
# eleven re-generated parts that merely resemble it.
#
# WHAT IT DOES NOT DO. It does not master. Hand the bed it writes to
# /admin/mastering and choose the "Karaoke bed" target — loudnorm goes Dynamic on
# a bed at every target tried, so peak-only is the only mode that preserves it.
#
# ⚠️ SHARED HOST. This box also runs crowvault.ca, ai-dev-ide and goform.ca, and
# the root volume has been sitting at ~97% full. Separation writes two full-length
# WAVs, so this refuses to start rather than fill the disk out from under another
# product. It installs nothing: ~/venv-demucs already carries torch + demucs.
set -euo pipefail

VENV="${DEMUCS_VENV:-$HOME/venv-demucs}"
MODEL="${DEMUCS_MODEL:-htdemucs}"
# Separation writes two full-length stems, plus the null-test renders. Eight times
# the input is measured headroom, not a guess: two stems + two test mixes + slack.
SPACE_FACTOR="${KARAOKE_BED_SPACE_FACTOR:-8}"
MIN_FREE_MB="${KARAOKE_BED_MIN_FREE_MB:-700}"
# A true decomposition reconstructs its source. Below this the separation is
# resynthesis and the bed is not the record with the voice removed.
MIN_NULL_DB=25

die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

usage() {
  sed -n '3,12p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

IN=""; S3KEY=""; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --s3) S3KEY="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) IN="$1"; shift ;;
  esac
done

command -v ffmpeg >/dev/null || die "ffmpeg is not on PATH"
[ -x "$VENV/bin/demucs" ] || die "no demucs at $VENV/bin/demucs — set DEMUCS_VENV"

WORK="$(mktemp -d -t karaoke-bed-XXXXXX)"
# Always clean up: the stems are the bulk of the disk cost and leaving them on a
# volume this full is how the next product on this box falls over.
trap 'rm -rf "$WORK"' EXIT INT TERM

if [ -n "$S3KEY" ]; then
  [ -z "$IN" ] || die "pass a file OR --s3, not both"
  IN="$WORK/$(basename "$S3KEY")"
  say "→ fetching s3://tamil-web-media/$S3KEY"
  aws s3 cp "s3://tamil-web-media/$S3KEY" "$IN" --only-show-errors \
    || die "could not fetch that key"
fi

[ -n "$IN" ] || usage 1
[ -f "$IN" ] || die "no such file: $IN"

IN_MB=$(( $(stat -c %s "$IN") / 1024 / 1024 ))
[ "$IN_MB" -gt 0 ] || die "$IN is empty"
NEED_MB=$(( IN_MB * SPACE_FACTOR ))
[ "$NEED_MB" -lt "$MIN_FREE_MB" ] && NEED_MB="$MIN_FREE_MB"
FREE_MB=$(df -Pm "$WORK" | awk 'NR==2 {print $4}')

say ""
say "input      $IN  (${IN_MB} MB)"
say "model      $MODEL  ($(nproc) cores — a 6-minute song takes a while on CPU)"
say "disk       ${FREE_MB} MB free, needs ~${NEED_MB} MB"

if [ "$FREE_MB" -lt "$NEED_MB" ]; then
  df -h "$WORK" >&2
  die "not enough free space. This box is shared — freeing someone else's files
  is not this script's call. Clear space deliberately, then re-run."
fi

BASE="$(basename "${IN%.*}")"
[ -n "$OUT" ] || OUT="$(dirname "$IN")/${BASE}-bed.wav"
[ -e "$OUT" ] && die "$OUT already exists — move it or pass --out"

# ── separate ────────────────────────────────────────────────────────────────
# --two-stems writes vocals.wav and no_vocals.wav directly. Four stems would
# need summing, which is one more place to get a sign or a gain wrong, and it
# doubles the disk for no gain: the bed IS no_vocals.
say ""
say "→ separating (vocals / no_vocals)…"
# NNPACK is unavailable on this CPU and demucs says so once per block — dozens of
# identical warnings that bury the progress bar and would bury a real error.
"$VENV/bin/demucs" --two-stems=vocals -n "$MODEL" --float32 \
  -o "$WORK/sep" "$IN" 2>&1 | grep -v NNPACK | sed 's/^/   /'

BED="$WORK/sep/$MODEL/$BASE/no_vocals.wav"
VOX="$WORK/sep/$MODEL/$BASE/vocals.wav"
[ -f "$BED" ] || die "demucs produced no no_vocals.wav (looked in $WORK/sep/$MODEL/$BASE)"

# ── verify ──────────────────────────────────────────────────────────────────
# A null test, and a CONTROL for the null test.
#
# ⚠️ THE SIGN. ffmpeg's `amix` IGNORES the sign of a weight — `amix=weights=1 -1`
# ADDS, it does not subtract. A null built that way reads about -8 dB and looks
# like a failure when nothing is wrong. Inversion has to be done in `pan`.
# Learned the hard way, twice; see the mastering docs.
# ⚠️ volumedetect lives INSIDE the complex graph. Passing it via -af alongside a
# -filter_complex is rejected ("not a simple filter"), and under `set -e` that
# reads as the script dying at the verification step for no stated reason.
null_db() {  # null_db <a> <b>  → mean dB of (a − b)
  ffmpeg -hide_banner -nostats -i "$1" -i "$2" -filter_complex \
    "[1:a]pan=stereo|c0=-1*c0|c1=-1*c1[inv];[0:a][inv]amix=inputs=2:duration=shortest:normalize=0,volumedetect[m]" \
    -map "[m]" -f null - 2>&1 | awk -F': ' '/mean_volume/ {print $2}' | tail -1
}

say ""
say "→ checking the separation actually decomposes the master…"
# The control proves the rig, not the separation: a file against itself must
# vanish. If this is not deeply negative, the measurement is wrong and the
# number below means nothing.
CONTROL=$(null_db "$IN" "$IN")

# vocals + no_vocals should rebuild the master.
ffmpeg -hide_banner -nostats -i "$VOX" -i "$BED" -filter_complex \
  "[0:a][1:a]amix=inputs=2:duration=shortest:normalize=0[m]" -map "[m]" \
  -c:a pcm_f32le "$WORK/rebuilt.wav" -y 2>/dev/null
REBUILT=$(null_db "$IN" "$WORK/rebuilt.wav")

say "   self-null control   ${CONTROL:-?}   (a file against itself — must be far below 0)"
say "   vocals + bed        ${REBUILT:-?}   (against the master)"

NULL_NUM=$(printf '%s' "${REBUILT:-0}" | tr -dc '0-9.-' | cut -d. -f1)
NULL_NUM=${NULL_NUM:-0}
if [ "${NULL_NUM#-}" = "$NULL_NUM" ] || [ "${NULL_NUM#-}" -lt "$MIN_NULL_DB" ]; then
  say ""
  say "⚠️  The two stems do NOT rebuild the master (want ${MIN_NULL_DB} dB or better)."
  say "    The bed was still written, but treat it as suspect: a shallow null is"
  say "    the signature of resynthesis rather than extraction, which is exactly"
  say "    what makes Suno's own stems the worse route."
fi

# ── loudness of the bed, so the Studio's target is an informed choice ───────
say ""
say "→ measuring the bed…"
# Four leading spaces, not two: ebur128's summary indents the values under their
# headings, so an anchored two-space pattern silently matched only "Peak:".
ffmpeg -hide_banner -nostats -i "$BED" -af ebur128=peak=true -f null - 2>&1 \
  | awk '/^ +(I|LRA|Peak): / {gsub(/^ +/, "   "); print}'

mv "$BED" "$OUT"
say ""
say "✓ bed written"
say "   $OUT"
say ""
say "Next: /admin/mastering → upload this → target \"Karaoke bed\"."
say "Do NOT pick -14 or -16: loudnorm goes Dynamic on a bed at every target"
say "tried, and peak-only is the mode that keeps it intact."
