#!/bin/sh
# Runs as the unprivileged `redis` user (Compose `user:`). Writes the auth include from the
# secret file so the password never appears in the process list or the image.
set -eu
umask 077
printf 'requirepass %s\n' "$(cat /run/secrets/redis_password)" > /tmp/redis-auth.conf
exec redis-server /usr/local/etc/redis/redis.conf
