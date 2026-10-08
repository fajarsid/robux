# Production Deployment

Production uses the existing host Nginx as the only public edge. API, web, worker and
scheduler are separate non-root systemd services. Docker Compose runs PostgreSQL 17 and
Redis only; both host bindings are loopback-only and their named data volumes are retained.
The application does not require Docker Nginx, Docker Certbot, or immutable image tags.

```text
Internet :80/:443 → host Nginx → 127.0.0.1 API / Web
                                    ├── systemd API, worker, scheduler
                                    └── systemd Next.js standalone web
Docker PostgreSQL and Redis → 127.0.0.1 only
```

## Provision the VPS

Run these commands from the checked-out repository on the VPS. The scripts require the
existing host Nginx, host Certbot, Docker Compose, Node.js 22.12+, Corepack/pnpm, systemd,
`ss`, `getent`, `curl`, and `nginx -T`. They do not install or replace the VPS's global Nginx.

```bash
sudo ./setup-vps.sh
sudoedit /etc/robux/production.env
```

Set `DOMAIN` to the confirmed public domain in `/etc/robux/production.env`, and configure
Telegram and any approved payment credentials in files under `/etc/robux/secrets/`. The
setup script creates a dedicated `robux` system user, chooses ports only after checking
`ss -ltnp` and current Docker port mappings, creates the four systemd units, and adds a
single Robux virtual host following the active host Nginx include convention. It refuses a
missing/unresolved domain, a port conflict it cannot safely reuse, or a domain already
owned by another virtual host. It snapshots the prior Nginx configuration and only reloads
after `nginx -t` passes. A failed validation restores the Robux vhost and never reloads.
When migrating a Robux checkout, it carries forward its public `APP_DOMAIN`/`API_DOMAIN`,
database names, non-secret feature flags, and existing files in the configured `SECRETS_DIR`
only when destination values do not exist. If the production Docker volume exists but its
database or encryption secrets cannot be recovered, setup stops rather than generating new
keys that would make persisted data unreadable.

Production configuration and credentials stay outside Git:

```text
/etc/robux/production.env     root:robux 0600
/etc/robux/secrets/*          root:robux, restricted by /etc/robux directory
```

Secret files are created only when absent. Existing values are preserved. Do not copy
production secrets into the repository's `.env` or `secrets/` directory.

## TLS and Nginx

The setup script does not issue a certificate. After DNS points to the VPS and the new HTTP
vhost is active, issue/attach the normal host certificate:

```bash
sudo nginx -t
# Run the certbot --nginx command with domain arguments printed by setup-vps.sh.
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Use the exact domain arguments printed by `setup-vps.sh`; it preserves a configured legacy
API hostname as an optional alias and includes it in the certificate request.

Certbot and its renewal timer remain host-managed. The Robux vhost routes `/api/` and
`/health/live` to the API and all other paths, including `/telegram-store`, to the web app.
The webhook is `/api/v1/telegram/webhook`. No WebSocket-specific headers are added; the current application uses ordinary HTTP.
Access logging is disabled for this vhost to avoid recording sensitive URL parameters. Do not stop, disable, restart,
replace, or reinstall global Nginx. Postgres and Redis are never published on public
interfaces; only host Nginx owns ports 80/443.

## Deploy

Once setup, environment, secrets, and TLS are ready:

```bash
sudo ./deploy.sh
```

The script requires a clean Git checkout with an upstream and pulls using `--ff-only`,
installs from the frozen pnpm lockfile, builds, validates Compose, starts only the existing
production Postgres/Redis services, runs `prisma migrate deploy`, and then restarts the four
systemd services. It stops only this Compose project's legacy application containers
(`api`, `worker`, `scheduler`, `frontend`, `nginx`) after the build and migration pass; it
never removes containers' persistent volumes. Health checks cover the local API and
`/telegram-store`, HTTPS and redirect behavior, and the API/web paths through host Nginx.
The script checks API, worker and scheduler readiness, then snapshots Nginx server names before/after its graceful reload and refuses to
continue if existing names disappear. It registers/verifies the Telegram webhook only when
both token and webhook-secret files are configured; tokens are not printed.

The deploy script does not enable production payment, Stars, TON treasury, Binance
withdrawals, Fragment, or fulfillment suppliers. Existing feature flags are not silently
rewritten. The template defaults these sensitive integrations off.

## Services and operations

```bash
sudo systemctl status robux-api robux-web robux-worker robux-scheduler
sudo journalctl -u robux-api -u robux-web -u robux-worker -u robux-scheduler -f
docker compose --env-file /etc/robux/production.env -f docker-compose.yml -f docker-compose.prod.yml ps
ss -ltnp
sudo nginx -t
```

Current API and Web listen on their selected loopback ports in `/etc/robux/production.env`.
Worker and scheduler health ports are loopback-only. PostgreSQL/Redis host ports are selected
separately and bound to `127.0.0.1`. Compose project name and volumes remain `robux-prod`;
do not use `down -v`, `volume prune`, or remove the named volumes during deployment.

## Failure and rollback

Build or migration failure stops before restarting the app services. systemd keeps each
process non-root and restarts it after failure. For an application rollback, record the
deployed Git revision, check out the previous known-good revision in a maintenance window,
then run `sudo bash ./deploy.sh --no-pull` to rebuild/migrate/restart without pulling
the newer revision back in. The same option supports a reviewed, intentionally dirty local
checkout; it never discards files. Do not use `git reset --hard`. Database
migrations may not be reversible; restore a verified database backup only under the
separate database recovery procedure. Nginx configuration backups created by setup are
stored next to the Robux vhost; no other virtual host is modified.

## Runtime verification

This repository-side change has not been run on the VPS. Before calling deployment complete,
verify `nginx -T`, `nginx -t`, all four systemd units, Docker health for PostgreSQL/Redis,
`ss -ltnp`, `http://<DOMAIN>` redirect, `https://<DOMAIN>/telegram-store`,
`https://<DOMAIN>/api/v1/telegram/webhook`, and several existing VPS domains. Then open the
bot in Telegram and verify `/start` → Mini App. Do not report these runtime checks as passed
until they have been executed on that host.

## Migration precautions

Setup switches the Robux vhost from the old Docker edge to direct upstreams. Until the
first build and service start finish, the Robux domain may return 502. Schedule this
first migration in a maintenance window; unrelated virtual hosts are not changed.
Subsequent builds run in the checkout, so a build can affect an already running Next.js
process even before restart. This simple deployment is not a zero-downtime release system.

DNS resolution is checked automatically. Confirm separately that all resolved A/AAAA
records point to this VPS (or its intended proxy) before running Certbot. Setup does not
change DNS. Certificates, renewal, and Telegram client behavior require VPS verification.

Both scripts serialize execution with a shared lock and save Nginx snapshots in a root-only
`/var/tmp/robux-deploy.*` directory. Backups contain sensitive configuration: keep their
permissions restrictive and periodically archive/remove obsolete copies manually.
No database contents are backed up by these scripts; migration history is an audit snapshot,
not a database backup. Take a verified database backup before schema changes.

Provisioning intentionally requires the host dependencies to be installed already; it does
not reinstall shared VPS infrastructure. If legacy Telegram secrets were environment values
rather than files, move them manually to the external secret files without printing them.
The production runtime rejects mock payment/fulfillment by design. This refactor does not
weaken that gate to make a staging workflow look production-ready.
