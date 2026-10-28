#!/bin/sh
set -eu
case "${1:-api}" in
  migrate) exec bun scripts/migrate.ts ;;
  api) exec bun deploy/runtime/server.ts ;;
  repository) exec bun deploy/runtime/repository.ts ;;
  worker) exec bun workers/compiler/main.ts ;;
  *) exec "$@" ;;
esac
