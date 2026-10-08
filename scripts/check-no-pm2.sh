#!/bin/sh
# Fails if PM2 is installed, configured or invoked anywhere (ADR-002: Docker Compose manages
# all processes). Comments that merely state "no PM2" are allowed.
set -eu
pattern='"pm2"|pm2-runtime|ecosystem\.config|(^|[^A-Za-z0-9_-])pm2 +(start|restart|reload|resurrect|startup|save|install)'
if git grep --untracked -n -I -E "$pattern" -- ':!docs/**' ':!scripts/check-no-pm2.sh'; then
  echo "PM2 usage found. Docker Compose is the only process manager (ADR-002)." >&2
  exit 1
fi
echo "OK: no PM2 dependency, config or invocation"
