#!/bin/bash
# Re-creates everything the sandbox loses on reset: node_modules, FlyWire binaries, cloudflared.
set -e
cd "$(dirname "$0")/.."
[ -d node_modules/hono ] || npm install --silent
if [ ! -f data/brain/csr_w.bin ]; then
  mkdir -p /tmp/flywire && cd /tmp/flywire
  B=https://storage.googleapis.com/flywire-data/codex/data/fafb/783
  for f in classification.csv.gz coordinates.csv.gz connections.csv.gz consolidated_cell_types.csv.gz; do [ -f $f ] || curl -sO "$B/$f"; done
  cd - >/dev/null
  python3 -c "import numpy,pandas" 2>/dev/null || pip install -q numpy pandas
  python3 scripts/prepare_data.py /tmp/flywire
fi
which cloudflared >/dev/null || (curl -sL -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/)
echo "ENV READY"
