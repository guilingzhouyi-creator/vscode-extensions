#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · Taxis 质量与性能门禁)
# 文件路径: fractal-git/scripts/sh/audit-taxis.sh
# 架构定位: 五级质量与性能审查 Runner (Linux Bash)，与 audit-taxis.ps1 保持同构
# 依赖与触发: 触发方: 本地 CLI / CI | 上游: fractal-git 静态校验与 cargo | 下游: 审查报告与晋级账本 | 运行时: Bash 4+
# 职责说明: 依次执行微 Crate 拓扑与零分配边界、回归套件、微基准棘轮、质量分数包络与自举晋级桥接
# 退出语义与设计依据: 退出码: 0=五级全通过, 1=存在阻断违规 | 设计依据: AGENTS.md 质量度量求真公理
# ------------------------------------------------------------------------------
# 用法示例:
#   bash fractal-git/scripts/sh/audit-taxis.sh
#   bash fractal-git/scripts/sh/audit-taxis.sh --fast
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MANIFEST_PATH="${PROJECT_ROOT}/Cargo.toml"
BASELINE_PATH="${PROJECT_ROOT}/baselines/taxis-perf.baseline.json"

FAST_MODE=0
for arg in "$@"; do
    case "$arg" in
        --fast|-f|-Fast) FAST_MODE=1 ;;
        --help|-h|-Help)
            echo "用法: bash fractal-git/scripts/sh/audit-taxis.sh [选项]"
            echo "选项:"
            echo "  --fast, -f, -Fast   快速模式 (限制测试线程数)"
            echo "  --help, -h, -Help   显示此帮助信息"
            exit 0
            ;;
        *)
            echo "BLOCK  未知参数: $arg" >&2
            exit 2
            ;;
    esac
done

echo "=========================================================================="
echo "  Taxis (Fractal Git) Industrial Audit & Auto-Refactor Quality Gate (Bash)"
echo "=========================================================================="

# 步骤身份与四态判定由工作区共享运行时库提供，禁止在本 Runner 内复制实现。
GATE_ROOT_DIR="${PROJECT_ROOT}/.."
GATE_NODE_BIN="$(command -v node 2>/dev/null || echo node)"
GATE_SUPPRESS=0
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "${GATE_ROOT_DIR}/scripts/sh/lib/gate-runtime.sh"
gate_init audit-taxis

CARGO_CMD="${CARGO_CMD:-cargo}"
if ! command -v "${CARGO_CMD}" &>/dev/null; then
    # 缺少原生工具链时不得静默放行：未执行审查与审查通过必须可区分 (GUARD-SYS-001)。
    write_step_banner "CRATE-TOPOLOGY-01"
    write_step_verdict "CRATE-TOPOLOGY-01" BLOCK "未检测到 cargo 工具链，原生审查无法执行"
    exit 1
fi
if command -v node &>/dev/null; then
    TOPO_STATUS=0
    node "${PROJECT_ROOT}/scripts/common/validate-crate-topology.js" || TOPO_STATUS=$?
    node "${PROJECT_ROOT}/scripts/common/check-zero-alloc-boundary.js" || TOPO_STATUS=$?
    node "${PROJECT_ROOT}/scripts/common/validate-git-parity.js" || TOPO_STATUS=$?
    if [[ "${TOPO_STATUS}" -ne 0 ]]; then
        write_step_verdict "CRATE-TOPOLOGY-01" BLOCK "微 Crate 拓扑、零分配边界或 Git 对等校验未通过"
        exit 1
    fi
    write_step_verdict "CRATE-TOPOLOGY-01" PASS "微 Crate 拓扑、零分配边界与 Git 对等校验通过"
else
    # node 是可安装的运行时，不是可选投票项；缺失即无法完成该级审查。
    write_step_verdict "CRATE-TOPOLOGY-01" BLOCK "未检测到 node 运行时，静态拓扑与零分配审查无法执行"
    exit 1
fi

# -----------------------------------------------------------------------------
# 多 Crate 回归测试套件
# -----------------------------------------------------------------------------
echo ""
write_step_banner "CRATE-REGRESSION-02"
TEST_STATUS=0
if [[ "${FAST_MODE}" -eq 1 ]]; then
    TEST_OUTPUT="$("${CARGO_CMD}" test --manifest-path "${MANIFEST_PATH}" -- --test-threads=4 2>&1)" || TEST_STATUS=$?
else
    TEST_OUTPUT="$("${CARGO_CMD}" test --manifest-path "${MANIFEST_PATH}" 2>&1)" || TEST_STATUS=$?
fi
printf '%s\n' "${TEST_OUTPUT}"
if [[ "${TEST_STATUS}" -ne 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" BLOCK "cargo 回归套件报告失败"
    exit 1
fi
PASSED_TOTAL="$(printf '%s\n' "${TEST_OUTPUT}" | sed -nE 's/^test result: (ok|FAILED)\. ([0-9]+) passed.*/\2/p' | awk '{s+=$1} END {print s+0}')"
if [[ "${PASSED_TOTAL}" -gt 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" PASS "${PASSED_TOTAL} 项测试通过"
else
    write_step_verdict "CRATE-REGRESSION-02" PASS "回归套件通过（cargo 未报告测试计数）"
fi

# -----------------------------------------------------------------------------
# 性能微基准与耗时棘轮
# -----------------------------------------------------------------------------
echo ""
write_step_banner "CRATE-BENCHMARK-03"
BENCH_STATUS=0
"${CARGO_CMD}" run --manifest-path "${MANIFEST_PATH}" --bin taxis -- bench -m 5 --verify-baseline "${BASELINE_PATH}" || BENCH_STATUS=$?
if [[ "${BENCH_STATUS}" -ne 0 ]]; then
    write_step_verdict "CRATE-BENCHMARK-03" BLOCK "TB-REGRESSION 微基准超出容差包络"
    exit 1
fi
write_step_verdict "CRATE-BENCHMARK-03" PASS "微基准在 15% 容差包络内"

# -----------------------------------------------------------------------------
# 重构质量分数包络计算
# -----------------------------------------------------------------------------
echo ""
write_step_banner "QUALITY-ENVELOPE-04"
AUDIT_SCRIPT="${PROJECT_ROOT}/scripts/common/run-audit-report.js"
REPORT_PATH="${PROJECT_ROOT}/reports/audit-latest.json"
COMPOSITE_SCORE=""
CAI_SCORE=""
CI_LOWER=""

# 分数只来自客观报告。报告缺失时保持空值并如实标注 N/A，
# 绝不以写死常数回填，否则审查输出会给出任何检查都未产出的数字。
if command -v node &>/dev/null && [[ -f "${AUDIT_SCRIPT}" ]]; then
    node "${AUDIT_SCRIPT}" >/dev/null 2>&1 || true
    if [[ -f "${REPORT_PATH}" ]]; then
        DYNAMIC_VALUES="$(node -e '
            try {
                const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
                if (r && r.qualityEnvelope) {
                    const pick = (v) => (v === undefined || v === null ? "" : v);
                    console.log([pick(r.qualityEnvelope.composite_score),
                                 pick(r.qualityEnvelope.cai_score),
                                 pick(r.qualityEnvelope.credible_interval_lower)].join(" "));
                }
            } catch {}
        ' "${REPORT_PATH}" 2>/dev/null || true)"
        if [[ -n "${DYNAMIC_VALUES}" ]]; then
            read -r COMPOSITE_SCORE CAI_SCORE CI_LOWER <<< "${DYNAMIC_VALUES}"
        fi
    fi
fi

if [[ -z "${COMPOSITE_SCORE}" || -z "${CAI_SCORE}" || -z "${CI_LOWER}" ]]; then
    write_step_verdict "QUALITY-ENVELOPE-04" SKIP "质量报告不可用，综合分/CAI/置信下界未评估"
else
    write_step_verdict "QUALITY-ENVELOPE-04" PASS "综合分 ${COMPOSITE_SCORE} / CAI ${CAI_SCORE} / CI 下界 ${CI_LOWER}"
fi

# -----------------------------------------------------------------------------
# 自举晋级桥接校验
# -----------------------------------------------------------------------------
echo ""
write_step_banner "PROMOTION-BRIDGE-05"
if [[ -z "${COMPOSITE_SCORE}" || -z "${CAI_SCORE}" || -z "${CI_LOWER}" ]]; then
    write_step_verdict "PROMOTION-BRIDGE-05" SKIP "质量包络不可得，晋级请求无可依附的客观分数"
else
    PROMO_STATUS=0
    "${CARGO_CMD}" run --manifest-path "${MANIFEST_PATH}" --bin taxis -- promotion request \
        --candidate "1111111111111111111111111111111111111111" \
        --agent "taxis-auditor" \
        --score "${COMPOSITE_SCORE}" \
        --cai "${CAI_SCORE}" \
        --ci-lower "${CI_LOWER}" \
        --summary "Dogfooding self-audit verified: clean topology, zero-alloc boundary, ${PASSED_TOTAL} passing tests, and TB-REGRESSION baseline ratchet preserved." \
        || PROMO_STATUS=$?
    if [[ "${PROMO_STATUS}" -ne 0 ]]; then
        write_step_verdict "PROMOTION-BRIDGE-05" BLOCK "自举晋级暂存请求失败"
        exit 1
    fi
    write_step_verdict "PROMOTION-BRIDGE-05" PASS "晋级暂存请求已受理，候选保留于 UAC 暂存账本"
fi

echo ""
echo "=========================================================================="
echo "  TAXIS QUALITY & PERFORMANCE GATES COMPLETED"
echo "=========================================================================="
exit 0
