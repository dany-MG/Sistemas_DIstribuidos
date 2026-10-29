FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG PUBLIC_API_NODE_1_URL=""
ARG PUBLIC_API_NODE_2_URL=""
ENV PUBLIC_API_NODE_1_URL=$PUBLIC_API_NODE_1_URL \
    PUBLIC_API_NODE_2_URL=$PUBLIC_API_NODE_2_URL

RUN pnpm build

FROM nginx:alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 4321

CMD ["nginx", "-g", "daemon off;"]
