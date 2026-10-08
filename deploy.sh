#!/usr/bin/env bash
# Deploy Robux behind existing host Nginx. Never stop/restart host Nginx.
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")
MARKER="# managed-by-robux-deploy"
WEBROOT=/var/www/letsencrypt
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
getv(){ sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed -E "s/^['\"]|['\"]$//g"; }
setv(){
 local key="$1" val="$2" tmp found=0 line
 tmp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
 while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == "$key="* ]]; then
   if (( found == 0 )); then printf '%s=%s\n' "$key" "$val" >>"$tmp"; found=1; fi
  else printf '%s\n' "$line" >>"$tmp"; fi
 done <"$ENV_FILE"
 (( found )) || printf '%s=%s\n' "$key" "$val" >>"$tmp"
 chmod 0600 "$tmp"; chown root:root "$tmp"; mv -f "$tmp" "$ENV_FILE"
}
[[ $EUID -eq 0 ]] || die 'Run: sudo ./deploy.sh <immutable-image-tag>.'
[[ -f "$ENV_FILE" ]] || die 'DOMAIN_REQUIRED: create .env with intended APP_DOMAIN and API_DOMAIN; no domain is guessed.'
for cmd in docker nginx certbot curl getent systemctl ss python3 openssl; do command -v "$cmd" >/dev/null || die "Required command missing: $cmd"; done
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin required.'
chmod 0600 "$ENV_FILE"; chown root:root "$ENV_FILE"
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$ROOT_DIR" check-ignore --quiet "$ENV_FILE"; then die '.env is not ignored by Git.'; fi
APP_HOST="$(getv APP_DOMAIN)"; API_HOST="$(getv API_DOMAIN)"
[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ && "$APP_HOST" != *localhost* ]] || die 'DOMAIN_REQUIRED: set public APP_DOMAIN in .env.'
[[ "$API_HOST" =~ ^[A-Za-z0-9.-]+$ && "$API_HOST" != *localhost* ]] || die 'DOMAIN_REQUIRED: set public API_DOMAIN in .env.'
[[ "$APP_HOST" != "$API_HOST" ]] || die 'APP_DOMAIN and API_DOMAIN must be distinct.'
for host in "$APP_HOST" "$API_HOST"; do getent ahostsv4 "$host" >/dev/null || die "DNS does not resolve: $host"; done
TAG="${1:-${IMAGE_TAG:-}}"; [[ -n "$TAG" && "$TAG" != local ]] || die 'Use sudo ./deploy.sh <immutable-image-tag>.'
export IMAGE_TAG="$TAG"
[[ "$(systemctl is-active nginx)" == active ]] || die 'Host Nginx not active; refusing to start/replace it.'
mkdir -p /tmp; nginx -T >/tmp/nginx-before-robux.txt 2>&1 || die 'Existing nginx config invalid; no changes made.'
listeners="$(ss -H -ltnp)"
ss -H -ltnp 'sport = :80' | grep -q nginx || die 'Port 80 is not owned by host Nginx.'
ss -H -ltnp 'sport = :443' | grep -q nginx || die 'Port 443 is not owned by host Nginx.'
SECRETS_DIR="$(getv SECRETS_DIR)"; SECRETS_DIR="${SECRETS_DIR:-./secrets}"
[[ "$SECRETS_DIR" = /* ]] || SECRETS_DIR="$ROOT_DIR/$SECRETS_DIR"
mkdir -p "$SECRETS_DIR"; chmod 0700 "$SECRETS_DIR"; (cd "$ROOT_DIR" && SECRETS_DIR="$SECRETS_DIR" bash scripts/generate-secrets.sh)
for s in postgres_password.txt redis_password.txt csrf_secret.txt totp_encryption_key.txt idempotency_encryption_key.txt account_inventory_encryption_key.txt; do [[ -s "$SECRETS_DIR/$s" ]] || die "Missing secret $SECRETS_DIR/$s"; done
setv TRUSTED_ORIGINS "https://$APP_HOST"; setv TELEGRAM_MINI_APP_URL "https://$APP_HOST/telegram-store"
setv DUITKU_CALLBACK_URL "https://$API_HOST/api/v1/webhooks/payments/duitku"; setv DUITKU_RETURN_URL "https://$APP_HOST/payment/return"
setv PAYMENT_GATEWAY none; setv PAYMENT_PROVIDER_STARS_ENABLED false; setv TELEGRAM_STARS_PRODUCTION_AUTHORIZED false
setv TON_TREASURY_ENABLED false; setv TON_TREASURY_PRODUCTION_AUTHORIZED false; setv BINANCE_WITHDRAWAL_ENABLED false
freeport(){ ! ss -H -ltn "sport = :$1" | grep -q .; }
PORT="$(getv ROBUX_LOCAL_PORT)"
EXISTING_NGINX="$("${COMPOSE[@]}" ps -q nginx 2>/dev/null || true)"
if [[ "$PORT" =~ ^[0-9]+$ ]] && ! freeport "$PORT" && [[ -n "$EXISTING_NGINX" ]] \
  && docker inspect --format '{{json .NetworkSettings.Ports}}' "$EXISTING_NGINX" | grep -Fq "\"HostIp\":\"127.0.0.1\",\"HostPort\":\"$PORT\""; then
  : # Reuse this project's current localhost binding on repeat deployments.
elif [[ ! "$PORT" =~ ^[0-9]+$ ]] || ! freeport "$PORT"; then PORT=''; for p in $(seq 8088 8199); do if freeport "$p"; then PORT="$p"; break; fi; done; fi
[[ -n "$PORT" ]] || die 'No free port in 8088-8199.'
setv ROBUX_LOCAL_PORT "$PORT"
info(){ printf '\n==> %s\n' "$*"; }
info "Robux Docker edge will bind only 127.0.0.1:$PORT."
"${COMPOSE[@]}" config --quiet
case "${DEPLOY_BUILD:-true}" in true|1|yes) "${COMPOSE[@]}" build --pull;; false|0|no) "${COMPOSE[@]}" pull;; *) die 'DEPLOY_BUILD must be true or false.';; esac
"${COMPOSE[@]}" up -d --wait --wait-timeout "${DEPLOY_WAIT_SECONDS:-240}"
NGINX_CID="$("${COMPOSE[@]}" ps -q nginx)"
[[ -n "$NGINX_CID" ]] || die 'Robux Docker Nginx container was not created.'
docker inspect --format '{{json .NetworkSettings.Ports}}' "$NGINX_CID" | grep -Fq "\"HostIp\":\"127.0.0.1\",\"HostPort\":\"$PORT\"" || die 'Robux Docker Nginx is not published exclusively on the selected localhost port.'
EDGE_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -H "Host: $APP_HOST" "http://127.0.0.1:$PORT/")"
[[ "$EDGE_CODE" =~ ^[23][0-9][0-9]$ ]] || die "Robux local edge failed (HTTP $EDGE_CODE)."
"${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
"${COMPOSE[@]}" exec -T frontend node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
"${COMPOSE[@]}" exec -T nginx wget -q -O /dev/null http://127.0.0.1:8081/nginx-health
nginx -T >/tmp/nginx-before-robux.txt 2>&1
if grep -Fq 'include /etc/nginx/sites-enabled/' /tmp/nginx-before-robux.txt; then
 VHOST=/etc/nginx/sites-available/robux.conf; LINK=/etc/nginx/sites-enabled/robux.conf; mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
elif grep -Fq 'include /etc/nginx/conf.d/' /tmp/nginx-before-robux.txt; then VHOST=/etc/nginx/conf.d/robux.conf
else die 'Unknown host Nginx include convention; no vhost written.'; fi
if [[ -e "$VHOST" ]] && ! grep -Fq "$MARKER" "$VHOST"; then die "$VHOST is not managed by Robux."; fi
for h in "$APP_HOST" "$API_HOST"; do
 if grep -E "^[[:space:]]*server_name[^;]*([[:space:]]|^)$h([[:space:];]|$)" /tmp/nginx-before-robux.txt | grep -q . \
   && ! grep -Fq "$MARKER" /tmp/nginx-before-robux.txt; then die "$h already belongs to another vhost."; fi
done
LINK_CREATED=0
if [[ -n "${LINK:-}" && -L "$LINK" && "$(readlink -f "$LINK")" != "$VHOST" ]]; then die "$LINK points to a different vhost; refusing to replace it."; fi
if [[ -n "${LINK:-}" && -e "$LINK" && ! -L "$LINK" ]]; then die "$LINK is not the expected symlink; refusing to replace it."; fi
EMAIL="$(getv CERTBOT_EMAIL)"; [[ "$EMAIL" == *@*.* ]] || die 'Set valid CERTBOT_EMAIL in .env.'
mkdir -p "$WEBROOT/.well-known/acme-challenge"; chmod 0755 "$WEBROOT" "$WEBROOT/.well-known" "$WEBROOT/.well-known/acme-challenge"
CERT="/etc/letsencrypt/live/$APP_HOST"; BACKUP=''
if [[ -f "$VHOST" ]]; then BACKUP="$VHOST.backup.$(date -u +%Y%m%dT%H%M%SZ)"; cp -a "$VHOST" "$BACKUP"; fi
write_http(){
cat >"$VHOST" <<EOF
$MARKER
server {
 listen 80;
 listen [::]:80;
 server_name $APP_HOST $API_HOST;
 location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; try_files \$uri =404; }
 location / { return 301 https://\$host\$request_uri; }
}
EOF
}
write_https(){
cat >"$VHOST" <<EOF
$MARKER
server {
 listen 80;
 listen [::]:80;
 server_name $APP_HOST $API_HOST;
 location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; try_files \$uri =404; }
 location / { return 301 https://\$host\$request_uri; }
}
server {
 listen 443 ssl http2;
 listen [::]:443 ssl http2;
 server_name $APP_HOST $API_HOST;
 ssl_certificate $CERT/fullchain.pem;
 ssl_certificate_key $CERT/privkey.pem;
 location / {
  proxy_pass http://127.0.0.1:$PORT;
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Request-Id \$request_id;
  proxy_set_header Upgrade \$http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 60s;
 }
}
EOF
}
restore_vhost(){
 if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then cp -a "$BACKUP" "$VHOST"; else rm -f "$VHOST"; fi
 if [[ "$LINK_CREATED" == 1 ]]; then rm -f "$LINK"; fi
 nginx -t && systemctl reload nginx
}
trap 's=$?; if ((s)) && { [[ "$LINK_CREATED" == 1 ]] || { [[ -n "${VHOST:-}" && -f "${VHOST:-}" ]] && grep -Fq "$MARKER" "$VHOST"; }; }; then restore_vhost; fi' EXIT
if [[ -n "${LINK:-}" && ! -e "$LINK" && ! -L "$LINK" ]]; then ln -s "$VHOST" "$LINK"; LINK_CREATED=1; fi
write_http; nginx -t || die 'nginx -t failed; restoring only Robux vhost.'
systemctl reload nginx || die 'Host Nginx reload failed; host process was not stopped.'
probe="robux-acme-$$"; printf 'robux-acme-ok\n' >"$WEBROOT/.well-known/acme-challenge/$probe"
for h in "$APP_HOST" "$API_HOST"; do [[ "$(curl -fsS -H "Host: $h" "http://127.0.0.1/.well-known/acme-challenge/$probe")" == robux-acme-ok ]] || die "ACME route failed for $h."; done
rm -f "$WEBROOT/.well-known/acme-challenge/$probe"
CERT_VALID=0
if [[ -s "$CERT/fullchain.pem" && -s "$CERT/privkey.pem" ]] \
  && openssl x509 -in "$CERT/fullchain.pem" -noout -checkend 86400 >/dev/null 2>&1 \
  && openssl x509 -in "$CERT/fullchain.pem" -noout -checkhost "$APP_HOST" >/dev/null 2>&1 \
  && openssl x509 -in "$CERT/fullchain.pem" -noout -checkhost "$API_HOST" >/dev/null 2>&1; then CERT_VALID=1; fi
if [[ "$CERT_VALID" != 1 ]]; then
  domains=(-d "$APP_HOST"); [[ "$API_HOST" == "$APP_HOST" ]] || domains+=(-d "$API_HOST")
  expand=(); [[ -s "$CERT/fullchain.pem" ]] && expand+=(--expand)
  certbot certonly --non-interactive --agree-tos --email "$EMAIL" --webroot --webroot-path "$WEBROOT" --cert-name "$APP_HOST" --keep-until-expiring "${expand[@]}" "${domains[@]}"
fi
[[ -s "$CERT/fullchain.pem" && -s "$CERT/privkey.pem" ]] || die 'Let?s Encrypt certificate missing.'
openssl x509 -in "$CERT/fullchain.pem" -noout -checkend 86400 >/dev/null || die 'Certificate is expired or expires within 24 hours.'
openssl x509 -in "$CERT/fullchain.pem" -noout -checkhost "$APP_HOST" >/dev/null || die 'Certificate does not cover APP_DOMAIN.'
openssl x509 -in "$CERT/fullchain.pem" -noout -checkhost "$API_HOST" >/dev/null || die 'Certificate does not cover API_DOMAIN.'
KEY="$(readlink -f "$CERT/privkey.pem")"; [[ "$(stat -c '%a' "$KEY")" =~ ^(600|640)$ ]] || die 'Private key permissions must be 600 or 640.'
write_https; nginx -t || die 'HTTPS nginx -t failed; restoring only Robux vhost.'
systemctl reload nginx || die 'Host Nginx reload failed.'
if systemctl list-unit-files --no-legend 2>/dev/null | grep -q '^certbot.timer'; then
 systemctl is-active --quiet certbot.timer || die 'Host Certbot timer is not active; enable it using the VPS standard Certbot setup.'
elif systemctl list-unit-files --no-legend 2>/dev/null | grep -q '^snap.certbot.renew.timer'; then
 systemctl is-active --quiet snap.certbot.renew.timer || die 'Host Certbot renewal timer is not active.'
else die 'Could not verify an existing host Certbot renewal timer; no duplicate timer was created.'; fi
HOOK_DIR=/etc/letsencrypt/renewal-hooks/deploy
HOOK="$HOOK_DIR/robux-host-nginx-reload"
mkdir -p "$HOOK_DIR"
if [[ -e "$HOOK" ]] && ! grep -Fq '# managed-by-robux-deploy' "$HOOK"; then die "$HOOK exists and is not managed by Robux."; fi
if [[ ! -e "$HOOK" ]]; then
 cat >"$HOOK" <<'EOF'
#!/usr/bin/env bash
# managed-by-robux-deploy
set -Eeuo pipefail
nginx -t
systemctl reload nginx
EOF
 chown root:root "$HOOK"; chmod 0750 "$HOOK"
fi
certbot renew --cert-name "$APP_HOST" --dry-run
nginx -T >/tmp/nginx-after-robux.txt 2>&1 || die 'Post-deploy nginx -T failed.'
for h in smartpad.web.id quranest.web.id ride.fajarhub.tech mbgcore.id ceotopup.com layartopup.com; do
 if grep -Fq "$h" /tmp/nginx-before-robux.txt; then
  grep -Fq "$h" /tmp/nginx-after-robux.txt || die "Existing vhost $h disappeared."
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$h/" || true)"
  [[ "$code" =~ ^[23][0-9][0-9]$ ]] || die "Existing project $h failed smoke test; stopping."
  printf 'Existing project %s: HTTP %s\n' "$h" "$code"
 fi
done
http="$(curl -sS -o /dev/null -w '%{http_code}' "http://$APP_HOST/")"; [[ "$http" == 301 || "$http" == 308 ]] || die "HTTP redirect failed ($http)."
mini="$(curl -sS -o /dev/null -w '%{http_code}' "https://$APP_HOST/telegram-store")"; [[ "$mini" =~ ^[23][0-9][0-9]$ ]] || die "Mini App failed ($mini)."
api="$(curl -sS -o /dev/null -w '%{http_code}' "https://$API_HOST/health/live")"; [[ "$api" =~ ^[23][0-9][0-9]$ ]] || die "API failed ($api)."
hook="$(curl -sS -o /dev/null -w '%{http_code}' "https://$APP_HOST/api/v1/telegram/webhook")"; [[ "$hook" =~ ^[1-5][0-9][0-9]$ ]] || die 'Webhook route returned no HTTP response.'
TOKEN="$(getv TELEGRAM_BOT_TOKEN)"; SECRET="$(getv TELEGRAM_WEBHOOK_SECRET)"
if [[ -n "$TOKEN" && -n "$SECRET" ]]; then
 URL="https://$APP_HOST/api/v1/telegram/webhook"
 response="$(curl -sS --config - 2>/dev/null <<EOF
url = "https://api.telegram.org/bot$TOKEN/setWebhook"
request = "POST"
data-urlencode = "url=$URL"
data-urlencode = "secret_token=$SECRET"
EOF
)" || die 'Telegram webhook registration failed.'
 printf '%s' "$response" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") else 1)' || die 'Telegram rejected webhook.'
 response="$(curl -sS --config - 2>/dev/null <<EOF
url = "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
EOF
)" || die 'Telegram webhook status query failed.'
 printf '%s' "$response" | python3 -c 'import json,sys; x=json.load(sys.stdin); r=x.get("result",{}); print("Webhook URL:",r.get("url","")); print("Last error:",r.get("last_error_message") or "none"); sys.exit(0 if x.get("ok") and r.get("url")==sys.argv[1] and not r.get("last_error_message") else 1)' "$URL" || die 'Telegram webhook verification failed.'
else printf '\nNOTICE: Telegram token/secret absent; registration skipped.\n'; fi
printf '\nNOTICE: Payment gateway forced to none; fulfillment provider remains none for staging.\n'
printf 'Robux edge: 127.0.0.1:%s; Mini App: https://%s/telegram-store\n' "$PORT" "$APP_HOST"
"${COMPOSE[@]}" ps --all
