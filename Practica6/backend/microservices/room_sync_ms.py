from typing import Optional
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database.connection import get_active_db_path
from microservices.registry import get_microservice_info, is_service_enabled, require_service_active
from services.telemetry_service import TelemetryService

MS_ID = "ms-room-sync"

router = APIRouter(tags=["Microservice: Room Clock & Presence Sync (ms-room-sync)"])


def _get_service():
    svc = TelemetryService()
    try:
        yield svc
    finally:
        svc.close()


@router.get("/health")
def room_sync_health():
    info = get_microservice_info(MS_ID)
    if not is_service_enabled(MS_ID):
        raise HTTPException(status_code=503, detail=info)
    return {
        "status": "ok",
        "ms_id": MS_ID,
        "active_session": get_active_db_path().name,
        "info": info,
    }


@router.api_route("/state", methods=["GET", "POST"])
def sync_room_state(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    cursor_s: float = Query(default=15.0),
    duration_s: float = Query(default=649.5),
    data_node: Optional[str] = Query(default=None),
    svc: TelemetryService = Depends(_get_service),
):
    """
    Microservicio Atómico de Sincronización de Sala y Presencia MC-MS:
    Coordina en memoria (0% uso de DuckDB) el reloj maestro compartido (1.0x)
    y la lista de clientes conectados a la sala.
    """
    require_service_active(MS_ID)
    res = svc.sync_lightweight_state(
        client_id=client_id,
        mode=mode,
        client_cursor_s=cursor_s,
        duration_sec=duration_s,
        preferred_data_node=data_node,
    )
    return {**res, "ms_id": MS_ID}


@router.post("/reset")
def reset_room_clock(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    svc: TelemetryService = Depends(_get_service),
):
    require_service_active(MS_ID)
    cursor = svc.reset_playback(client_id=client_id, mode=mode)
    return {
        "status": "ok",
        "ms_id": MS_ID,
        "client_id": client_id,
        "mode": mode,
        "cursor": cursor,
    }


app = FastAPI(
    title="LMU Microservice — Room Clock & Presence Sync (ms-room-sync)",
    version="1.0.0",
)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
