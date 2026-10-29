from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from middleware.error_handler import TelemetryErrorMiddleware
from routes import telemetry_routes
from database.connection import NODE_ID, get_node_id

app = FastAPI(
    title = f"LMU Paddock Dashboard API ({NODE_ID})",
    description = "API & Streaming Node for the LMU Paddock Dashboard (MC-MS Architecture)",
    version = "2.0.0",
)

app.add_middleware(TelemetryErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permite múltiples clientes desde cualquier puerto/host local
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/app/v1/health")
async def health_check():
    return {"status": "ok", "node_id": get_node_id(), "role": "api"}

app.include_router(telemetry_routes.router, prefix="/api/v1")
