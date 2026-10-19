#!/bin/bash
# Runs ON bento, started by scripts/deploy-agent.mjs: $1 is a fresh temp folder holding the agent
# archive. Replaces the agent files in /opt/bento-agent and restarts the service. It never touches
# /etc/bento-agent/config.json nor the installed unit (whose ExecStart points to your own Node).
set -euo pipefail

work="$1"
archive="$(ls "$work"/bento-agent-*.tar.gz)"
dest=/opt/bento-agent

tar -xzf "$archive" --strip-components=1 -C "$work"

sudo install -m 0644 -o root -g root "$work/bento-agent.cjs" "$dest/bento-agent.cjs"
sudo rm -rf "$dest/public"
sudo cp -r "$work/public" "$dest/public"
sudo chown -R root:root "$dest/public"
sudo chmod -R u=rwX,go=rX "$dest/public"

# The unit keeps the Node path chosen on this machine: only warn when the rest has changed.
unit=/etc/systemd/system/bento-agent.service
if ! diff -q <(grep -v '^ExecStart=' "$work/bento-agent.service") \
  <(sudo grep -v '^ExecStart=' "$unit") >/dev/null; then
  echo "ATTENTION : l'unité systemd du paquet diffère de celle installée (hors ExecStart)."
  echo "  Compare : diff $work/bento-agent.service $unit"
fi

sudo systemctl restart bento-agent
sleep 2
systemctl is-active bento-agent

# Without the Tailscale header the agent must answer 403: proof that it listens and is guarded.
if command -v curl >/dev/null; then
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8484/ || true)"
  echo "Réponse locale sans identité : $code (403 attendu)"
fi
