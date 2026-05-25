#!/usr/bin/env bash
#
# Build tree-sitter-arkts WASM grammar for CodeGraph-ArkTS.
#
# Usage:
#   scripts/build-wasm-arkts.sh [source-path]
#
#   source-path:  path to tree-sitter-arkts source directory (default: ../tree-sitter-arkts)
#
# Prerequisites:
#   - Node.js (for npx tree-sitter-cli)
#
# The resulting .wasm is written to src/extraction/wasm/tree-sitter-arkts.wasm
# (relative to the repo root).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$REPO_ROOT/src/extraction/wasm/tree-sitter-arkts.wasm"

# Source directory: argument, sibling dir, or prompt
if [ -n "${1:-}" ]; then
  SRC="$1"
else
  SRC="$REPO_ROOT/../tree-sitter-arkts"
fi

if [ ! -d "$SRC" ]; then
  echo "Error: tree-sitter-arkts source not found at: $SRC"
  echo ""
  echo "Clone it first:"
  echo "  git clone https://github.com/harmony-contrib/tree-sitter-arkts.git \"$SRC\""
  echo ""
  echo "Then re-run this script, or pass the path as an argument:"
  echo "  scripts/build-wasm-arkts.sh /path/to/tree-sitter-arkts"
  exit 1
fi

if [ ! -f "$SRC/grammar.js" ] && [ ! -f "$SRC/src/grammar.json" ]; then
  echo "Error: '$SRC' does not appear to be a tree-sitter grammar (no grammar.js or src/grammar.json)"
  exit 1
fi

echo ":: Building tree-sitter-arkts WASM from: $SRC"
npx tree-sitter-cli build --wasm -o "$OUTPUT" "$SRC"

echo ":: Done! Written to: $OUTPUT"
ls -lh "$OUTPUT"
