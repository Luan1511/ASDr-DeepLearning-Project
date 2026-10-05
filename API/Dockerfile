# ML server image (FastAPI + ST-GCN). OpenPose is NOT built here: mount a Linux
# OpenPose build at /opt/openpose (see docker-compose.yml, profile "ml") or run
# the server directly on the GPU host, which is the tested setup.
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Ubuntu 22.04 ships Python 3.10, the version the code is developed with.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p storage ASD_Model

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "server_openpose:app", "--host", "0.0.0.0", "--port", "8000"]
