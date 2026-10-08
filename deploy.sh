#!/usr/bin/env bash
# Deploy the production Compose stack from the current VPS checkout.
# Usage: ./deploy.sh [image-tag]
# By default images are built on the VPS. Set DEPLOY_BUILD=false to pull from a registry.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '\n==> %s\n' "$*"
}

read_env_value() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

set_env_value() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed 's/[|&]/\\&/g')"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_telegram_webhook_secret() {
  local existing
  existing="$(read_env_value TELEGRAM_WEBHOOK_SECRET)"
  if [[ -z "$existing" ]]; then
    command -v od >/dev/null 2>&1 || die "The 'od' utility is required to generate a Telegram webhook secret."
    existing="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
    set_env_value TELEGRAM_WEBHOOK_SECRET "$existing"
    info "Generated a Telegram webhook secret in .env (value not displayed)."
  fi
}

cd "$ROOT_DIR"
command -v docker >/dev/null 2>&1 || die "Docker is not installed or is not in PATH."
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required."

if [[ ! -f "$ENV_FILE" ]]; then
  [[ -f "$ROOT_DIR/.env.example" ]] || die "Missing both .env and .env.example."
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"

  APP_HOST="${APP_DOMAIN:-tele.fajarhub.tech}"
  API_HOST="${API_DOMAIN:-api.tele.fajarhub.tech}"
  [[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "Invalid APP_DOMAIN value."
  [[ "$API_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "Invalid API_DOMAIN value."

  set_env_value APP_DOMAIN "$APP_HOST"
  set_env_value API_DOMAIN "$API_HOST"
  set_env_value TRUSTED_ORIGINS "https://${APP_HOST}"
  set_env_value TELEGRAM_MINI_APP_URL "https://${APP_HOST}/telegram-store"
  set_env_value DUITKU_CALLBACK_URL "https://${API_HOST}/api/v1/webhooks/payments/duitku"
  set_env_value DUITKU_RETURN_URL "https://${APP_HOST}/payment/return"
  info "Created .env with production domain defaults. Review it before enabling live payment."
fi

chmod 0600 "$ENV_FILE"

SECRETS_DIR_VALUE="$(read_env_value SECRETS_DIR)"
SECRETS_DIR_VALUE="${SECRETS_DIR_VALUE:-./secrets}"
if [[ "$SECRETS_DIR_VALUE" = /* ]]; then
  SECRETS_PATH="$SECRETS_DIR_VALUE"
else
  SECRETS_PATH="$ROOT_DIR/$SECRETS_DIR_VALUE"
fi
mkdir -p "$SECRETS_PATH"
chmod 0700 "$SECRETS_PATH"
if [[ -f "$ROOT_DIR/scripts/generate-secrets.sh" ]]; then
  (cd "$ROOT_DIR" && bash scripts/generate-secrets.sh)
else
  die "Missing scripts/generate-secrets.sh; cannot initialize required app secrets."
fi
ensure_telegram_webhook_secret

TAG="${1:-${IMAGE_TAG:-$(git rev-parse --short=12 HEAD 2>/dev/null || true)}}"
[[ -n "$TAG" ]] || die "Provide an immutable image tag: ./deploy.sh <image-tag>"
[[ "$TAG" != "local" ]] || die "The 'local' image tag is not allowed for production deployment."
export IMAGE_TAG="$TAG"

required_secrets=(
  postgres_password.txt
  redis_password.txt
  csrf_secret.txt
  totp_encryption_key.txt
  idempotency_encryption_key.txt
  account_inventory_encryption_key.txt
  origin_cert.pem
  origin_key.pem
)
for secret_file in "${required_secrets[@]}"; do
  [[ -s "$SECRETS_PATH/$secret_file" ]] || die "Required secret/certificate file is missing or empty: $SECRETS_PATH/$secret_file"
done

PAYMENT_GATEWAY_VALUE="$(read_env_value PAYMENT_GATEWAY)"
if [[ "$PAYMENT_GATEWAY_VALUE" == "duitku" ]]; then
  [[ -s "$SECRETS_PATH/duitku_merchant_code.txt" ]] || die "Duitku is enabled but its merchant code secret is empty."
  [[ -s "$SECRETS_PATH/duitku_api_key.txt" ]] || die "Duitku is enabled but its API key secret is empty."
fi

info "Validating production Compose configuration (tag: $TAG)"
"${COMPOSE[@]}" config --quiet

BUILD_VALUE="${DEPLOY_BUILD:-true}"
case "$BUILD_VALUE" in
  true|1|yes)
    info "Building production images on this VPS"
    "${COMPOSE[@]}" build --pull
    ;;
  false|0|no)
    info "Pulling production images from the configured registry"
    "${COMPOSE[@]}" pull
    ;;
  *) die "DEPLOY_BUILD must be true or false." ;;
esac

info "Starting/updating production services and waiting for health checks"
"${COMPOSE[@]}" up -d --wait --wait-timeout "${DEPLOY_WAIT_SECONDS:-240}"

info "Verifying database migration completed successfully"
MIGRATE_ID="$("${COMPOSE[@]}" ps --all -q migrate | head -n 1)"
[[ -n "$MIGRATE_ID" ]] || die "Compose did not create the migration container."
MIGRATE_EXIT="$(docker inspect --format '{{.State.ExitCode}}' "$MIGRATE_ID")"
MIGRATE_STATE="$(docker inspect --format '{{.State.Status}}' "$MIGRATE_ID")"
[[ "$MIGRATE_STATE" == "exited" && "$MIGRATE_EXIT" == "0" ]] || {
  "${COMPOSE[@]}" logs --no-color migrate >&2 || true
  die "Database migration did not complete successfully (state=$MIGRATE_STATE, exit=$MIGRATE_EXIT)."
}

info "Verifying internal API, frontend, and Nginx health"
"${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
"${COMPOSE[@]}" exec -T frontend node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
"${COMPOSE[@]}" exec -T nginx wget -q -O /dev/null http://127.0.0.1:8081/nginx-health

info "Deployment completed"
"${COMPOSE[@]}" ps --all
if [[ "$PAYMENT_GATEWAY_VALUE" == "none" || -z "$PAYMENT_GATEWAY_VALUE" ]]; then
  printf '\nNOTICE: PAYMENT_GATEWAY is disabled. This deployment does not accept customer payments.\n'
fi
printf 'NOTICE: Production Compose sets FULFILLMENT_PROVIDER=none. Do not open live sales until an authorized fulfillment provider is configured.\n'
printf 'Public checks: https://%s/ and https://%s/health/live\n' \
  "$(read_env_value APP_DOMAIN)" "$(read_env_value API_DOMAIN)"
