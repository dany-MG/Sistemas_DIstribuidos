import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database.connection import NodeIdentityMiddleware
from middleware.error_handler import TelemetryErrorMiddleware
from routes import telemetry_routes, data_node_routes
from microservices import (
    track_map_ms,
    car_setup_ms,
    session_catalog_ms,
    telemetry_pack_ms,
    room_sync_ms,
)
from microservices.registry import get_all_microservices_status

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "paddock-dashboard" / "dist"

# En la nube (Render), activamos el modo clúster de proceso único para consumir < 100 MB RAM
os.environ.setdefault("SINGLE_PROCESS_CLUSTER", "1")

app = FastAPI(
    title="LMU Paddock Cloud Gateway & Lightweight Cluster",
    description="Servidor Cloud Unificado (<100 MB RAM) con soporte CORS para Vercel y compresión Gzip",
    version="3.0.0",
)

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(TelemetryErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sub-aplicaciones ligeras por nodo dentro del mismo proceso ASGI (0 sobrecarga de RAM)
node1_app = FastAPI(title="API Node 1")
node1_app.include_router(telemetry_routes.router, prefix="/api/v1")
app.mount("/node1", NodeIdentityMiddleware(node1_app, "api-node-1"))

node2_app = FastAPI(title="API Node 2")
node2_app.include_router(telemetry_routes.router, prefix="/api/v1")
app.mount("/node2", NodeIdentityMiddleware(node2_app, "api-node-2"))

data1_app = FastAPI(title="Data Node 1")
data1_app.include_router(data_node_routes.router, prefix="/data/v1")
app.mount("/data1", NodeIdentityMiddleware(data1_app, "data-node-1"))

data2_app = FastAPI(title="Data Node 2")
data2_app.include_router(data_node_routes.router, prefix="/data/v1")
app.mount("/data2", NodeIdentityMiddleware(data2_app, "data-node-2"))

# También exponemos /api/v1 y /data/v1 en la raíz para peticiones directas
app.include_router(telemetry_routes.router, prefix="/api/v1")
app.include_router(data_node_routes.router, prefix="/data/v1")

# Montaje directo de los 5 Microservicios Atómicos bajo /ms/*
app.include_router(track_map_ms.router, prefix="/ms/track-map")
app.include_router(car_setup_ms.router, prefix="/ms/car-setup")
app.include_router(session_catalog_ms.router, prefix="/ms/session-catalog")
app.include_router(telemetry_pack_ms.router, prefix="/ms/telemetry-pack")
app.include_router(room_sync_ms.router, prefix="/ms/room-sync")


@app.get("/health")
def root_health():
    return {
        "status": "ok",
        "mode": "lightweight_cloud_cluster_with_microservices",
        "microservices": get_all_microservices_status(),
    }


# Si existe el build estático de Astro, también lo servimos como respaldo
if FRONTEND_DIST.exists():
    if (FRONTEND_DIST / "_astro").exists():
        app.mount("/_astro", StaticFiles(directory=str(FRONTEND_DIST / "_astro")), name="astro-assets")
    if (FRONTEND_DIST / "cars").exists():
        app.mount("/cars", StaticFiles(directory=str(FRONTEND_DIST / "cars")), name="car-assets")
    if (FRONTEND_DIST / "data").exists():
        app.mount("/data", StaticFiles(directory=str(FRONTEND_DIST / "data")), name="data-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
