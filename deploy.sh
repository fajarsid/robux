#!/usr/bin/env bash
# Build and deploy Robux host services behind the existing host Nginx.
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
PULL=1
case "${1:-}" in '') ;; --no-pull) PULL=0;; *) printf 'Usage: sudo bash deploy.sh [--no-pull]\n' >&2; exit 1;; esac
[[ $# -le 1 ]] || exit 1
ENV_FILE=/etc/robux/production.env
SECRETS_DIR=/etc/robux/secrets
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info(){ printf '\n==> %s\n' "$*"; }
getv(){ awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); value=$0} END{print value}' "$ENV_FILE"; }
[[ $EUID -eq 0 ]] || die 'Run: sudo ./deploy.sh'
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || die "Missing protected environment file $ENV_FILE; run setup-vps.sh first."
[[ "$(stat -c '%a' "$ENV_FILE")" == 600 ]] || die "$ENV_FILE must have mode 0600."
for c in flock mktemp cp git corepack node docker systemctl nginx ss curl getent openssl python3 runuser stat awk grep sed tr sort comm install chown chmod date; do command -v "$c" >/dev/null || die "Required command missing: $c"; done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin is required.'
docker info >/dev/null 2>&1 || die 'Docker daemon unavailable; refusing to infer that existing data volumes are absent.'
exec 9>/run/lock/robux-deployment.lock
flock -n 9 || die 'Another Robux setup/deployment is running.'
SNAPSHOT_DIR="$(mktemp -d /var/tmp/robux-deploy.XXXXXX)"
chmod 0700 "$SNAPSHOT_DIR"
printf 'Private audit snapshots: %s\n' "$SNAPSHOT_DIR"
DOMAIN="$(getv DOMAIN)"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$DOMAIN" != *localhost* ]] || die 'DOMAIN_REQUIRED: set DOMAIN in /etc/robux/production.env.'
[[ "$(getv API_HOST)" == 127.0.0.1 && "$(getv HOSTNAME)" == 127.0.0.1 ]] || die 'API and Web must bind only to 127.0.0.1.'
getent ahostsv4 "$DOMAIN" >/dev/null || die "PREREQUISITE_NOT_MET: Robux DNS for $DOMAIN does not resolve."
API_ALIAS="$(getv API_DOMAIN_ALIAS)"
if [[ -n "$API_ALIAS" ]]; then getent ahostsv4 "$API_ALIAS" >/dev/null || die "PREREQUISITE_NOT_MET: Robux API alias DNS for $API_ALIAS does not resolve."; fi
for key in API_PORT WEB_PORT POSTGRES_HOST_PORT REDIS_HOST_PORT WORKER_HEALTH_PORT SCHEDULER_HEALTH_PORT; do
  value="$(getv "$key")"; [[ "$value" =~ ^[0-9]{2,5}$ ]] && ((value > 1024 && value < 65536)) || die "Invalid $key in production environment."
done
for port in 80 443; do ss -H -ltnp "sport = :$port" | grep -qi nginx || die "Expected existing host Nginx to own port $port."; done
[[ "$(systemctl is-active nginx)" == active ]] || die 'Host Nginx is not active; refusing to change global Nginx.'
nginx -T >"$SNAPSHOT_DIR/nginx-before-robux-deploy.txt" 2>&1 || die 'nginx -T failed; deployment stopped.'
VHOST=/etc/nginx/sites-available/robux.conf; [[ -f "$VHOST" ]] || VHOST=/etc/nginx/conf.d/robux.conf
[[ -f "$VHOST" ]] || die 'Robux host Nginx vhost is missing; run setup-vps.sh first.'
grep -Fq "server 127.0.0.1:$(getv API_PORT);" "$VHOST" || die 'Nginx API upstream does not match configured API_PORT.'
grep -Fq "server 127.0.0.1:$(getv WEB_PORT);" "$VHOST" || die 'Nginx Web upstream does not match configured WEB_PORT.'
grep -E "server_name[^;]*$DOMAIN" "$VHOST" >/dev/null || die 'Robux Nginx vhost does not include configured DOMAIN.'
[[ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && -s "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]] || die "PREREQUISITE_NOT_MET: Robux TLS certificate missing. After DNS and HTTP routing are ready, run: sudo certbot --nginx -d $DOMAIN"
openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkend 0 >/dev/null || die 'TLS certificate expired.'
openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null || die 'Let’s Encrypt certificate does not cover DOMAIN.'
if [[ -n "$API_ALIAS" ]]; then openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$API_ALIAS" >/dev/null || die 'Let’s Encrypt certificate does not cover API_DOMAIN_ALIAS.'; fi
for unit in robux-api robux-web robux-worker robux-scheduler; do systemctl cat "$unit.service" >/dev/null 2>&1 || die "Missing $unit.service; run setup-vps.sh first."; done
for pair in API_PORT:api WEB_PORT:web WORKER_HEALTH_PORT:worker SCHEDULER_HEALTH_PORT:scheduler; do
  key=${pair%:*}; service=${pair#*:}; port="$(getv "$key")"
  listeners="$(ss -H -ltnp "sport = :$port")"
  if [[ -n "$listeners" ]]; then
    pid="$(systemctl show -p MainPID --value "robux-$service.service")"
    [[ "$pid" =~ ^[1-9][0-9]*$ && "$listeners" == *"pid=$pid,"* ]] || die "$key is occupied by another process; no service was restarted."
  fi
done
for secret in postgres_password redis_password csrf_secret totp_encryption_key idempotency_encryption_key account_inventory_encryption_key; do [[ -s "$SECRETS_DIR/$secret.txt" ]] || die "Missing required secret file: $SECRETS_DIR/$secret.txt"; done
BACKUP_DIR=/var/backups/robux
install -d -o root -g root -m 0700 "$BACKUP_DIR"
cp -a "$ENV_FILE" "$BACKUP_DIR/environment-$(date -u +%Y%m%dT%H%M%SZ).env"
cp -a "$VHOST" "$BACKUP_DIR/nginx-robux-$(date -u +%Y%m%dT%H%M%SZ).conf"
chmod 0600 "$BACKUP_DIR"/nginx-robux-*.conf
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ "$PULL" == 1 ]]; then
  [[ -z "$(git -c safe.directory="$ROOT_DIR" -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] || die 'Working tree has changes or untracked files; review them before deployment; this script will not overwrite local work.'
  git -c safe.directory="$ROOT_DIR" -C "$ROOT_DIR" diff --quiet || die 'Working tree has tracked changes; review/stash them before pull.'
  git -c safe.directory="$ROOT_DIR" -C "$ROOT_DIR" diff --cached --quiet || die 'Index has staged changes; deployment stopped.'
  git -c safe.directory="$ROOT_DIR" -C "$ROOT_DIR" pull --ff-only
  else info "Using the reviewed local checkout without pulling; revision $(git -C "$ROOT_DIR" rev-parse HEAD)."; fi
else die 'Deployment directory is not a Git checkout.'; fi

info 'Install locked dependencies and build all workspace packages.'
corepack pnpm install --frozen-lockfile
corepack pnpm build
[[ -s "$ROOT_DIR/apps/api/dist/main.js" && -s "$ROOT_DIR/apps/api/dist/worker.js" && -s "$ROOT_DIR/apps/api/dist/scheduler.js" ]] || die 'API build artifacts are incomplete.'
[[ -s "$ROOT_DIR/apps/web/.next/standalone/apps/web/server.js" ]] || die 'Next standalone server artifact is missing.'
# Next standalone output excludes static assets and public files.
cp -a "$ROOT_DIR/apps/web/.next/static" "$ROOT_DIR/apps/web/.next/standalone/apps/web/.next/"
if [[ -d "$ROOT_DIR/apps/web/public" ]]; then cp -a "$ROOT_DIR/apps/web/public" "$ROOT_DIR/apps/web/.next/standalone/apps/web/"; fi
runuser -u robux -- test -r "$ROOT_DIR/apps/api/dist/main.js" || die 'The robux service user cannot read the API build output.'
runuser -u robux -- test -r "$ROOT_DIR/apps/web/.next/standalone/apps/web/server.js" || die 'The robux service user cannot read the Web build output.'

info 'Validate production Compose configuration and start only private data services.'
export SECRETS_DIR
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d --wait --wait-timeout 180 postgres redis
MIGRATION_STATE="$BACKUP_DIR/migrations-before-$(date -u +%Y%m%dT%H%M%SZ).txt"
if [[ "$("${COMPOSE[@]}" exec -T postgres psql -U "$(getv POSTGRES_USER)" -d "$(getv POSTGRES_DB)" -Atc "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" == t ]]; then
  "${COMPOSE[@]}" exec -T postgres psql -U "$(getv POSTGRES_USER)" -d "$(getv POSTGRES_DB)" -Atc "SELECT migration_name || ':' || coalesce(finished_at::text, 'pending') FROM _prisma_migrations ORDER BY started_at" >"$MIGRATION_STATE"
else
  printf 'No Prisma migration table before this deployment.\n' >"$MIGRATION_STATE"
fi
chmod 0600 "$MIGRATION_STATE"
DATABASE_URL="$(python3 "$ROOT_DIR/scripts/production-database-url.py" "$ENV_FILE")"
export DATABASE_URL
corepack pnpm --filter @robux/api run db:migrate:deploy
unset DATABASE_URL
"${COMPOSE[@]}" exec -T postgres psql -U "$(getv POSTGRES_USER)" -d "$(getv POSTGRES_DB)" -Atc "SELECT migration_name || ':' || coalesce(finished_at::text, 'pending') FROM _prisma_migrations ORDER BY started_at" >"$BACKUP_DIR/migrations-after-$(date -u +%Y%m%dT%H%M%SZ).txt"
chmod 0600 "$BACKUP_DIR"/migrations-after-*.txt
install -d "$ROOT_DIR/apps/web/.next/standalone/apps/web/.next/cache"
chown robux:robux "$ROOT_DIR/apps/web/.next/standalone/apps/web/.next/cache"
chmod 0750 "$ROOT_DIR/apps/web/.next/standalone/apps/web/.next/cache"

# Stop only this Compose project's old application containers; its persistent DB/Redis remain up.
"${COMPOSE[@]}" stop api worker scheduler frontend nginx >/dev/null
for unit in robux-api robux-worker robux-scheduler robux-web; do systemctl restart "$unit.service"; done

wait_http(){ local url=$1 i; for ((i=0;i<30;i++)); do curl -fsS --max-time 3 "$url" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
API_PORT="$(getv API_PORT)"; WEB_PORT="$(getv WEB_PORT)"
wait_http "http://127.0.0.1:$API_PORT/health/ready" || die 'API loopback health check failed.'
wait_http "http://127.0.0.1:$WEB_PORT/telegram-store" || die 'Web /telegram-store loopback health check failed.'
for key in WORKER_HEALTH_PORT SCHEDULER_HEALTH_PORT; do
  wait_http "http://127.0.0.1:$(getv "$key")/health/ready" || die "$key readiness failed."
done

for unit in robux-api robux-web robux-worker robux-scheduler; do
  systemctl is-active --quiet "$unit.service" || die "$unit.service is not active."
  printf 'Robux service %s: ACTIVE; HTTP health check passed.\n' "$unit"
done
printf 'Robux PostgreSQL/Redis: Compose startup health checks passed; process readiness passed.\n'
nginx -t || die 'nginx -t failed; host Nginx was NOT reloaded.'
# deploy.sh does not write Nginx configuration; setup-vps.sh reloads only its changes.
printf 'Robux Nginx configuration not modified by deploy; reload skipped.\n'
nginx -T >"$SNAPSHOT_DIR/nginx-after-robux-deploy.txt" 2>&1 || die 'Post-deploy nginx -T failed.'
# No existing server_name may disappear during this deployment.
grep -E '^[[:space:]]*server_name[[:space:]]' "$SNAPSHOT_DIR/nginx-before-robux-deploy.txt" | sed -E 's/^[[:space:]]*server_name[[:space:]]+//;s/;.*$//' | tr ' ' '\n' | sed '/^$/d' | sort -u >"$SNAPSHOT_DIR/robux-server-names-before.txt"
grep -E '^[[:space:]]*server_name[[:space:]]' "$SNAPSHOT_DIR/nginx-after-robux-deploy.txt" | sed -E 's/^[[:space:]]*server_name[[:space:]]+//;s/;.*$//' | tr ' ' '\n' | sed '/^$/d' | sort -u >"$SNAPSHOT_DIR/robux-server-names-after.txt"
if comm -23 "$SNAPSHOT_DIR/robux-server-names-before.txt" "$SNAPSHOT_DIR/robux-server-names-after.txt" | grep -q .; then
  die 'Existing Nginx server_name entries changed or disappeared.'
fi
http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://$DOMAIN/")"
[[ "$http_code" == 301 || "$http_code" == 308 ]] || die "HTTP to HTTPS redirect failed (HTTP $http_code)."
web_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/telegram-store")"
[[ "$web_code" =~ ^[23][0-9][0-9]$ ]] || die "Public Telegram Mini App failed (HTTP $web_code)."
api_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/health/live")"
[[ "$api_code" =~ ^2[0-9][0-9]$ ]] || die "Public API health failed (HTTP $api_code)."
hook_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/api/v1/telegram/webhook" || true)"
[[ "$hook_code" == 404 || "$hook_code" == 405 ]] || die "Unexpected Telegram webhook GET probe status: $hook_code"
TOKEN_FILE="$(getv TELEGRAM_BOT_TOKEN_FILE)"; SECRET_FILE="$(getv TELEGRAM_WEBHOOK_SECRET_FILE)"
TOKEN_FILE="${TOKEN_FILE:-$SECRETS_DIR/telegram_bot_token.txt}"; SECRET_FILE="${SECRET_FILE:-$SECRETS_DIR/telegram_webhook_secret.txt}"
if [[ -s "$TOKEN_FILE" && -s "$SECRET_FILE" ]]; then
  TOKEN="$(tr -d '\r\n' <"$TOKEN_FILE")"; WEBHOOK_SECRET="$(tr -d '\r\n' <"$SECRET_FILE")"
  [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || die 'Invalid Telegram bot token format.'
  [[ "$WEBHOOK_SECRET" =~ ^[A-Za-z0-9_-]{16,256}$ ]] || die 'Invalid Telegram webhook secret format.'
  WEBHOOK_URL="https://$DOMAIN/api/v1/telegram/webhook"
  response="$(curl -fsS --config - 2>/dev/null <<EOF
url = "https://api.telegram.org/bot$TOKEN/setWebhook"
request = "POST"
data-urlencode = "url=$WEBHOOK_URL"
data-urlencode = "secret_token=$WEBHOOK_SECRET"
EOF
)" || die 'Telegram webhook registration failed; token was not printed.'
  printf '%s' "$response" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") else 1)' || die 'Telegram rejected webhook registration.'
  response="$(curl -fsS --config - 2>/dev/null <<EOF
url = "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
EOF
)" || die 'Telegram webhook status query failed; token was not printed.'
  printf '%s' "$response" | python3 -c 'import json,sys; x=json.load(sys.stdin).get("result",{}); sys.exit(0 if x.get("url")==sys.argv[1] and not x.get("last_error_message") else 1)' "$WEBHOOK_URL" || die 'Telegram webhook verification failed.'
else
  printf 'Telegram credentials are not configured; webhook registration skipped.\n'
fi

printf '\nDeployment complete. Domain: https://%s\nAPI: 127.0.0.1:%s\nWeb: 127.0.0.1:%s\nMini App: https://%s/telegram-store\n' "$DOMAIN" "$API_PORT" "$WEB_PORT" "$DOMAIN"
printf 'Telegram webhook endpoint: https://%s/api/v1/telegram/webhook (HTTP %s to GET probe)\n' "$DOMAIN" "$hook_code"
printf 'Payment/treasury flags were not enabled or changed. Review units with: systemctl status robux-api robux-web robux-worker robux-scheduler\n'
