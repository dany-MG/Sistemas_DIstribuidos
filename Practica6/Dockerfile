# ============================================================================
# Etapa 1: Build del Frontend Astro + React (Respaldo integrado)
# ============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /frontend
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY frontend/paddock-dashboard/package.json frontend/paddock-dashboard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/paddock-dashboard/ ./
RUN pnpm build

# ============================================================================
# Etapa 2: Servidor Backend Ultraligero (<100 MB RAM) para Render Free Tier
# ============================================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SINGLE_PROCESS_CLUSTER=1 \
    PORT=8080

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /frontend/dist ./frontend/paddock-dashboard/dist

WORKDIR /app/backend

EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn gateway_main:app --host 0.0.0.0 --port ${PORT:-8080}"]
