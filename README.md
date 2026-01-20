# Big Data Image Processor - Quick Start Guide

This guide will help you get the Big Data system running in minutes.

## Prerequisites Check

Before starting, ensure you have:
-  Docker Desktop installed and running
-  At least 16GB RAM available
-  50GB free disk space
-  (Optional) NVIDIA GPU with drivers for faster processing

## Step 1: Initial Setup (5 minutes)

``` wsl
# 1. Check if docker sees GPU
docker run --rm --gpus all nvidia/cuda:12.9.0-base-ubuntu22.04 nvidia-smi
```

## Step 2: Start the Infrastructure (2-3 minutes)

```wsl
# Start all services
docker-compose up -d --build

# Wait for services to be ready
Start-Sleep -Seconds 30

# Check status
docker-compose ps
```

You should see all services as "Up":
```
NAME                    STATUS
bigdata-nginx           Up
bigdata-web-1           Up
bigdata-web-2           Up
bigdata-worker-1        Up (healthy)
bigdata-worker-2        Up (healthy)
bigdata-worker-3        Up (healthy)
bigdata-worker-4        Up (healthy)
bigdata-redis           Up (healthy)
bigdata-minio           Up (healthy)
bigdata-postgres        Up (healthy)
bigdata-ollama          Up
bigdata-prometheus      Up
bigdata-grafana         Up
```

## Step 3: Download Ollama Model (5-10 minutes, one-time only)

``` wsl
# Pull the llava model into Ollama container
docker exec -it bigdata-ollama ollama pull llava:latest
```

Wait for the download to complete (~4.7GB).

## Step 4: Access the System

### Web UI
Open browser: **http://localhost**

### Grafana Dashboard
Open browser: **http://localhost:3001**
- Username: `admin`
- Password: `admin123`

### MinIO Console
Open browser: **http://localhost:9001**
- Username: `minioadmin`
- Password: `minioadmin123`

## Step 5: Test with Sample Images (2 minutes)

### Method A: Download Test Dataset
``` wsl
# Download 100 images from Unsplash
.\scripts\download-bulk-dataset.ps1 -Count 100 -Source unsplash -Category nature
```

### Method B: Use Existing Images
1. Go to http://localhost
2. Drag & drop images from your computer
3. Click "Process Images"

## Step 6: Monitor Processing

Watch real-time progress:
- **Web UI**: http://localhost - See worker stats, queue, and results
- **Grafana**: http://localhost:3001 - View metrics and graphs
- **Logs**: `docker-compose logs -f worker-1`

## Quick Commands Reference

``` wsl
# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f worker-1
docker-compose logs -f web-1

# Check system health
curl http://localhost/api/health

# Restart a service
docker-compose restart worker-1

# Stop everything
docker-compose down

# Stop and remove volumes (CAUTION: deletes all data)
docker-compose down -v

# Scale workers
docker-compose up -d --scale worker-1=2

# View resource usage
docker stats
```

## Troubleshooting

### Issue: "Cannot connect to Docker daemon"
**Solution**: Start Docker Desktop

### Issue: Port already in use
**Solution**: 
```wsl
# Check what's using the port
netstat -ano | findstr :80
# Kill the process or change port in docker-compose.yml
```

### Issue: Out of memory
**Solution**: 
1. Open Docker Desktop → Settings → Resources
2. Increase Memory to 16GB
3. Apply & Restart

### Issue: Ollama not responding
**Solution**:
``` wsl
# Check Ollama logs
docker-compose logs ollama

# Restart Ollama
docker-compose restart ollama

# Verify model is loaded
docker exec -it bigdata-ollama ollama list
```

### Issue: Workers not processing
**Solution**:
``` wsl
# Check worker logs
docker-compose logs worker-1 worker-2 worker-3 worker-4

# Restart all workers
docker-compose restart worker-1 worker-2 worker-3 worker-4

# Check Redis connection
docker exec -it bigdata-redis redis-cli ping
```
