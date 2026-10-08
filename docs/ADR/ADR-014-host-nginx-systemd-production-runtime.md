# ADR-014: Host Nginx and systemd for the production VPS

**Status:** Accepted  
**Date:** 2026-10-08  
**Supersedes:** ADR-002 production process-lifecycle and edge decisions  
**Related:** ADR-001, ADR-004, ADR-008, ADR-013, `docs/DEPLOYMENT.md`

## Context

The production VPS already hosts unrelated applications behind one host-level Nginx and
Certbot installation. A per-project Docker Nginx edge and immutable image release flow adds
operational complexity and creates a risk of port conflicts with the shared host edge.

## Decision

- The existing host Nginx remains the only public edge and continues to own ports 80/443.
- The Robux virtual host proxies the same public domain's `/api/` paths to the API and other
  paths (including `/telegram-store`) to the Web process over loopback.
- Host Certbot manages Let's Encrypt certificates under `/etc/letsencrypt`. The project does
  not require a Docker Nginx, a Certbot container, or Cloudflare Origin Certificate files.
- API, Web, Worker, and Scheduler run as separate non-root systemd services. Their code is
  built from the repository checkout with the locked pnpm toolchain; deployment does not
  require immutable image tags.
- PostgreSQL and Redis remain Docker services to preserve the existing Postgres 17/Redis
  setup and named volumes. Their only host bindings are selected localhost ports.
- Deployment runs frozen dependency installation, build, migration, controlled service
  restart, Nginx validation/reload, and health checks. It never changes unrelated vhosts or
  stops/restarts global Nginx. A failed Nginx validation does not trigger reload.
- Secrets and production configuration live under `/etc/robux`, outside the checkout.

## Consequences

- Production process supervision differs from the development Compose topology; the four
  systemd unit files and environment file are the source of truth for app runtime.
- Build and migration failures stop before application restarts. Database schema rollback
  remains a separate recovery operation because migrations are not presumed reversible.
- Existing Postgres/Redis data volumes are retained. No live payment, treasury, supplier, or
  fulfillment feature is enabled by this deployment decision.
- Host Nginx, DNS, TLS issuance, Telegram webhook state, service health, and existing VPS
  domains must be verified on the target VPS; repository tests cannot establish those facts.
