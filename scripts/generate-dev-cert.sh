#!/bin/sh
# Retained for compatibility with old setup notes; certificates must not be fabricated.
set -eu
echo "This project no longer generates self-signed or Origin certificates."
echo "Production TLS is issued and renewed by Certbot; CI uses the HTTP-only ACME bootstrap config."
exit 2
