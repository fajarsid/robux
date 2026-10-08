#!/usr/bin/env bash
# One-time setup for host Nginx + systemd app services. Never replaces global Nginx.
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONF=/etc/robux
SECRETS="$CONF/secrets"
ENV_FILE="$CONF/production.env"
MARKER='# managed-by-robux'
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'Run: sudo ./setup-vps.sh'
for c in flock mktemp cp node corepack docker nginx certbot systemctl ss getent install sed awk runuser curl openssl groupadd useradd id find chgrp chmod chown cp date grep readlink tr comm sort; do command -v "$c" >/dev/null || die "Missing host command: $c"; done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin is required.'
docker info >/dev/null 2>&1 || die 'Docker daemon unavailable; refusing to infer that existing data volumes are absent.'
exec 9>/run/lock/robux-deployment.lock
flock -n 9 || die 'Another Robux setup/deployment is running.'
SNAPSHOT_DIR="$(mktemp -d /var/tmp/robux-deploy.XXXXXX)"
chmod 0700 "$SNAPSHOT_DIR"
printf 'Private audit snapshots: %s\n' "$SNAPSHOT_DIR"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a===22&&b>=12?0:1)' || die 'Node.js 22.12+ is required.'
getent group robux >/dev/null 2>&1 || groupadd --system robux
id robux >/dev/null 2>&1 || useradd --system --gid robux --create-home --home-dir /var/lib/robux --shell /usr/sbin/nologin robux
install -d -o root -g robux -m 0750 "$CONF" "$SECRETS"
ENV_CREATED=0
if [[ ! -e "$ENV_FILE" ]]; then install -o root -g robux -m 0600 "$ROOT_DIR/infra/systemd/production.env.example" "$ENV_FILE"; ENV_CREATED=1; fi
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || die "$ENV_FILE must be a regular file."
chmod 0600 "$ENV_FILE"; chown root:robux "$ENV_FILE"
cp -a "$ENV_FILE" "$ENV_FILE.backup.$(date -u +%Y%m%dT%H%M%SZ)"
getv(){ awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); value=$0} END{print value}' "$ENV_FILE"; }
setv(){ local k=$1 v=$2 t; [[ "$v" != *$'\n'* && "$v" != *$'\r'* ]] || die "Invalid value for $k"; t="$(mktemp "$CONF/env.XXXXXX")"; awk -F= -v k="$k" '$1!=k{print}' "$ENV_FILE" >"$t"; printf '%s=%s\n' "$k" "$v" >>"$t"; chmod 0600 "$t"; chown root:robux "$t"; mv "$t" "$ENV_FILE"; }
oldv(){ awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); gsub(/^[\047"]|[\047"]$/, "", $0); value=$0} END{print value}' "$ROOT_DIR/.env"; }
OLD_DOMAIN=''; LEGACY_SECRET_DIR=''
if [[ -f "$ROOT_DIR/.env" ]]; then
  candidate="$(oldv APP_DOMAIN)"
  if [[ "$candidate" =~ ^[A-Za-z0-9.-]+$ && "$candidate" != *localhost* ]]; then
    OLD_DOMAIN="$candidate"
    legacy_dir="$(oldv SECRETS_DIR)"; legacy_dir="${legacy_dir:-./secrets}"
    [[ "$legacy_dir" == /* ]] || legacy_dir="$ROOT_DIR/$legacy_dir"
    LEGACY_SECRET_DIR="$legacy_dir"
    if [[ -z "$(getv DOMAIN)" ]]; then setv DOMAIN "$OLD_DOMAIN"; fi
    if [[ "$ENV_CREATED" == 1 ]]; then
      for key in POSTGRES_DB POSTGRES_USER PAYMENT_GATEWAY PAYMENT_PROVIDER_STARS_ENABLED TELEGRAM_STARS_PRODUCTION_AUTHORIZED DUITKU_ENVIRONMENT DUITKU_PAYMENT_METHODS DUITKU_CALLBACK_ALLOWED_IPS DUITKU_REQUEST_TIMEOUT_MS FULFILLMENT_PROVIDER QUEUE_PREFIX WORKER_SHUTDOWN_TIMEOUT_MS LOG_LEVEL TON_TREASURY_ENABLED TON_TREASURY_PRODUCTION_AUTHORIZED BINANCE_WITHDRAWAL_ENABLED TON_TREASURY_MIN_BALANCE_NANO TON_TREASURY_TARGET_BALANCE_NANO TON_TREASURY_MAX_REFILL_NANO TON_TREASURY_DAILY_LIMIT_NANO TON_TREASURY_ALLOWED_ADDRESSES TON_SUPPLIER_ENABLED FRAGMENT_ENABLED; do
        value="$(oldv "$key")"; [[ -z "$value" ]] || setv "$key" "$value"
      done
    fi
    alias="$(oldv API_DOMAIN)"
    if [[ "$(getv DOMAIN)" == "$OLD_DOMAIN" && -z "$(getv API_DOMAIN_ALIAS)" && "$alias" =~ ^[A-Za-z0-9.-]+$ && "$alias" != *localhost* && "$alias" != "$OLD_DOMAIN" ]]; then setv API_DOMAIN_ALIAS "$alias"; fi
  fi
fi
# Populate an empty environment left by an earlier setup, preserving configured domains.
if [[ -z "$(getv DOMAIN)" ]]; then
  default_domain="$(awk -F= '$1=="DOMAIN" {print $2; exit}' "$ROOT_DIR/infra/systemd/production.env.example")"
  setv DOMAIN "$default_domain"
fi
busy(){ ss -H -ltn "sport = :$1" | grep -q .; }
reserved(){
  local port=$1 own=$2 key
  for key in API_PORT WEB_PORT POSTGRES_HOST_PORT REDIS_HOST_PORT WORKER_HEALTH_PORT SCHEDULER_HEALTH_PORT; do
    [[ "$key" == "$own" ]] && continue
    [[ "$(getv "$key")" == "$port" ]] && return 0
  done
  return 1
}
active(){ systemctl is-active --quiet "robux-$1" 2>/dev/null; }
cert_ready(){
  [[ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && -s "/etc/letsencrypt/live/$DOMAIN/privkey.pem" && -s /etc/letsencrypt/options-ssl-nginx.conf && -s /etc/letsencrypt/ssl-dhparams.pem ]] || return 1
  openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null 2>&1 || return 1
  [[ -z "$API_ALIAS" ]] || openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$API_ALIAS" >/dev/null 2>&1
}
choose(){
  local k=$1 start=$2 old p pid svc=''
  old="$(getv "$k")"
  [[ -z "$old" || "$old" =~ ^[1-9][0-9]{3,4}$ ]] || die "Invalid configured port: $k"
  [[ -z "$old" ]] || (( old > 1024 && old < 65536 )) || die "Port outside allowed range: $k"
  case "$k" in API_PORT) svc=api;; WEB_PORT) svc=web;; WORKER_HEALTH_PORT) svc=worker;; SCHEDULER_HEALTH_PORT) svc=scheduler;; esac
  if [[ "$old" =~ ^[0-9]+$ ]] && ! busy "$old" && ! reserved "$old" "$k"; then setv "$k" "$old"; return; fi
  if [[ -n "$svc" && "$old" =~ ^[0-9]+$ ]] && ! reserved "$old" "$k" && active "$svc"; then
    pid="$(systemctl show -p MainPID --value "robux-$svc.service")"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] && ss -H -ltnp "sport = :$old" | grep -Fq "pid=$pid," || die "$k is occupied by a process other than robux-$svc."
    setv "$k" "$old"; return
  fi
  if [[ "$k" == POSTGRES_HOST_PORT || "$k" == REDIS_HOST_PORT ]]; then
    local cname=postgres; [[ "$k" == REDIS_HOST_PORT ]] && cname=redis
    if [[ "$old" =~ ^[0-9]+$ ]] && docker ps --format '{{.Names}} {{.Ports}}' | grep -E "robux-prod-$cname.*127\.0\.0\.1:$old->" >/dev/null; then setv "$k" "$old"; return; fi
  fi
  for ((p=start;p<start+100;p++)); do if ! busy "$p" && ! reserved "$p" "$k"; then setv "$k" "$p"; return; fi; done
  die "No free port for $k near $start."
}
printf 'Inspecting current listeners; existing services will not be stopped.\n'
ss -ltnp || true
docker ps --format 'table {{.Names}}\t{{.Ports}}' || true
choose API_PORT 8082; choose WEB_PORT 3211; choose POSTGRES_HOST_PORT 5433; choose REDIS_HOST_PORT 6380; choose WORKER_HEALTH_PORT 4081; choose SCHEDULER_HEALTH_PORT 4082
setv NODE_ENV production
setv API_HOST 127.0.0.1
setv API_INTERNAL_URL "http://127.0.0.1:$(getv API_PORT)"
setv HOSTNAME 127.0.0.1
setv PORT "$(getv WEB_PORT)"
setv POSTGRES_HOST 127.0.0.1
setv POSTGRES_PORT "$(getv POSTGRES_HOST_PORT)"
setv REDIS_HOST 127.0.0.1
setv REDIS_PORT "$(getv REDIS_HOST_PORT)"
setv SECRETS_DIR "$SECRETS"
if [[ -n "$LEGACY_SECRET_DIR" && -d "$LEGACY_SECRET_DIR" ]]; then
  for s in postgres_password redis_password csrf_secret totp_encryption_key idempotency_encryption_key account_inventory_encryption_key duitku_merchant_code duitku_api_key telegram_bot_token telegram_webhook_secret; do
    [[ -e "$SECRETS/${s}.txt" || ! -f "$LEGACY_SECRET_DIR/${s}.txt" ]] || install -o root -g robux -m 0444 "$LEGACY_SECRET_DIR/${s}.txt" "$SECRETS/${s}.txt"
  done
fi
STATEFUL_VOLUME=0
docker volume inspect robux-prod_pgdata >/dev/null 2>&1 && STATEFUL_VOLUME=1
docker volume inspect robux-prod_redisdata >/dev/null 2>&1 && STATEFUL_VOLUME=1
for s in postgres_password redis_password csrf_secret totp_encryption_key idempotency_encryption_key account_inventory_encryption_key; do
  f="$SECRETS/${s}.txt"
  if [[ "$STATEFUL_VOLUME" == 1 && ! -s "$f" ]]; then die "Existing production data volume detected but $f is missing; recover the original secret before setup."; fi
  [[ -e "$f" ]] || od -An -N32 -tx1 /dev/urandom | tr -d ' \n' >"$f"
  [[ -s "$f" ]] || die "Empty secret: $f"
  chown root:robux "$f"; chmod 0444 "$f"
done
for s in duitku_merchant_code duitku_api_key telegram_bot_token telegram_webhook_secret; do
  f="$SECRETS/${s}.txt"; [[ -e "$f" ]] || : >"$f"; chown root:robux "$f"; chmod 0444 "$f"
done
DOMAIN="$(getv DOMAIN)"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$DOMAIN" != *localhost* ]] || die 'DOMAIN_REQUIRED: fill DOMAIN in /etc/robux/production.env; Nginx was not changed.'
getent ahostsv4 "$DOMAIN" >/dev/null || die "PREREQUISITE_NOT_MET: Robux DNS for $DOMAIN does not resolve; Nginx was not changed."
API_ALIAS="$(getv API_DOMAIN_ALIAS)"
if [[ -n "$API_ALIAS" ]]; then
  [[ "$API_ALIAS" =~ ^[A-Za-z0-9.-]+$ && "$API_ALIAS" != *localhost* && "$API_ALIAS" != "$DOMAIN" ]] || die 'Invalid API_DOMAIN_ALIAS in production environment.'
  getent ahostsv4 "$API_ALIAS" >/dev/null || die "PREREQUISITE_NOT_MET: Robux API alias DNS for $API_ALIAS does not resolve."
fi
SERVER_NAMES="$DOMAIN"; [[ -z "$API_ALIAS" ]] || SERVER_NAMES="$DOMAIN $API_ALIAS"
setv TRUSTED_ORIGINS "https://$DOMAIN"
setv TELEGRAM_MINI_APP_URL "https://$DOMAIN/telegram-store"
setv DUITKU_CALLBACK_URL "https://$DOMAIN/api/v1/webhooks/payments/duitku"
setv DUITKU_RETURN_URL "https://$DOMAIN/payment/return"
[[ "$(systemctl is-active nginx 2>/dev/null || true)" == active ]] || die 'Host Nginx is not active; refusing to manage it.'
nginx -T >"$SNAPSHOT_DIR/nginx-before-robux.txt" 2>&1 || die 'Existing host Nginx config is invalid; no changes made.'
for p in 80 443; do ss -H -ltnp "sport = :$p" | grep -qi nginx || die "Host Nginx is not listening on :$p."; done
if [[ -e /etc/nginx/sites-available/robux.conf || -L /etc/nginx/sites-enabled/robux.conf ]]; then VHOST=/etc/nginx/sites-available/robux.conf; LINK=/etc/nginx/sites-enabled/robux.conf
elif [[ -e /etc/nginx/conf.d/robux.conf ]]; then VHOST=/etc/nginx/conf.d/robux.conf; LINK=
elif grep -Fq 'include /etc/nginx/sites-enabled/' "$SNAPSHOT_DIR/nginx-before-robux.txt"; then VHOST=/etc/nginx/sites-available/robux.conf; LINK=/etc/nginx/sites-enabled/robux.conf
elif grep -Fq 'include /etc/nginx/conf.d/' "$SNAPSHOT_DIR/nginx-before-robux.txt"; then VHOST=/etc/nginx/conf.d/robux.conf; LINK=
else die 'Unknown host Nginx include convention; no vhost written.'; fi
LEGACY=0
if [[ -e "$VHOST" ]] && ! grep -Fxq "$MARKER" "$VHOST"; then
  if grep -Fq '# managed-by-robux-deploy' "$VHOST" && grep -E "^[[:space:]]*server_name[^;]*([[:space:]]|^)$DOMAIN([[:space:];]|$)" "$VHOST" >/dev/null; then LEGACY=1; else die "$VHOST exists and is not the expected Robux-managed vhost."; fi
fi
count_domain(){ awk -v host="$1" '$1=="server_name" {for(i=2;i<=NF;i++){gsub(/;/,"",$i); if($i==host){n++; break}}} END{print n+0}' "$2"; }
for host in $SERVER_NAMES; do
  DOMAIN_BLOCKS="$(count_domain "$host" "$SNAPSHOT_DIR/nginx-before-robux.txt")"
  OWN_BLOCKS=0
  [[ ! -f "$VHOST" ]] || OWN_BLOCKS="$(count_domain "$host" "$VHOST")"
  (( DOMAIN_BLOCKS <= OWN_BLOCKS )) || die "$host also appears in another Nginx server block; refusing a duplicate host."
done
if [[ -n "$LINK" && -e "$LINK" && ! -L "$LINK" ]]; then die "$LINK exists but is not a symlink."; fi
if [[ -n "$LINK" && -L "$LINK" && "$(readlink -f "$LINK")" != "$VHOST" ]]; then die "$LINK targets another file."; fi
# Grant group read/traverse on code only; leave repo-local env, secrets and Git untouched.
find "$ROOT_DIR" -path "$ROOT_DIR/.git" -prune -o -path "$ROOT_DIR/secrets" -prune -o -name ".env*" -prune -o -type d -exec chgrp robux {} + -exec chmod g+rX {} +
find "$ROOT_DIR" -path "$ROOT_DIR/.git" -prune -o -path "$ROOT_DIR/secrets" -prune -o -name ".env*" -prune -o -type f -exec chgrp robux {} + -exec chmod g+r {} +
install -d -o robux -g robux -m 0750 "$ROOT_DIR/apps/web/.next/standalone/apps/web/.next/cache"
NODE_BIN="$(readlink -f "$(command -v node)")"
case "$NODE_BIN" in /root/*|/home/*) die 'Install Node.js system-wide; systemd ProtectHome hides home directories.';; esac
case "$ROOT_DIR" in /root/*|/home/*|*[[:space:]]*|*'%'*|*'&'*|*'|'*) die 'Use a system application path without spaces or template metacharacters, such as /var/www/robux.';; esac
runuser -u robux -- "$NODE_BIN" --version >/dev/null 2>&1 || die 'Node.js must be installed in a path accessible to the robux service user (not under /root).'
for service in api web worker scheduler; do
  t="$(mktemp "/etc/systemd/system/robux-$service.XXXXXX")"
  sed -e "s|@APP_ROOT@|$ROOT_DIR|g" -e "s|@NODE_BIN@|$NODE_BIN|g" "$ROOT_DIR/infra/systemd/robux-$service.service" >"$t"
  install -o root -g root -m 0644 "$t" "/etc/systemd/system/robux-$service.service"; rm -f "$t"
done
systemctl daemon-reload
systemctl enable robux-api robux-web robux-worker robux-scheduler
VHOST_BACKUP=''
CREATED_LINK=0
VHOST_CHANGED=0
if [[ ! -e "$VHOST" || "$LEGACY" == 1 ]]; then
  VHOST_CHANGED=1
  if [[ -e "$VHOST" ]]; then VHOST_BACKUP="$VHOST.backup.$(date -u +%Y%m%dT%H%M%SZ)"; cp -a "$VHOST" "$VHOST_BACKUP"; fi
  t="$(mktemp "$(dirname "$VHOST")/.robux.XXXXXX")"
  if cert_ready; then
    SOURCE="$ROOT_DIR/infra/nginx/host/robux-http-redirect.conf.template"
  else SOURCE="$ROOT_DIR/infra/nginx/host/robux.conf.template"; fi
  sed -e "s/@DOMAIN@/$DOMAIN/g" -e "s/@SERVER_NAMES@/$SERVER_NAMES/g" -e "s/@API_PORT@/$(getv API_PORT)/g" -e "s/@WEB_PORT@/$(getv WEB_PORT)/g" "$SOURCE" >"$t"
  if cert_ready; then
    sed -e "s/@DOMAIN@/$DOMAIN/g" -e "s/@SERVER_NAMES@/$SERVER_NAMES/g" "$ROOT_DIR/infra/nginx/host/robux-tls.conf.template" >>"$t"
  fi
  chown root:root "$t"; chmod 0644 "$t"; mv "$t" "$VHOST"
  if [[ -n "$LINK" && ! -L "$LINK" ]]; then ln -s "$VHOST" "$LINK"; CREATED_LINK=1; fi
else
  grep -E "server_name[^;]*$DOMAIN" "$VHOST" >/dev/null || die 'Managed Robux vhost does not match DOMAIN; inspect manually.'
  grep -Fq "server 127.0.0.1:$(getv API_PORT);" "$VHOST" || die 'Managed Nginx API upstream differs from the selected port; inspect manually.'
  grep -Fq "server 127.0.0.1:$(getv WEB_PORT);" "$VHOST" || die 'Managed Nginx Web upstream differs from the selected port; inspect manually.'
fi
if ! nginx -t; then
  if [[ "$VHOST_CHANGED" == 1 ]]; then
    if [[ -n "$VHOST_BACKUP" ]]; then cp -a "$VHOST_BACKUP" "$VHOST"; else rm -f "$VHOST"; fi
  fi
  [[ "$CREATED_LINK" == 0 ]] || rm -f "$LINK"
  nginx -t >/dev/null 2>&1 || true
  die 'nginx -t failed. Only the Robux vhost change was rolled back; host Nginx was NOT reloaded.'
fi
if [[ "$VHOST_CHANGED" == 1 || "$CREATED_LINK" == 1 ]]; then
  if ! systemctl reload nginx; then
    if [[ "$VHOST_CHANGED" == 1 ]]; then
      if [[ -n "$VHOST_BACKUP" ]]; then cp -a "$VHOST_BACKUP" "$VHOST"; else rm -f "$VHOST"; fi
    fi
    [[ "$CREATED_LINK" == 0 ]] || rm -f "$LINK"
    die 'Host Nginx reload failed; global Nginx was not stopped. Check active config.'
  fi
else
  printf 'Robux Nginx configuration unchanged; reload skipped.\n'
fi
nginx -T >"$SNAPSHOT_DIR/nginx-after-robux-setup.txt" 2>&1 || die 'Post-setup nginx -T failed.'
grep -E '^[[:space:]]*server_name[[:space:]]' "$SNAPSHOT_DIR/nginx-before-robux.txt" | sed -E 's/^[[:space:]]*server_name[[:space:]]+//;s/;.*$//' | tr ' ' '\n' | sed '/^$/d' | sort -u >"$SNAPSHOT_DIR/robux-setup-before.txt"
grep -E '^[[:space:]]*server_name[[:space:]]' "$SNAPSHOT_DIR/nginx-after-robux-setup.txt" | sed -E 's/^[[:space:]]*server_name[[:space:]]+//;s/;.*$//' | tr ' ' '\n' | sed '/^$/d' | sort -u >"$SNAPSHOT_DIR/robux-setup-after.txt"
if comm -23 "$SNAPSHOT_DIR/robux-setup-before.txt" "$SNAPSHOT_DIR/robux-setup-after.txt" | grep -q .; then die 'An existing host Nginx server_name disappeared; inspect Nginx immediately.'; fi
printf '\nSetup ready. No app services started and no certificate issued.\nDomain: %s\nAPI: 127.0.0.1:%s\nWeb: 127.0.0.1:%s\nPostgreSQL: Docker loopback :%s\nRedis: Docker loopback :%s\n' "$DOMAIN" "$(getv API_PORT)" "$(getv WEB_PORT)" "$(getv POSTGRES_HOST_PORT)" "$(getv REDIS_HOST_PORT)"
if [[ -n "$API_ALIAS" ]]; then printf 'After confirming DNS and secrets, run: sudo certbot --nginx -d %s -d %s\n' "$DOMAIN" "$API_ALIAS"; else printf 'After confirming DNS and secrets, run: sudo certbot --nginx -d %s\n' "$DOMAIN"; fi
printf 'Robux runtime health: NOT VERIFIED by setup; deploy.sh checks API, Web, Worker, Scheduler, PostgreSQL and Redis.\n'
printf 'Then deploy with: sudo ./deploy.sh\n'
