# Foilio skannermotor utan AI. Indexfilerna ligger på en volym (DATA_DIR), inte i avbildningen.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py app.py ./
ENV DATA_DIR=/data PYTHONUNBUFFERED=1
CMD ["python", "app.py"]
