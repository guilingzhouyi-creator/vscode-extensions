#!/usr/bin/env bash
# ==============================================================================
# Fractal Git Linux / WSL Automated Build Pipeline
# Adheres strictly to set -euo pipefail, explicit working dir, and non-interactive guards
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${PROJECT_ROOT}/.." && pwd)"

FAST_MODE=0
SKIP_RUST=0
for arg in "$@"; do
    case "$arg" in
        --fast|-f|-Fast) FAST_MODE=1 ;;
        --skip-rust|-SkipRust) SKIP_RUST=1 ;;
        --help|-h|-Help)
            echo "用法: bash fractal-git/scripts/sh/build.sh [选项]"
            echo "选项:"
            echo "  --fast, -f, -Fast       仅执行 cargo check，不做完整构建"
            echo "  --skip-rust             跳过 Rust 原生内核编译"
            echo "  --help, -h, -Help       显示此帮助信息"
            exit 0
            ;;
        *)
            echo "BLOCK  未知参数: $arg" >&2
            exit 2
            ;;
    esac
done

echo "================================================================="
echo "  Fractal Git (Taxis) Build Pipeline (Linux/WSL)"
echo "================================================================="
echo "Project Root: ${PROJECT_ROOT}"

cd "${PROJECT_ROOT}"

# 1. Micro-crates DAG topology validation
if command -v node >/dev/null 2>&1; then
    echo "Validating Micro-Crate DAG Topology..."
    node "${PROJECT_ROOT}/scripts/common/validate-crate-topology.js"
fi

# 2. Git plumbing byte parity validation
if command -v node >/dev/null 2>&1; then
    echo "Validating Git Plumbing Byte Parity..."
    node "${PROJECT_ROOT}/scripts/common/validate-git-parity.js"
fi

# 3. TypeScript compilation
if command -v node >/dev/null 2>&1; then
    TSC_PATH="${REPO_ROOT}/auto-refactor/node_modules/typescript/bin/tsc"
    if [[ -f "${TSC_PATH}" ]]; then
        echo "Compiling TypeScript Facade..."
        node "${TSC_PATH}" -p "${PROJECT_ROOT}/tsconfig.json"
    fi
fi

# 4. Native Rust Cargo check/build
if [[ "${SKIP_RUST}" -eq 0 ]]; then
    if command -v cargo >/dev/null 2>&1; then
        echo "Verifying Native Rust Micro-Crate Kernel..."
        if [[ "${FAST_MODE}" -eq 1 ]]; then
            cargo check --manifest-path "${PROJECT_ROOT}/Cargo.toml" --all-targets
        else
            cargo build --manifest-path "${PROJECT_ROOT}/Cargo.toml" --all-targets
        fi
    else
        echo "Cargo toolchain not found on PATH, skipping native build."
    fi
fi

echo "=== Fractal Git Build Pipeline Completed Successfully ==="
exit 0
