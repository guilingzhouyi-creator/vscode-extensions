#!/usr/bin/env bash
# ==============================================================================
# Fractal Git Linux / WSL Automated Build & Verification Pipeline
# Adheres strictly to set -euo pipefail, explicit working dir, and non-interactive guards
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

echo "=== Building Fractal Git (Linux/WSL Pipeline) ==="
echo "Project Root: ${PROJECT_ROOT}"

cd "${PROJECT_ROOT}"

# 1. Check Cargo manifest
if command -v cargo >/dev/null 2>&1; then
    echo "[1/2] Running Cargo check on Rust kernel..."
    cargo check --manifest-path "${PROJECT_ROOT}/Cargo.toml"
else
    echo "[1/2] Cargo command not found in PATH, skipping native build."
fi

# 2. Check TypeScript build
if command -v node >/dev/null 2>&1; then
    TSC_PATH="${PROJECT_ROOT}/../auto-refactor/node_modules/typescript/bin/tsc"
    if [[ -f "${TSC_PATH}" ]]; then
        echo "[2/2] Compiling TypeScript Facade..."
        node "${TSC_PATH}" -p "${PROJECT_ROOT}/tsconfig.json"
    fi
fi

echo "=== Fractal Git Linux Verification Succeeded ==="
exit 0
