import duckdb
from typing import List, Dict, Any, Tuple

class TelemetryRepository:
    """
    Repositorio encargado EXCLUSIVAMENTE de comunicarse con DuckDB.
    Ningún otro archivo del backend importará 'duckdb' excepto este.
    """
    
    def __init__(self, db_path: str):
        self.db_path = str(db_path)
        # Conexión de solo lectura, ideal para análisis de telemetría sin bloquear el archivo
        # y permitiendo que Múltiples Servidores de Datos lean el archivo .duckdb concurrentemente
        self._conn = duckdb.connect(database=self.db_path, read_only=True)
        
        # Descubrimos dinámicamente las tablas y el prefijo que LMU le asignó a esta sesión
        self._available_tables = self._discover_available_tables()
        self.table_prefix = self._discover_table_prefix()

    def _discover_available_tables(self) -> set:
        try:
            rows = self._conn.execute("SELECT table_name FROM information_schema.tables").fetchall()
            return {r[0] for r in rows}
        except duckdb.Error:
            return set()

    def _discover_table_prefix(self) -> str:
        """
        Busca en el esquema de la base de datos para encontrar el prefijo 
        dinámico que LMU le asignó a las tablas en esta sesión.
        """
        for tname in self._available_tables:
            if tname.lower().endswith("metadata"):
                return tname[:-len("metadata")]
        return ""

    def _resolve_channel_name(self, candidates: List[str]) -> str:
        for cand in candidates:
            if f"{self.table_prefix}{cand}" in self._available_tables:
                return cand
        return candidates[0]

    def get_session_metadata(self) -> Dict[str, Any]:
        """
        Extrae la tabla de metadatos (clave-valor) y la convierte en un diccionario de Python.
        """
        table_name = f'"{self.table_prefix}metadata"'
        query = f"SELECT key, value FROM {table_name}"
        
        try:
            results = self._conn.execute(query).fetchall()
            # Convertimos la lista de tuplas [('DriverName', 'Alejandro Manrique'), ...] a dict
            return {key: value for key, value in results}
        except duckdb.Error as e:
            print(f"[Repository Error] No se pudo leer metadata: {e}")
            return {}

    def get_car_setup(self) -> str:
        """
        Extrae el JSON crudo del CarSetup almacenado en la tabla de metadata.
        """
        table_name = f'"{self.table_prefix}metadata"'
        query = f"SELECT value FROM {table_name} WHERE key = 'CarSetup'"
        
        try:
            result = self._conn.execute(query).fetchone()
            return result[0] if result else "{}"
        except duckdb.Error as e:
            print(f"[Repository Error] No se pudo leer CarSetup: {e}")
            return "{}"

    def get_channel_data(self, channel_name: str, limit: int = 1, offset: int = 0) -> list[tuple]:
        """
        Consulta genérica para extraer datos de un canal específico.
        Utiliza OFFSET para simular la reproducción secuencial del tiempo.
        """
        table_name = f'"{self.table_prefix}{channel_name}"'
        
        # Leemos en orden ascendente (cronológico) aplicando el cursor
        query = f"SELECT * FROM {table_name} ORDER BY rowid ASC LIMIT {limit} OFFSET {offset}"
        
        try:
            return self._conn.execute(query).fetchall()
        except duckdb.Error as e:
            print(f"[Repository Error] Canal '{channel_name}' no encontrado: {e}")
            return []
        
    
    def get_event_data(self, event_name: str, current_time_seconds: float, default: Any = 0.0) -> Any:
        """
        Consulta tablas de eventos. Busca el último evento que haya 
        ocurrido antes o en el segundo actual de la simulación.
        """
        table_name = f'"{self.table_prefix}{event_name}"'
        # Buscamos el evento más reciente según el tiempo de la simulación (precisión float)
        query = f"SELECT value FROM {table_name} WHERE ts <= {float(current_time_seconds)} ORDER BY ts DESC LIMIT 1"
        
        try:
            result = self._conn.execute(query).fetchone()
            return result[0] if result is not None else default
        except duckdb.Error:
            return default

    def get_event_row(self, event_name: str, current_time_seconds: float) -> tuple:
        """
        Consulta la fila completa del último evento ocurrido antes o en el segundo actual
        (útil para eventos multi-columna como TyresCompound).
        """
        table_name = f'"{self.table_prefix}{event_name}"'
        query = f"SELECT * FROM {table_name} WHERE ts <= {float(current_time_seconds)} ORDER BY ts DESC LIMIT 1"
        try:
            result = self._conn.execute(query).fetchone()
            return result if result is not None else ()
        except duckdb.Error:
            return ()

    def get_latest_lap_event(self, current_time_seconds: float) -> Tuple[float, int]:
        """
        Obtiene el timestamp (ts) de inicio y el número de la vuelta actual
        en función del tiempo real de simulación (GPS Time).
        """
        table_name = f'"{self.table_prefix}Lap"'
        query = f"SELECT ts, value FROM {table_name} WHERE ts <= {float(current_time_seconds)} ORDER BY ts DESC LIMIT 1"
        try:
            result = self._conn.execute(query).fetchone()
            if result:
                return float(result[0]), int(result[1])
            return 0.0, 0
        except duckdb.Error:
            return 0.0, 0
    
    def get_channel_frequencies(self) -> Dict[str, int]:
        """
        Lee la tabla channelsList generada por el config.json de LMU
        para obtener la frecuencia real de cada canal dinámicamente.
        """
        table_name = f'"{self.table_prefix}channelsList"'
        query = f"SELECT channelName, frequency FROM {table_name}"
        try:
            results = self._conn.execute(query).fetchall()
            return {name: int(freq) for name, freq in results}
        except duckdb.Error as e:
            print(f"[Repository Error] No se pudo leer channelsList: {e}")
            return {}

    def get_track_map_coordinates(self, step: int = 5) -> List[tuple]:
        """
         Une las tablas de Latitud y Longitud por su índice de fila (rowid)
        para reconstruir el trazado del circuito. Aplica downsampling (step)
        para optimizar el payload de red.
        """
        lat_table = f'"{self.table_prefix}GPS Latitude"'
        lon_table = f'"{self.table_prefix}GPS Longitude"'
        
        # Filtramos valores en 0 (cuando el auto está cargando en el garaje sin señal GPS)
        query = f"""
            SELECT lat.value, lon.value 
            FROM {lat_table} lat
            JOIN {lon_table} lon ON lat.rowid = lon.rowid
            WHERE lat.value != 0 AND lon.value != 0
            AND lat.rowid % {step} = 0
            ORDER BY lat.rowid ASC
            LIMIT 2500
        """
        try:
            return self._conn.execute(query).fetchall()
        except duckdb.Error as e:
            print(f"[Repository Error] Error extrayendo mapa GPS: {e}")
            return []

    def get_snapshot_raw_bundle(self, current_time_sec: float, frequencies: Dict[str, int]) -> Dict[str, Any]:
        """
        Extrae en lote todos los canales continuos y eventos de un instante de tiempo
        desde el archivo .duckdb. Diseñado para los Servidores de Recursos DuckDB (Data Nodes).
        """
        rpm_freq = frequencies.get("Engine RPM", 100)
        check_offset = int(round(current_time_sec * rpm_freq))
        check_data = self.get_channel_data("Engine RPM", limit=1, offset=check_offset)
        end_of_session = not bool(check_data) and current_time_sec > 0
        if end_of_session:
            current_time_sec = 0.0

        def read_scalar(channel: str, default_freq: int, default_val: Any = 0.0):
            freq = frequencies.get(channel, default_freq)
            offset = int(round(current_time_sec * freq))
            rows = self.get_channel_data(channel, limit=1, offset=offset)
            return rows[0][0] if rows else default_val

        def read_wheels(channel: str, default_freq: int) -> Dict[str, float]:
            freq = frequencies.get(channel, default_freq)
            offset = int(round(current_time_sec * freq))
            rows = self.get_channel_data(channel, limit=1, offset=offset)
            if rows and len(rows[0]) >= 4:
                return {
                    "fl": float(rows[0][0]),
                    "fr": float(rows[0][1]),
                    "rl": float(rows[0][2]),
                    "rr": float(rows[0][3]),
                }
            return {"fl": 0.0, "fr": 0.0, "rl": 0.0, "rr": 0.0}

        session_gps_time = float(read_scalar("GPS Time", 100, current_time_sec))
        lap_start_ts, current_lap = self.get_latest_lap_event(session_gps_time)
        compound_row = self.get_event_row("TyresCompound", session_gps_time)
        compound_idx = int(compound_row[1]) if len(compound_row) >= 2 else 0

        return {
            "end_of_session": end_of_session,
            "effective_time_sec": round(current_time_sec, 3),
            "session_gps_time": session_gps_time,
            "lap_start_ts": lap_start_ts,
            "current_lap": current_lap,
            "compound_idx": compound_idx,
            "continuous": {
                "rpm": float(read_scalar("Engine RPM", 100)),
                "speed_kmh": float(read_scalar("Ground Speed", 100)),
                "fuel_level_liters": float(read_scalar("Fuel Level", 20)),
                "virtual_energy_pct": float(read_scalar("Virtual Energy", 20)),
                "water_temp_c": float(read_scalar("Engine Water Temp", 7)),
                "oil_temp_c": float(read_scalar("Engine Oil Temp", 7)),
                "throttle_pos": float(read_scalar("Throttle Pos Unfiltered", 50)),
                "brake_pos": float(read_scalar("Brake Pos Unfiltered", 50)),
                "steering_pos": float(read_scalar("Steering Pos", 100)),
                "g_force_lat": float(read_scalar("G Force Lat", 10)),
                "g_force_long": float(read_scalar("G Force Long", 10)),
                "tc_active": bool(read_scalar("TC", 100, False)),
                "gps_lat": float(read_scalar("GPS Latitude", 10)),
                "gps_lon": float(read_scalar("GPS Longitude", 10)),
                "track_temp_c": float(read_scalar("Track Temperature", 1)),
                "ambient_temp_c": float(read_scalar("Ambient Temperature", 1)),
            },
            "wheels": {
                "tyre_temps_c": read_wheels("TyresTempCentre", 100),
                "brake_temps_c": read_wheels("Brakes Temp", 50),
                "tyre_wear_percent": read_wheels("Tyres Wear", 10),
                "tyre_pressures_kpa": read_wheels("TyresPressure", 10),
            },
            "events": {
                "max_rpm": float(self.get_event_data("Engine Max RPM", session_gps_time, 9500.0)),
                "tc_level": int(self.get_event_data("TCLevel", session_gps_time, 0)),
                "abs_active": bool(self.get_event_data("ABS", session_gps_time, False)),
                "abs_level": int(self.get_event_data("ABSLevel", session_gps_time, 0)),
                "brake_bias_rear": float(self.get_event_data("Brake Bias Rear", session_gps_time, 0.5)),
                "in_pits": bool(self.get_event_data("In Pits", session_gps_time, 0)),
                "yellow_flag": int(self.get_event_data("Yellow Flag State", session_gps_time, 0)),
                "gear": int(self.get_event_data("Gear", session_gps_time, 0)),
                "current_lap_time_event": float(self.get_event_data("Current LapTime", session_gps_time, 0.0)),
                "best_lap_time": float(self.get_event_data("Best LapTime", session_gps_time, 0.0)),
                "last_lap_time": float(self.get_event_data("Lap Time", session_gps_time, 0.0)),
                "best_sector_1": float(self.get_event_data("Best Sector1", session_gps_time, 0.0)),
                "best_sector_2": float(self.get_event_data("Best Sector2", session_gps_time, 0.0)),
                "last_sector_1": float(self.get_event_data("Last Sector1", session_gps_time, 0.0)),
                "last_sector_2": float(self.get_event_data("Last Sector2", session_gps_time, 0.0)),
                "raw_sector": int(self.get_event_data("Current Sector", session_gps_time, 1)),
            },
        }

    def get_vectorized_session_pack(self, step_hz: int = 20) -> Dict[str, Any]:
        """
        Extrae en una sola operación vectorizada todas las series de tiempo (muestreadas a step_hz,
        por defecto 20 Hz = cada 0.05s / 50ms) y todas las tablas de eventos de la sesión en DuckDB.
        Permite que el cliente y su Service Worker procesen toda la telemetría localmente
        dejando el mínimo trabajo de CPU y memoria al servidor.
        """
        step_hz = max(1, int(step_hz))
        frequencies = self.get_channel_frequencies()

        continuous_channels = {
            "gps_time": (["GPS Time"], 100),
            "rpm": (["Engine RPM"], 100),
            "speed_kmh": (["Ground Speed"], 100),
            "fuel_level_liters": (["Fuel Level"], 20),
            "virtual_energy_pct": (["Virtual Energy"], 20),
            "water_temp_c": (["Engine Water Temp"], 7),
            "oil_temp_c": (["Engine Oil Temp"], 7),
            "throttle_pos": (["Throttle Pos Unfiltered", "Throttle Pos"], 50),
            "brake_pos": (["Brake Pos Unfiltered", "Brake Pos"], 50),
            "steering_pos": (["Steering Pos", "Steering Pos Unfiltered"], 100),
            "g_force_lat": (["G Force Lat"], 10),
            "g_force_long": (["G Force Long"], 10),
            "tc_active": (["TC", "TC Active"], 100),
            "gps_lat": (["GPS Latitude"], 10),
            "gps_lon": (["GPS Longitude"], 10),
            "track_temp_c": (["Track Temperature"], 1),
            "ambient_temp_c": (["Ambient Temperature"], 1),
        }

        wheel_channels = {
            "tyre_temps_c": (["TyresTempCentre", "Tyres Temp Centre"], 100),
            "brake_temps_c": (["Brakes Temp", "BrakesTemp"], 50),
            "tyre_wear_percent": (["Tyres Wear", "TyresWear"], 10),
            "tyre_pressures_kpa": (["TyresPressure", "Tyres Pressure"], 10),
        }

        event_channels = {
            "max_rpm": "Engine Max RPM",
            "tc_level": "TCLevel",
            "abs_active": "ABS",
            "abs_level": "ABSLevel",
            "brake_bias_rear": "Brake Bias Rear",
            "in_pits": "In Pits",
            "yellow_flag": "Yellow Flag State",
            "gear": "Gear",
            "current_lap_time_event": "Current LapTime",
            "best_lap_time": "Best LapTime",
            "last_lap_time": "Lap Time",
            "best_sector_1": "Best Sector1",
            "best_sector_2": "Best Sector2",
            "last_sector_1": "Last Sector1",
            "last_sector_2": "Last Sector2",
            "raw_sector": "Current Sector",
            "lap": "Lap",
        }

        continuous_data: Dict[str, List[Any]] = {}
        for key, (ch_candidates, default_freq) in continuous_channels.items():
            ch_name = self._resolve_channel_name(ch_candidates)
            freq = frequencies.get(ch_name, default_freq)
            step = max(1, int(round(freq / step_hz)))
            table_name = f'"{self.table_prefix}{ch_name}"'
            try:
                if key == "tc_active":
                    q = f"SELECT CAST(value AS INT) FROM {table_name} WHERE rowid % {step} = 0 ORDER BY rowid ASC"
                elif key in ("gps_lat", "gps_lon"):
                    q = f"SELECT ROUND(CAST(value AS DOUBLE), 6) FROM {table_name} WHERE rowid % {step} = 0 ORDER BY rowid ASC"
                else:
                    q = f"SELECT ROUND(CAST(value AS DOUBLE), 2) FROM {table_name} WHERE rowid % {step} = 0 ORDER BY rowid ASC"
                rows = self._conn.execute(q).fetchall()
                continuous_data[key] = [r[0] for r in rows]
            except duckdb.Error:
                continuous_data[key] = []

        wheels_data: Dict[str, List[List[float]]] = {}
        for key, (ch_candidates, default_freq) in wheel_channels.items():
            ch_name = self._resolve_channel_name(ch_candidates)
            freq = frequencies.get(ch_name, default_freq)
            step = max(1, int(round(freq / step_hz)))
            table_name = f'"{self.table_prefix}{ch_name}"'
            try:
                q = f"""
                    SELECT ROUND(CAST(value1 AS DOUBLE), 1),
                           ROUND(CAST(value2 AS DOUBLE), 1),
                           ROUND(CAST(value3 AS DOUBLE), 1),
                           ROUND(CAST(value4 AS DOUBLE), 1)
                    FROM {table_name}
                    WHERE rowid % {step} = 0
                    ORDER BY rowid ASC
                """
                rows = self._conn.execute(q).fetchall()
                wheels_data[key] = [[r[0], r[1], r[2], r[3]] for r in rows]
            except duckdb.Error:
                wheels_data[key] = []

        events_data: Dict[str, List[List[Any]]] = {}
        for key, ev_name in event_channels.items():
            table_name = f'"{self.table_prefix}{ev_name}"'
            try:
                q = f"SELECT ROUND(CAST(ts AS DOUBLE), 4), value FROM {table_name} ORDER BY ts ASC"
                rows = self._conn.execute(q).fetchall()
                events_data[key] = [
                    [float(r[0]), round(float(r[1]), 4) if isinstance(r[1], float) else r[1]]
                    for r in rows
                ]
            except duckdb.Error:
                events_data[key] = []

        # Compuesto de neumáticos
        compound_idx = 0
        try:
            comp_table = f'"{self.table_prefix}TyresCompound"'
            crow = self._conn.execute(f"SELECT value1 FROM {comp_table} ORDER BY ts DESC LIMIT 1").fetchone()
            if crow:
                compound_idx = int(crow[0])
        except duckdb.Error:
            compound_idx = 0

        total_ticks = max(
            (len(v) for k, v in continuous_data.items() if k in ("rpm", "speed_kmh", "gps_time")),
            default=1,
        )
        duration_sec = round(total_ticks / float(step_hz), 2)

        return {
            "step_hz": step_hz,
            "total_ticks": total_ticks,
            "duration_sec": duration_sec,
            "compound_idx": compound_idx,
            "continuous": continuous_data,
            "wheels": wheels_data,
            "events": events_data,
        }

    def close(self):
        """Cierra la conexión a la base de datos para liberar memoria."""
        self._conn.close()
