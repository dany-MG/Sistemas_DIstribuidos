from typing import Optional
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database.connection import get_active_db_path
from microservices.registry import get_microservice_info, is_service_enabled, require_service_active
from services.telemetry_service import TelemetryService

MS_ID = "ms-telemetry-pack"

router = APIRouter(tags=["Microservice: Vectorized Telemetry 20Hz (ms-telemetry-pack)"])


def _get_service():
    svc = TelemetryService()
    try:
        yield svc
    finally:
        svc.close()


@router.get("/health")
def telemetry_pack_health():
    info = get_microservice_info(MS_ID)
    if not is_service_enabled(MS_ID):
        raise HTTPException(status_code=503, detail=info)
    return {
        "status": "ok",
        "ms_id": MS_ID,
        "active_session": get_active_db_path().name,
        "info": info,
    }


@router.get("/pack")
def get_vectorized_telemetry_pack(
    step_hz: int = Query(default=20, ge=1, le=50),
    data_node: Optional[str] = Query(default=None),
    svc: TelemetryService = Depends(_get_service),
):
    """
    Microservicio Atómico de Series de Tiempo Vectorizadas (20 Hz):
    Entrega los arreglos comprimidos de canales continuos, las 4 ruedas y los eventos
    para que TelemetryClientEngine interpole localmente a 20 Hz.
    """
    require_service_active(MS_ID)
    pref_node = data_node if data_node and data_node != "auto" else None
    payload = svc.get_full_session_pack(step_hz=step_hz, preferred_data_node=pref_node)
    return {
        **payload,
        "ms_id": MS_ID,
    }


app = FastAPI(
    title="LMU Microservice — Vectorized Telemetry 20Hz (ms-telemetry-pack)",
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
