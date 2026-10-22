# ============================================================================
# Etapa 1: Build del Frontend Astro + React (Pit Wall Dashboard)
# ============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /frontend
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY frontend/paddock-dashboard/package.json frontend/paddock-dashboard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/paddock-dashboard/ ./
RUN pnpm build

# ============================================================================
# Etapa 2: Clúster Backend MC-MS (2 Data Nodes + 2 API Nodes) + Cloud Gateway
# ============================================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /frontend/dist ./frontend/paddock-dashboard/dist

RUN printf '#!/bin/sh\n\
set -e\n\
cd /app/backend\n\
NODE_ID="data-node-1" NODE_ROLE="data" uvicorn data_node_main:app --host 127.0.0.1 --port 8011 &\n\
NODE_ID="data-node-2" NODE_ROLE="data" uvicorn data_node_main:app --host 127.0.0.1 --port 8012 &\n\
NODE_ID="api-node-1" NODE_ROLE="api" uvicorn main:app --host 127.0.0.1 --port 8000 &\n\
NODE_ID="api-node-2" NODE_ROLE="api" uvicorn main:app --host 127.0.0.1 --port 8001 &\n\
exec uvicorn gateway_main:app --host 0.0.0.0 --port "${PORT:-8080}"\n' > /app/start_cloud.sh \
    && chmod +x /app/start_cloud.sh

EXPOSE 8080

CMD ["/app/start_cloud.sh"]
