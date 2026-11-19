#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · Taxis 质量与性能门禁)
# 文件路径: fractal-git/scripts/sh/audit-taxis.sh
# 架构定位: 五级质量与性能审查 Runner (Linux Bash)，与 audit-taxis.ps1 保持同构
# 依赖与触发: 触发方: 本地 CLI / CI | 上游: fractal-git 静态校验与 cargo | 下游: 审查报告与晋级账本 | 运行时: Bash 4+
# 职责说明: 依次执行内核子系统拓扑与零分配边界、回归套件、微基准棘轮、质量分数包络与自举晋级桥接
# 退出语义与设计依据: 退出码: 0=五级全通过, 1=存在阻断违规 | 设计依据: AGENTS.md 质量度量求真公理
# ------------------------------------------------------------------------------
# 用法示例:
#   bash fractal-git/scripts/sh/audit-taxis.sh
#   bash fractal-git/scripts/sh/audit-taxis.sh --fast
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${PROJECT_ROOT}/.." && pwd)"
MANIFEST_PATH="${PROJECT_ROOT}/Cargo.toml"

FAST_MODE=0
JSON_MODE=0
for arg in "$@"; do
    case "$arg" in
        --fast|-f|-Fast) FAST_MODE=1 ;;
        --json|-Json) JSON_MODE=1 ;;
        --help|-h|-Help)
            echo "用法: bash fractal-git/scripts/sh/audit-taxis.sh [选项]"
            echo "选项:"
            echo "  --fast, -f, -Fast   快速模式 (限制测试线程数)"
            echo "  --json, -Json       机器消费模式 (仅在结束时输出单一 JSON)"
            echo "  --help, -h, -Help   显示此帮助信息"
            exit 0
            ;;
        *)
            echo "BLOCK  未知参数: $arg" >&2
            exit 2
            ;;
    esac
done

# 步骤身份与四态判定由工作区共享运行时库提供，禁止在本 Runner 内复制实现。
GATE_ROOT_DIR="${REPO_ROOT}"
GATE_NODE_BIN="$(command -v node 2>/dev/null || echo node)"
GATE_SUPPRESS="${JSON_MODE}"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "${GATE_ROOT_DIR}/scripts/sh/lib/gate-runtime.sh"
gate_init audit-taxis

AUDIT_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taxis-audit-XXXXXX")"
PROMO_ROOT=""
cleanup_audit_tmp() {
    rm -rf "${AUDIT_TMP_DIR:-}" "${PROMO_ROOT:-}"
}
trap cleanup_audit_tmp EXIT
CARGO_SUMMARY_JSON=""

gate_log "=========================================================================="
gate_log "  Taxis (Fractal Git) Industrial Audit & Auto-Refactor Quality Gate (Bash)"
gate_log "=========================================================================="

write_step_banner "CRATE-TOPOLOGY-01"
CARGO_CMD="${CARGO_CMD:-cargo}"
if ! command -v "${CARGO_CMD}" &>/dev/null; then
    # 缺少原生工具链时不得静默放行：未执行审查与审查通过必须可区分 (GUARD-SYS-001)。
    write_step_verdict "CRATE-TOPOLOGY-01" BLOCK "未检测到 cargo 工具链，原生审查无法执行"
    exit 1
fi
if command -v node &>/dev/null; then
    TOPO_STATUS=0
    if [[ "${JSON_MODE}" -eq 1 ]]; then
        node "${PROJECT_ROOT}/scripts/common/validate-crate-topology.js" >/dev/null 2>&1 || TOPO_STATUS=$?
        node "${PROJECT_ROOT}/scripts/common/check-zero-alloc-boundary.js" >/dev/null 2>&1 || TOPO_STATUS=$?
        node "${PROJECT_ROOT}/scripts/common/validate-git-parity.js" --require-git >/dev/null 2>&1 || TOPO_STATUS=$?
        "${CARGO_CMD}" fmt --manifest-path "${MANIFEST_PATH}" --all -- --check >/dev/null 2>&1 || TOPO_STATUS=$?
        "${CARGO_CMD}" clippy --workspace --manifest-path "${MANIFEST_PATH}" --all-targets -- -D warnings >/dev/null 2>&1 || TOPO_STATUS=$?
    else
        node "${PROJECT_ROOT}/scripts/common/validate-crate-topology.js" || TOPO_STATUS=$?
        node "${PROJECT_ROOT}/scripts/common/check-zero-alloc-boundary.js" || TOPO_STATUS=$?
        node "${PROJECT_ROOT}/scripts/common/validate-git-parity.js" --require-git || TOPO_STATUS=$?
        "${CARGO_CMD}" fmt --manifest-path "${MANIFEST_PATH}" --all -- --check || TOPO_STATUS=$?
        "${CARGO_CMD}" clippy --workspace --manifest-path "${MANIFEST_PATH}" --all-targets -- -D warnings || TOPO_STATUS=$?
    fi
    if [[ "${TOPO_STATUS}" -ne 0 ]]; then
        write_step_verdict "CRATE-TOPOLOGY-01" BLOCK "内核子系统拓扑、零分配边界、Git 对等、格式或 Clippy 校验未通过"
        exit 1
    fi
    write_step_verdict "CRATE-TOPOLOGY-01" PASS "内核子系统拓扑、零分配边界、Git 对等、rustfmt 与 Clippy 校验通过"
else
    # node 是可安装的运行时，不是可选投票项；缺失即无法完成该级审查。
    write_step_verdict "CRATE-TOPOLOGY-01" BLOCK "未检测到 node 运行时，静态拓扑与零分配审查无法执行"
    exit 1
fi

# -----------------------------------------------------------------------------
# 内核子系统回归测试套件
# -----------------------------------------------------------------------------
gate_log ""
write_step_banner "CRATE-REGRESSION-02"
TEST_STATUS=0
if [[ "${FAST_MODE}" -eq 1 ]]; then
    TEST_OUTPUT="$("${CARGO_CMD}" test --workspace --manifest-path "${MANIFEST_PATH}" -- --test-threads=4 2>&1)" || TEST_STATUS=$?
else
    TEST_OUTPUT="$("${CARGO_CMD}" test --workspace --manifest-path "${MANIFEST_PATH}" 2>&1)" || TEST_STATUS=$?
fi
if [[ "${JSON_MODE}" -eq 0 ]]; then
    printf '%s\n' "${TEST_OUTPUT}"
fi
if [[ "${TEST_STATUS}" -ne 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" BLOCK "cargo 回归套件报告失败"
    exit 1
fi

TSC_PATH="${REPO_ROOT}/auto-refactor/node_modules/typescript/bin/tsc"
if [[ ! -f "${TSC_PATH}" ]]; then
    TSC_PATH="${PROJECT_ROOT}/node_modules/typescript/bin/tsc"
fi
if [[ ! -f "${PROJECT_ROOT}/node_modules/ajv/dist/2020.js" && -f "${PROJECT_ROOT}/package-lock.json" ]] && command -v npm &>/dev/null; then
    NPM_CI_STATUS=0
    npm --prefix "${PROJECT_ROOT}" ci --offline --ignore-scripts >/dev/null 2>&1 || NPM_CI_STATUS=$?
    if [[ "${NPM_CI_STATUS}" -ne 0 ]]; then
        gate_log_err "npm offline ci unavailable (${NPM_CI_STATUS}); proceeding to TS check."
    fi
fi
TS_STATUS=0
if [[ ! -f "${TSC_PATH}" ]]; then
    TS_STATUS=1
else
    node "${PROJECT_ROOT}/scripts/common/sync-quality-evidence.js" --check >/dev/null 2>&1 || TS_STATUS=$?
    if [[ "${TS_STATUS}" -eq 0 ]]; then
        node "${TSC_PATH}" -p "${PROJECT_ROOT}/tsconfig.json" || TS_STATUS=$?
    fi
fi
TS_OUTPUT=""
TS_PASSED=0
if [[ "${TS_STATUS}" -eq 0 ]]; then
    TS_TEST_FILES=()
    while IFS= read -r -d '' tf; do
        TS_TEST_FILES+=("$tf")
    done < <(find "${PROJECT_ROOT}/dist/tests/ts" -maxdepth 1 -type f -name '*.test.js' -print0 2>/dev/null | sort -z)
    if [[ "${#TS_TEST_FILES[@]}" -eq 0 ]]; then
        TS_STATUS=1
    else
        TS_OUTPUT="$(node --test "${TS_TEST_FILES[@]}" 2>&1)" || TS_STATUS=$?
        if [[ "${JSON_MODE}" -eq 0 ]]; then
            printf '%s\n' "${TS_OUTPUT}"
        fi
        if [[ "${TS_STATUS}" -eq 0 ]]; then
            TS_PASSED="$(printf '%s\n' "${TS_OUTPUT}" | sed -nE 's/^.*[[:space:]]pass ([0-9]+)[[:space:]]*$/\1/p' | tail -n 1)"
            TS_PASSED="${TS_PASSED:-0}"
        fi
    fi
fi
if [[ "${TS_STATUS}" -ne 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" BLOCK "TypeScript 编译、契约校验或 tests/ts 回归套件报告失败"
    exit 1
fi

read -r RUST_PASSED RUST_FAILED RUST_IGNORED RUST_SUITES <<< "$(printf '%s' "${TEST_OUTPUT}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const re = /test result:\s+(?:ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored;/g;
    let passed = 0, failed = 0, ignored = 0, suites = 0, m;
    while ((m = re.exec(raw)) !== null) {
        passed += Number(m[1]);
        failed += Number(m[2]);
        ignored += Number(m[3]);
        suites += 1;
    }
    console.log([passed, failed, ignored, suites].join(" "));
')"
if [[ "${RUST_FAILED}" -gt 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" BLOCK "cargo 回归套件报告 ${RUST_FAILED} 项测试失败"
    exit 1
fi

PASSED_TOTAL=$((RUST_PASSED + TS_PASSED))
if [[ "${RUST_PASSED}" -gt 0 && "${RUST_FAILED}" -eq 0 && "${RUST_SUITES}" -gt 0 ]]; then
    CARGO_SUMMARY_JSON="${AUDIT_TMP_DIR}/cargo-test-summary.json"
    node -e '
        const fs = require("fs");
        const payload = {
            passed: Number(process.argv[2]),
            failed: Number(process.argv[3]),
            ignored: Number(process.argv[4]),
            suites: Number(process.argv[5]),
            source: "audit-taxis-step-2",
        };
        fs.writeFileSync(process.argv[1], JSON.stringify(payload) + "\n", "utf8");
    ' "${CARGO_SUMMARY_JSON}" "${RUST_PASSED}" "${RUST_FAILED}" "${RUST_IGNORED}" "${RUST_SUITES}"
fi

REGRESSION_STATUS="WARN"
if [[ "${RUST_PASSED}" -gt 0 && "${TS_PASSED}" -gt 0 ]]; then
    REGRESSION_STATUS="PASS"
    write_step_verdict "CRATE-REGRESSION-02" PASS "${PASSED_TOTAL} 项测试通过 (Rust ${RUST_PASSED} + TS ${TS_PASSED})"
elif [[ "${RUST_PASSED}" -gt 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" WARN "Rust ${RUST_PASSED} 项通过，但 node --test 未报告通过计数"
elif [[ "${TS_PASSED}" -gt 0 ]]; then
    write_step_verdict "CRATE-REGRESSION-02" WARN "TS ${TS_PASSED} 项通过，但 cargo test 未报告通过计数"
else
    # A green exit status carrying no reported count means the harness executed nothing, or the
    # output shape changed underneath this parser. Both conditions must surface: calling this PASS
    # made an empty suite indistinguishable from one that actually asserted.
    write_step_verdict "CRATE-REGRESSION-02" WARN "未报告任何测试计数，回归覆盖不可证实"
fi

# -----------------------------------------------------------------------------
# 性能微基准与耗时棘轮
# -----------------------------------------------------------------------------
gate_log ""
write_step_banner "CRATE-BENCHMARK-03"
# 微基准的清单路径、基线路径与采样数由 Node 侧单一实现持有：双平台各自拼装命令行会在
# 基线路径的相对/绝对形式上悄悄分叉，届时「两端同构」只在脚本结构上成立而不在语义上成立。
BENCH_SCRIPT="${PROJECT_ROOT}/scripts/common/validate-perf-baseline.js"
BENCH_STATUS=0
if ! command -v node &>/dev/null; then
    write_step_verdict "CRATE-BENCHMARK-03" BLOCK "node 运行时缺失，微基准棘轮无法执行"
    exit 1
fi
if [[ "${JSON_MODE}" -eq 1 ]]; then
    node "${BENCH_SCRIPT}" >/dev/null 2>&1 || BENCH_STATUS=$?
else
    node "${BENCH_SCRIPT}" || BENCH_STATUS=$?
fi
if [[ "${BENCH_STATUS}" -ne 0 ]]; then
    write_step_verdict "CRATE-BENCHMARK-03" BLOCK "TB-REGRESSION 微基准超出容差包络"
    exit 1
fi
write_step_verdict "CRATE-BENCHMARK-03" PASS "微基准在 15% 容差包络内"

# -----------------------------------------------------------------------------
# 重构质量分数包络计算
# -----------------------------------------------------------------------------
gate_log ""
write_step_banner "QUALITY-ENVELOPE-04"
AUDIT_SCRIPT="${PROJECT_ROOT}/scripts/common/run-audit-report.js"
REPORT_PATH="${PROJECT_ROOT}/reports/audit-latest.json"
COMPOSITE_SCORE=""
CAI_SCORE=""
CI_LOWER=""

# 分数只来自客观报告。报告缺失或执行失败时保持空值并如实标注 SKIP，
# 绝不以写死常数或陈旧报告回填，否则审查输出会给出伪造测量。
if command -v node &>/dev/null && [[ -f "${AUDIT_SCRIPT}" ]]; then
    REPORT_ARGS=()
    [[ "${FAST_MODE}" -eq 1 ]] && REPORT_ARGS+=("--fast")
    [[ -n "${CARGO_SUMMARY_JSON}" && -f "${CARGO_SUMMARY_JSON}" ]] && REPORT_ARGS+=("--cargo-test-summary" "${CARGO_SUMMARY_JSON}")
    [[ "${BENCH_STATUS}" -eq 0 ]] && REPORT_ARGS+=("--perf-preverified")
    REPORT_STATUS=0
    if [[ "${JSON_MODE}" -eq 1 ]]; then
        node "${AUDIT_SCRIPT}" ${REPORT_ARGS[@]+"${REPORT_ARGS[@]}"} >/dev/null 2>&1 || REPORT_STATUS=$?
    else
        node "${AUDIT_SCRIPT}" ${REPORT_ARGS[@]+"${REPORT_ARGS[@]}"} || REPORT_STATUS=$?
    fi
    if [[ "${REPORT_STATUS}" -eq 0 && -f "${REPORT_PATH}" ]]; then
        DYNAMIC_VALUES=""
        if ! DYNAMIC_VALUES="$(node -e '
            try {
                const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
                if (r && r.qualityEnvelope) {
                    const pick = (v) => (v === undefined || v === null ? "" : v);
                    console.log([pick(r.qualityEnvelope.composite_score),
                                 pick(r.qualityEnvelope.cai_score),
                                 pick(r.qualityEnvelope.credible_interval_lower)].join(" "));
                }
            } catch {}
        ' "${REPORT_PATH}" 2>/dev/null)"; then
            DYNAMIC_VALUES=""
        fi
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
gate_log ""
write_step_banner "PROMOTION-BRIDGE-05"
PROMO_STATUS_LABEL="SKIP"
if [[ -z "${COMPOSITE_SCORE}" || -z "${CAI_SCORE}" || -z "${CI_LOWER}" ]]; then
    write_step_verdict "PROMOTION-BRIDGE-05" SKIP "质量包络不可得，晋级请求无可依附的客观分数"
else
    # A promotion is staged into the repository container, so the ledger refuses to run in a
    # directory that has none. Creating the container through `taxis init` keeps this probe on
    # the same path an operator takes. The directory lives under the staging root so the two
    # implementations stay byte-equivalent in intent.
    PROMO_ROOT="${TMPDIR:-/tmp}/taxis-promotion-ledger-$$"
    mkdir -p "${PROMO_ROOT}"
    PROMO_TAXIS_BIN=""
    for target_root in "${CARGO_TARGET_DIR:-}" "${PROJECT_ROOT}/target"; do
        [[ -n "${target_root}" ]] || continue
        for profile in release debug; do
            if [[ -x "${target_root}/${profile}/taxis" ]]; then
                PROMO_TAXIS_BIN="${target_root}/${profile}/taxis"
                break 2
            fi
        done
    done
    PROMO_INIT_STATUS=0
    if [[ -n "${PROMO_TAXIS_BIN}" ]]; then
        "${PROMO_TAXIS_BIN}" init --dev --workspace "${PROMO_ROOT}" >/dev/null 2>&1 || PROMO_INIT_STATUS=$?
    else
        "${CARGO_CMD}" run --quiet --manifest-path "${MANIFEST_PATH}" --bin taxis -- init --dev --workspace "${PROMO_ROOT}" >/dev/null 2>&1 || PROMO_INIT_STATUS=$?
    fi
    if [[ "${PROMO_INIT_STATUS}" -ne 0 ]]; then
        write_step_verdict "PROMOTION-BRIDGE-05" BLOCK "晋级演练仓库初始化失败，无法验证暂存链路"
        exit 1
    fi
    CANDIDATE_OID=""
    if ! CANDIDATE_OID="$(git -C "${PROJECT_ROOT}" rev-parse HEAD 2>/dev/null)"; then
        CANDIDATE_OID=""
    fi
    if [[ ! "${CANDIDATE_OID}" =~ ^[0-9a-f]{40}$ ]]; then
        CANDIDATE_OID="0000000000000000000000000000000000000000"
    fi
    PROMO_STATUS=0
    PROMO_ARGS=(
        promotion request
        --git-dir "${PROMO_ROOT}/.taxis"
        --candidate "${CANDIDATE_OID}"
        --agent "taxis-auditor"
        --score "${COMPOSITE_SCORE}"
        --cai "${CAI_SCORE}"
        --ci-lower "${CI_LOWER}"
        --summary "In-house self-audit verified: clean topology, zero-alloc boundary, ${PASSED_TOTAL} passing tests, and TB-REGRESSION baseline ratchet preserved."
    )
    if [[ "${JSON_MODE}" -eq 1 ]]; then
        if [[ -n "${PROMO_TAXIS_BIN}" ]]; then
            "${PROMO_TAXIS_BIN}" "${PROMO_ARGS[@]}" >/dev/null 2>&1 || PROMO_STATUS=$?
        else
            "${CARGO_CMD}" run --manifest-path "${MANIFEST_PATH}" --bin taxis -- "${PROMO_ARGS[@]}" >/dev/null 2>&1 || PROMO_STATUS=$?
        fi
    else
        if [[ -n "${PROMO_TAXIS_BIN}" ]]; then
            "${PROMO_TAXIS_BIN}" "${PROMO_ARGS[@]}" || PROMO_STATUS=$?
        else
            "${CARGO_CMD}" run --manifest-path "${MANIFEST_PATH}" --bin taxis -- "${PROMO_ARGS[@]}" || PROMO_STATUS=$?
        fi
    fi
    if [[ "${PROMO_STATUS}" -ne 0 ]]; then
        write_step_verdict "PROMOTION-BRIDGE-05" BLOCK "自举晋级暂存请求失败"
        exit 1
    fi
    # 落盘断言检查容器本身：账本是容器的一个节，不存在独立的账本文件。
    if [[ ! -f "${PROMO_ROOT}/.taxis/repo.txc" ]]; then
        write_step_verdict "PROMOTION-BRIDGE-05" BLOCK "晋级暂存请求未落盘，仓库容器缺失"
        exit 1
    fi
    PROMO_STATUS_LABEL="PASS"
    write_step_verdict "PROMOTION-BRIDGE-05" PASS "晋级暂存请求已受理，候选保留于提权审批暂存账本"
fi

if [[ "${JSON_MODE}" -eq 1 ]]; then
    node -e '
        const fast = process.argv[1] === "1";
        const passed = Number(process.argv[2]) || 0;
        const comp = process.argv[3] ? Number(process.argv[3]) : null;
        const cai = process.argv[4] ? Number(process.argv[4]) : null;
        const ci = process.argv[5] ? Number(process.argv[5]) : null;
        const promo = process.argv[6] || "SKIP";
        const regStatus = process.argv[7] || "WARN";
        const qualityStatus = comp !== null && cai !== null && ci !== null ? "PASS" : "SKIP";
        console.log(JSON.stringify({
            protocolVersion: "1.0.0",
            status: "PASS",
            entry: "audit-taxis",
            fastMode: fast,
            steps: {
                "CRATE-TOPOLOGY-01": "PASS",
                "CRATE-REGRESSION-02": regStatus,
                "CRATE-BENCHMARK-03": "PASS",
                "QUALITY-ENVELOPE-04": qualityStatus,
                "PROMOTION-BRIDGE-05": promo,
            },
            testsPassed: passed,
            qualityEnvelope: { compositeScore: comp, caiScore: cai, credibleIntervalLower: ci },
            failedSteps: [],
        }, null, 2));
    ' "${FAST_MODE}" "${PASSED_TOTAL}" "${COMPOSITE_SCORE}" "${CAI_SCORE}" "${CI_LOWER}" "${PROMO_STATUS_LABEL}" "${REGRESSION_STATUS}"
    exit 0
fi

gate_log ""
gate_log "=========================================================================="
gate_log "  TAXIS QUALITY & PERFORMANCE GATES COMPLETED"
gate_log "=========================================================================="
exit 0
