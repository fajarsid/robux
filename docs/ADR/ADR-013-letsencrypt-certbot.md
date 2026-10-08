# ADR-013: Let's Encrypt certificates managed by Certbot

**Status:** Accepted

## Context

Production previously required Cloudflare Origin Certificate files mounted as Docker
secrets. The deployment target now uses publicly trusted Let's Encrypt certificates and
must also support HTTP-01 renewal without storing TLS keys in the repository.

## Decision

Certbot runs on the VPS and stores canonical certificate material under `/etc/letsencrypt`.
Nginx mounts that directory read-only. A dedicated host group grants only the Nginx
container read access to the private key; a Certbot deploy hook reapplies the group/mode and
reloads Nginx after renewal. The deploy helper starts a temporary HTTP-only Nginx template
to serve the ACME webroot, obtains and verifies the certificate for the domains in `.env`,
then starts the regular HTTPS configuration. HTTP redirects to HTTPS except the ACME
challenge path.

CI tests the temporary ACME HTTP configuration without fabricating certificates. Public
certificate issuance, HTTPS, and renewal dry-run are verified on the configured VPS.

## Consequences

- Production no longer depends on `origin_cert.pem` or `origin_key.pem`.
- Inbound TCP/80 must reach Nginx for HTTP-01 challenges; HTTPS remains on TCP/443.
- Certbot and systemd renewal are host dependencies. Cloudflare proxying is optional; when
  enabled, its SSL mode must be Full (strict).
- Nginx remains unprivileged, and PostgreSQL/Redis remain private.
- DNS, a valid certificate contact email, and a Telegram bot token must be configured by
  the operator; deployment does not invent credentials.
