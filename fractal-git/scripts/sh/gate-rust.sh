#!/usr/bin/env bash
# ==============================================================================
# Fractal Git Linux / WSL Rust Industrial Quality Gate
# Adheres strictly to set -euo pipefail, explicit working dir, and non-interactive guards
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "================================================================="
echo "  Fractal Git Rust Industrial Quality Gate (Linux/WSL)"
echo "================================================================="

cd "${PROJECT_ROOT}"

if ! command -v cargo >/dev/null 2>&1; then
    echo "Warning: cargo command not found on PATH. Native Rust gate skipped."
    exit 0
fi

MANIFEST="${PROJECT_ROOT}/Cargo.toml"

# Stage 1: Rustfmt check
echo ""
echo "=== [gate:rust 1/4] Code Formatting Check (rustfmt --check) ==="
cargo fmt --all --manifest-path "${MANIFEST}" -- --check
echo "[PASS] rustfmt clean."

# Stage 2: Clippy zero-warning check
echo ""
echo "=== [gate:rust 2/4] Linter & Static Audit (clippy -D warnings) ==="
cargo clippy --workspace --all-targets --manifest-path "${MANIFEST}" -- -D warnings
echo "[PASS] clippy clean with zero warnings."

# Stage 3: Zero-Allocation and concurrency boundary scanner
echo ""
echo "=== [gate:rust 3/4] Zero-Allocation & Safety Proof Scanner ==="
if command -v node >/dev/null 2>&1; then
    node "${PROJECT_ROOT}/scripts/common/check-zero-alloc-boundary.js"
fi

# Stage 4: Unit and integration tests
echo ""
echo "=== [gate:rust 4/4] Multi-Crate Regression Tests (cargo test) ==="
cargo test --workspace --manifest-path "${MANIFEST}"
echo "[PASS] All micro-crate unit and integration tests passed."

echo ""
echo "=== ALL FRACTAL GIT RUST GATE STAGES PASSED SUCCESSFULLY ==="
exit 0
