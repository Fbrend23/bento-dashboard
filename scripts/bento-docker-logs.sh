#!/bin/bash
# bento-docker-logs: print the last 200 log lines of ONE existing docker container.
#
# Installed on bento as root:root 0755 in /usr/local/bin and allowed to bento-dash by one sudoers
# line (see the README). The container name is the only free argument of that line, so this script
# is the security boundary: it validates everything before docker is called. It is read-only.
#
# Exit codes: 0 done, 64 bad usage, 65 unknown container, 66 docker unavailable; anything else is
# docker's own exit code.
set -euo pipefail
PATH=/usr/bin:/bin
DOCKER=/usr/bin/docker

if [ "$#" -ne 1 ]; then
  echo "usage: bento-docker-logs <container>" >&2
  exit 64
fi

name=$1

# A leading dash is impossible, so the name can never be read as an option by docker.
if ! [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "invalid container name" >&2
  exit 64
fi

if ! names=$("$DOCKER" ps -a --format '{{.Names}}'); then
  echo "docker unavailable" >&2
  exit 66
fi

# Exact, whole-line match: "jelly" or "JELLYFIN" do not match "jellyfin".
if ! printf '%s\n' "$names" | grep -Fxq -- "$name"; then
  echo "unknown container" >&2
  exit 65
fi

exec "$DOCKER" logs --tail 200 "$name"
