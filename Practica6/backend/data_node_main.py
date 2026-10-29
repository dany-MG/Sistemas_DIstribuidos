from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from middleware.error_handler import TelemetryErrorMiddleware
from routes import data_node_routes
from database.connection import NODE_ID, get_node_id

app = FastAPI(
    title=f"LMU DuckDB Data Server ({NODE_ID})",
    description="Servidor dedicado de recursos de telemetría (.duckdb) para arquitectura MC-MS",
    version="1.0.0",
)

app.add_middleware(TelemetryErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def root_health():
    return {"status": "ok", "node_id": get_node_id(), "role": "data"}


app.include_router(data_node_routes.router, prefix="/data/v1")
