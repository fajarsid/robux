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
  local key="$1" value="$2" temporary found=0 line
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then
      if [[ "$found" == 0 ]]; then
        printf '%s=%s\n' "$key" "$value" >> "$temporary"
        found=1
      fi
    else
      printf '%s\n' "$line" >> "$temporary"
    fi
  done < "$ENV_FILE"
  if [[ "$found" == 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$temporary"
  fi
  chmod 0600 "$temporary"
  chown root:root "$temporary"
  mv -f "$temporary" "$ENV_FILE"
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
[[ "$EUID" -eq 0 ]] || die "Run with sudo/root; this script initializes protected configuration and host Certbot."

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
chown root:root "$ENV_FILE"
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  && ! git -C "$ROOT_DIR" check-ignore --quiet "$ENV_FILE"; then
  die ".env is not ignored by Git; refusing to continue with bot/payment configuration at risk of being committed."
fi

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
)
for secret_file in "${required_secrets[@]}"; do
  [[ -s "$SECRETS_PATH/$secret_file" ]] || die "Required secret/certificate file is missing or empty: $SECRETS_PATH/$secret_file"
done

APP_HOST="$(read_env_value APP_DOMAIN)"
API_HOST="$(read_env_value API_DOMAIN)"
CERTBOT_EMAIL_VALUE="$(read_env_value CERTBOT_EMAIL)"
WEBROOT_VALUE="$(read_env_value LE_WEBROOT_PATH)"
WEBROOT_VALUE="${WEBROOT_VALUE:-/var/www/letsencrypt}"
[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ && "$APP_HOST" != *localhost* ]] || die "Set APP_DOMAIN in .env to the public hostname configured for this deployment."
[[ "$API_HOST" =~ ^[A-Za-z0-9.-]+$ && "$API_HOST" != *localhost* ]] || die "Set API_DOMAIN in .env to its public hostname."
[[ "$WEBROOT_VALUE" = /* ]] || die "LE_WEBROOT_PATH must be an absolute host path."
EXPECTED_MINI_APP_URL="https://${APP_HOST}/telegram-store"
set_env_value TRUSTED_ORIGINS "https://${APP_HOST}"
set_env_value TELEGRAM_MINI_APP_URL "$EXPECTED_MINI_APP_URL"
set_env_value DUITKU_CALLBACK_URL "https://${API_HOST}/api/v1/webhooks/payments/duitku"
set_env_value DUITKU_RETURN_URL "https://${APP_HOST}/payment/return"

# This deployment is for staging/testing only: payment intake and all treasury integrations stay off.
set_env_value PAYMENT_GATEWAY none
set_env_value PAYMENT_PROVIDER_STARS_ENABLED false
set_env_value TELEGRAM_STARS_PRODUCTION_AUTHORIZED false
set_env_value TON_TREASURY_ENABLED false
set_env_value TON_TREASURY_PRODUCTION_AUTHORIZED false
set_env_value BINANCE_WITHDRAWAL_ENABLED false

if [[ -z "$CERTBOT_EMAIL_VALUE" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Email for Let's Encrypt expiry notices: " CERTBOT_EMAIL_VALUE
    [[ "$CERTBOT_EMAIL_VALUE" == *@*.* ]] || die "A valid CERTBOT_EMAIL is required."
    set_env_value CERTBOT_EMAIL "$CERTBOT_EMAIL_VALUE"
  else
    die "Set CERTBOT_EMAIL in .env (or rerun interactively) before requesting a certificate."
  fi
fi

command -v curl >/dev/null 2>&1 || die "curl is required for HTTP challenge and health checks."
command -v openssl >/dev/null 2>&1 || die "openssl is required to verify the issued certificate."
command -v python3 >/dev/null 2>&1 || die "python3 is required to safely verify Telegram webhook responses."

if ! command -v certbot >/dev/null 2>&1; then
  info "Installing Certbot for the detected VPS package manager"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot
  elif command -v yum >/dev/null 2>&1; then
    yum install -y certbot
  else
    die "Cannot install Certbot automatically on this OS. Install certbot using its official OS instructions, then rerun."
  fi
fi

command -v systemctl >/dev/null 2>&1 || die "systemd is required to configure automatic Certbot renewal."
if ! getent group robux-tls >/dev/null 2>&1; then
  groupadd --system robux-tls
fi
TLS_GID="$(getent group robux-tls | cut -d: -f3)"
set_env_value LE_CERT_GID "$TLS_GID"
mkdir -p /etc/letsencrypt "$WEBROOT_VALUE/.well-known/acme-challenge"
chmod 0755 "$WEBROOT_VALUE" "$WEBROOT_VALUE/.well-known" "$WEBROOT_VALUE/.well-known/acme-challenge"

certbot_domains=(-d "$APP_HOST")
if [[ "$API_HOST" != "$APP_HOST" ]]; then
  certbot_domains+=(-d "$API_HOST")
fi
CERT_LINEAGE="/etc/letsencrypt/live/$APP_HOST"
CERT_VALID=false
if [[ -s "$CERT_LINEAGE/fullchain.pem" && -s "$CERT_LINEAGE/privkey.pem" ]] \
  && openssl x509 -in "$CERT_LINEAGE/fullchain.pem" -noout -checkend 86400 >/dev/null 2>&1 \
  && openssl x509 -in "$CERT_LINEAGE/fullchain.pem" -noout -checkhost "$APP_HOST" >/dev/null 2>&1 \
  && openssl x509 -in "$CERT_LINEAGE/fullchain.pem" -noout -checkhost "$API_HOST" >/dev/null 2>&1; then
  CERT_VALID=true
fi

if [[ "$CERT_VALID" != true ]]; then
  certbot_expand=()
  if [[ -s "$CERT_LINEAGE/fullchain.pem" ]]; then
    certbot_expand+=(--expand)
  fi
  info "Starting temporary HTTP-only Nginx for the ACME HTTP-01 challenge"
  BOOTSTRAP_COMPOSE=("${COMPOSE[@]}" -f "$ROOT_DIR/docker-compose.certbot-bootstrap.yml")
  "${BOOTSTRAP_COMPOSE[@]}" config --quiet
  "${BOOTSTRAP_COMPOSE[@]}" up -d --no-deps nginx

  challenge_probe="robux-acme-probe-$$"
  printf 'acme-webroot-ok\n' > "$WEBROOT_VALUE/.well-known/acme-challenge/$challenge_probe"
  for hostname in "$APP_HOST" "$API_HOST"; do
    challenge_body="$(curl --silent --show-error --fail --header "Host: $hostname" \
      "http://127.0.0.1/.well-known/acme-challenge/$challenge_probe")" || {
      rm -f "$WEBROOT_VALUE/.well-known/acme-challenge/$challenge_probe"
      die "Nginx did not serve the ACME challenge for $hostname on port 80. Check firewall/DNS and retry."
    }
    [[ "$challenge_body" == "acme-webroot-ok" ]] || die "ACME webroot check returned unexpected content for $hostname."
  done
  rm -f "$WEBROOT_VALUE/.well-known/acme-challenge/$challenge_probe"

  info "Requesting Let's Encrypt certificate for configured hostnames"
  certbot certonly --non-interactive --agree-tos --email "$CERTBOT_EMAIL_VALUE" \
    --webroot --webroot-path "$WEBROOT_VALUE" --cert-name "$APP_HOST" --keep-until-expiring \
    "${certbot_expand[@]}" \
    "${certbot_domains[@]}"
fi

[[ -s "$CERT_LINEAGE/fullchain.pem" && -s "$CERT_LINEAGE/privkey.pem" ]] || die "Certbot did not create the expected certificate under $CERT_LINEAGE."
openssl x509 -in "$CERT_LINEAGE/fullchain.pem" -noout -checkhost "$APP_HOST" >/dev/null || die "Let's Encrypt certificate does not cover APP_DOMAIN=$APP_HOST."
openssl x509 -in "$CERT_LINEAGE/fullchain.pem" -noout -checkhost "$API_HOST" >/dev/null || die "Let's Encrypt certificate does not cover API_DOMAIN=$API_HOST."
PRIVATE_KEY_PATH="$(readlink -f "$CERT_LINEAGE/privkey.pem")"
CERT_PUBLIC_KEY="$(openssl x509 -in "$CERT_LINEAGE/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
KEY_PUBLIC_KEY="$(openssl pkey -in "$PRIVATE_KEY_PATH" -pubout -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
[[ -n "$CERT_PUBLIC_KEY" && "$CERT_PUBLIC_KEY" == "$KEY_PUBLIC_KEY" ]] || die "Let's Encrypt certificate and private key do not match."
chown root:robux-tls "$PRIVATE_KEY_PATH"
chmod 0640 "$PRIVATE_KEY_PATH"
[[ "$(stat -c '%a' "$PRIVATE_KEY_PATH")" == 640 ]] || die "Let's Encrypt private key permissions are not restricted to root and the Nginx certificate group."

HOOK_DIR=/etc/letsencrypt/renewal-hooks/deploy
mkdir -p "$HOOK_DIR"
cat > "$HOOK_DIR/robux-nginx-reload" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
lineage="\${RENEWED_LINEAGE:?Certbot did not provide RENEWED_LINEAGE}"
private_key="\$(readlink -f "\$lineage/privkey.pem")"
chown root:robux-tls "\$private_key"
chmod 0640 "\$private_key"
docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml" exec -T nginx nginx -s reload
EOF
chmod 0750 "$HOOK_DIR/robux-nginx-reload"

if systemctl list-unit-files certbot.timer --no-legend 2>/dev/null | grep -q '^certbot.timer'; then
  RENEWAL_TIMER=certbot.timer
  systemctl enable --now certbot.timer
else
  RENEWAL_TIMER=robux-certbot-renew.timer
  CERTBOT_BIN="$(command -v certbot)"
  cat > /etc/systemd/system/robux-certbot-renew.service <<'EOF'
[Unit]
Description=Renew Let's Encrypt certificates
After=network-online.target

[Service]
Type=oneshot
ExecStart=__CERTBOT_BIN__ renew --quiet
EOF
  sed -i "s|__CERTBOT_BIN__|$CERTBOT_BIN|" /etc/systemd/system/robux-certbot-renew.service
  cat > /etc/systemd/system/robux-certbot-renew.timer <<'EOF'
[Unit]
Description=Twice-daily Let's Encrypt renewal check

[Timer]
OnCalendar=*-*-* 03,15:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$RENEWAL_TIMER"
fi
systemctl is-active --quiet "$RENEWAL_TIMER" || die "Automatic Certbot renewal timer is not active."

PAYMENT_GATEWAY_VALUE="$(read_env_value PAYMENT_GATEWAY)"

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

info "Testing Certbot renewal configuration"
certbot renew --cert-name "$APP_HOST" --dry-run

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

info "Checking public HTTP redirect, HTTPS, API health, and Mini App route"
HTTP_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --resolve "${APP_HOST}:80:127.0.0.1" "http://${APP_HOST}/")"
[[ "$HTTP_STATUS" == 301 || "$HTTP_STATUS" == 308 ]] || die "HTTP did not redirect to HTTPS for $APP_HOST (status $HTTP_STATUS)."
HTTPS_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --resolve "${APP_HOST}:443:127.0.0.1" "https://${APP_HOST}/")" || die "TLS validation failed for $APP_HOST."
[[ "$HTTPS_STATUS" =~ ^[23][0-9][0-9]$ ]] || die "Public HTTPS check failed for $APP_HOST (status $HTTPS_STATUS)."
MINI_APP_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --resolve "${APP_HOST}:443:127.0.0.1" "https://${APP_HOST}/telegram-store")" || die "TLS validation failed for the Mini App route."
[[ "$MINI_APP_STATUS" =~ ^[23][0-9][0-9]$ ]] || die "Mini App route failed (status $MINI_APP_STATUS)."
API_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --resolve "${API_HOST}:443:127.0.0.1" "https://${API_HOST}/health/live")" || die "TLS validation failed for the API hostname."
[[ "$API_STATUS" =~ ^[23][0-9][0-9]$ ]] || die "Public API health check failed for $API_HOST (status $API_STATUS)."

if [[ "$PAYMENT_GATEWAY_VALUE" == "none" || -z "$PAYMENT_GATEWAY_VALUE" ]]; then
  printf '\nNOTICE: PAYMENT_GATEWAY is disabled. This deployment does not accept customer payments.\n'
fi
printf 'NOTICE: Production Compose sets FULFILLMENT_PROVIDER=none. Do not open live sales until an authorized fulfillment provider is configured.\n'
printf 'Public checks: http://%s (redirect expected), https://%s/telegram-store, https://%s/health/live\n' \
  "$APP_HOST" "$APP_HOST" "$API_HOST"

TELEGRAM_TOKEN="$(read_env_value TELEGRAM_BOT_TOKEN)"
TELEGRAM_SECRET="$(read_env_value TELEGRAM_WEBHOOK_SECRET)"
if [[ -n "$TELEGRAM_TOKEN" && -n "$TELEGRAM_SECRET" ]]; then
  WEBHOOK_URL="https://${APP_HOST}/api/v1/telegram/webhook"
  info "Registering Telegram webhook (token and secret are not printed)"
  set_response="$(curl --silent --show-error --config - 2>/dev/null <<EOF
url = "https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook"
request = "POST"
data-urlencode = "url=${WEBHOOK_URL}"
data-urlencode = "secret_token=${TELEGRAM_SECRET}"
EOF
)" || die "Telegram webhook registration request failed; token was not displayed."
  printf '%s' "$set_response" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") is True else 1)' || die "Telegram rejected webhook registration; inspect BotFather token and webhook configuration."
  info "Verifying Telegram webhook URL and last error"
  webhook_info="$(curl --silent --show-error --config - 2>/dev/null <<EOF
url = "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo"
EOF
)" || die "Could not query Telegram webhook status."
printf '%s' "$webhook_info" | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result",{}); print("Webhook URL:",r.get("url","")); print("Last error:",r.get("last_error_message") or "none"); sys.exit(0 if d.get("ok") is True and r.get("url")==sys.argv[1] and not r.get("last_error_message") else 1)' "$WEBHOOK_URL" || die "Telegram webhook verification failed."
else
  printf '\nNOTICE: TELEGRAM_BOT_TOKEN is empty; HTTPS is deployed but Telegram webhook registration was skipped.\n'
fi

info "Deployment checks passed"
"${COMPOSE[@]}" ps --all
