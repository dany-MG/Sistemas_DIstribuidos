import time
import traceback
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class TelemetryErrorMiddleware(BaseHTTPMiddleware):
    """
    Middleware encargado de medir el tiempo de procesamiento de cada petición
    y capturar excepciones no controladas devolviendo un formato JSON uniforme.
    """

    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        try:
            response = await call_next(request)
            process_time_ms = (time.perf_counter() - start_time) * 1000
            response.headers["X-Process-Time-Ms"] = f"{process_time_ms:.2f}"
            return response
        except Exception as exc:
            print(f"[Middleware Error] Excepción en {request.url.path}: {exc}")
            traceback.print_exc()
            return JSONResponse(
                status_code=500,
                content={
                    "status": "error",
                    "detail": str(exc),
                    "path": request.url.path,
                },
            )
