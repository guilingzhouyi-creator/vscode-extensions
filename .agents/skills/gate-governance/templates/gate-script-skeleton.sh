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

ALL_MODE=0
AGENT_MODE=0
VIEW_LOG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h|-Help)
      printf '%s\n' "Usage: bash scripts/sh/example-gate.sh [--all] [--agent] [--json] [--view-log] [--help]"
      printf '%s\n' "Options:"
      printf '%s\n' "  --all                  Run full target check regardless of staged scope"
      printf '%s\n' "  --agent, -a, -Agent    Emit machine-readable Agent-Native JSON output"
      printf '%s\n' "  --json, -j, -Json      Emit JSON output (equivalent to --agent)"
      printf '%s\n' "  --view-log, -v, -ViewLog View the latest failure diagnostic log"
      printf '%s\n' "  --help, -h, -Help      Show this help message"
      exit 0
      ;;
    --all|-All)
      ALL_MODE=1
      shift
      ;;
    --agent|-a|-Agent|--json|-j|-Json)
      AGENT_MODE=1
      shift
      ;;
    --view-log|-v|-ViewLog)
      VIEW_LOG=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

GATE_ROOT_DIR="$ROOT"
GATE_SUPPRESS="$AGENT_MODE"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT/scripts/sh/lib/gate-runtime.sh"
gate_init_git_isolation "$ROOT"
gate_resolve_runtime_bins

if [[ -z "${NODE_BIN:-}" ]]; then
  echo "✖ BLOCK  Missing Node.js runtime" >&2
  exit 1
fi

if [[ "$VIEW_LOG" -eq 1 ]]; then
  exec "$NODE_BIN" "$ROOT/scripts/common/log-rotator.js" --view
fi

if [[ -z "${NPM_BIN:-}" ]]; then
  echo "✖ BLOCK  Missing npm runtime" >&2
  exit 1
fi

gate_log "Starting local quality gate (all=${ALL_MODE})..."

FAST_GATE="$ROOT/scripts/common/gate-fast-staged.js"
if [[ -f "$FAST_GATE" ]]; then
  gate_log "Running fast streaming staged audit..."
  STATUS=0
  "$NODE_BIN" "$FAST_GATE" || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "✖ BLOCK  Fast staged audit failed" >&2
    exit "$STATUS"
  fi
fi

SUBPROJECT="$ROOT/auto-refactor"
if [[ -d "$SUBPROJECT" ]]; then
  gate_log "Running isolated subproject test suite..."
  STATUS=0
  (cd "$SUBPROJECT" && "$NPM_BIN" test) || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "✖ BLOCK [AR-TEST-02] Subproject tests failed" >&2
    exit "$STATUS"
  fi
fi

if [[ "$AGENT_MODE" -eq 1 ]]; then
  printf '%s\n' '{"protocolVersion":"1.0.0","status":"PASS"}'
else
  gate_log "✔ PASS  [AR-TEST-02] All checks passed"
fi
exit 0
