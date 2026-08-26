"""
tamilagaval-matchering-worker — AWS Lambda handler.

Event shape (from tamilagaval-master-worker's Node handler):
    {
        "jobId": "<uuid>",
        "sourceKey": "audio/mastering/<file>.wav",
        "referenceKey": "audio/references/<id>.wav",
        "outputKey":    "audio/mastering/<file>-matched.wav",
    }

Flow:
    1. Validate all three keys against approved prefixes (defense-in-depth;
       the calling route already validates, but this Lambda is Event-invoked
       and a bad payload would otherwise reach matchering).
    2. Patch MASTERJOB item with matchingStage=downloading.
    3. Download source + reference from S3 to /tmp.
    4. Patch matchingStage=matching.
    5. Run matchering.process at 48 kHz internal sample rate (verified in
       the Phase 1A spike; keeps parity with the existing TamilAgaval
       pipeline instead of downsampling to 44.1 kHz).
    6. Patch matchingStage=uploading.
    7. Upload matched WAV to S3 at outputKey.
    8. Patch matchingStage=completed with matchingStats.
    9. On any error: patch matchingStage=failed with error.code + message.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from dataclasses import dataclass, asdict
from typing import Any

import boto3
import matchering as mg
import soundfile as sf


REGION = os.environ.get("AWS_REGION", "ca-central-1")
TAKES_BUCKET = os.environ.get("TAKES_BUCKET")
TAKES_BUCKET_REGION = os.environ.get("TAKES_BUCKET_REGION", REGION)
TABLE = os.environ.get("DYNAMODB_TABLE_NAME", "TamilWebContent")

# The two S3 prefixes this worker is allowed to touch. Mirrors
# src/lib/mastering-storage.ts::MASTERING_PREFIX. Any key outside these is
# refused BEFORE any S3 or matchering call — see validate_keys().
MASTERING_PREFIX = "audio/mastering/"
REFERENCES_PREFIX = "audio/references/"

# Boto3 clients — created at module load so warm invocations skip the setup.
s3 = boto3.client("s3", region_name=TAKES_BUCKET_REGION)
ddb = boto3.client("dynamodb", region_name=REGION)


def log(level: str, msg: str, **kwargs: Any) -> None:
    """Structured JSON log line — CloudWatch parses each line."""
    print(json.dumps({"level": level, "msg": msg, **kwargs}), file=sys.stdout, flush=True)


@dataclass
class MatchingStats:
    inputLufs: float | None = None
    referenceLufs: float | None = None
    outputLufs: float | None = None
    inputTruePeakDbtp: float | None = None
    outputTruePeakDbtp: float | None = None
    inputLra: float | None = None
    outputLra: float | None = None
    elapsedSec: float | None = None
    referenceId: str = ""
    engine: str = "matchering"
    engineVersion: str = ""


def validate_keys(source_key: str, reference_key: str, output_key: str) -> str | None:
    """Return an error message if any key violates its expected prefix, else None."""
    if not source_key or not source_key.startswith(MASTERING_PREFIX):
        return f"sourceKey must live under {MASTERING_PREFIX}"
    if not reference_key or not reference_key.startswith(REFERENCES_PREFIX):
        return f"referenceKey must live under {REFERENCES_PREFIX}"
    if not output_key or not output_key.startswith(MASTERING_PREFIX):
        return f"outputKey must live under {MASTERING_PREFIX}"
    for k in (source_key, reference_key, output_key):
        if ".." in k or "\\" in k:
            return f"key contains illegal path characters: {k!r}"
    return None


def patch_job(job_id: str, fields: dict) -> None:
    """UPDATE the MASTERJOB item with the given fields (sparse update)."""
    if not job_id:
        return
    names: dict[str, str] = {}
    values: dict[str, Any] = {}
    sets: list[str] = []
    for k, v in fields.items():
        if v is None:
            continue
        n = f"#{k}"
        val = f":{k}"
        names[n] = k
        # Convert to DynamoDB type-marker form.
        if isinstance(v, str):
            values[val] = {"S": v}
        elif isinstance(v, bool):
            values[val] = {"BOOL": v}
        elif isinstance(v, (int, float)):
            values[val] = {"N": str(v)}
        elif isinstance(v, dict):
            values[val] = {"S": json.dumps(v)}
        else:
            values[val] = {"S": str(v)}
        sets.append(f"{n} = {val}")
    if not sets:
        return
    ddb.update_item(
        TableName=TABLE,
        Key={"PK": {"S": f"MASTERJOB#{job_id}"}, "SK": {"S": "METADATA"}},
        UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def measure_lufs(path: str) -> tuple[float | None, float | None]:
    """Very rough LUFS proxy from soundfile alone — full EBU R128 needs ffmpeg,
    which we don't ship in this container. Returns (None, None) for now; the
    Node master-worker already runs a proper measure-fn on the output and
    that reading is authoritative. This is only for early progress reporting."""
    return (None, None)


def run(event: dict, context) -> dict:
    job_id = event.get("jobId") or ""
    source_key = event.get("sourceKey") or ""
    reference_key = event.get("referenceKey") or ""
    output_key = event.get("outputKey") or ""
    reference_id = event.get("referenceId") or ""

    log("info", "start", jobId=job_id, sourceKey=source_key, referenceKey=reference_key)

    if not TAKES_BUCKET:
        log("error", "TAKES_BUCKET env not set")
        patch_job(job_id, {"matchingStage": "failed",
                           "matchingError": json.dumps({"code": "config",
                                                        "message": "TAKES_BUCKET not configured"})})
        return {"ok": False, "error": "TAKES_BUCKET not configured"}

    err = validate_keys(source_key, reference_key, output_key)
    if err:
        log("error", "bad keys", error=err)
        patch_job(job_id, {"matchingStage": "failed",
                           "matchingError": json.dumps({"code": "bad-key", "message": err})})
        return {"ok": False, "error": err}

    source_path = f"/tmp/source-{job_id}.wav"
    reference_path = f"/tmp/reference-{job_id}.wav"
    output_path = f"/tmp/matched-{job_id}.wav"

    try:
        patch_job(job_id, {"matchingStage": "downloading"})
        s3.download_file(TAKES_BUCKET, source_key, source_path)
        s3.download_file(TAKES_BUCKET, reference_key, reference_path)
        log("info", "downloaded",
            source_bytes=os.path.getsize(source_path),
            reference_bytes=os.path.getsize(reference_path))

        patch_job(job_id, {"matchingStage": "matching"})
        t0 = time.time()
        # Keep the internal SR at 48 kHz to preserve parity with the existing
        # TamilAgaval pipeline. Spike (2026-08-26) verified the Config field
        # accepts 48000. Everything else in Config stays at library defaults.
        cfg = mg.Config(internal_sample_rate=48000)
        # Silence matchering's chatty logger; we emit our own structured lines.
        mg.log(lambda *_a, **_k: None)
        mg.process(
            target=source_path,
            reference=reference_path,
            results=[mg.pcm24(output_path)],
            config=cfg,
        )
        elapsed = time.time() - t0
        log("info", "matched", elapsedSec=round(elapsed, 2))

        patch_job(job_id, {"matchingStage": "uploading"})
        s3.upload_file(output_path, TAKES_BUCKET, output_key,
                       ExtraArgs={"ContentType": "audio/wav"})
        log("info", "uploaded", outputKey=output_key)

        stats = MatchingStats(
            elapsedSec=round(elapsed, 2),
            referenceId=reference_id,
            engine="matchering",
            engineVersion=mg.__version__ if hasattr(mg, "__version__") else "2.0.6",
        )
        patch_job(job_id, {
            "matchingStage": "completed",
            "matchedMasterKey": output_key,
            "matchingStats": asdict(stats),
        })
        return {"ok": True, "outputKey": output_key, "elapsedSec": elapsed}

    except Exception as e:
        tb = traceback.format_exc()
        log("error", "failed", error=str(e), traceback=tb)
        patch_job(job_id, {
            "matchingStage": "failed",
            "matchingError": json.dumps({"code": type(e).__name__, "message": str(e)[:500]}),
        })
        return {"ok": False, "error": str(e)}

    finally:
        for p in (source_path, reference_path, output_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass


def lambda_handler(event: dict, context) -> dict:
    """Entry point Lambda invokes. Wrapped so a top-level import error isn't
    silent — CloudWatch will show the traceback on any startup failure too."""
    return run(event, context)
