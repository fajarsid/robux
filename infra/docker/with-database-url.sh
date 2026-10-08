#!/bin/sh
# Builds DATABASE_URL for the Prisma CLI from non-secret parts and the password secret file,
# then runs the given command. Used only by the one-shot `migrate` service; the application
# processes assemble the URL in code and never export it to the environment.
set -eu

: "${POSTGRES_HOST:?}" "${POSTGRES_DB:?}" "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD_FILE:?}"

password="$(cat "$POSTGRES_PASSWORD_FILE")"
case "$password" in
  *[!A-Za-z0-9_-]*)
    echo "with-database-url: password must be URL-safe ([A-Za-z0-9_-]); regenerate it" >&2
    exit 1
    ;;
esac

DATABASE_URL="postgresql://${POSTGRES_USER}:${password}@${POSTGRES_HOST}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"
export DATABASE_URL
unset password

exec "$@"
