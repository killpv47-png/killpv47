#!/bin/bash
# Starts (or restarts) a temporary Cloudflare Quick Tunnel to the local FlyTrader server
# and prints the public https://*.trycloudflare.com URL.  No Cloudflare account needed.
cd "$(dirname "$0")/.."
PORT=${PORT:-3000}
pm2 delete cf-tunnel >/dev/null 2>&1
pm2 start cloudflared --name cf-tunnel -- tunnel --url "http://localhost:$PORT" --no-autoupdate >/dev/null
for i in $(seq 1 40); do
  URL=$(pm2 logs cf-tunnel --nostream --lines 60 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
  [ -n "$URL" ] && break; sleep 1
done
if [ -n "$URL" ]; then echo "$URL" | tee data/tunnel_url.txt; else echo "tunnel not ready yet — run: pm2 logs cf-tunnel --nostream"; fi
