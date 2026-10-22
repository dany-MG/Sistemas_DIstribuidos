import os
import asyncio
import urllib.request
import urllib.error
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "paddock-dashboard" / "dist"

NODE_TARGETS = {
    "node1": os.getenv("API_NODE_1_URL", "http://localhost:8000"),
    "node2": os.getenv("API_NODE_2_URL", "http://localhost:8001"),
}

app = FastAPI(
    title="LMU Paddock Cloud Gateway",
    description="Gateway Unificado que expone en una sola URL pública HTTPS el Frontend Astro y el Clúster MC-MS",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _proxy_request(target_base: str, subpath: str, request: Request):
    query = request.url.query
    url = f"{target_base}/api/v1/{subpath}" + (f"?{query}" if query else "")

    # Si es el endpoint de streaming SSE, hacemos streaming asíncrono directo sin buffering
    if subpath.strip("/") == "stream":
        async def sse_proxy_generator():
            req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
            try:
                resp = await asyncio.to_thread(urllib.request.urlopen, req, None, 5.0)
                try:
                    while True:
                        line = await asyncio.to_thread(resp.readline)
                        if not line:
                            break
                        yield line
                finally:
                    resp.close()
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                yield f"event: error\ndata: {str(exc)}\n\n".encode("utf-8")

        return StreamingResponse(
            sse_proxy_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Petición REST estándar (GET / POST)
    method = request.method
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None

    def _do_req():
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Accept", "application/json")
        if body:
            req.add_header("Content-Type", request.headers.get("content-type", "application/json"))
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "application/json")

    try:
        status_code, content, content_type = await asyncio.to_thread(_do_req)
        return Response(content=content, status_code=status_code, media_type=content_type)
    except urllib.error.HTTPError as e:
        return Response(content=e.read(), status_code=e.code, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Nodo destino ({target_base}) no disponible: {e}")


@app.api_route("/node1/api/v1/{subpath:path}", methods=["GET", "POST"])
async def proxy_node1(subpath: str, request: Request):
    return await _proxy_request(NODE_TARGETS["node1"], subpath, request)


@app.api_route("/node2/api/v1/{subpath:path}", methods=["GET", "POST"])
async def proxy_node2(subpath: str, request: Request):
    return await _proxy_request(NODE_TARGETS["node2"], subpath, request)


@app.api_route("/api/v1/{subpath:path}", methods=["GET", "POST"])
async def proxy_default(subpath: str, request: Request):
    try:
        return await _proxy_request(NODE_TARGETS["node1"], subpath, request)
    except HTTPException:
        return await _proxy_request(NODE_TARGETS["node2"], subpath, request)


# Montamos el Frontend estático compilado de Astro en la raíz "/"
if FRONTEND_DIST.exists():
    app.mount("/_astro", StaticFiles(directory=str(FRONTEND_DIST / "_astro")), name="astro-assets")
    if (FRONTEND_DIST / "cars").exists():
        app.mount("/cars", StaticFiles(directory=str(FRONTEND_DIST / "cars")), name="car-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
