#!/usr/bin/env bash
# ==============================================================================
# Module: Gate Infrastructure (Quality Audit Example Script)
# File Path: scripts/sh/example-gate.sh
# Architecture Role: Local and CI automated gate entrypoint (Linux Bash)
# Dependencies & Triggers: .githooks / local CLI / CI -> staged & working tree -> exit codes & logs
# Responsibilities: Single-pass streaming staged audit and isolated impacted subproject execution
# Exit Semantics & Design Rationale: 0=PASS, non-zero=BLOCK on violation
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

GATE_ROOT_DIR="$ROOT"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT/scripts/sh/lib/gate-runtime.sh"
gate_init_git_isolation "$ROOT"
gate_resolve_runtime_bins

if [[ -z "${NODE_BIN:-}" ]]; then
  echo "✖ BLOCK  Missing Node.js runtime" >&2
  exit 1
fi

if [[ -z "${NPM_BIN:-}" ]]; then
  echo "✖ BLOCK  Missing npm runtime" >&2
  exit 1
fi

echo "Starting local quality gate..."

FAST_GATE="$ROOT/scripts/common/gate-fast-staged.js"
if [[ -f "$FAST_GATE" ]]; then
  echo "Running fast streaming staged audit..."
  STATUS=0
  "$NODE_BIN" "$FAST_GATE" || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "✖ BLOCK  Fast staged audit failed" >&2
    exit "$STATUS"
  fi
fi

SUBPROJECT="$ROOT/auto-refactor"
if [[ -d "$SUBPROJECT" ]]; then
  echo "Running isolated subproject test suite..."
  STATUS=0
  (cd "$SUBPROJECT" && "$NPM_BIN" test) || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "✖ BLOCK [AR-TEST-02] Subproject tests failed" >&2
    exit "$STATUS"
  fi
fi

echo "✔ PASS  [AR-TEST-02] All checks passed"
exit 0
