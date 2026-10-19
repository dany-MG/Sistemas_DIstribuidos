from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, List, Optional, Any

class WheelData(BaseModel):
    fl: float
    fr: float
    rl: float
    rr: float

class SetupEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    key: str = Field(default="Unknown")
    value: Any = Field(default=None)
    
    string_value: Optional[str] = Field(default=None, alias="stringValue")
    last_saved: Optional[str] = Field(default=None, alias="lastSavedStringValue")
    
    available: bool = Field(default=False)
    is_free_setting: Optional[bool] = Field(default=None, alias="isFreeSetting")

class SessionMetadata(BaseModel):
    driver_name: str = Field(alias="DriverName")
    track_name: str = Field(alias="TrackName")
    weather: str = Field(alias="WeatherConditions")
    car_name: str = Field(alias="CarName")
    car_class: str = Field(alias="CarClass")
    recording_time: str = Field(alias="RecordingTime")

class TelemetrySnapshot(BaseModel):
    """
    Representa una 'fotografía' de un instante de la telemetría 
    para enviarla al frontend de React.
    """
    # Motor y Transmisión
    rpm: float
    gear: int
    speed_kmh: float
    fuel_level_liters: float
    
    # Entradas del Piloto
    throttle_pos: float
    brake_pos: float
    steering_angle: float
    
    # Temperaturas y Desgaste (Usando nuestro modelo de 4 ruedas)
    tyre_temps_c: WheelData
    brake_temps_c: WheelData
    tyre_wear_percent: WheelData
    
    # Tiempos
    current_lap_time: float
    best_lap_time: float

class DashboardResponse(BaseModel):
    """
    El contenedor principal (Payload) que nuestra API REST devolverá al cliente HTTP
    """
    session: SessionMetadata
    setup: Dict[str, SetupEntry]
    current_telemetry: TelemetrySnapshot

