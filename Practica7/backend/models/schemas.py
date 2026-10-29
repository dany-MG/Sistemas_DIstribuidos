from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, List, Optional, Any

class WheelData(BaseModel):
    fl: float
    fr: float
    rl: float
    rr: float

class GPSPoint(BaseModel):
    lat: float
    lon: float

class SetupEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    key: str = Field(default="Unknown")
    caption: Optional[str] = Field(default=None)
    value: Any = Field(default=None)
    string_value: Optional[str] = Field(default=None, validation_alias="stringValue")
    last_saved: Optional[str] = Field(default=None, validation_alias="lastSavedStringValue")
    min_value: Optional[Any] = Field(default=None, validation_alias="minValue")
    max_value: Optional[Any] = Field(default=None, validation_alias="maxValue")
    available: bool = Field(default=False)
    is_free_setting: Optional[bool] = Field(default=None, validation_alias="isFreeSetting")

class SessionMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    
    driver_name: str = Field(default="Piloto Local", validation_alias="DriverName")
    track_name: str = Field(default="Circuito Desconocido", validation_alias="TrackName")
    track_layout: str = Field(default="", validation_alias="TrackLayout")
    session_type: str = Field(default="Practice", validation_alias="SessionType")
    session_time: str = Field(default="", validation_alias="SessionTime")
    weather: str = Field(default="Clear", validation_alias="WeatherConditions")
    car_name: str = Field(default="Vehículo Genérico", validation_alias="CarName")
    car_class: str = Field(default="LMH/LMDh", validation_alias="CarClass")
    car_brand: str = Field(default="Porsche")
    recording_time: str = Field(default="", validation_alias="RecordingTime")

class TelemetrySnapshot(BaseModel):
    # Metadatos de Clúster Distribuido (MC-MS)
    api_node_id: str = "api-node-1"
    data_node_id: str = "data-node-1"
    playback_mode: str = "sync"
    active_clients_count: int = 1

    # Tiempo de sesión sincronizado o independiente
    session_time_s: float = 0.0

    # Motor, Transmisión y Energía
    rpm: float
    max_rpm: float = 9500.0
    gear: int
    speed_kmh: float
    fuel_level_liters: float
    virtual_energy_pct: float = 0.0
    water_temp_c: float = 0.0
    oil_temp_c: float = 0.0
    
    # Inputs del Piloto y Fuerzas G
    throttle_pos: float
    brake_pos: float
    steering_pos: float  # Nombre corregido según config.json (-100 a 100 o -1 a 1)
    g_force_lat: float = 0.0
    g_force_long: float = 0.0
    
    # Electrónica y Ayudas de Conducción
    tc_active: bool = False
    tc_level: int = 0
    abs_active: bool = False
    abs_level: int = 0
    brake_bias_rear: float = 50.0

    # Posición GPS y Estado en Pista
    gps_lat: float
    gps_lon: float
    in_pits: bool = False
    yellow_flag: int = 0
    track_temp_c: float = 0.0
    ambient_temp_c: float = 0.0
    
    # Neumáticos y Frenos (4 ruedas: FL, FR, RL, RR)
    tyre_temps_c: WheelData
    brake_temps_c: WheelData
    tyre_wear_percent: WheelData
    tyre_pressures_kpa: WheelData = Field(default_factory=lambda: WheelData(fl=0.0, fr=0.0, rl=0.0, rr=0.0))
    tyre_compound: str = "Medium"

    # Tiempos y Vueltas
    current_lap: int = 0
    current_lap_time: float
    best_lap_time: float
    last_lap_time: float
    
    # Sectores (Histórico de la mejor vuelta)
    best_sector_1: float
    best_sector_2: float
    
    # Sectores (Última vuelta completada)
    last_sector_1: float
    last_sector_2: float
    
    # Sector actual (en qué parte de la pista estamos: 1, 2 o 3)
    current_sector: int

class ClusterNodeInfo(BaseModel):
    node_id: str
    role: str  # "api" | "data"
    url: str
    status: str = "online"

class ConnectedClientInfo(BaseModel):
    client_id: str
    mode: str  # "sync" | "independent"
    cursor_s: float
    api_node: str
    data_node: str
    last_seen_ago_s: float

class ClusterStatusResponse(BaseModel):
    api_node_id: str
    state_backend: str
    active_session: str
    sync_cursor_s: float
    api_nodes: List[ClusterNodeInfo] = Field(default_factory=list)
    data_nodes: List[ClusterNodeInfo] = Field(default_factory=list)
    connected_clients: List[ConnectedClientInfo] = Field(default_factory=list)

class DashboardResponse(BaseModel):
    session: SessionMetadata
    setup: Dict[str, SetupEntry]
    current_telemetry: TelemetrySnapshot
    available_sessions: List[str] = Field(default_factory=list)
    active_session_file: str = ""
    cluster: Optional[ClusterStatusResponse] = None
