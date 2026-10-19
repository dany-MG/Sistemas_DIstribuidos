import duckdb
from typing import List, Dict, Any

class TelemetryRepository:
    """
    Repositorio encargado EXCLUSIVAMENTE de comunicarse con DuckDB.
    Ningún otro archivo del backend importará 'duckdb' excepto este.
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        # Conexión de solo lectura, ideal para análisis de telemetría sin bloquear el archivo
        self._conn = duckdb.connect(database=db_path, read_only=True)
        
        # Descubrimos dinámicamente los prefijos de las tablas generadas por LMU
        self.table_prefix = self._discover_table_prefix()

    def _discover_table_prefix(self) -> str:
        """
        Busca en el esquema de la base de datos para encontrar el prefijo 
        dinámico que LMU le asignó a las tablas en esta sesión.
        """
        query = """
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name LIKE '%metadata%'
            LIMIT 1
        """
        result = self._conn.execute(query).fetchone()
        if result:
            # Extraemos la parte del nombre antes de 'metadata'
            full_name = result[0]
            return full_name.replace("metadata", "")
        return ""

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
        
    
    def get_event_data(self, event_name: str, current_time_seconds: int) -> float:
        """
        Consulta tablas de eventos. Busca el último evento que haya 
        ocurrido antes o en el segundo actual de la simulación.
        """
        table_name = f'"{self.table_prefix}{event_name}"'
        # Buscamos el evento más reciente según el tiempo de la simulación
        query = f"SELECT value FROM {table_name} WHERE ts <= {current_time_seconds} ORDER BY ts DESC LIMIT 1"
        
        try:
            result = self._conn.execute(query).fetchone()
            return result[0] if result else 0.0
        except duckdb.Error:
            return 0.0

    def close(self):
        """Cierra la conexión a la base de datos para liberar memoria."""
        self._conn.close()