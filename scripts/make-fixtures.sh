#!/usr/bin/env bash
#
# Generating the calibration corpus — audio whose correct measurement is known
# BEFORE anything measures it.
#
# WHY. The suite has ~4,000 tests and they agree with each other. Three times in
# one week they agreed while being wrong about the world: the ebur128 parser
# matched nothing on real output, the fade verdict over-warned on every song
# that ends with a fade, and the LRA blocker rejected half of a song that had
# already shipped. Every one of those was caught by real audio, never by a test.
#
# A fixture whose expected value is *derived from the standard* breaks that
# circle: when the chain and the arithmetic disagree, one of them is wrong and
# neither can hide behind the other.
#
# ⚠️ TWO GENERATOR TRAPS, both found by measuring rather than reasoning:
#
#   1. lavfi `sine` HAS NO AMPLITUDE OPTION and does not emit full scale — it
#      peaks at 4095/32768 = -18.06 dBFS. `sine=...,volume=-20dB` therefore
#      yields -38.06, not -20. The mono/stereo relationship still looks right,
#      so the error is invisible unless the absolute value is checked — and the
#      absolute value is the entire point of a gain-path anchor. Use `aevalsrc`,
#      which states its amplitude in the expression.
#
#   2. A -26 dB quiet section does NOT produce a wide LRA. LRA gates relatively
#      at -20 LU below the ungated mean, so anything that far down is discarded
#      before the percentiles are taken: measured LRA 6.3 LU, not ~26. Every
#      step has to sit INSIDE the gate. The 0/-6/-12/-18 ladder below measures
#      18.0 LU.
#
# Regenerating is safe and deterministic — `aevalsrc` is closed-form and
# `anoisesrc` is seeded — so the .wav files are NOT committed. Only the measured
# numbers are, in test/fixtures/audio/golden.json.
#
# Usage:  bash scripts/make-fixtures.sh [outdir]
set -euo pipefail

OUT="${1:-test/fixtures/audio}"
mkdir -p "$OUT"

FF="${FFMPEG_PATH:-ffmpeg} -hide_banner -nostdin -loglevel error"
E48="-c:a pcm_s24le -ar 48000 -y"

# 1. GAIN-PATH ANCHOR. Stereo 1 kHz sine, peak exactly -20 dBFS.
#
#    K-weighting at 1 kHz is +0.6977 dB and BS.1770's offset is -0.691 dB, so
#    they cancel to within 0.007 dB. What is left is the channel summation:
#    two identical channels sum to 2x the single-channel mean square, i.e.
#    +3.01 dB. A STEREO 1 kHz sine therefore reads an integrated loudness equal
#    to its peak dBFS. That makes the expected value a consequence of the
#    standard rather than a constant somebody once observed.
#
#      derived: I = -19.99 LUFS, true peak = -20.00 dBFS
$FF -f lavfi -i "aevalsrc=exprs=0.1*sin(2*PI*1000*t)|0.1*sin(2*PI*1000*t):s=48000:d=30" \
    $E48 "$OUT/tone_1k_stereo_minus20.wav"

# 2. THE SAME TONE IN MONO — the control that proves #1 measures summation and
#    not something else. One channel is half the power of two, so it must read
#    exactly 3.01 dB lower off an identical peak.
#
#      derived: I = -23.00 LUFS, true peak = -20.00 dBFS
$FF -f lavfi -i "aevalsrc=exprs=0.1*sin(2*PI*1000*t):s=48000:d=30" \
    $E48 "$OUT/tone_1k_mono_minus20.wav"

# 3. MUST TAKE THE LINEAR PATH. Quiet, low crest factor, mild 0/-3/-6 steps.
#    A linear gain to -14 lands the peak at -1.35 dBTP, under the ceiling, so
#    loudnorm has no reason to compress.
#
#    ⚠️ NOT a flat file. See the LRA=0.00 trap in loudness-measure.ts — a
#    perfectly flat source can NEVER take the linear path, because ffmpeg reads
#    measured_LRA=0.00 as "not supplied". A flat fixture asserting `linear`
#    would fail forever for a reason unrelated to the chain.
$FF -f lavfi -i "anoisesrc=color=pink:duration=60:sample_rate=48000:amplitude=0.1:seed=20260806" \
    -af "volume='if(lt(t,20),1, if(lt(t,40),0.708,0.501))':eval=frame,pan=stereo|c0=c0|c1=c0" \
    $E48 "$OUT/pink_gentle_linear.wav"

# 4. MUST BE FORCED INTO DYNAMIC. Four-step ladder, every step inside the
#    relative gate, high crest factor. Linear gain to -14 would put the peak at
#    -0.20 dBTP, above the -1 ceiling, so ffmpeg falls back and COMPRESSES.
#
#    This is the fixture that exercises take-screen's `forces-dynamic` rule end
#    to end. Until it existed the rule was only ever checked against a
#    hand-written LRA number, never against ffmpeg actually refusing.
$FF -f lavfi -i "anoisesrc=color=pink:duration=80:sample_rate=48000:amplitude=0.4:seed=20260806" \
    -af "volume='if(lt(t,20),1, if(lt(t,40),0.501, if(lt(t,60),0.251,0.126)))':eval=frame,pan=stereo|c0=c0|c1=c0" \
    $E48 "$OUT/pink_ladder_forces_dynamic.wav"

# 5. INTERSAMPLE-PEAK TRAP. A tone at exactly fs/4 with a 45 degrees phase
#    offset lands every sample on +/-0.7071 x A while the reconstructed waveform
#    peaks at A — a derivable +3.01 dB gap between sample peak and true peak.
#
#    ⚠️ A high-frequency sine is NOT a trap. 19 kHz at 44.1 kHz was the obvious
#    choice and it is useless: a sine's true peak IS its amplitude, so sample
#    peak and true peak agree to 0.02 dB. The overshoot needs the samples to
#    straddle the crest, which is what the phase offset arranges.
#
#      derived: sample peak = -3.01 dBFS, true peak = 0.00 dBFS
${FFMPEG_PATH:-ffmpeg} -hide_banner -nostdin -loglevel error \
    -f lavfi -i "aevalsrc=exprs=sin(2*PI*11025*t+PI/4)|sin(2*PI*11025*t+PI/4):s=44100:d=10" \
    -c:a pcm_s24le -ar 44100 -y "$OUT/isp_trap_fs4.wav"

echo "Wrote 5 fixtures to $OUT"
echo "Verify with: npx tsx scripts/verify-fixtures.ts $OUT"
