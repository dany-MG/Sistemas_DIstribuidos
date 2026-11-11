from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from middleware.error_handler import TelemetryErrorMiddleware
from routes import telemetry_routes
from database.connection import NODE_ID, get_node_id
from microservices import (
    track_map_ms,
    car_setup_ms,
    session_catalog_ms,
    telemetry_pack_ms,
    room_sync_ms,
)

app = FastAPI(
    title = f"LMU Paddock Dashboard API ({NODE_ID})",
    description = "API & Streaming Node for the LMU Paddock Dashboard (MC-MS Architecture)",
    version = "2.0.0",
)

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(TelemetryErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permite múltiples clientes desde cualquier puerto/host local
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/app/v1/health")
async def health_check():
    return {"status": "ok", "node_id": get_node_id(), "role": "api"}

app.include_router(telemetry_routes.router, prefix="/api/v1")
app.include_router(track_map_ms.router, prefix="/ms/track-map")
app.include_router(car_setup_ms.router, prefix="/ms/car-setup")
app.include_router(session_catalog_ms.router, prefix="/ms/session-catalog")
app.include_router(telemetry_pack_ms.router, prefix="/ms/telemetry-pack")
app.include_router(room_sync_ms.router, prefix="/ms/room-sync")
