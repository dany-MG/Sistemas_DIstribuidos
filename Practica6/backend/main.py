from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import telemetry_routes

app = FastAPI(
    title = "LMU Paddock Dashboard",
    description = "API for the LMU Paddock Dashboard",
    version = "1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4321"], # Puerto por defecto de Astro
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/app/v1/health")
async def health_check():
    return {"status": "ok"}

app.include_router(telemetry_routes.router, prefix="/api/v1")