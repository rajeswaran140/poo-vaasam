#!/usr/bin/env bash
#
# Reproduce the Phase 1A Matchering feasibility spike.
#
# Requires:
#   - python3-venv installed
#   - ffmpeg installed (for LUFS measurement)
#   - AWS creds with s3:GetObject on tamil-web-media/audio/mastering/*
#
# Runs the spike end-to-end: creates a venv, installs matchering==2.0.6 pinned,
# downloads 3 TamilAgaval WAV pairs from the mastering workspace, runs matchering
# against each pair, measures wall time / peak memory / LUFS accuracy.
#
# Full findings: see the admin doc "music-lab-reference-mastering-spike-report".

set -uo pipefail
export ZSH_VERSION=""

cd "$(dirname "$0")"

echo "=== 1. venv + matchering install (Python 3.12; upstream cert 3.8-3.10) ==="
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet matchering==2.0.6

echo "=== 2. download 3 test pairs from the mastering workspace ==="
mkdir -p wavs
declare -A PAIRS=(
  ["1_target"]="1787709165737_fb3a8c83_-_Music-1_1.wav"
  ["1_reference"]="1787709165737_fb3a8c83_-_Music-1_1-master-14LUFS.wav"
  ["2_target"]="1787707239736_af8ac41d_-_Fm-55_4_Remastered.wav"
  ["2_reference"]="1787707239736_af8ac41d_-_Fm-55_4_Remastered-master-14LUFS.wav"
  ["3_target"]="1787256955130_3e6c7e79_-Ver-1_1_Master_-14_LUFS.wav"
  ["3_reference"]="1787256955130_3e6c7e79_-Ver-1_1_Master_-14_LUFS-master-14LUFS.wav"
)
for k in "${!PAIRS[@]}"; do
  aws --region us-east-1 s3 cp "s3://tamil-web-media/audio/mastering/${PAIRS[$k]}" "wavs/$k.wav" --quiet
done

echo "=== 3. run matchering with /usr/bin/time on each pair ==="
for tag in 1 2 3; do
  echo "--- test $tag ---"
  /usr/bin/time -v python -c "
import matchering as mg, time
mg.log(lambda *a: None)
t0 = time.time()
mg.process(target='wavs/${tag}_target.wav', reference='wavs/${tag}_reference.wav',
           results=[mg.pcm24('wavs/${tag}_matched.wav')])
print(f'ELAPSED_SEC={time.time()-t0:.2f}')
" 2>&1 | grep -E 'ELAPSED_SEC|Maximum resident|Elapsed \(wall'
done

echo "=== 4. LUFS accuracy — did matched output match the reference? ==="
for tag in 1 2 3; do
  for label in reference matched; do
    LINE=$(ffmpeg -nostats -hide_banner -i "wavs/${tag}_${label}.wav" -af ebur128=peak=true -f null - 2>&1 | grep -A5 'Integrated loudness:' | head -6)
    I=$(echo "$LINE" | grep -oP 'I:\s+\K-?[0-9.]+' | tail -1)
    LRA=$(echo "$LINE" | grep -oP 'LRA:\s+\K-?[0-9.]+' | head -1)
    printf "  test %s %-9s  I=%7s LUFS   LRA=%s LU\n" "$tag" "$label" "${I:-?}" "${LRA:-?}"
  done
done

echo "=== 5. cleanup ==="
echo "To free ~1 GB: rm -rf wavs/ .venv/"
