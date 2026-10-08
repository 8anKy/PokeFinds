# Foilio skannermotor utan AI. Indexfilerna ligger på en volym (DATA_DIR), inte i avbildningen.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py app.py bootstrap.py ./
# Minnet (2026-10-08): kapa glibc-arenorna och faiss/OpenMP-trådarna — se app.py:s _trim().
ENV DATA_DIR=/data PYTHONUNBUFFERED=1 MALLOC_ARENA_MAX=2 OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=1
CMD ["python", "app.py"]
