# ADR-013: Let's Encrypt certificates managed by Certbot

**Status:** Accepted

## Context

Production runs on a VPS whose host Nginx already serves multiple applications and owns
public ports 80/443. Robux must integrate as one additional virtual host without changing
the global Nginx configuration or storing TLS keys in the repository.

## Decision

Host-level Certbot stores canonical certificate material under `/etc/letsencrypt`, which
only host Nginx reads. The Robux Docker Nginx is HTTP-only and bound to an unused
`127.0.0.1` port. The deploy helper detects the host's existing `sites-enabled` or `conf.d`
convention, manages only its own marked vhost, serves the HTTP-01 webroot, validates with
`nginx -t`, and gracefully reloads (never stops or restarts) host Nginx.

Public certificate issuance, HTTPS, renewal dry-run, and existing-domain smoke tests run on
the configured VPS. CI validates the private Docker edge and does not fabricate TLS files.

## Consequences

- Production does not depend on Cloudflare Origin Certificate files or TLS mounts in Docker.
- Inbound TCP/80 must reach Nginx for HTTP-01 challenges; HTTPS remains on TCP/443.
- Certbot and systemd renewal are host dependencies. Cloudflare proxying is optional; when
  enabled, its SSL mode must be Full (strict).
- The global host Nginx must already be active and is never stopped, disabled, replaced, or
  restarted by `deploy.sh`; only `nginx -t` and a graceful reload are used.
- The Docker edge publishes only an unused loopback port; PostgreSQL/Redis remain private.
- DNS, a valid certificate contact email, and a Telegram bot token must be configured by
  the operator; deployment does not invent credentials.
