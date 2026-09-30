# ==============================================================================
# SUMTECH BACKEND - DOCKERFILE MULTI-STAGE OPTIMIZADO (NestJS 10 + e-CF DGII)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Builder (Compilación de código TypeScript y assets)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Instalar dependencias nativas para compilar bcrypt y libxmljs2 (XSD DGII e-CF)
RUN apk add --no-cache python3 make g++ libxml2-dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ------------------------------------------------------------------------------
# 2. Prod-deps (Instalación limpia de dependencias de producción)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS prod-deps

RUN apk add --no-cache python3 make g++ libxml2-dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# 3. Runner (Imagen mínima de producción)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

# Librería de tiempo de ejecución C para libxml2, init process tini y utilitarios
RUN apk add --no-cache libxml2 tini curl

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# Copiar dependencias de producción y artefactos compilados
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Crear directorios para certificados DGII y uploads con permisos adecuados
RUN mkdir -p /app/certs /app/uploads && \
    chmod +x /app/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
