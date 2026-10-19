#!/bin/bash
# bento-docker-action: start, stop or restart ONE existing docker container.
#
# Installed on bento as root:root 0755 in /usr/local/bin and allowed to bento-dash by three sudoers
# lines, one per action (see the README). The container name is the only free argument of those
# lines, so this script is the security boundary: it validates everything before docker is called.
#
# Exit codes: 0 done, 64 bad usage, 65 unknown container, 66 docker unavailable; anything else is
# docker's own exit code.
set -euo pipefail
PATH=/usr/bin:/bin
DOCKER=/usr/bin/docker

if [ "$#" -ne 2 ]; then
  echo "usage: bento-docker-action <start|stop|restart> <container>" >&2
  exit 64
fi

action=$1
name=$2

case "$action" in
  start | stop | restart) ;;
  *)
    echo "unknown action" >&2
    exit 64
    ;;
esac

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

exec "$DOCKER" "$action" "$name"
