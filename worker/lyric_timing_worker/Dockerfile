# AWS Lambda container image for tamilagaval-lyric-timing.
#
# The same sensor as scripts/lib/asr_words.py (demucs vocal split, then
# faster-whisper word timings), packaged so it runs in AWS instead of the dev
# box. It measures; it decides nothing about captions (see
# src/lib/local-asr-clock.ts and src/lib/caption-alignment.ts).
#
# Built by CodeBuild (buildspec.yml), not locally: the image is 3-4 GB and the
# shared dev box has too little disk.

FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Bake both models into the image so a run never downloads anything (Lambda's
# filesystem is read-only outside /tmp, and a download per cold start would
# cost minutes).
ENV TORCH_HOME=/opt/models/torch \
    WHISPER_DIR=/opt/models/whisper \
    WHISPER_MODEL=small \
    HF_HUB_DISABLE_TELEMETRY=1
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')" \
 && python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8', download_root=os.environ['WHISPER_DIR'])" \
 && chmod -R a+rX /opt/models

# Offline from here on: the models are already on disk.
ENV HF_HUB_OFFLINE=1

COPY handler.py ${LAMBDA_TASK_ROOT}/
CMD ["handler.lambda_handler"]
