import os
import json
import time
import fcntl
import threading
import urllib.request
import urllib.parse
import redis
from contextvars import ContextVar
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
DEFAULT_DB_NAME = "Sebring International Raceway_P_2026-10-18T21_03_43Z.duckdb"
SHARED_STATE_FILE = Path(os.getenv("CLUSTER_STATE_FILE", "/tmp/lmu_paddock_cluster_state.json"))

# Identificador del nodo actual (API Node o Data Node)
NODE_ID = os.getenv("NODE_ID", "api-node-1")
NODE_ROLE = os.getenv("NODE_ROLE", "api")  # "api" | "data"

# Tiempos de espera configurables (en la nube con poca CPU conviene aumentarlos)
DATA_NODE_TIMEOUT = float(os.getenv("DATA_NODE_TIMEOUT", "0.35"))
NODE_HEALTH_TIMEOUT = float(os.getenv("NODE_HEALTH_TIMEOUT", "0.25"))

# Identidad del nodo por petición. Permite que varios servidores (puertos distintos)
# convivan en un mismo proceso (modo nube) conservando cada uno su propio NODE_ID.
_current_node_id: ContextVar[str] = ContextVar("lmu_current_node_id", default=NODE_ID)


def get_node_id() -> str:
    """Devuelve el identificador del nodo que está atendiendo la petición actual."""
    return _current_node_id.get()


class NodeIdentityMiddleware:
    """
    Middleware ASGI puro que asigna la identidad del nodo (ej. 'api-node-2')
    durante todo el ciclo de vida de cada petición, incluyendo streams SSE.
    """

    def __init__(self, app, node_id: str):
        self.app = app
        self.node_id = node_id

    async def __call__(self, scope, receive, send):
        token = _current_node_id.set(self.node_id)
        try:
            await self.app(scope, receive, send)
        finally:
            _current_node_id.reset(token)

# Catálogo de Nodos de API y Nodos de Datos (.duckdb) configurable por variables de entorno (Local / Docker / Cloud)
DEFAULT_API_NODES = [
    {
        "node_id": "api-node-1",
        "role": "api",
        "url": os.getenv("API_NODE_1_URL", "http://localhost:8000"),
    },
    {
        "node_id": "api-node-2",
        "role": "api",
        "url": os.getenv("API_NODE_2_URL", "http://localhost:8001"),
    },
]

DEFAULT_DATA_NODES = [
    {
        "node_id": "data-node-1",
        "role": "data",
        "url": os.getenv("DATA_NODE_1_URL", "http://localhost:8011"),
    },
    {
        "node_id": "data-node-2",
        "role": "data",
        "url": os.getenv("DATA_NODE_2_URL", "http://localhost:8012"),
    },
]


class PlaybackStateStore:
    """
    Gestor de estado distribuido para la arquitectura Múltiples Clientes - Múltiples Servidores.
    Utiliza Redis si está disponible y, en caso contrario, emplea un almacén IPC compartido
    en disco (/tmp/lmu_paddock_cluster_state.json) protegido por bloqueo de archivo (fcntl)
    para que todos los procesos (API Nodes y Data Nodes) compartan relojes y clientes activos.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._redis: Optional[redis.Redis] = None
        self._use_redis = False
        self._rr_counter = 0
        self._init_redis()
        self._ensure_shared_file()

    def _init_redis(self):
        redis_host = os.getenv("REDIS_HOST", "localhost")
        redis_port = int(os.getenv("REDIS_PORT", "6379"))
        try:
            client = redis.Redis(
                host=redis_host,
                port=redis_port,
                db=0,
                decode_responses=True,
                socket_connect_timeout=0.4,
                socket_timeout=0.4,
            )
            client.ping()
            self._redis = client
            self._use_redis = True
        except Exception:
            self._redis = None
            self._use_redis = False

    def _default_state(self) -> Dict[str, Any]:
        return {
            "active_session": DEFAULT_DB_NAME,
            "custom_sessions": [],
            "sync_cursor": 15.0,
            "sync_last_wall_ts": 0.0,
            "sync_reset_ts": 0.0,
            "client_cursors": {},
            "clients": {},
        }

    def _ensure_shared_file(self):
        if not SHARED_STATE_FILE.exists():
            try:
                SHARED_STATE_FILE.write_text(json.dumps(self._default_state()))
            except Exception:
                pass

    def _read_shared_state(self) -> Dict[str, Any]:
        if self._use_redis and self._redis is not None:
            try:
                raw = self._redis.get("lmu_cluster_state_json")
                if raw:
                    return json.loads(raw)
                return self._default_state()
            except Exception:
                self._use_redis = False

        self._ensure_shared_file()
        try:
            with open(SHARED_STATE_FILE, "r+", encoding="utf-8") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    content = f.read().strip()
                    return json.loads(content) if content else self._default_state()
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            return self._default_state()

    def _update_shared_state(self, mutator_fn) -> Any:
        with self._lock:
            if self._use_redis and self._redis is not None:
                try:
                    raw = self._redis.get("lmu_cluster_state_json")
                    state = json.loads(raw) if raw else self._default_state()
                    result = mutator_fn(state)
                    self._redis.set("lmu_cluster_state_json", json.dumps(state))
                    return result
                except Exception:
                    self._use_redis = False

            self._ensure_shared_file()
            try:
                with open(SHARED_STATE_FILE, "r+", encoding="utf-8") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        content = f.read().strip()
                        state = json.loads(content) if content else self._default_state()
                    except Exception:
                        state = self._default_state()

                    result = mutator_fn(state)

                    f.seek(0)
                    f.truncate()
                    f.write(json.dumps(state))
                    f.flush()
                    fcntl.flock(f, fcntl.LOCK_UN)
                    return result
            except Exception:
                state = self._default_state()
                return mutator_fn(state)

    @property
    def backend_type(self) -> str:
        return "redis_cluster" if self._use_redis else "ipc_shared_store"

    def resolve_cursor(
        self,
        client_id: str = "default-client",
        mode: str = "sync",
        advance: bool = True,
        step_seconds: float = 0.2,
    ) -> float:
        """
        Obtiene y avanza el cursor de tiempo según el modo del cliente:
        - 'sync': Reloj Maestro compartido basado en tiempo real (wall-clock delta).
                  Aunque 10 clientes lean al mismo tiempo, el reloj avanza a 1.0x real.
        - 'independent': Cada client_id posee su propio cursor aislado.
        """
        now = time.time()
        normalized_mode = "independent" if mode == "independent" else "sync"

        def _mutate(state: Dict[str, Any]) -> float:
            if normalized_mode == "sync":
                cursor = float(state.get("sync_cursor", 15.0))
                last_ts = float(state.get("sync_last_wall_ts", 0.0))
                if advance:
                    if last_ts <= 0.0 or (now - last_ts) > 5.0:
                        delta = step_seconds
                    else:
                        delta = max(0.0, now - last_ts)
                    # Solo avanzamos si ha pasado al menos 40ms para evitar que múltiples clientes sumen doble
                    if delta >= 0.04 or last_ts <= 0.0:
                        cursor = round(cursor + delta, 3)
                        state["sync_cursor"] = cursor
                        state["sync_last_wall_ts"] = now
                return cursor
            else:
                client_cursors = state.setdefault("client_cursors", {})
                c_entry = client_cursors.get(client_id, {"cursor": 15.0, "last_ts": 0.0})
                cursor = float(c_entry.get("cursor", 15.0))
                if advance:
                    cursor = round(cursor + step_seconds, 3)
                    c_entry["cursor"] = cursor
                    c_entry["last_ts"] = now
                    client_cursors[client_id] = c_entry
                return cursor

        return self._update_shared_state(_mutate)

    def reset_cursor(self, client_id: str = "default-client", mode: str = "sync") -> float:
        """Reinicia el cursor global (si mode='sync') o solo el del cliente (si mode='independent')."""
        now = time.time()
        normalized_mode = "independent" if mode == "independent" else "sync"

        def _mutate(state: Dict[str, Any]) -> float:
            if normalized_mode == "sync":
                state["sync_cursor"] = 15.0
                state["sync_last_wall_ts"] = now
                state["sync_reset_ts"] = now
            else:
                client_cursors = state.setdefault("client_cursors", {})
                client_cursors[client_id] = {"cursor": 15.0, "last_ts": now}
            return 15.0

        return self._update_shared_state(_mutate)

    def register_client_activity(
        self,
        client_id: str,
        mode: str,
        cursor_s: float,
        api_node: str,
        data_node: str,
    ) -> int:
        """Registra el heartbeat de un cliente conectado y limpia clientes inactivos (> 6s)."""
        now = time.time()

        def _mutate(state: Dict[str, Any]) -> int:
            clients = state.setdefault("clients", {})
            # Purgamos clientes desconectados hace más de 6 segundos
            expired = [cid for cid, info in clients.items() if (now - float(info.get("last_seen", 0))) > 6.0]
            for cid in expired:
                clients.pop(cid, None)

            clients[client_id] = {
                "client_id": client_id,
                "mode": "independent" if mode == "independent" else "sync",
                "cursor_s": round(cursor_s, 2),
                "api_node": api_node,
                "data_node": data_node,
                "last_seen": now,
            }
            return len(clients)

        return self._update_shared_state(_mutate)

    def get_cluster_snapshot(self) -> Dict[str, Any]:
        """Devuelve el estado actual del clúster y clientes activos."""
        now = time.time()

        def _mutate(state: Dict[str, Any]) -> Dict[str, Any]:
            clients = state.setdefault("clients", {})
            expired = [cid for cid, info in clients.items() if (now - float(info.get("last_seen", 0))) > 6.0]
            for cid in expired:
                clients.pop(cid, None)
            return json.loads(json.dumps(state))

        return self._update_shared_state(_mutate)

    def get_active_session_name(self) -> str:
        state = self._read_shared_state()
        return str(state.get("active_session", DEFAULT_DB_NAME))

    def get_custom_sessions(self) -> List[str]:
        state = self._read_shared_state()
        raw = state.get("custom_sessions", [])
        return [str(x) for x in raw] if isinstance(raw, list) else []

    def register_custom_session_name(self, filename: str, activate: bool = True) -> None:
        now = time.time()

        def _mutate(state: Dict[str, Any]):
            custom = state.setdefault("custom_sessions", [])
            if filename not in custom:
                custom.append(filename)
            if activate:
                state["active_session"] = filename
                state["sync_cursor"] = 15.0
                state["sync_last_wall_ts"] = now
                state["sync_reset_ts"] = now
                state["client_cursors"] = {}

        self._update_shared_state(_mutate)

    def set_active_session_name(self, filename: str) -> None:
        now = time.time()

        def _mutate(state: Dict[str, Any]):
            state["active_session"] = filename
            state["sync_cursor"] = 15.0
            state["sync_last_wall_ts"] = now
            state["sync_reset_ts"] = now
            state["client_cursors"] = {}

        self._update_shared_state(_mutate)

    def next_data_node_order(self) -> List[Dict[str, str]]:
        """Devuelve la lista de Nodos de Datos (.duckdb) rotada en Round-Robin para balancear carga."""
        with self._lock:
            idx = self._rr_counter % len(DEFAULT_DATA_NODES)
            self._rr_counter += 1
        return DEFAULT_DATA_NODES[idx:] + DEFAULT_DATA_NODES[:idx]


# Instancia singleton compartida
state_store = PlaybackStateStore()


def list_available_sessions() -> List[str]:
    """Devuelve la lista de archivos .duckdb disponibles en backend/data/ y sesiones registradas por clientes."""
    disk_files = [f.name for f in DATA_DIR.glob("*.duckdb")] if DATA_DIR.exists() else []
    custom_files = state_store.get_custom_sessions()
    return sorted(set(disk_files + custom_files))


def get_active_db_path() -> Path:
    """Obtiene la ruta al archivo DuckDB activo para la sesión actual."""
    active_name = state_store.get_active_session_name()
    candidate = DATA_DIR / active_name
    if candidate.exists():
        return candidate

    # Si es una sesión cargada en memoria por el cliente (DuckDB-Wasm), mantenemos su nombre lógico
    if active_name in state_store.get_custom_sessions():
        return DATA_DIR / active_name

    disk_files = sorted([f.name for f in DATA_DIR.glob("*.duckdb")]) if DATA_DIR.exists() else []
    if disk_files:
        return DATA_DIR / disk_files[0]
    return DATA_DIR / DEFAULT_DB_NAME


def set_active_session(filename: str) -> Path:
    """Cambia el archivo DuckDB activo y reinicia los cursores de reproducción."""
    candidate = DATA_DIR / filename
    available = set(list_available_sessions())
    if not candidate.exists() and filename not in available:
        raise FileNotFoundError(f"El archivo de sesión '{filename}' no existe en data/ ni en sesiones registradas.")
    state_store.set_active_session_name(filename)
    return candidate


def fetch_from_data_nodes(
    endpoint_path: str,
    params: Optional[Dict[str, Any]] = None,
    preferred_data_node: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Cliente HTTP distribuido: Consulta los Servidores de Recursos DuckDB (Data Nodes)
    con balanceo de carga Round-Robin (o nodo preferido) y Failover automático.
    Devuelve (payload_dict, data_node_id) o (None, 'local-duckdb-fallback') si ningún Data Node remoto responde.
    """
    ordered_nodes = state_store.next_data_node_order()
    if preferred_data_node and preferred_data_node != "auto":
        preferred = [n for n in ordered_nodes if n["node_id"] == preferred_data_node]
        others = [n for n in ordered_nodes if n["node_id"] != preferred_data_node]
        ordered_nodes = preferred + others

    # En modo Cloud de proceso único (Render), evitamos sockets TCP extra y rotamos el identificador de Data Node
    if os.getenv("SINGLE_PROCESS_CLUSTER", "0") == "1":
        chosen_id = ordered_nodes[0]["node_id"] if ordered_nodes else "data-node-1"
        return None, chosen_id

    query_str = f"?{urllib.parse.urlencode(params)}" if params else ""

    for node in ordered_nodes:
        url = f"{node['url']}{endpoint_path}{query_str}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=DATA_NODE_TIMEOUT) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return data, node["node_id"]
        except Exception:
            continue

    return None, "local-duckdb-fallback"


def check_node_health(url: str) -> bool:
    """Verifica rápidamente si un servidor (API Node o Data Node) está en línea."""
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=NODE_HEALTH_TIMEOUT) as resp:
            return resp.status == 200
    except Exception:
        return False
