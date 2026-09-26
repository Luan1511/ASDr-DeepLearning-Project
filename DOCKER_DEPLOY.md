# ASDr - Docker Deployment Guide

## 📋 Prerequisites

- **Docker** (version 20.10+)
- **Docker Compose** (version 2.0+)
- **NVIDIA GPU** (recommended for ML API)
- **NVIDIA Container Toolkit** (for GPU support in ML API)

## 🚀 Quick Start

### 1. Prepare Environment

```bash
# Copy environment template if needed
cp backend/.env.example backend/.env  # Optional if .env doesn't exist

# Ensure necessary directories exist
mkdir -p backend/uploads
mkdir -p API/storage
mkdir -p API/ASD_Model
```

### 2. Build Images

```bash
# Build all services
docker-compose build

# Or build specific service
docker-compose build backend
docker-compose build frontend
docker-compose build ml-api
```

### 3. Start Services

```bash
# Start all services in background
docker-compose up -d

# Or start with logs visible
docker-compose up
```

### 4. Initialize Database

```bash
# Run Prisma migrations
docker-compose exec backend npm run prisma:migrate

# (Optional) Seed database
docker-compose exec backend npm run prisma:seed
```

### 5. Access Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **ML API Docs**: http://localhost:8000/docs
- **Database**: localhost:5433 (postgres:123456)

## 📊 Service Architecture

```
┌─────────────────────────────────────────┐
│         Frontend (Nginx/React)          │
│         http://localhost:3000           │
└────────────────┬────────────────────────┘
                 │
         ┌───────┼───────┐
         ▼       ▼       ▼
    ┌────────────────┐  ┌─────────────────┐
    │ Backend (Node) │  │ ML API (Python) │
    │ :4000          │  │ :8000           │
    └────────┬───────┘  └────────┬────────┘
             │                   │
         ┌───┴─────────────────┐ │
         ▼                     ▼ ▼
    ┌────────────────────────────────────┐
    │    PostgreSQL Database             │
    │    localhost:5433                  │
    └────────────────────────────────────┘
```

## 🛠️ Common Commands

```bash
# View logs
docker-compose logs -f backend
docker-compose logs -f ml-api
docker-compose logs -f frontend

# Stop services
docker-compose down

# Remove volumes (WARNING: deletes database)
docker-compose down -v

# Restart specific service
docker-compose restart backend

# Run commands in container
docker-compose exec backend npm run prisma:generate
docker-compose exec ml-api python3 -c "import torch; print(torch.cuda.is_available())"
```

## 🐛 Troubleshooting

### ML API fails to start (CUDA not available)

```bash
# Check GPU support
docker run --rm --gpus all nvidia/cuda:12.2.2-runtime-ubuntu22.04 nvidia-smi

# If no GPU, temporarily disable in docker-compose.yml
# Comment out the 'deploy' section in ml-api service
```

### Database connection refused

```bash
# Check if db service is healthy
docker-compose ps
docker-compose logs db

# Wait a bit longer for DB to initialize
sleep 10
docker-compose up -d
```

### Port conflicts

If ports are already in use, modify `docker-compose.yml`:

- Frontend: `3000:5173`
- Backend: `4000:4000`
- ML API: `8000:8000`
- Database: `5433:5432`

## 📁 File Structure

```
project/
├── docker-compose.yml           # Orchestrates all services
├── frontend/
│   ├── Dockerfile              # React build + Nginx
│   └── nginx.conf              # Nginx configuration
├── backend/
│   ├── Dockerfile              # Node build
│   ├── .env                    # Environment variables
│   └── prisma/                 # Database schemas
├── API/
│   ├── Dockerfile              # Python ML API
│   ├── erequirements.txt         # Python dependencies
│   ├── server_openpose.py      # FastAPI entry point
│   └── ASD_Model/              # Pre-trained models
└── README.md
```

## 🔧 Customization

### Change Database

Edit `docker-compose.yml`:

```yaml
db:
  environment:
    POSTGRES_PASSWORD: your-password-here
```

### Enable GPU for ML API

Ensure NVIDIA Container Toolkit is installed:

```bash
docker run --rm --gpus all ubuntu nvidia-smi
```

### Adjust Resource Limits

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
```

## 📦 Production Checklist

- [ ] Use strong JWT_SECRET
- [ ] Set CORS_ORIGIN correctly
- [ ] Use managed PostgreSQL instead of container
- [ ] Configure proper logging
- [ ] Set up health checks
- [ ] Use reverse proxy (Nginx, Traefik)
- [ ] Enable HTTPS/SSL
- [ ] Set resource limits
- [ ] Monitor container health
- [ ] Regular backups

## 🔐 Security Notes

1. Change default database password
2. Update JWT_SECRET to a strong random string
3. Whitelist CORS origins properly
4. Use secrets management for production
5. Don't expose sensitive environment variables
6. Regularly update base images

---

For more help, check individual service documentation or run:

```bash
docker-compose logs -f
```
