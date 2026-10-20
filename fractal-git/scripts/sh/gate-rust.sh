#!/usr/bin/env bash
# ==============================================================================
# Fractal Git Linux / WSL Rust Industrial Quality Gate
# Adheres strictly to set -euo pipefail, explicit working dir, and non-interactive guards
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

FAST_MODE=0
for arg in "$@"; do
    case "$arg" in
        --fast|-f|-Fast) FAST_MODE=1 ;;
        --help|-h|-Help)
            echo "用法: bash fractal-git/scripts/sh/gate-rust.sh [选项]"
            echo "选项:"
            echo "  --fast, -f, -Fast   限制测试线程数以缩短本地回归耗时"
            echo "  --help, -h, -Help   显示此帮助信息"
            exit 0
            ;;
        *)
            echo "BLOCK  未知参数: $arg" >&2
            exit 2
            ;;
    esac
done

echo "================================================================="
echo "  Fractal Git Rust Industrial Quality Gate (Linux/WSL)"
echo "================================================================="

cd "${PROJECT_ROOT}"

if ! command -v cargo >/dev/null 2>&1; then
    # 缺少原生工具链时不得静默放行：未执行审查与审查通过必须可区分 (GUARD-SYS-001)。
    echo "BLOCK  cargo 工具链缺失，Rust 质量门禁无法执行。" >&2
    exit 1
fi

MANIFEST="${PROJECT_ROOT}/Cargo.toml"

# 格式检查 (rustfmt)
echo ""
echo "=== [gate:rust 1/4] Code Formatting Check (rustfmt --check) ==="
cargo fmt --all --manifest-path "${MANIFEST}" -- --check
echo "[PASS] rustfmt clean."

# 静态检查 (clippy -D warnings)
echo ""
echo "=== [gate:rust 2/4] Linter & Static Audit (clippy -D warnings) ==="
cargo clippy --workspace --all-targets --manifest-path "${MANIFEST}" -- -D warnings
echo "[PASS] clippy clean with zero warnings."

# 零分配与并发边界扫描
echo ""
echo "=== [gate:rust 3/4] Zero-Allocation & Safety Proof Scanner ==="
if command -v node >/dev/null 2>&1; then
    node "${PROJECT_ROOT}/scripts/common/check-zero-alloc-boundary.js"
fi

# 单元与集成测试
echo ""
echo "=== [gate:rust 4/4] Multi-Crate Regression Tests (cargo test) ==="
if [[ "${FAST_MODE}" -eq 1 ]]; then
    cargo test --workspace --manifest-path "${MANIFEST}" -- --test-threads=4
else
    cargo test --workspace --manifest-path "${MANIFEST}"
fi
echo "[PASS] All micro-crate unit and integration tests passed."

echo ""
echo "=== ALL FRACTAL GIT RUST GATE STAGES PASSED SUCCESSFULLY ==="
exit 0
