#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/paddock-dashboard"
UVICORN="$BACKEND_DIR/.venv/bin/uvicorn"
GATEWAY_PID_FILE="/tmp/lmu_paddock_gateway.pid"

if [ "${1:-}" = "stop" ]; then
    if [ -f "$GATEWAY_PID_FILE" ]; then
        kill "$(cat "$GATEWAY_PID_FILE")" 2>/dev/null || true
        rm -f "$GATEWAY_PID_FILE"
    fi
    "$ROOT_DIR/start_cluster.sh" stop
    exit 0
fi

echo "1. Compilando Frontend estático (Astro + React + WebP)..."
pnpm --dir "$FRONTEND_DIR" build

echo "2. Iniciando Clúster Múltiples Clientes - Múltiples Servidores..."
"$ROOT_DIR/start_cluster.sh"

# Iniciamos el Gateway Unificado en el puerto 8080 si no está corriendo
if ! python3 -c "import socket; s=socket.socket(); res=s.connect_ex(('127.0.0.1', 8080)); s.close(); exit(0 if res==0 else 1)"; then
    cd "$BACKEND_DIR"
    "$UVICORN" gateway_main:app --host 0.0.0.0 --port 8080 > /tmp/lmu_gateway.log 2>&1 &
    echo $! > "$GATEWAY_PID_FILE"
    echo "  [+] Gateway Web Unificado iniciado -> http://localhost:8080 (PID $!)"
fi

echo "============================================================"
echo " Abriendo túnel HTTPS público hacia el Gateway (:8080)..."
echo " Comparte la URL https://....lhr.life que aparecerá abajo:"
echo "============================================================"
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8080 nokey@localhost.run
