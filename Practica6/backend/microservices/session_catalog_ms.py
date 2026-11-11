import os
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database.connection import (
    DATA_DIR,
    get_active_db_path,
    list_available_sessions,
    set_active_session,
)
from microservices.registry import get_microservice_info, is_service_enabled, require_service_active
from repositories.telemetry_repository import TelemetryRepository
from services.telemetry_service import TelemetryService

MS_ID = "ms-session-catalog"

router = APIRouter(tags=["Microservice: Session Catalog & DuckDB Loader (ms-session-catalog)"])


def _get_service():
    svc = TelemetryService()
    try:
        yield svc
    finally:
        svc.close()


@router.get("/health")
def session_catalog_health():
    info = get_microservice_info(MS_ID)
    if not is_service_enabled(MS_ID):
        raise HTTPException(status_code=503, detail=info)
    return {
        "status": "ok",
        "ms_id": MS_ID,
        "active_session": get_active_db_path().name,
        "available_sessions_count": len(list_available_sessions()),
        "info": info,
    }


@router.get("/metadata")
def get_session_catalog_metadata(svc: TelemetryService = Depends(_get_service)):
    """
    Microservicio Atómico de Catálogo y Metadatos de Sesión (.duckdb):
    Entrega los datos del piloto, vehículo, marca detectada, pista y lista de archivos .duckdb.
    """
    require_service_active(MS_ID)
    meta = svc.get_session_info()
    return {
        "ms_id": MS_ID,
        "active_session_file": get_active_db_path().name,
        "available_sessions": list_available_sessions(),
        "session": meta.model_dump(),
    }


@router.get("/list")
def list_catalog_sessions():
    require_service_active(MS_ID)
    return {
        "ms_id": MS_ID,
        "active": get_active_db_path().name,
        "sessions": list_available_sessions(),
    }


@router.post("/switch/{filename}")
def switch_catalog_session(filename: str):
    require_service_active(MS_ID)
    try:
        new_path = set_active_session(filename)
        return {
            "status": "ok",
            "ms_id": MS_ID,
            "active": new_path.name,
            "available_sessions": list_available_sessions(),
            "cursor": 15.0,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/register-pack")
async def register_wasm_session_pack(
    request: Request,
    svc: TelemetryService = Depends(_get_service),
):
    require_service_active(MS_ID)
    try:
        body = await request.json()
        filename = body.get("filename") or "custom_session.duckdb"
        pack_payload = body.get("pack_payload") or body
        result = svc.register_uploaded_session_pack(filename=filename, pack_payload=pack_payload)
        return {**result, "ms_id": MS_ID}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error registrando paquete en {MS_ID}: {str(e)}")


@router.post("/upload")
async def upload_duckdb_file(
    request: Request,
    filename: str = Query(default="uploaded_session.duckdb"),
    svc: TelemetryService = Depends(_get_service),
):
    require_service_active(MS_ID)
    clean_name = os.path.basename(filename.strip()) or "uploaded_session.duckdb"
    if not clean_name.endswith(".duckdb"):
        clean_name = f"{clean_name}.duckdb"

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    target_path = DATA_DIR / clean_name

    try:
        raw_bytes = await request.body()
        if not raw_bytes or len(raw_bytes) < 1024:
            raise HTTPException(status_code=400, detail="El archivo .duckdb recibido está vacío o incompleto.")

        target_path.write_bytes(raw_bytes)
        repo = TelemetryRepository(str(target_path))
        try:
            meta = repo.get_session_metadata()
            if not meta:
                raise ValueError("No se encontró tabla de metadata de Le Mans Ultimate en el archivo .duckdb.")
        finally:
            repo.close()

        set_active_session(clean_name)
        pack = svc.get_full_session_pack(step_hz=20)
        return {**pack, "ms_id": MS_ID}
    except HTTPException:
        raise
    except Exception as e:
        if target_path.exists() and target_path.name != "Sebring International Raceway_P_2026-10-18T21_03_43Z.duckdb":
            try:
                target_path.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=f"Archivo .duckdb inválido: {str(e)}")


app = FastAPI(
    title="LMU Microservice — Session Catalog & DuckDB Loader (ms-session-catalog)",
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
