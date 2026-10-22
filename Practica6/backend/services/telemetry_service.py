import json
import time
from typing import Dict, List, Optional
from database.connection import (
    NODE_ID,
    DEFAULT_API_NODES,
    DEFAULT_DATA_NODES,
    state_store,
    fetch_from_data_nodes,
    check_node_health,
    get_active_db_path,
)
from repositories.telemetry_repository import TelemetryRepository
from models.schemas import (
    SessionMetadata,
    SetupEntry,
    TelemetrySnapshot,
    WheelData,
    GPSPoint,
    ClusterStatusResponse,
    ClusterNodeInfo,
    ConnectedClientInfo,
)

COMPOUND_MAP = {
    0: "Medium",
    1: "Soft",
    2: "Hard",
    3: "Wet",
}

_LOCAL_FREQ_CACHE: Dict[str, Dict[str, int]] = {}

# Reglas de detección de fabricante por nombre directo o por escudería oficial WEC/ELMS en LMU
BRAND_RULES = [
    ("porsche", "Porsche"),
    ("proton", "Porsche"),
    ("manthey", "Porsche"),
    ("penske", "Porsche"),
    ("jota", "Porsche"),
    ("iron dames", "Porsche"),
    ("ferrari", "Ferrari"),
    ("af corse", "Ferrari"),
    ("vista", "Ferrari"),
    ("bmw", "BMW"),
    ("wrt", "BMW"),
    ("corvette", "Corvette"),
    ("tf sport", "Corvette"),
    ("mclaren", "McLaren"),
    ("united autosports", "McLaren"),
    ("aston", "Aston Martin"),
    ("heart of racing", "Aston Martin"),
    ("d'station", "Aston Martin"),
    ("lamborghini", "Lamborghini"),
    ("iron lynx", "Lamborghini"),
    ("toyota", "Toyota"),
    ("gazoo", "Toyota"),
    ("cadillac", "Cadillac"),
    ("ganassi", "Cadillac"),
    ("action express", "Cadillac"),
    ("peugeot", "Peugeot"),
    ("alpine", "Alpine"),
    ("signatech", "Alpine"),
    ("ford", "Ford"),
    ("mustang", "Ford"),
    ("mercedes", "Mercedes-AMG"),
    ("amg", "Mercedes-AMG"),
    ("genesis", "Genesis"),
    ("lexus", "Lexus"),
    ("akkodis", "Lexus"),
    ("lmp2", "LMP2"),
    ("oreca", "LMP2"),
]


def detect_car_brand(car_name: str, car_class: str = "") -> str:
    """
    Detecta la marca del vehículo a partir del nombre del equipo/auto (CarName) y su clase.
    Ejemplo: 'Proton Competition 2026 #75:ELMS' -> 'Porsche'
    """
    haystack = f"{car_name or ''} {car_class or ''}".lower()
    for keyword, brand in BRAND_RULES:
        if keyword in haystack:
            return brand
    return "Porsche"


class TelemetryService:
    def __init__(self, repository: Optional[TelemetryRepository] = None):
        self._repo = repository
        self.state = state_store
        self.last_data_node_id = "data-node-1"

    def _get_fallback_repo(self) -> TelemetryRepository:
        if self._repo is None:
            self._repo = TelemetryRepository(db_path=str(get_active_db_path()))
        return self._repo

    def close(self):
        if self._repo is not None:
            self._repo.close()
            self._repo = None

    def get_session_info(self) -> SessionMetadata:
        remote_payload, node_id = fetch_from_data_nodes("/data/v1/metadata")
        if remote_payload and "metadata" in remote_payload:
            self.last_data_node_id = node_id
            raw_metadata = remote_payload["metadata"]
        else:
            raw_metadata = self._get_fallback_repo().get_session_metadata()

        meta = SessionMetadata(**raw_metadata)
        meta.car_brand = detect_car_brand(meta.car_name, meta.car_class)
        return meta

    def get_car_setup(self) -> Dict[str, SetupEntry]:
        remote_payload, node_id = fetch_from_data_nodes("/data/v1/setup")
        if remote_payload and "setup_json" in remote_payload:
            self.last_data_node_id = node_id
            raw_setup_str = remote_payload["setup_json"]
        else:
            raw_setup_str = self._get_fallback_repo().get_car_setup()

        try:
            raw_setup_dict = json.loads(raw_setup_str)
        except json.JSONDecodeError:
            return {}

        setup_models = {}
        for key, val in raw_setup_dict.items():
            if isinstance(val, dict) and "key" in val:
                setup_models[key] = SetupEntry(**val)
        return setup_models

    def get_track_map(self) -> List[GPSPoint]:
        """Devuelve la lista de coordenadas para dibujar el circuito en el frontend."""
        remote_payload, node_id = fetch_from_data_nodes("/data/v1/track-map", params={"step": 5})
        if remote_payload and "coordinates" in remote_payload:
            self.last_data_node_id = node_id
            coords = remote_payload["coordinates"]
        else:
            coords = self._get_fallback_repo().get_track_map_coordinates(step=5)
        return [GPSPoint(lat=float(lat), lon=float(lon)) for lat, lon in coords]

    def reset_playback(self, client_id: str = "default-client", mode: str = "sync") -> float:
        """Reinicia el cursor de reproducción (sincronizado o independiente del cliente) a 0.0s."""
        return self.state.reset_cursor(client_id=client_id, mode=mode)

    def get_cluster_status(self) -> ClusterStatusResponse:
        """Construye el reporte de topología MC-MS (Nodos API, Nodos DuckDB y Clientes Conectados)."""
        cluster_state = self.state.get_cluster_snapshot()
        now = time.time()

        clients_raw = cluster_state.get("clients", {})
        active_api_nodes = {
            str(info.get("api_node"))
            for info in clients_raw.values()
            if (now - float(info.get("last_seen", 0))) < 5.0
        }

        api_nodes_info = [
            ClusterNodeInfo(
                node_id=n["node_id"],
                role="api",
                url=n["url"],
                status="online"
                if (
                    n["node_id"] == NODE_ID
                    or n["node_id"] in active_api_nodes
                    or check_node_health(f"{n['url']}/api/v1/health")
                )
                else "offline",
            )
            for n in DEFAULT_API_NODES
        ]

        data_nodes_info = [
            ClusterNodeInfo(
                node_id=n["node_id"],
                role="data",
                url=n["url"],
                status="online" if check_node_health(f"{n['url']}/data/v1/health") else "offline",
            )
            for n in DEFAULT_DATA_NODES
        ]
        connected_clients = [
            ConnectedClientInfo(
                client_id=str(info.get("client_id", cid)),
                mode=str(info.get("mode", "sync")),
                cursor_s=float(info.get("cursor_s", 0.0)),
                api_node=str(info.get("api_node", NODE_ID)),
                data_node=str(info.get("data_node", self.last_data_node_id)),
                last_seen_ago_s=round(max(0.0, now - float(info.get("last_seen", now))), 1),
            )
            for cid, info in clients_raw.items()
        ]

        return ClusterStatusResponse(
            api_node_id=NODE_ID,
            state_backend=self.state.backend_type,
            active_session=str(cluster_state.get("active_session", "")),
            sync_cursor_s=round(float(cluster_state.get("sync_cursor", 0.0)), 2),
            api_nodes=api_nodes_info,
            data_nodes=data_nodes_info,
            connected_clients=connected_clients,
        )

    def get_latest_telemetry(
        self,
        client_id: str = "default-client",
        mode: str = "sync",
        advance_cursor: bool = True,
        step_seconds: float = 0.2,
        preferred_data_node: Optional[str] = None,
    ) -> TelemetrySnapshot:
        normalized_mode = "independent" if mode == "independent" else "sync"
        current_time_sec = self.state.resolve_cursor(
            client_id=client_id,
            mode=normalized_mode,
            advance=advance_cursor,
            step_seconds=step_seconds,
        )

        # 1. Consultamos al clúster de Servidores de Recursos DuckDB (Data Nodes)
        bundle, data_node_id = fetch_from_data_nodes(
            "/data/v1/snapshot-bundle",
            params={"time_sec": round(current_time_sec, 3)},
            preferred_data_node=preferred_data_node,
        )

        # 2. Fallback local si los Data Nodes dedicados no están levantados
        if bundle is None:
            repo = self._get_fallback_repo()
            if repo.db_path not in _LOCAL_FREQ_CACHE:
                _LOCAL_FREQ_CACHE[repo.db_path] = repo.get_channel_frequencies()
            bundle = repo.get_snapshot_raw_bundle(
                current_time_sec=current_time_sec,
                frequencies=_LOCAL_FREQ_CACHE[repo.db_path],
            )
            data_node_id = "local-duckdb-fallback"

        self.last_data_node_id = data_node_id

        if bundle.get("end_of_session"):
            self.state.reset_cursor(client_id=client_id, mode=normalized_mode)
            current_time_sec = 0.0

        effective_time_sec = float(bundle.get("effective_time_sec", current_time_sec))
        session_gps_time = float(bundle.get("session_gps_time", effective_time_sec))
        lap_start_ts = float(bundle.get("lap_start_ts", 0.0))
        current_lap = int(bundle.get("current_lap", 0))
        compound_idx = int(bundle.get("compound_idx", 0))

        cont = bundle.get("continuous", {})
        wheels = bundle.get("wheels", {})
        ev = bundle.get("events", {})

        # Cronómetro en vivo desde el inicio de la vuelta actual
        if lap_start_ts > 0 and session_gps_time >= lap_start_ts:
            live_lap_time = session_gps_time - lap_start_ts
        else:
            live_lap_time = float(ev.get("current_lap_time_event", 0.0))

        # En LMU Current Sector codifica: 1 = S1, 2 = S2, 0 = S3
        raw_sector = int(ev.get("raw_sector", 1))
        normalized_sector = 3 if raw_sector == 0 else raw_sector

        tyre_compound = COMPOUND_MAP.get(compound_idx, f"Spec-{compound_idx}")

        raw_bb = float(ev.get("brake_bias_rear", 0.5))
        brake_bias_rear = raw_bb * 100.0 if raw_bb <= 1.0 else raw_bb

        active_clients_count = self.state.register_client_activity(
            client_id=client_id,
            mode=normalized_mode,
            cursor_s=effective_time_sec,
            api_node=NODE_ID,
            data_node=data_node_id,
        )

        return TelemetrySnapshot(
            api_node_id=NODE_ID,
            data_node_id=data_node_id,
            playback_mode=normalized_mode,
            active_clients_count=active_clients_count,
            session_time_s=round(effective_time_sec, 2),
            rpm=float(cont.get("rpm", 0.0)),
            max_rpm=float(ev.get("max_rpm", 9500.0)),
            speed_kmh=float(cont.get("speed_kmh", 0.0)),
            fuel_level_liters=float(cont.get("fuel_level_liters", 0.0)),
            virtual_energy_pct=float(cont.get("virtual_energy_pct", 0.0)),
            water_temp_c=float(cont.get("water_temp_c", 0.0)),
            oil_temp_c=float(cont.get("oil_temp_c", 0.0)),
            throttle_pos=float(cont.get("throttle_pos", 0.0)),
            brake_pos=float(cont.get("brake_pos", 0.0)),
            steering_pos=float(cont.get("steering_pos", 0.0)),
            g_force_lat=float(cont.get("g_force_lat", 0.0)),
            g_force_long=float(cont.get("g_force_long", 0.0)),
            tc_active=bool(cont.get("tc_active", False)),
            tc_level=int(ev.get("tc_level", 0)),
            abs_active=bool(ev.get("abs_active", False)),
            abs_level=int(ev.get("abs_level", 0)),
            brake_bias_rear=round(brake_bias_rear, 1),
            gps_lat=float(cont.get("gps_lat", 0.0)),
            gps_lon=float(cont.get("gps_lon", 0.0)),
            in_pits=bool(ev.get("in_pits", False)),
            yellow_flag=int(ev.get("yellow_flag", 0)),
            track_temp_c=float(cont.get("track_temp_c", 0.0)),
            ambient_temp_c=float(cont.get("ambient_temp_c", 0.0)),
            tyre_temps_c=WheelData(**wheels.get("tyre_temps_c", {"fl": 0, "fr": 0, "rl": 0, "rr": 0})),
            brake_temps_c=WheelData(**wheels.get("brake_temps_c", {"fl": 0, "fr": 0, "rl": 0, "rr": 0})),
            tyre_wear_percent=WheelData(**wheels.get("tyre_wear_percent", {"fl": 0, "fr": 0, "rl": 0, "rr": 0})),
            tyre_pressures_kpa=WheelData(**wheels.get("tyre_pressures_kpa", {"fl": 0, "fr": 0, "rl": 0, "rr": 0})),
            tyre_compound=tyre_compound,
            gear=int(ev.get("gear", 0)),
            current_lap=current_lap,
            current_lap_time=round(live_lap_time, 3),
            best_lap_time=float(ev.get("best_lap_time", 0.0)),
            last_lap_time=float(ev.get("last_lap_time", 0.0)),
            best_sector_1=float(ev.get("best_sector_1", 0.0)),
            best_sector_2=float(ev.get("best_sector_2", 0.0)),
            last_sector_1=float(ev.get("last_sector_1", 0.0)),
            last_sector_2=float(ev.get("last_sector_2", 0.0)),
            current_sector=normalized_sector,
        )
