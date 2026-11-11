import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import HTTPException

MS_STATE_FILE = Path(
    os.getenv(
        "MS_STATE_FILE",
        os.path.join(tempfile.gettempdir(), "lmu_paddock_ms_registry.json"),
    )
)

MICROSERVICES_CATALOG: List[dict] = [
    {
        "ms_id": "ms-track-map",
        "name": "Track Map Geometry Microservice",
        "domain": "Cartografía GPS & Proyección Normalizada SVG",
        "gateway_path": "/ms/track-map",
        "local_port": 8021,
        "criticality": "MEDIUM (UI Widget Isolated)",
        "fallback_strategy": "Aísla el panel Mapa GPS con modo degradado y reintento sin detener la telemetría 20 Hz.",
        "endpoints": ["GET /ms/track-map/map", "GET /ms/track-map/health"],
    },
    {
        "ms_id": "ms-car-setup",
        "name": "Car Setup & Engineering Microservice",
        "domain": "Parámetros Mecánicos, Suspensión y Aerodinámica",
        "gateway_path": "/ms/car-setup",
        "local_port": 8022,
        "criticality": "LOW (On-Demand Modal)",
        "fallback_strategy": "Muestra aviso de mantenimiento en el modal de Setup o usa caché local sin afectar la sala.",
        "endpoints": ["GET /ms/car-setup/setup", "GET /ms/car-setup/health"],
    },
    {
        "ms_id": "ms-session-catalog",
        "name": "Session Catalog & DuckDB Loader Microservice",
        "domain": "Catálogo .duckdb, Metadatos WEC/ELMS e Ingesta Wasm",
        "gateway_path": "/ms/session-catalog",
        "local_port": 8023,
        "criticality": "MEDIUM (Session Management)",
        "fallback_strategy": "Conserva la sesión activa en RAM y permite abrir archivos .duckdb locales con DuckDB-Wasm.",
        "endpoints": [
            "GET /ms/session-catalog/metadata",
            "GET /ms/session-catalog/list",
            "POST /ms/session-catalog/switch/{filename}",
            "POST /ms/session-catalog/upload",
            "POST /ms/session-catalog/register-pack",
        ],
    },
    {
        "ms_id": "ms-telemetry-pack",
        "name": "Vectorized Telemetry 20Hz Microservice",
        "domain": "Extracción Vectorizada 20 Hz (Canales, Ruedas y Eventos)",
        "gateway_path": "/ms/telemetry-pack",
        "local_port": 8024,
        "criticality": "HIGH (Edge Cached)",
        "fallback_strategy": "El Service Worker (sw.js) y TelemetryClientEngine sirven el paquete desde CacheStorage.",
        "endpoints": ["GET /ms/telemetry-pack/pack", "GET /ms/telemetry-pack/health"],
    },
    {
        "ms_id": "ms-room-sync",
        "name": "Room Clock & Presence Sync Microservice",
        "domain": "Reloj Maestro Sincronizado (1.0x) y Presencia MC-MS",
        "gateway_path": "/ms/room-sync",
        "local_port": 8025,
        "criticality": "MEDIUM (Local Broadcast Mesh Fallback)",
        "fallback_strategy": "Conmuta automáticamente al bus local BroadcastChannel y reloj performance.now() del navegador.",
        "endpoints": ["POST /ms/room-sync/state", "POST /ms/room-sync/reset", "GET /ms/room-sync/health"],
    },
]

_LOCK = threading.Lock()
_IN_MEMORY_STATUS: Dict[str, dict] = {
    item["ms_id"]: {
        "enabled": True,
        "requests_count": 0,
        "errors_count": 0,
        "last_request_ts": 0.0,
        "last_Toggle_ts": time.time(),
    }
    for item in MICROSERVICES_CATALOG
}


def _read_shared_ms_state() -> Dict[str, dict]:
    with _LOCK:
        if MS_STATE_FILE.exists():
            try:
                raw = json.loads(MS_STATE_FILE.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    for ms_id, st in raw.items():
                        if ms_id in _IN_MEMORY_STATUS and isinstance(st, dict):
                            _IN_MEMORY_STATUS[ms_id].update(st)
            except Exception:
                pass
        return {k: dict(v) for k, v in _IN_MEMORY_STATUS.items()}


def _write_shared_ms_state(state_map: Dict[str, dict]) -> None:
    with _LOCK:
        try:
            MS_STATE_FILE.write_text(json.dumps(state_map), encoding="utf-8")
        except Exception:
            pass


def is_service_enabled(ms_id: str) -> bool:
    state_map = _read_shared_ms_state()
    entry = state_map.get(ms_id)
    if not entry:
        return True
    return bool(entry.get("enabled", True))


def record_service_call(ms_id: str, success: bool = True) -> None:
    state_map = _read_shared_ms_state()
    if ms_id not in state_map:
        return
    state_map[ms_id]["requests_count"] = int(state_map[ms_id].get("requests_count", 0)) + 1
    if not success:
        state_map[ms_id]["errors_count"] = int(state_map[ms_id].get("errors_count", 0)) + 1
    state_map[ms_id]["last_request_ts"] = time.time()
    with _LOCK:
        _IN_MEMORY_STATUS[ms_id] = state_map[ms_id]
    _write_shared_ms_state(state_map)


def toggle_service(ms_id: str, enabled: Optional[bool] = None) -> dict:
    """
    Permite activar o desactivar (simular caída 503) un microservicio individualmente
    para demostrar la atomicidad y el aislamiento de fallos (Bulkhead Pattern) en la PWA.
    """
    state_map = _read_shared_ms_state()
    if ms_id not in state_map:
        raise KeyError(f"Microservicio '{ms_id}' no registrado en el catálogo.")

    current_val = bool(state_map[ms_id].get("enabled", True))
    new_val = (not current_val) if enabled is None else bool(enabled)
    state_map[ms_id]["enabled"] = new_val
    state_map[ms_id]["last_toggle_ts"] = time.time()

    with _LOCK:
        _IN_MEMORY_STATUS[ms_id] = state_map[ms_id]
    _write_shared_ms_state(state_map)

    return get_microservice_info(ms_id)


def require_service_active(ms_id: str) -> None:
    """
    Guardia de aislamiento de fallos (Circuit Breaker / Bulkhead):
    Si el microservicio está en estado OFFLINE (simulado o real), rechaza con HTTP 503
    sin afectar a ninguno de los demás microservicios del clúster.
    """
    if not is_service_enabled(ms_id):
        record_service_call(ms_id, success=False)
        raise HTTPException(
            status_code=503,
            detail={
                "error": "MICROSERVICE_UNAVAILABLE",
                "ms_id": ms_id,
                "message": f"El microservicio '{ms_id}' se encuentra fuera de línea (503 Service Unavailable). El resto de microservicios sigue operando con normalidad.",
            },
        )
    record_service_call(ms_id, success=True)


def get_microservice_info(ms_id: str) -> dict:
    state_map = _read_shared_ms_state()
    catalog_item = next((item for item in MICROSERVICES_CATALOG if item["ms_id"] == ms_id), None)
    if not catalog_item:
        raise KeyError(ms_id)
    runtime = state_map.get(ms_id, {})
    enabled = bool(runtime.get("enabled", True))
    return {
        **catalog_item,
        "status": "online" if enabled else "offline",
        "enabled": enabled,
        "requests_count": int(runtime.get("requests_count", 0)),
        "errors_count": int(runtime.get("errors_count", 0)),
        "last_request_ts": float(runtime.get("last_request_ts", 0.0)),
    }


def get_all_microservices_status() -> dict:
    services = [get_microservice_info(item["ms_id"]) for item in MICROSERVICES_CATALOG]
    online_count = sum(1 for s in services if s["enabled"])
    return {
        "architecture": "Atomic Microservices with Bulkhead Fault Isolation",
        "total_services": len(services),
        "online_services": online_count,
        "degraded_services": len(services) - online_count,
        "microservices": services,
    }
