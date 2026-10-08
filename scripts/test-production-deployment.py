"""Offline deployment checks; never run setup or mutate host infrastructure."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
BASH = (r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash"))


class DeploymentTests(unittest.TestCase):
    def test_shell_syntax(self):
        for name in ("deploy.sh", "setup-vps.sh"):
            result = subprocess.run([BASH, "-n", name], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def run_port_selection(self, old, occupied=(), active=False, owner=123):
        source = (ROOT / "setup-vps.sh").read_text()
        function = source[source.index("choose(){"):source.index("printf 'Inspecting current listeners")]
        harness = f"""set -Eeuo pipefail
export PATH=/usr/bin:/bin:$PATH
die(){{ echo "$*" >&2; exit 1; }}
getv(){{ echo {old}; }}
setv(){{ echo "$1=$2"; }}
reserved(){{ return 1; }}
busy(){{ case "$1" in {'|'.join(map(str, occupied)) or 'none'}) return 0;; *) return 1;; esac; }}
active(){{ {'true' if active else 'false'}; }}
systemctl(){{ echo 123; }}
ss(){{ echo 'users:(("node",pid={owner},fd=1))'; }}
{function}
choose API_PORT 8082
"""
        return subprocess.run([BASH], input=harness, cwd=ROOT, capture_output=True, text=True)

    def test_free_port_preserved(self):
        result = self.run_port_selection(8082)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "API_PORT=8082")

    def test_busy_port_skipped(self):
        result = self.run_port_selection(8082, (8082, 8083))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "API_PORT=8084")

    def test_public_edge_port_rejected(self):
        self.assertNotEqual(self.run_port_selection(443).returncode, 0)

    def test_own_active_listener_reused(self):
        result = self.run_port_selection(8082, (8082,), active=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "API_PORT=8082")

    def test_foreign_listener_never_reused(self):
        result = self.run_port_selection(8082, (8082,), active=True, owner=999)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("other than robux-api", result.stderr)

    def test_database_password_encoded_without_shell_evaluation(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            secret = directory / "password.txt"
            password = 'long-$(`not-a-command`)/?#@password'
            secret.write_text(password)
            env = directory / "production.env"
            env.write_text(f"POSTGRES_PASSWORD_FILE={secret}\nPOSTGRES_PORT=5433\n")
            result = subprocess.run([sys.executable, str(ROOT / "scripts/production-database-url.py"), str(env)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            parsed = urlparse(result.stdout.strip())
            self.assertEqual(unquote(parsed.password), password)
            self.assertEqual(parsed.hostname, "127.0.0.1")
            self.assertEqual(parsed.port, 5433)
            self.assertEqual(result.stderr, "")

    def test_missing_password_fails_without_url(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "production.env"
            env.write_text(f"POSTGRES_PASSWORD_FILE={directory}/missing\n")
            result = subprocess.run([sys.executable, str(ROOT / "scripts/production-database-url.py"), str(env)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
