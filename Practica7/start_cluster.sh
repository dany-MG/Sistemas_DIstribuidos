#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
UVICORN="$BACKEND_DIR/.venv/bin/uvicorn"
PID_FILE="/tmp/lmu_paddock_cluster.pids"

stop_cluster() {
    if [ -f "$PID_FILE" ]; then
        echo "Deteniendo nodos lanzados por start_cluster.sh..."
        while read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
        echo "Nodos detenidos."
    else
        echo "No hay nodos registrados en $PID_FILE."
    fi
}

port_in_use() {
    local port="$1"
    python3 -c "import socket; s=socket.socket(); res=s.connect_ex(('127.0.0.1', $port)); s.close(); exit(0 if res==0 else 1)"
}

if [ "${1:-}" = "stop" ]; then
    stop_cluster
    exit 0
fi

stop_cluster >/dev/null 2>&1 || true

echo "============================================================"
echo " Iniciando Clúster Múltiples Clientes - Múltiples Servidores"
echo "============================================================"

cd "$BACKEND_DIR"

start_node() {
    local node_id="$1"
    local role="$2"
    local app_module="$3"
    local port="$4"
    local log_file="$5"

    if port_in_use "$port"; then
        echo "  [*] $node_id (:$port) ya se encuentra en ejecución."
    else
        NODE_ID="$node_id" NODE_ROLE="$role" "$UVICORN" "$app_module" --host 0.0.0.0 --port "$port" > "$log_file" 2>&1 &
        echo $! >> "$PID_FILE"
        echo "  [+] $node_id ($role) iniciado -> http://localhost:$port (PID $!)"
    fi
}

# 1. Servidores de Recursos .duckdb (Data Nodes)
start_node "data-node-1" "data" "data_node_main:app" 8011 "/tmp/lmu_data_node_1.log"
start_node "data-node-2" "data" "data_node_main:app" 8012 "/tmp/lmu_data_node_2.log"

# 2. Servidores de API y Streaming SSE (API Nodes)
start_node "api-node-1" "api" "main:app" 8000 "/tmp/lmu_api_node_1.log"
start_node "api-node-2" "api" "main:app" 8001 "/tmp/lmu_api_node_2.log"

echo "============================================================"
echo " Clúster listo. Usa './start_cluster.sh stop' para detener."
echo "============================================================"
