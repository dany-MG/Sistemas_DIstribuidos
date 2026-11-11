from typing import Optional
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database.connection import get_active_db_path
from microservices.registry import get_microservice_info, is_service_enabled, require_service_active
from services.telemetry_service import TelemetryService

MS_ID = "ms-car-setup"

router = APIRouter(tags=["Microservice: Car Setup & Engineering (ms-car-setup)"])


def _get_service():
    svc = TelemetryService()
    try:
        yield svc
    finally:
        svc.close()


@router.get("/health")
def car_setup_health():
    info = get_microservice_info(MS_ID)
    if not is_service_enabled(MS_ID):
        raise HTTPException(status_code=503, detail=info)
    return {
        "status": "ok",
        "ms_id": MS_ID,
        "active_session": get_active_db_path().name,
        "info": info,
    }


@router.get("/setup")
def get_vehicle_engineering_setup(
    search: Optional[str] = Query(default=None),
    svc: TelemetryService = Depends(_get_service),
):
    """
    Microservicio Atómico de Ingeniería y Setup Mecánico:
    Extrae y filtra las hojas técnicas del vehículo (frenos, aerodinámica, suspensión, neumáticos).
    Totalmente desacoplado del flujo de telemetría en tiempo real.
    """
    require_service_active(MS_ID)

    setup_map = svc.get_car_setup()
    serialized = {k: v.model_dump() for k, v in setup_map.items()}

    if search and search.strip():
        q = search.strip().lower()
        serialized = {
            k: v
            for k, v in serialized.items()
            if q in k.lower()
            or q in str(v.get("caption") or "").lower()
            or q in str(v.get("string_value") or "").lower()
        }

    return {
        "ms_id": MS_ID,
        "active_session_file": get_active_db_path().name,
        "parameters_count": len(serialized),
        "setup": serialized,
    }


app = FastAPI(
    title="LMU Microservice — Car Setup & Engineering (ms-car-setup)",
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
