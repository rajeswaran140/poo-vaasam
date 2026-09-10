#!/usr/bin/env bash
# tamilagaval-lyria-probe.sh — does Google Lyria sing Tamil?
#
# Usage: tamilagaval-lyria-probe.sh <LYRICS_FILE> [options]
#   --style "..."   style/genre line prepended to the lyrics
#   --model ID      lyria-3.5 (default) | lyria-3-clip-preview (30s, cheaper)
#   --out DIR       output dir (default ~/reports/lyria-probe)
#   --wav           ask for WAV instead of the default MP3
#   --strip-directions  drop "(...)" arrangement notes so they are not sung
#   --dry-run       print the request and exit without spending anything
#
# Needs GEMINI_API_KEY in the environment. Cost: ~$0.08 per lyria-3.5 call.
set -uo pipefail

LYRICS_FILE=""; STYLE=""; MODEL="lyria-3.5"; OUT_DIR="$HOME/reports/lyria-probe"
WANT_WAV=0; DRY_RUN=0; STRIP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --style) STYLE="${2-}"; shift 2 ;;
    --model) MODEL="${2-}"; shift 2 ;;
    --out)   OUT_DIR="${2-}"; shift 2 ;;
    --wav)     WANT_WAV=1; shift ;;
    --strip-directions) STRIP=1; shift ;;
    --dry-run) DRY_RUN=1;  shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *)  LYRICS_FILE="$1"; shift ;;
  esac
done

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() { echo "FATAL: $*" >&2; exit 1; }

[ -n "$LYRICS_FILE" ] || die "no lyrics file given. usage: $0 <LYRICS_FILE> [--style ...]"
[ -f "$LYRICS_FILE" ] || die "lyrics file not found: $LYRICS_FILE"
command -v jq >/dev/null || die "jq is required"

# Default style stays deliberately plain: this probe tests VOCAL/LANGUAGE quality,
# so we do not want an elaborate style prompt confounding the result.
[ -n "$STYLE" ] || STYLE="A Tamil song with clear, natural female vocals at a relaxed, unhurried tempo."

# Lyria sings EVERYTHING after "Lyrics:". Lines that are purely a parenthetical
# arrangement note would be sung aloud, so optionally drop them.
SEND_FILE="$LYRICS_FILE"
if [ "$STRIP" -eq 1 ]; then
  SEND_FILE=$(mktemp); trap 'rm -f "$SEND_FILE"' EXIT
  sed -E '/^[[:space:]]*\(.*\)[[:space:]]*$/d' "$LYRICS_FILE" > "$SEND_FILE"
  DROPPED=$(( $(wc -l < "$LYRICS_FILE") - $(wc -l < "$SEND_FILE") ))
  log "stripped $DROPPED parenthetical direction line(s) so they are not sung"
fi

# Build the body with jq so Tamil UTF-8, quotes and newlines are escaped correctly.
BODY=$(jq -n --arg m "$MODEL" --arg s "$STYLE" --rawfile l "$SEND_FILE" --argjson wav "$WANT_WAV" '
  {model: $m,
   input: ($s + "\n\nLyrics:\n" + $l),
   response_format: (if $wav==1 then {type:"audio", format:"wav"} else {type:"audio"} end)}')

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$OUT_DIR/$(basename "${LYRICS_FILE%.*}")-${MODEL}-${STAMP}"
mkdir -p "$OUT_DIR"

echo "── Lyria probe ─────────────────────────────────"
echo "  model  : $MODEL"
echo "  lyrics : $LYRICS_FILE ($(wc -l < "$LYRICS_FILE") lines, $(wc -c < "$LYRICS_FILE") bytes)"
echo "  style  : $STYLE"
echo "  cost   : ~\$0.08 for lyria-3.5 (\$0.04 for the 30s clip model)"
echo "  out    : $BASE.*"
echo "────────────────────────────────────────────────"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "$BODY" | jq .
  log "dry run — nothing sent, nothing spent."
  exit 0
fi

[ -n "${GEMINI_API_KEY:-}" ] || die "GEMINI_API_KEY is not set.
  Get a key at https://aistudio.google.com/apikey then:
    export GEMINI_API_KEY='...'"

log "POST /v1beta/interactions ($MODEL) — this can take a minute or two"
HTTP=$(curl -sS -w '%{http_code}' -o "$BASE.response.json" \
  -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$BODY" 2>"$BASE.curl.err")

if [ "$HTTP" != "200" ]; then
  log "HTTP $HTTP — request failed"
  jq -r '.error.message // .' "$BASE.response.json" 2>/dev/null | head -20 || cat "$BASE.response.json" | head -20
  [ -s "$BASE.curl.err" ] && cat "$BASE.curl.err"
  die "no audio generated (full response saved at $BASE.response.json)"
fi

# Documented extraction path, with a fallback that hunts any base64 audio blob.
B64=$(jq -r '[.steps[]? | select(.type=="model_output") | .content[]? | select(.type=="audio") | .data] | first // empty' "$BASE.response.json")
if [ -z "$B64" ]; then
  log "documented path returned nothing — trying a generic scan of the response"
  B64=$(jq -r '[.. | objects | select(has("data")) | select((.type? // "")|test("audio")) | .data] | first // empty' "$BASE.response.json")
fi
[ -n "$B64" ] || { jq 'del(..|.data?)' "$BASE.response.json" | head -40; die "no audio field found — response shape saved at $BASE.response.json"; }

echo "$B64" | base64 -d > "$BASE.audio" 2>/dev/null || die "base64 decode failed"
[ -s "$BASE.audio" ] || die "decoded audio is empty"

# Sniff the real container rather than trusting the request.
MAGIC=$(head -c 4 "$BASE.audio" | xxd -p)
case "$MAGIC" in
  52494646*) EXT=wav ;;   # RIFF
  494433*|fff*|fffb*) EXT=mp3 ;;
  *) EXT=bin ;;
esac
mv "$BASE.audio" "$BASE.$EXT"

echo
echo "══ RESULT ══════════════════════════════════════"
echo "  file     : $BASE.$EXT"
echo "  size     : $(du -h "$BASE.$EXT" | cut -f1)"
if command -v ffprobe >/dev/null 2>&1; then
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$BASE.$EXT" 2>/dev/null | cut -d. -f1)
  if [ -n "$DUR" ]; then
    printf '  duration : %s (%dm%02ds)\n' "${DUR}s" $((DUR/60)) $((DUR%60))
    echo "  ── LENGTH GATE: your songs run 5-6 min ──"
    [ "$DUR" -lt 240 ] && echo "     ✗ under 4 min — confirms the ~3 min ceiling" \
                       || echo "     ✓ 4 min or over — better than documented"
  fi
else
  echo "  duration : (install ffmpeg for a duration read)"
fi
echo
echo "  ── LANGUAGE GATE: listen for these ──"
echo "     • Are the Tamil words intelligible, or approximated phonetically?"
echo "     • Is the syllable delivery unhurried, or rushed like Suno v6?"
echo "     • Compare against the published master of this same song."
echo "════════════════════════════════════════════════"
log "done."
