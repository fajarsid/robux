#!/usr/bin/env python3
"""Emit a Prisma connection URL from the protected host env file without sourcing shell code."""
from pathlib import Path
from urllib.parse import quote
import sys


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/robux/production.env")
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if not key.replace("_", "").isalnum():
            raise SystemExit("Invalid environment key in production env file.")
        values[key] = value.strip().strip("\"'")

    password_file = Path(values.get("POSTGRES_PASSWORD_FILE", "/etc/robux/secrets/postgres_password.txt"))
    try:
        password = password_file.read_text(encoding="utf-8").strip()
    except OSError:
        raise SystemExit("PostgreSQL password file is unavailable.") from None
    if len(password) < 16:
        raise SystemExit("PostgreSQL password file must contain a strong password.")
    host = values.get("POSTGRES_HOST", "127.0.0.1")
    port = values.get("POSTGRES_PORT", "5432")
    database = values.get("POSTGRES_DB", "robux")
    user = values.get("POSTGRES_USER", "robux")
    print(f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{quote(database, safe='')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
