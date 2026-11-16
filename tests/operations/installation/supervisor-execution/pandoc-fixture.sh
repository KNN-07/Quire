#!/bin/sh
if [ "$1" = "--version" ] && [ "$P74_DELAY_PROBE" = 1 ]; then
  printf 'P74_PROBE_ENTERED\n' >&2
  sleep 120
fi
for argument do
  if [ "$argument" = /src/noisy-out.md ]; then
    head -c 67108865 /dev/zero
    exit 0
  fi
  if [ "$argument" = /src/noisy-error.md ]; then
    head -c 65537 /dev/zero >&2
    exit 0
  fi
  if [ "$argument" = /src/hold.md ]; then
    printf 'P74_CONVERSION_ENTERED\n' >&2
    sleep 120
  fi
done
if [ "$1" = "--version" ]; then
  /usr/bin/pandoc-real "$@" | sed '1s/^pandoc-real /pandoc /'
  exit
fi
exec /usr/bin/pandoc-real "$@"
