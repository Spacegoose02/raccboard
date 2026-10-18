# syntax=docker/dockerfile:1

# ---- build: install deps and build the client ----
# Runs on the build machine's own architecture even for multi-arch images: the only native module
# (better-sqlite3) ships prebuilt binaries for linux x64 and arm64, so node_modules is portable.
FROM --platform=$BUILDPLATFORM node:22-slim AS build
# Build tools are only a fallback for platforms without a better-sqlite3 prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="Raccboard" \
      org.opencontainers.image.description="Self-hosted Kanban boards with lists, sublists, sharing, calendars and themes." \
      org.opencontainers.image.source="https://github.com/Spacegoose02/rackboard" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    PUID=99 \
    PGID=100
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY server ./server
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Starts as root only to fix /data ownership, then drops to PUID:PGID (Unraid default nobody:users = 99:100).
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
