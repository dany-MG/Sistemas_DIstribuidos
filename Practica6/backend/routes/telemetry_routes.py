import os
import traceback
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from typing import Dict

from services.telemetry_service import TelemetryService
from repositories.telemetry_repository import TelemetryRepository
from models.schemas import SessionMetadata, SetupEntry, TelemetrySnapshot, DashboardResponse

router = APIRouter(tags=["Telemetry Dashboard"])

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "Sebring International Raceway_P_2026-10-18T21_03_43Z.duckdb"

def get_telemetry_service():
    """
    Se ejecuta en cada petición HTTP. Abre la conexión a DuckDB,
    instancia el servicio y, al terminar la petición, asegura el cierre.
    """
    # Usamos el archivo de DuckDB que has generado como prueba
    db_path = DB_PATH
    repository = TelemetryRepository(db_path=db_path)
    service = TelemetryService(repository)
    
    try:
        yield service
    finally:
        repository.close()

@router.get("/session")
async def get_session_info(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve los metadatos de la sesión actual de LMU."""
    try:
        return service.get_session_info()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error obteniendo metadatos: {str(e)}")
    
@router.get("/setup")
async def get_car_setup(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve el JSON parseado del setup del vehículo."""
    try:
        return service.get_car_setup()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error obteniendo el setup: {str(e)}")

@router.get("/live", response_model=TelemetrySnapshot)
async def get_live_telemetry(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve el estado instantáneo de las métricas principales."""
    try:
        return service.get_latest_telemetry()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error leyendo telemetría: {str(e)}")

@router.get("/dashboard", response_model=DashboardResponse)
async def get_full_dashboard(service: TelemetryService = Depends(get_telemetry_service)):
    """
    Endpoint agregado: Devuelve toda la información necesaria 
    para el primer renderizado del frontend en una sola petición.
    """
    try:
        return DashboardResponse(
            session=service.get_session_info(),
            setup=service.get_car_setup(),
            current_telemetry=service.get_latest_telemetry()
        )
    except Exception as e:
        print("\n--- INICIO DE TRAZA DE ERROR ---")
        traceback.print_exc()
        print("--- FIN DE TRAZA DE ERROR ---\n")
        raise HTTPException(status_code=500, detail="Error crítico armando el dashboard")