#!/bin/sh
# Secret scan with gitleaks (Docker image).
#   1. Working tree: only files git would commit (tracked + untracked, minus .gitignore).
#      Ignored files such as secrets/, .env and build output are intentionally skipped:
#      they hold local secrets and generated keys by design and can never be committed.
#   2. History: every commit, once the repository has any.
set -eu

# Git Bash on Windows rewrites /container/paths in arguments; disable that and pass
# host paths in Windows form instead.
export MSYS_NO_PATHCONV=1
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

image=zricethezav/gitleaks:v8.28.0
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

git ls-files --cached --others --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C "$workdir"
docker run --rm -v "$(host_path "$workdir"):/scan:ro" "$image" dir --redact --config /scan/.gitleaks.toml /scan

if git rev-parse --verify -q HEAD >/dev/null; then
  docker run --rm -v "$(host_path "$(pwd)"):/repo:ro" "$image" git --redact --config /repo/.gitleaks.toml /repo
fi
echo "OK: no secrets found"
