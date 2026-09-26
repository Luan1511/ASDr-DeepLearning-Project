# Multi-stage build
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04 AS base

RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    libgl1-mesa-glx \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build stage
FROM base AS builder

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cu121

# Runtime stage
FROM base

WORKDIR /app

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/dist-packages /usr/local/lib/python3.11/dist-packages

# Copy application
COPY . .

# Create directories
RUN mkdir -p storage ASD_Model

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "server_openpose:app", "--host", "0.0.0.0", "--port", "8000"]
