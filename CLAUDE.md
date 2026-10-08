# CLAUDE.md

Automated Robux fulfillment platform: Next.js storefront + NestJS API, worker and scheduler, PostgreSQL, Redis/BullMQ, Nginx, all run by Docker Compose.

## Mandatory rules

- **Every future implementation must follow `docs/ENGINEERING_STANDARDS.md`. These rules apply across all phases unless explicitly superseded by a documented architecture decision.**
- **Git hold:** do not `git commit`, `push`, `merge`, `tag` or `rebase`, and never run `git reset --hard` or `git clean -fd`, unless the project owner explicitly says so. Do not configure remotes. Leave changes uncommitted. Every phase report ends with git status (modified, new, deleted, untracked files; commits created: NONE; push performed: NONE). If a commit seems appropriate, ask first.
- Docker Compose is the only process manager. No PM2 (ADR-002).
- No unofficial Roblox fulfillment, credential handling, cookie/session use, CAPTCHA/auth bypass or browser automation (R-01, `docs/SECURITY.md` §6). Fulfillment uses `MockFulfillmentProvider` until an authorized provider and its API contract exist.
- Payments: Duitku only through `PaymentGateway` (`modules/payments`), contract in `docs/integrations/duitku.md`. A callback is a trigger; only Check Transaction (verify-by-fetch) can make a payment PAID. No simulated gateway in the app (`PAYMENT_GATEWAY=none` turns payments off).
- Never invent external API contracts (Duitku, Roblox, providers). Implement against official documentation saved under `docs/integrations/`, or leave a port + mock.
- Money is computed only by the backend (`quotePrice`); the browser displays API amounts and never sends them. Order status changes only through the transition table in `orders/domain/order-state-machine.ts` (ARCHITECTURE.md 5.3, 6.1).

## Where things are

| Topic                                         | Document                        |
| --------------------------------------------- | ------------------------------- |
| Product requirements                          | `docs/PRD.md`                   |
| Phases, decisions (D-xx), risks, Phase status | `docs/IMPLEMENTATION_PLAN.md`   |
| System design, flows, state machines          | `docs/ARCHITECTURE.md`          |
| Security controls                             | `docs/SECURITY.md`              |
| Running and deploying                         | `docs/DEPLOYMENT.md`            |
| Code structure and conventions                | `docs/ENGINEERING_STANDARDS.md` |
| Architecture decisions                        | `docs/ADR/`                     |

## Commands

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm format:check
pnpm --filter @robux/api test:integration   # PostgreSQL + Redis via Testcontainers, needs Docker
# Dev and prod are separate Compose projects with separate volumes (robux-dev / robux-prod, DEPLOYMENT.md §3).
sh scripts/check-no-pm2.sh

cp .env.example .env && sh scripts/generate-secrets.sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait
curl -H "Host: app.localhost" http://127.0.0.1:8088/
curl -H "Host: api.localhost" http://127.0.0.1:8088/health/live
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api node dist/seed/run-seed.js   # dev data
# Dev accounts (development only): superadmin@ / admin@ / operator@ / customer@dev.robux.test,
# password in apps/api/src/modules/auth/domain/development-accounts.ts. Staff console: /console (sign-in /console/login);
# staff 2FA is optional and can be enabled under Console -> Security.
# Production staff: node dist/cli/create-staff-account.js --email ... --role ... (one-time password).
```
