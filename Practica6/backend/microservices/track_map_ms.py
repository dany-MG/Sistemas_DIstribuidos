from typing import Optional
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database.connection import get_active_db_path
from microservices.registry import get_microservice_info, is_service_enabled, require_service_active
from services.telemetry_service import TelemetryService

MS_ID = "ms-track-map"

router = APIRouter(tags=["Microservice: Track Map Geometry (ms-track-map)"])


def _get_service():
    svc = TelemetryService()
    try:
        yield svc
    finally:
        svc.close()


@router.get("/health")
def track_map_health():
    info = get_microservice_info(MS_ID)
    if not is_service_enabled(MS_ID):
        raise HTTPException(status_code=503, detail=info)
    return {
        "status": "ok",
        "ms_id": MS_ID,
        "active_session": get_active_db_path().name,
        "info": info,
    }


@router.get("/map")
def get_track_map_geometry(
    size: int = Query(default=200, ge=100, le=1000),
    padding: int = Query(default=15, ge=0, le=100),
    svc: TelemetryService = Depends(_get_service),
):
    """
    Microservicio Atómico de Cartografía GPS:
    Extrae las coordenadas del circuito, calcula los límites geográficos (Bounding Box)
    y entrega tanto los puntos crudos como la polilínea SVG pre-proyectada.
    Si este microservicio falla (503), el resto del Dashboard continúa operando.
    """
    require_service_active(MS_ID)

    points = svc.get_track_map()
    coords = [{"lat": p.lat, "lon": p.lon} for p in points]

    if not coords:
        return {
            "ms_id": MS_ID,
            "active_session_file": get_active_db_path().name,
            "points_count": 0,
            "bounds": None,
            "svg_points": "",
            "coordinates": [],
        }

    lats = [c["lat"] for c in coords]
    lons = [c["lon"] for c in coords]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    lat_range = (max_lat - min_lat) or 1.0
    lon_range = (max_lon - min_lon) or 1.0
    usable_span = size - (padding * 2)

    svg_Readout = []
    for c in coords:
        x = padding + ((c["lon"] - min_lon) / lon_range) * usable_span
        y = (size - padding) - ((c["lat"] - min_lat) / lat_range) * usable_span
        svg_Readout.append(f"{x:.1f},{y:.1f}")

    return {
        "ms_id": MS_ID,
        "active_session_file": get_active_db_path().name,
        "points_count": len(coords),
        "bounds": {
            "min_lat": min_lat,
            "max_lat": max_lat,
            "min_lon": min_lon,
            "max_lon": max_lon,
            "size": size,
            "padding": padding,
        },
        "svg_points": " ".join(svg_Readout),
        "coordinates": coords,
    }


app = FastAPI(
    title="LMU Microservice — Track Map Geometry (ms-track-map)",
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
