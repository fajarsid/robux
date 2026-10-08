#!/bin/sh
# Regenerates infra/nginx/snippets/cloudflare-real-ip.conf from Cloudflare's published lists.
set -eu
out=infra/nginx/snippets/cloudflare-real-ip.conf
{
  echo "# Trust CF-Connecting-IP only from Cloudflare edge ranges."
  echo "# Source: https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6"
  echo "# Regenerate with scripts/update-cloudflare-ips.sh and review the diff before deploying."
  for range in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $range;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > "$out"
echo "updated $out"
