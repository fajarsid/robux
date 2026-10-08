#!/bin/sh
# Generates local secret files for Docker Compose. Existing files are never overwritten.
# Values are URL-safe (hex) so they can be embedded in connection strings.
set -eu

dir="${SECRETS_DIR:-./secrets}"
mkdir -p "$dir"

gen() {
  file="$dir/$1"
  if [ -f "$file" ]; then
    echo "keep     $file"
    return
  fi
  # 32 random bytes → 64 hex characters.
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$file"
  chmod 0444 "$file"
  echo "created  $file"
}

gen postgres_password.txt
gen redis_password.txt
gen csrf_secret.txt
# 64 hex characters = the 32-byte AES-256-GCM key for TOTP secrets at rest.
gen totp_encryption_key.txt
# 64 hex characters = the 32-byte AES-256-GCM key for tracking tokens inside stored idempotent order responses.
gen idempotency_encryption_key.txt
# 64 hex characters = the 32-byte AES-256-GCM key for digital account payloads at rest.
gen account_inventory_encryption_key.txt

# Payment gateway credentials come from the Duitku dashboard, not from here. Empty placeholders
# let Compose mount the secrets while PAYMENT_GATEWAY=none; paste the real values into them.
placeholder() {
  file="$dir/$1"
  if [ -f "$file" ]; then
    echo "keep     $file"
    return
  fi
  : > "$file"
  chmod 0644 "$file"
  echo "created  $file (empty placeholder: fill from the Duitku dashboard)"
}

placeholder duitku_merchant_code.txt
placeholder duitku_api_key.txt
