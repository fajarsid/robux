# secrets/

Runtime secret files mounted into containers via Docker Compose `secrets:`.
Everything in this directory except this README is git-ignored.

Generate local values with:

```bash
./scripts/generate-secrets.sh
```

Files:

| File                                   | Used by                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `postgres_password.txt`                | postgres, migrate, api, worker, scheduler                                         |
| `redis_password.txt`                   | redis, api, worker, scheduler                                                     |
| `csrf_secret.txt`                      | api (HMAC key for session-bound CSRF tokens)                                      |
| `totp_encryption_key.txt`              | api (AES-256-GCM key for staff TOTP secrets, 64 hex chars)                        |
| `idempotency_encryption_key.txt`       | api (AES-256-GCM key for tracking tokens in stored order responses, 64 hex chars) |
| `account_inventory_encryption_key.txt` | api (AES-256-GCM key for digital account payloads at rest, 64 hex chars)          |
| `duitku_merchant_code.txt`             | api (Duitku project code; from the Duitku dashboard, placeholder created empty)   |
| `duitku_api_key.txt`                   | api (Duitku API key, signs requests and verifies callbacks; from the dashboard)   |
| `origin_cert.pem`, `origin_key.pem`    | nginx (production TLS)                                                            |

Production: create these files on the host (readable by the container users, see DEPLOYMENT.md §5), owned by root, never copied from a developer machine.
