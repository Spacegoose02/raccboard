#!/bin/sh
# Make /data writable by PUID:PGID, then run Rackboard as that user.
# Defaults match Unraid (nobody:users = 99:100). If the container is started with --user,
# it is already unprivileged and runs as-is.
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only walk the tree when something is owned by someone else (keeps big appdata folders fast).
  if [ -n "$(find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit)" ]; then
    echo "Setting ownership of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR"
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi

exec "$@"
