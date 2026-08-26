# AWS Lambda container image for tamilagaval-matchering-worker.
#
# Python 3.12 base — matches the environment the Phase 1A spike empirically
# validated. Matchering's upstream cert lists only 3.8-3.10, but 3.12 worked
# cleanly with modern NumPy 2.x/SciPy in the spike. Reproducibility with the
# spike beats deference to a dormant (2022-10) cert range.
#
# Size: ~500 MB uncompressed. Only concern is Lambda cold start (~5-10s).
# Mastering is a manual job; the user tolerates that.

FROM public.ecr.aws/lambda/python:3.12

# Copy requirements first so Docker caches the pip install layer separately from
# handler edits. Without this, editing handler.py invalidates the pip cache and
# every rebuild reinstalls Matchering + all its deps.
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# --no-cache-dir keeps the image ~150 MB smaller by not persisting the pip
# download cache into a layer.
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Handler last — this is what changes most often.
COPY handler.py ${LAMBDA_TASK_ROOT}/

# Lambda invokes lambda_handler in handler.py.
CMD ["handler.lambda_handler"]
