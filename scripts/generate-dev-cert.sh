#!/bin/sh
# Self-signed certificate for running the PRODUCTION compose stack locally (verification only).
# Real deployments use a Cloudflare Origin Certificate placed in the secrets directory.
set -eu
dir="${SECRETS_DIR:-./secrets}"
app="${APP_DOMAIN:-app.localhost}"
api="${API_DOMAIN:-api.localhost}"
mkdir -p "$dir"
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout "$dir/origin_key.pem" -out "$dir/origin_cert.pem" \
  -subj "/CN=$app" -addext "subjectAltName=DNS:$app,DNS:$api"
chmod 0444 "$dir/origin_key.pem" "$dir/origin_cert.pem"
echo "created $dir/origin_cert.pem and $dir/origin_key.pem (self-signed, local only)"
