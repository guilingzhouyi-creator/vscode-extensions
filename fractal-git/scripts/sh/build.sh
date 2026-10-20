#!/usr/bin/env bash
# ==============================================================================
# Fractal Git Linux / WSL Automated Build Pipeline
# Adheres strictly to set -euo pipefail, explicit working dir, and non-interactive guards
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${PROJECT_ROOT}/.." && pwd)"

echo "================================================================="
echo "  Fractal Git (Taxis) Build Pipeline (Linux/WSL)"
echo "================================================================="
echo "Project Root: ${PROJECT_ROOT}"

cd "${PROJECT_ROOT}"

# 1. Micro-crates DAG topology validation
if command -v node >/dev/null 2>&1; then
    echo "[1/4] Validating Micro-Crate DAG Topology..."
    node "${PROJECT_ROOT}/scripts/common/validate-crate-topology.js"
fi

# 2. Git plumbing byte parity validation
if command -v node >/dev/null 2>&1; then
    echo "[2/4] Validating Git Plumbing Byte Parity..."
    node "${PROJECT_ROOT}/scripts/common/validate-git-parity.js"
fi

# 3. TypeScript compilation
if command -v node >/dev/null 2>&1; then
    TSC_PATH="${REPO_ROOT}/auto-refactor/node_modules/typescript/bin/tsc"
    if [[ -f "${TSC_PATH}" ]]; then
        echo "[3/4] Compiling TypeScript Facade..."
        node "${TSC_PATH}" -p "${PROJECT_ROOT}/tsconfig.json"
    fi
fi

# 4. Native Rust Cargo check/build
if command -v cargo >/dev/null 2>&1; then
    echo "[4/4] Verifying Native Rust Micro-Crate Kernel..."
    cargo check --manifest-path "${PROJECT_ROOT}/Cargo.toml" --all-targets
else
    echo "[4/4] Cargo toolchain not found on PATH, skipping native build."
fi

echo "=== Fractal Git Build Pipeline Completed Successfully ==="
exit 0
