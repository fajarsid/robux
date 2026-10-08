# Deployment refactor result

Repository implementation completed; VPS deployment is **NOT VERIFIED**. This session has
local Windows repository access, not an SSH connection to the shared VPS.

## Architecture

- Existing host Nginx owns public HTTP/HTTPS and proxies API/Web over localhost.
- API, Web, Worker, Scheduler use non-root `robux` systemd services.
- Host Certbot manages TLS; no Origin Certificate or Docker Certbot requirement.
- PostgreSQL 17 and Redis retain the `robux-prod` Compose project and named volumes.
  Only their loopback host ports are published. Production scripts start these two services
  explicitly; legacy Compose application definitions remain for compatibility.
- Environment and secrets live in `/etc/robux`; existing encryption keys are preserved.
- Deployment no longer requires an image tag. Normal deployment pulls with `--ff-only`;
  `--no-pull` uses the reviewed local checkout, including during application rollback.
- Payment and treasury flags are not enabled by deployment.

## Validation

| Check | Result |
| --- | --- |
| API unit tests | 389 passed / 49 suites |
| Web tests | 153 passed / 29 files |
| Typecheck | PASS |
| Lint | PASS |
| Workspace build | PASS |
| Offline deployment tests | 8 passed |
| Bash syntax, both scripts | PASS |
| Production Compose configuration | PASS |
| git diff --check | PASS |
| Full PostgreSQL integration | NOT RUN in this deployment refactor |
| Host Nginx/systemd/Certbot | NOT VERIFIED |
| Existing VPS domains | NOT VERIFIED |
| Live Telegram / Mini App flow | NOT VERIFIED |

The Docker daemon is unavailable in the local environment, so container startup and live
loopback database connectivity were not exercised. No remote configuration, DNS, certificate,
production data, or other VPS application was changed. No Git commit/push was performed.

## Files

Deployment scripts: `deploy.sh`, `setup-vps.sh`, `scripts/production-database-url.py`,
`scripts/test-production-deployment.py`.

Configuration: `infra/systemd/*`, `infra/nginx/host/*`, `.env.example`,
`docker-compose.yml`, `docker-compose.prod.yml`.

Runtime: API configuration and startup accept an explicit bind host; the existing default
remains compatible with containers. Business domains and state machines were not changed.

Documentation: deployment guide, ADR-014, supersession notices in ADR-002 and ADR-013.

## VPS execution

Use the existing checkout, typically `/var/www/robux`. Review and transfer these local changes
before execution; scripts do not publish changes to the remote repository.

```bash
cd /var/www/robux
sudo bash ./setup-vps.sh
# If DOMAIN_REQUIRED appears, configure the confirmed domain and rerun setup:
sudoedit /etc/robux/production.env
sudo bash ./setup-vps.sh
# Verify DNS points to this VPS. Run the host certbot command printed by setup.
# Then, for this reviewed local working tree:
sudo bash ./deploy.sh --no-pull
# For later clean-checkout deployments with an upstream:
sudo bash ./deploy.sh
```

Confirm the server domain (previously requested: `tele.fajarhub.tech`) in server configuration.
Ports are selected on the VPS; local candidate values are not proof of availability.
Verify `/telegram-store`, the API webhook, all services, renewal with
`certbot renew --dry-run`, existing projects, and the real Telegram `/start` flow before
declaring deployment successful.

## Limitations

- First migration needs a maintenance window for Robux; setup switches its upstreams before
  systemd services start. Unrelated vhosts are preserved.
- Builds run in-place, not as atomic releases. Failed builds do not restart services, but
  an active Next.js process can be affected by changed build files.
- DNS resolution alone does not establish that records point to this VPS; verify this before
  issuing a certificate. No automatic DNS changes are made.
- Migration-history snapshots are not database backups. Database rollback requires a separate
  verified recovery plan.
- Production rejects mock payment/fulfillment; this security gate remains unchanged.
