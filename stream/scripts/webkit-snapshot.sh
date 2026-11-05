#!/usr/bin/env bash
# Snapshots a page from the dev server in a real WKWebView, with Tauri's IPC
# stubbed. See "Checking the UI" in AGENTS.md.
#
#   pnpm snapshot --url http://localhost:3000/verify-x --out /tmp/x.png \
#     --stub my-stubs.js [--run checks.js] [--width 900 --height 600]
#
# tauri-stub.js is always injected first, so --stub files only need to set
# window.__TAURI_STUBS__.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
source_file="$here/webkit-snapshot/snapshot.swift"
binary_dir="$here/../src-tauri/target/webkit-snapshot"
binary="$binary_dir/snapshot"

if [ ! -x "$binary" ] || [ "$source_file" -nt "$binary" ]; then
  mkdir -p "$binary_dir"
  swiftc -O "$source_file" -o "$binary"
fi

url=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [ "${args[$i]}" = "--url" ]; then
    url="${args[$((i + 1))]:-}"
  fi
done

# The dev assetPrefix hardcodes port 3000, so any other port renders blank
if [[ "$url" == http://localhost:* ]] && [[ "$url" != http://localhost:3000* ]]; then
  echo "webkit-snapshot: serve on port 3000, or the page renders blank" >&2
  exit 64
fi
if [[ "$url" == http://localhost:3000* ]] &&
  ! curl -fs -o /dev/null --max-time 120 "$url"; then
  echo "webkit-snapshot: $url isn't serving; start \`pnpm dev\` first" >&2
  exit 69
fi

exec "$binary" --stub "$here/webkit-snapshot/tauri-stub.js" "$@"
