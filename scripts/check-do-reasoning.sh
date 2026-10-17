#!/usr/bin/env bash
# Probe every DigitalOcean GenAI model to detect reasoning/thinking output.
#
# Usage (run in YOUR terminal; never paste the key into chat):
#   bash scripts/check-do-reasoning.sh
#
# Env: ZEN_DIGITALOCEAN_API_KEY (required)
#      ZEN_DIGITALOCEAN_BASE_URL (optional, default https://inference.do-ai.run/v1)

set -euo pipefail

: "${ZEN_DIGITALOCEAN_API_KEY:?export ZEN_DIGITALOCEAN_API_KEY first}"
BASE_URL="${ZEN_DIGITALOCEAN_BASE_URL:-https://inference.do-ai.run/v1}"
BASE_URL="${BASE_URL%/}"

tmpdir=$(mktemp -d)

echo "Probing models on $BASE_URL ..."

curl_err=$(curl -fsS -m 20 -H "Authorization: Bearer $ZEN_DIGITALOCEAN_API_KEY" "$BASE_URL/models" 1>"$tmpdir/models.json" 2>"$tmpdir/curl.err") || curl_err="$(cat "$tmpdir/curl.err")"

if [ -n "$curl_err" ]; then
  echo "ERROR: could not reach $BASE_URL/models" >&2
  echo "  $curl_err" >&2
  echo "Hints:" >&2
  echo "  - network problems: if you use a proxy/VPN, make sure it is running" >&2
  echo "  - wrong endpoint: copy the URL from the DO console, set ZEN_DIGITALOCEAN_BASE_URL" >&2
  echo "  - invalid key: re-check ZEN_DIGITALOCEAN_API_KEY" >&2
  exit 1
fi

ids=$(python3 -c "import sys,json; k=chr(105)+chr(100); data=json.load(sys.stdin).get(chr(100)+chr(97)+chr(116)+chr(97),[]); print(chr(10).join(m[k] for m in data if isinstance(m.get(k),str)))" < "$tmpdir/models.json" 2>/dev/null) || ids=""

if [ -z "$ids" ]; then
  echo "ERROR: $BASE_URL/models returned an unexpected (empty or non-list) JSON body." >&2
  exit 1
fi

total=$(printf "%s\n" "$ids" | wc -l | tr -d " ")
echo "Found $total model(s). Sending a tiny test prompt to each one (small cost) ..."
echo

reasoning=""
for id in $ids; do
  payload=$(printf "{\"model\":\"%s\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 17*19?\"}],\"max_tokens\":64}" "$id")
  resp=$(curl -fsS -m 45 -H "Authorization: Bearer $ZEN_DIGITALOCEAN_API_KEY" -H "Content-Type: application/json" -d "$payload" "$BASE_URL/chat/completions" 2>/dev/null || true)
  if printf "%s" "$resp" | grep -q "reasoning_content\|\"reasoning\""; then
    echo "REASONING   $id"
    if [ -z "$reasoning" ]; then reasoning="$id"; else reasoning="$reasoning,$id"; fi
  else
    echo "normal      $id"
  fi
done

rm -rf "$tmpdir"

echo
if [ -n "$reasoning" ]; then
  echo "Models that returned reasoning content:"
  echo "  $reasoning"
  echo
  echo "Set this in YOUR terminal (or replace the old line in ~/.zshrc):"
  echo "  export ZEN_DIGITALOCEAN_REASONING_MODELS=$reasoning"
else
  echo "No model returned reasoning content - leave ZEN_DIGITALOCEAN_REASONING_MODELS unset."
fi