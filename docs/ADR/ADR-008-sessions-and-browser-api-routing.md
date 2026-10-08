# ADR-008: Server-side Sessions and Same-origin Browser API Routing

- **Status:** Accepted
- **Date:** 2026-10-05 (Phase 3)
- **Related:** ADR-002 §3 (routing; this ADR adopts its documented fallback for browser traffic), SECURITY.md §3 and §7, DATABASE.md (`user_sessions`)

## Context

Phase 3 introduces browser authentication. Two earlier decisions meet here:

1. Sessions are server-side and opaque; no JWT in the browser (D-04, SECURITY.md §3).
2. ADR-002 routed `app.<domain>` to the frontend and `api.<domain>` to the API, which made every browser API call cross-origin. To let Next.js server rendering see the session, the session cookie would have had to be scoped to the parent domain.

Working through the implementation exposed problems with that cookie design:

- A parent-domain cookie is sent to every subdomain. Any future subdomain (marketing site, status page, third-party tool) would receive session cookies.
- `__Host-` cookies, the strongest browser protection against cookie injection from sibling subdomains, cannot have a `Domain` attribute, so they were not usable.
- In local development `app.localhost` and `api.localhost` are different sites, so `SameSite=Lax` cookies are not sent on cross-origin fetches at all; development would need a different cookie policy from production.
- Every browser request needed CORS with credentials, adding preflights and configuration surface.

## Decision

### Browser traffic is same-origin

Nginx routes the frontend host's `/api/` path to the API:

```text
app.<domain>/api/*  → api:4000   (browser calls, same origin as the page)
app.<domain>/*      → frontend:3000
api.<domain>/*      → api:4000   (webhooks, server-to-server, health)
```

The frontend calls `/api/v1/...` relative to its own origin. Next.js server components call `http://api:4000` on the internal network and forward the incoming `Cookie` header. The frontend's own health route moves from `/api/healthz` to `/healthz` so the `/api` path belongs entirely to the API.

### Session model

- Token: 256-bit CSPRNG value, base64url. Only its SHA-256 hash is stored (`user_sessions.token_hash`). The session store is PostgreSQL; Redis is not used for sessions.
- Cookie: `__Host-sid`, `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`. Host-only on the frontend host. No identity data in any client-readable cookie.
- Lifetimes: customer idle 7 days / absolute 30 days; staff idle 30 minutes / absolute 12 hours; staff session waiting for 2FA: absolute 5 minutes.
- Rotation: a new token is issued at login (any session presented at login time is revoked: fixation defence), after 2FA succeeds, and after a password change (which also revokes every other session of the user).
- Theft signal: presenting a token that was revoked by rotation while a newer session of the same family is active revokes the whole family.
- Logout revokes the server-side session and its family, and clears the cookie.

### CSRF and CORS

- Every state-changing request (POST, PUT, PATCH, DELETE) must carry an `Origin` (or, failing that, `Referer`) from the trusted-origin list. Requests without either are rejected. Webhook endpoints opt out explicitly and authenticate by signature instead.
- Requests with a session must also carry `X-CSRF-Token`, equal to HMAC-SHA256(`CSRF_SECRET`, session token hash). The value is returned by `GET /api/v1/auth/session`. `SameSite=Lax` is defence in depth, not the control.
- CORS remains enabled only for the exact trusted origins (never `*`), for any legitimate cross-origin use of `api.<domain>`. Browser traffic itself no longer needs it.

## Consequences

**Positive:** host-only `__Host-` cookie; identical cookie behaviour in development and production; no browser CORS preflights; SSR sees the session naturally; the parent-domain exposure documented as a risk in ADR-002 is gone.

**Negative:** the frontend host now proxies API traffic (one Nginx location); `/api` on the frontend host is reserved for the backend.

## Alternatives considered

- **Parent-domain cookie + CORS (ADR-002 original):** rejected for the reasons above.
- **Next.js route handlers as a backend-for-frontend proxy:** rejected; Nginx already does the routing with less code and no extra hop in the Node process.
- **JWT access + refresh tokens:** rejected by D-04; revocation and rotation are simpler with server-side sessions.
