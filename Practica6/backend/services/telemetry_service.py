import json
import redis
from typing import Dict, Any
from repositories.telemetry_repository import TelemetryRepository
from models.schemas import SessionMetadata, SetupEntry, TelemetrySnapshot, WheelData

class TelemetryService:
    def __init__(self, repository: TelemetryRepository):
        self.repo = repository
        
        # Conexión al cerebro de estado distribuido
        self.redis = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        self.cursor_key = "lmu_playback_cursor"

    def get_session_info(self) -> SessionMetadata:
        raw_metadata = self.repo.get_session_metadata()
        return SessionMetadata(**raw_metadata)

    def get_car_setup(self) -> Dict[str, SetupEntry]:
        raw_setup_str = self.repo.get_car_setup()
        try:
            raw_setup_dict = json.loads(raw_setup_str)
        except json.JSONDecodeError:
            return {}

        setup_models = {}
        for key, val in raw_setup_dict.items():
            if isinstance(val, dict) and "key" in val:
                setup_models[key] = SetupEntry(**val)
        return setup_models

    def get_latest_telemetry(self) -> TelemetrySnapshot:
        # El cursor ahora representa SEGUNDOS TRANSCURRIDOS de la sesión
        current_time_sec = int(self.redis.get(self.cursor_key) or 0)

        # 1. Extractor para canales continuos (usa Hz para saltar a la fila correcta)
        def fetch_continuous(channel: str, frequency: int, default: float = 0.0):
            # Calculamos la fila exacta multiplicando segundos x hercios
            offset = current_time_sec * frequency
            data = self.repo.get_channel_data(channel, limit=1, offset=offset)
            return data[0][0] if data else default

        # 2. Extractor para las 4 ruedas
        def fetch_wheels(channel: str, frequency: int):
            offset = current_time_sec * frequency
            data = self.repo.get_channel_data(channel, limit=1, offset=offset)
            if data and len(data[0]) >= 4:
                return WheelData(fl=data[0][0], fr=data[0][1], rl=data[0][2], rr=data[0][3])
            return WheelData(fl=0.0, fr=0.0, rl=0.0, rr=0.0)

        # Construimos el DTO aplicando el Reloj Unificado a cada sensor
        snapshot = TelemetrySnapshot(
            rpm=fetch_continuous("Engine RPM", frequency=100),
            speed_kmh=fetch_continuous("Ground Speed", frequency=100),
            fuel_level_liters=fetch_continuous("Fuel Level", frequency=20),
            
            throttle_pos=fetch_continuous("Throttle Pos Unfiltered", frequency=50),
            brake_pos=fetch_continuous("Brake Pos Unfiltered", frequency=50),
            steering_angle=fetch_continuous("Steering Pos", frequency=100),
            
            tyre_temps_c=fetch_wheels("TyresTempCentre", frequency=100),
            brake_temps_c=fetch_wheels("Brakes Core Temp", frequency=50),
            tyre_wear_percent=fetch_wheels("Tyres Wear", frequency=10),
            
            # Los eventos usan el nuevo método que busca por la columna 'ts'
            gear=int(self.repo.get_event_data("Gear", current_time_sec)),
            current_lap_time=self.repo.get_event_data("Current LapTime", current_time_sec),
            best_lap_time=self.repo.get_event_data("Best LapTime", current_time_sec)
        )

        # Avanzamos el reloj 1 segundo para la siguiente petición de React
        self.redis.incr(self.cursor_key)
        
        return snapshot