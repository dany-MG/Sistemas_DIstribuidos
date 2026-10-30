import os
import asyncio
import traceback
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from typing import List, Optional

from database.connection import (
    get_node_id,
    DATA_DIR,
    get_active_db_path,
    list_available_sessions,
    set_active_session,
    state_store,
)
from repositories.telemetry_repository import TelemetryRepository
from services.telemetry_service import TelemetryService
from models.schemas import (
    SessionMetadata,
    TelemetrySnapshot,
    DashboardResponse,
    GPSPoint,
    ClusterStatusResponse,
)

router = APIRouter(tags=["Telemetry Dashboard"])


def get_telemetry_service():
    """
    Se ejecuta en cada petición HTTP en el Nodo de API.
    El servicio consulta de forma prioritaria al clúster de Nodos de Datos (.duckdb)
    y abre conexión local únicamente si todos los Data Nodes remotos están inactivos.
    """
    service = TelemetryService()
    try:
        yield service
    finally:
        service.close()


@router.get("/health")
def api_health_check():
    """Verifica el estado del Nodo de API actual y la sesión activa."""
    db_path = get_active_db_path()
    return {
        "status": "ok",
        "node_id": get_node_id(),
        "role": "api",
        "state_backend": state_store.backend_type,
        "active_session": db_path.name,
    }


@router.get("/session-pack")
def get_session_pack(
    step_hz: int = Query(default=20, ge=1, le=50),
    data_node: Optional[str] = Query(default=None),
    service: TelemetryService = Depends(get_telemetry_service),
):
    """
    Entrega en una sola petición comprimida todas las series de tiempo y eventos
    para que el Cliente y su Service Worker procesen la telemetría localmente.
    """
    try:
        pref_node = data_node if data_node and data_node != "auto" else None
        return service.get_full_session_pack(step_hz=step_hz, preferred_data_node=pref_node)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generando session-pack: {str(e)}")


@router.api_route("/sync-state", methods=["GET", "POST"])
def sync_lightweight_state(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    cursor_s: float = Query(default=0.0),
    duration_s: float = Query(default=649.5),
    data_node: Optional[str] = Query(default=None),
    service: TelemetryService = Depends(get_telemetry_service),
):
    """
    Endpoint ultraligero (0% consultas a DuckDB): sincroniza el reloj maestro de la sala
    y actualiza la presencia del cliente en la tabla MC-MS.
    """
    return service.sync_lightweight_state(
        client_id=client_id,
        mode=mode,
        client_cursor_s=cursor_s,
        duration_sec=duration_s,
        preferred_data_node=data_node,
    )


@router.get("/cluster/status", response_model=ClusterStatusResponse)
def get_cluster_status(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve la topología en vivo de Nodos API, Nodos de Datos (.duckdb) y Clientes Conectados."""
    return service.get_cluster_status()


@router.get("/sessions")
def get_available_sessions():
    """Devuelve la lista de archivos .duckdb disponibles en el directorio data/ y registrados en sala."""
    active_db = get_active_db_path()
    return {
        "active": active_db.name,
        "sessions": list_available_sessions(),
    }


@router.post("/sessions/register-pack")
async def register_client_session_pack(
    request: Request,
    service: TelemetryService = Depends(get_telemetry_service),
):
    """
    Recibe el paquete vectorizado ya extraído en el navegador por DuckDB-Wasm (~350 KB)
    y lo registra como sesión activa en el servidor para todos los clientes de la sala.
    """
    try:
        body = await request.json()
        filename = body.get("filename") or "custom_session.duckdb"
        pack_payload = body.get("pack_payload") or body
        return service.register_uploaded_session_pack(filename=filename, pack_payload=pack_payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error registrando session-pack: {str(e)}")


@router.post("/sessions/upload")
async def upload_duckdb_session_file(
    request: Request,
    filename: str = Query(default="uploaded_session.duckdb"),
    service: TelemetryService = Depends(get_telemetry_service),
):
    """
    Recibe un archivo binario .duckdb de Le Mans Ultimate, valida su esquema,
    lo guarda en backend/data/ y devuelve el session-pack a 20 Hz.
    """
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

        # Validamos que DuckDB pueda abrirlo y que contenga metadatos de LMU
        repo = TelemetryRepository(str(target_path))
        try:
            meta = repo.get_session_metadata()
            if not meta:
                raise ValueError("No se encontró tabla de metadata de Le Mans Ultimate en el archivo .duckdb.")
        finally:
            repo.close()

        set_active_session(clean_name)
        return service.get_full_session_pack(step_hz=20)
    except HTTPException:
        raise
    except Exception as e:
        if target_path.exists() and target_path.name != "Sebring International Raceway_P_2026-10-18T21_03_43Z.duckdb":
            try:
                target_path.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=f"Archivo .duckdb inválido: {str(e)}")


@router.post("/sessions/{filename}")
def switch_active_session(filename: str):
    """Cambia la sesión activa de DuckDB y reinicia el cursor de reproducción."""
    try:
        new_path = set_active_session(filename)
        return {
            "status": "ok",
            "active": new_path.name,
            "available_sessions": list_available_sessions(),
            "cursor": 15.0,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/playback/reset")
def reset_playback_cursor(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    service: TelemetryService = Depends(get_telemetry_service),
):
    """
    Reinicia el cursor de tiempo al segundo 0.0:
    - Si mode='sync': Reinicia el reloj compartido de la sala.
    - Si mode='independent': Reinicia únicamente el reloj del cliente indicado.
    """
    cursor = service.reset_playback(client_id=client_id, mode=mode)
    return {"status": "ok", "client_id": client_id, "mode": mode, "cursor": cursor}


@router.get("/session", response_model=SessionMetadata)
def get_session_info(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve los metadatos de la sesión actual de LMU (incluyendo car_brand)."""
    try:
        return service.get_session_info()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error obteniendo metadatos: {str(e)}")


@router.get("/setup")
def get_car_setup(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve el JSON parseado del setup del vehículo."""
    try:
        return service.get_car_setup()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error obteniendo el setup: {str(e)}")


@router.get("/live", response_model=TelemetrySnapshot)
def get_live_telemetry(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    data_node: Optional[str] = Query(default=None),
    service: TelemetryService = Depends(get_telemetry_service),
):
    """Devuelve el estado instantáneo de las métricas principales para un cliente y modo dados."""
    try:
        return service.get_latest_telemetry(
            client_id=client_id,
            mode=mode,
            advance_cursor=True,
            step_seconds=0.2,
            preferred_data_node=data_node if data_node and data_node != "auto" else None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error leyendo telemetría: {str(e)}")


@router.get("/dashboard", response_model=DashboardResponse)
def get_full_dashboard(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    data_node: Optional[str] = Query(default=None),
    service: TelemetryService = Depends(get_telemetry_service),
):
    """
    Endpoint agregado: Devuelve toda la información necesaria 
    para el primer renderizado del frontend en una sola petición.
    """
    try:
        active_db = get_active_db_path()
        pref_node = data_node if data_node and data_node != "auto" else None
        return DashboardResponse(
            session=service.get_session_info(),
            setup=service.get_car_setup(),
            current_telemetry=service.get_latest_telemetry(
                client_id=client_id,
                mode=mode,
                advance_cursor=False,
                preferred_data_node=pref_node,
            ),
            available_sessions=list_available_sessions(),
            active_session_file=active_db.name,
            cluster=service.get_cluster_status(),
        )
    except Exception:
        print("\n--- INICIO DE TRAZA DE ERROR ---")
        traceback.print_exc()
        print("--- FIN DE TRAZA DE ERROR ---\n")
        raise HTTPException(status_code=500, detail="Error crítico armando el dashboard")


@router.get("/track-map", response_model=List[GPSPoint])
def get_track_map(service: TelemetryService = Depends(get_telemetry_service)):
    """Devuelve la nube de puntos GPS estática para dibujar el mapa del circuito."""
    try:
        return service.get_track_map()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generando mapa: {str(e)}")


@router.get("/stream")
async def stream_telemetry(
    client_id: str = Query(default="default-client"),
    mode: str = Query(default="sync"),
    data_node: Optional[str] = Query(default=None),
):
    """
    Endpoint SSE (Server-Sent Events) Multi-Cliente / Multi-Servidor.
    Mantiene la conexión HTTP abierta y empuja la telemetría a 5 Hz (paso de 0.2s = 1:1)
    consultando de forma distribuida a los Nodos de Datos (.duckdb) en un hilo no bloqueante.
    """
    pref_node = data_node if data_node and data_node != "auto" else None

    def _fetch_tick() -> str:
        svc = TelemetryService()
        try:
            snap = svc.get_latest_telemetry(
                client_id=client_id,
                mode=mode,
                advance_cursor=True,
                step_seconds=0.2,
                preferred_data_node=pref_node,
            )
            return snap.model_dump_json()
        finally:
            svc.close()

    async def event_generator():
        try:
            while True:
                payload_json = await asyncio.to_thread(_fetch_tick)
                yield f"data: {payload_json}\n\n"
                await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            print(f"[SSE {get_node_id()}] Cliente '{client_id}' ({mode}) desconectado")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
