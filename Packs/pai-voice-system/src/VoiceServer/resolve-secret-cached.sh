#!/bin/bash
# resolve-secret-cached.sh <tb-sec-alias> <cache-file-path>
#
# Resolves a secret via tb-sec; on success, caches it locally (0600) so an
# off-network start can still use the last-known-good value instead of
# failing outright. Never caches an empty/failed lookup — a transient
# resolve failure must not overwrite a good cached value with nothing.
#
# Prints the resolved value to stdout (capture with $(...), never bare —
# same discipline as every other tb-sec call in this codebase). Exits 1
# only when BOTH the live resolve and the cache are unavailable; the
# caller decides whether that's fatal (see start-with-secrets.sh: it is
# for the Dante GATEWAY on plato, since an empty token there means "auth
# silently disabled" — it is NOT for a consumer's optional cascade tier,
# which should just skip that tier and fall through).
set -uo pipefail

ALIAS="${1:?usage: resolve-secret-cached.sh <alias> <cache-file>}"
CACHE_FILE="${2:?usage: resolve-secret-cached.sh <alias> <cache-file>}"

mkdir -p "$(dirname "$CACHE_FILE")"

VALUE="$(tb-sec get "$ALIAS" 2>/dev/null)"
if [ -n "$VALUE" ]; then
  # Live resolve succeeded — refresh the cache for the next off-network start.
  ( umask 077; printf '%s' "$VALUE" > "$CACHE_FILE" )
  printf '%s' "$VALUE"
  exit 0
fi

# Live resolve failed (network down, cluster unreachable, tb-sec missing,
# etc.) — fall back to the last successfully-cached value, if any.
if [ -s "$CACHE_FILE" ]; then
  cat "$CACHE_FILE"
  exit 0
fi

echo "resolve-secret-cached: tb-sec get $ALIAS failed and no cached value exists at $CACHE_FILE" >&2
exit 1
