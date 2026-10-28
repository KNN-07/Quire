# Resolve the verified base digest with the release image manifest before publishing.
ARG BUN_IMAGE=oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY apps ./apps
RUN bun install --frozen-lockfile
COPY services ./services
COPY workers ./workers
COPY deploy ./deploy
RUN bun --bun vite build --config apps/web/vite.config.ts

FROM ${BUN_IMAGE}
USER root
ARG DEBIAN_SNAPSHOT=20261027T000000Z
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/%s trixie main\n' "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list && \
    printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/%s trixie-security main\n' "$DEBIAN_SNAPSHOT" >> /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends git util-linux ca-certificates curl \
    && dpkg-query -W > /app-system-packages.tsv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
RUN chmod 0555 deploy/runtime/entrypoint.sh && mkdir /data /git /backups && chown bun:bun /data /git /backups && chmod 0700 /backups
ENV NODE_ENV=production QUIRE_HOST=0.0.0.0 QUIRE_PORT=8080 QUIRE_DATA_DIR=/data
USER bun
EXPOSE 8080
ENTRYPOINT ["/app/deploy/runtime/entrypoint.sh"]
CMD ["api"]
