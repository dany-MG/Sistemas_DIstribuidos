from typing import Dict
from fastapi import APIRouter, Depends, HTTPException, Query
from database.connection import (
    get_node_id,
    get_active_db_path,
    list_available_sessions,
)
from repositories.telemetry_repository import TelemetryRepository

router = APIRouter(tags=["DuckDB Telemetry Data Node"])

# Caché en memoria de frecuencias por archivo .duckdb en el Data Node
_FREQUENCIES_CACHE: Dict[str, Dict[str, int]] = {}


def get_duckdb_repository():
    """
    Dependencia exclusiva del Servidor de Recursos DuckDB (Data Node).
    Abre el archivo .duckdb en modo read_only=True permitiendo lecturas concurrentes
    desde múltiples Data Nodes sin bloqueo.
    """
    db_path = get_active_db_path()
    repo = TelemetryRepository(db_path=str(db_path))
    try:
        yield repo
    finally:
        repo.close()


def _get_cached_frequencies(repo: TelemetryRepository) -> Dict[str, int]:
    if repo.db_path not in _FREQUENCIES_CACHE:
        _FREQUENCIES_CACHE[repo.db_path] = repo.get_channel_frequencies()
    return _FREQUENCIES_CACHE[repo.db_path]


@router.get("/health")
def data_node_health():
    db_path = get_active_db_path()
    return {
        "status": "ok",
        "node_id": get_node_id(),
        "role": "data",
        "active_session": db_path.name,
        "available_sessions": list_available_sessions(),
    }


@router.get("/metadata")
def get_raw_metadata(repo: TelemetryRepository = Depends(get_duckdb_repository)):
    try:
        return {
            "node_id": get_node_id(),
            "metadata": repo.get_session_metadata(),
            "frequencies": _get_cached_frequencies(repo),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en Data Node ({get_node_id()}) leyendo metadata: {e}")


@router.get("/setup")
def get_raw_setup(repo: TelemetryRepository = Depends(get_duckdb_repository)):
    try:
        return {
            "node_id": get_node_id(),
            "setup_json": repo.get_car_setup(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en Data Node ({get_node_id()}) leyendo setup: {e}")


@router.get("/track-map")
def get_raw_track_map(
    step: int = Query(default=5, ge=1, le=50),
    repo: TelemetryRepository = Depends(get_duckdb_repository),
):
    try:
        coords = repo.get_track_map_coordinates(step=step)
        return {
            "node_id": get_node_id(),
            "coordinates": [[float(lat), float(lon)] for lat, lon in coords],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en Data Node ({get_node_id()}) leyendo track-map: {e}")


@router.get("/snapshot-bundle")
def get_raw_snapshot_bundle(
    time_sec: float = Query(default=0.0, ge=0.0),
    repo: TelemetryRepository = Depends(get_duckdb_repository),
):
    """
    Extrae en una sola operación todos los canales continuos y eventos del archivo .duckdb
    para el instante 'time_sec' solicitado por un Servidor de API/Streaming.
    """
    try:
        frequencies = _get_cached_frequencies(repo)
        bundle = repo.get_snapshot_raw_bundle(current_time_sec=time_sec, frequencies=frequencies)
        bundle["data_node_id"] = get_node_id()
        return bundle
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en Data Node ({get_node_id()}) extrayendo bundle: {e}")
