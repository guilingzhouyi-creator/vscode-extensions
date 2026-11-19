#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 全工作区跨项目审查中枢)
# 文件路径: scripts/sh/audit-all.sh
# 架构定位: 全工作区跨项目统一审查 Runner (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 统一质量看板 | 运行时: Bash 4+
# 职责说明: 调度执行全工作区跨项目质量审查，多项目并行调度 workspace-timing、auto-refactor 与 WebGames
# 退出语义与设计依据: 退出码: 0=全项审查通过, 1=存在审查违规 | 设计依据: AGENTS.md 工作区全局治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-all.sh
#   bash scripts/sh/audit-all.sh --fast
#   bash scripts/sh/audit-all.sh --json
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

export GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-NUL}"
export GIT_CONFIG_SYSTEM="${GIT_CONFIG_SYSTEM:-NUL}"
export GIT_CONFIG_NOSYSTEM="${GIT_CONFIG_NOSYSTEM:-1}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$ROOT_DIR}"

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "npm")
PYTHON_BIN=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")
CARGO_BIN=$(command -v cargo 2>/dev/null || command -v cargo.exe 2>/dev/null || echo "")

FAST_MODE=0
JSON_MODE=0
AGENT_MODE=0
COMMIT_LEDGER=0

for arg in "$@"; do
    case "$arg" in
        --fast|-f|-Fast) FAST_MODE=1 ;;
        --json|-j|-Json) JSON_MODE=1 ;;
        --agent|-a|-Agent) AGENT_MODE=1 ;;
        --commit-ledger|-CommitLedger) COMMIT_LEDGER=1 ;;
        --help|-h|-Help)
            echo "用法: bash scripts/sh/audit-all.sh [选项]"
            echo "选项:"
            echo "  --fast, -f, -Fast    快速审查模式 (跳过耗时深层自审)"
            echo "  --json, -j, -Json    以 JSON 格式输出审查摘要"
            echo "  --agent, -a, -Agent  以 Agent-Native JSON 信封格式输出审查结果"
            echo "  --commit-ledger      将本次审查写入受控轨迹账本 (默认写入运行期目录)"
            echo "  --help, -h, -Help    显示此帮助信息"
            exit 0
            ;;
    esac
done

if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 ]]; then
    echo "================================================================="
    echo "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)"
    echo "================================================================="
fi

FAILED=0
START_TIME=$("$NODE_BIN" -e 'process.stdout.write(Date.now().toString())')

# 步骤身份与四态判定由共享运行时库提供，禁止在本 Runner 内复制实现。
GATE_ROOT_DIR="$ROOT_DIR"
GATE_NODE_BIN="$NODE_BIN"
GATE_SUPPRESS=$([[ "$JSON_MODE" -eq 1 || "$AGENT_MODE" -eq 1 ]] && echo 1 || echo 0)
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
gate_init audit-all

# 1. 物理卫生八维刚性公理与全域巡检
LOG_HYGIENE=""
GUARDS_JSON=""
LOG_WT=""
LOG_WG=""
LOG_AR=""
LOG_AR_SELF=""
LOG_FG=""
SUMMARY_INPUT=""
trap 'rm -f "${LOG_HYGIENE:-}" "${GUARDS_JSON:-}" "${LOG_WT:-}" "${LOG_WG:-}" "${LOG_AR:-}" "${LOG_AR_SELF:-}" "${LOG_FG:-}" "${SUMMARY_INPUT:-}"' EXIT

write_step_banner "WORKSPACE-AUDIT-01"
LOG_HYGIENE=$(mktemp)
CODE_HYGIENE=0
"$NODE_BIN" scripts/common/validate-physical-hygiene.js --json >"$LOG_HYGIENE" 2>&1 || CODE_HYGIENE=$?
CODE_ISO=0
"$NODE_BIN" scripts/common/validate-script-isomorphism.js >/dev/null 2>&1 || CODE_ISO=$?
CODE_GI=0
"$NODE_BIN" scripts/common/validate-gitignore-governance.js >/dev/null 2>&1 || CODE_GI=$?
CODE_DENSITY=0
"$NODE_BIN" scripts/common/validate-code-density.js --all >/dev/null 2>&1 || CODE_DENSITY=$?
CODE_ELOC=0
"$NODE_BIN" scripts/common/evaluate-eloc-budget.js --all >/dev/null 2>&1 || CODE_ELOC=$?
if [[ "$CODE_HYGIENE" -ne 0 || "$CODE_ISO" -ne 0 || "$CODE_GI" -ne 0 || "$CODE_DENSITY" -ne 0 || "$CODE_ELOC" -ne 0 ]]; then
    STATUS_HYGIENE="BLOCK"
    write_step_verdict "WORKSPACE-AUDIT-01" BLOCK "物理卫生、同构脚本、.gitignore、代码密度或体积审查未通过"
    FAILED=1
else
    STATUS_HYGIENE="PASS"
    write_step_verdict "WORKSPACE-AUDIT-01" PASS "物理卫生八维、同构脚本、.gitignore、代码密度与体积合规"
fi

# 2. 单源规则注册表与目录一致性及技能集规范 (有界并发调度 Pillar-2 守卫)
write_step_banner "RULE-AUDIT-02"
GUARDS_JSON=$(mktemp)
GUARDS_EXIT=0
"$NODE_BIN" scripts/common/run-workspace-guards.js --group pillar2 --json >"$GUARDS_JSON" 2>/dev/null || GUARDS_EXIT=$?
GUARDS_ALL_PASS=$("$NODE_BIN" -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const ok = Array.isArray(data.codes)
    && data.codes.length > 0
    && (data.total == null || data.codes.length === data.total)
    && data.codes.every((c) => c === 0);
  process.stdout.write(ok ? "1" : "0");
} catch (_) {
  process.stdout.write("0");
}
' "$GUARDS_JSON" 2>/dev/null || echo "0")
if [[ "$GUARDS_EXIT" -ne 0 || "$GUARDS_ALL_PASS" != "1" ]]; then
    STATUS_RULES="BLOCK"
    write_step_verdict "RULE-AUDIT-02" BLOCK "规则目录同步、闭包、可达性、规则源一致性、文档一致性、技能集、轨迹账本或破坏性操作溯源审查未通过"
    FAILED=1
else
    STATUS_RULES="PASS"
    write_step_verdict "RULE-AUDIT-02" PASS "单源规则目录、闭包、可达性、文档一致性、引用锚点、指标覆盖、规则族契约、文档可达性与提交历史冻结清单合规"
fi

LOG_WT=$(mktemp)
LOG_WG=$(mktemp)
LOG_AR=$(mktemp)
LOG_AR_SELF=$(mktemp)
LOG_FG=$(mktemp)

# 3~6. 并行并发调度 workspace-timing、WebGames、auto-refactor 与 fractal-git 四大项目审查
write_step_banner "EXTENSION-AUDIT-03"
write_step_banner "DOMAIN-AUDIT-04"
write_step_banner "ENGINE-AUDIT-05"
write_step_banner "RUST-AUDIT-06"

# 并发拉起四大项目审查任务 (后台异步派发)
(cd workspace-timing && "$NPM_BIN" run review:strict) >"$LOG_WT" 2>&1 &
PID_WT=$!

if [[ "$FAST_MODE" -eq 1 ]]; then
    ("$PYTHON_BIN" WebGames/scripts/py/audit_runner.py --diff) >"$LOG_WG" 2>&1 &
else
    ("$PYTHON_BIN" WebGames/scripts/py/audit_runner.py) >"$LOG_WG" 2>&1 &
fi
PID_WG=$!

if [[ "$FAST_MODE" -eq 1 ]]; then
    (cd auto-refactor && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js) >"$LOG_AR" 2>&1 &
    PID_AR=$!
else
    (cd auto-refactor && "$NODE_BIN" scripts/test-parallel.js) >"$LOG_AR" 2>&1 &
    PID_AR=$!
fi

if [[ "$FAST_MODE" -eq 1 ]]; then
    ("$NODE_BIN" fractal-git/scripts/common/run-audit-report.js --fast) >"$LOG_FG" 2>&1 &
else
    ("$NODE_BIN" fractal-git/scripts/common/run-audit-report.js) >"$LOG_FG" 2>&1 &
fi
PID_FG=$!

# 看门狗超时守卫：防止子进程挂起导致审查无限阻塞
TIMEOUT_WT=$([[ "$FAST_MODE" -eq 1 ]] && echo 90 || echo 180)
TIMEOUT_WG=$([[ "$FAST_MODE" -eq 1 ]] && echo 60 || echo 120)
TIMEOUT_AR=$([[ "$FAST_MODE" -eq 1 ]] && echo 90 || echo 240)
TIMEOUT_FG=$([[ "$FAST_MODE" -eq 1 ]] && echo 120 || echo 360)

STATUS_WT="PASS"
CODE_WT=0
wait_with_timeout "$PID_WT" "$TIMEOUT_WT" "workspace-timing" "$LOG_WT" || CODE_WT=$?
if [[ "$CODE_WT" -ne 0 ]] || [[ ! -f "workspace-timing/reports/auto-refactor-latest.json" && ! -f "workspace-timing/reports/.refactor-cache/report.json" && ! -f "workspace-timing/reports/review/report-latest.json" ]]; then
    STATUS_WT="BLOCK"
    write_step_verdict "EXTENSION-AUDIT-03" BLOCK "workspace-timing 严格审查门禁未通过或缺失权威报告"
    FAILED=1
else
    write_step_verdict "EXTENSION-AUDIT-03" PASS "workspace-timing 严格审查门禁通过"
fi

STATUS_WG="PASS"
CODE_WG=0
wait_with_timeout "$PID_WG" "$TIMEOUT_WG" "WebGames" "$LOG_WG" || CODE_WG=$?
if [[ "$CODE_WG" -ne 0 ]] || [[ ! -f "WebGames/reports/audit-latest.json" || ! -f "WebGames/reports/auto-refactor-latest.json" ]]; then
    STATUS_WG="BLOCK"
    write_step_verdict "DOMAIN-AUDIT-04" BLOCK "WebGames 领域配置与架构审查未通过或缺失权威报告"
    FAILED=1
else
    write_step_verdict "DOMAIN-AUDIT-04" PASS "WebGames 领域配置与架构审查通过"
fi

STATUS_AR="PASS"
CODE_AR=0
wait_with_timeout "$PID_AR" "$TIMEOUT_AR" "auto-refactor" "$LOG_AR" || CODE_AR=$?
if [[ "$CODE_AR" -ne 0 ]] || [[ ! -f "auto-refactor/reports/self-audit-baseline.json" && ! -f "auto-refactor/reports/self-audit-baseline.aas.json" ]]; then
    STATUS_AR="BLOCK"
    FAILED=1
fi

STATUS_FG="PASS"
CODE_FG=0
wait_with_timeout "$PID_FG" "$TIMEOUT_FG" "fractal-git" "$LOG_FG" || CODE_FG=$?
if [[ "$CODE_FG" -ne 0 ]] || [[ ! -f "fractal-git/reports/audit-latest.json" ]]; then
    STATUS_FG="BLOCK"
    FAILED=1
fi

if [[ "$STATUS_FG" == "PASS" ]]; then
    write_step_verdict "RUST-AUDIT-06" PASS "fractal-git 内核子系统回归套件与静态校验通过"
else
    write_step_verdict "RUST-AUDIT-06" BLOCK "fractal-git 内核子系统回归套件或静态校验未通过"
fi

if [[ "$FAST_MODE" -eq 0 && "$STATUS_AR" == "PASS" ]]; then
    for ar_gate_script in "scripts/gate-self.js" "scripts/gate-comments.js" "scripts/gate-rust.js"; do
        [[ "$STATUS_AR" != "PASS" ]] && break
        CODE_GATE_AR=0
        (cd auto-refactor && "$NODE_BIN" "$ar_gate_script") >"$LOG_AR_SELF" 2>&1 || CODE_GATE_AR=$?
        if [[ "$CODE_GATE_AR" -ne 0 ]]; then
            STATUS_AR="BLOCK"
            FAILED=1
            cat "$LOG_AR_SELF" >> "$LOG_AR"
        fi
    done
elif [[ "$FAST_MODE" -eq 1 && "$STATUS_AR" == "PASS" ]]; then
    CODE_GATE_AR=0
    (cd auto-refactor && "$NODE_BIN" scripts/gate-self-slice.js) >"$LOG_AR_SELF" 2>&1 || CODE_GATE_AR=$?
    if [[ "$CODE_GATE_AR" -ne 0 ]]; then
        STATUS_AR="BLOCK"
        FAILED=1
        cat "$LOG_AR_SELF" >> "$LOG_AR"
    fi
fi

# 判定必须在所有影响该步骤的检查之后渲染：gate-self 与并行套件同属 ENGINE-AUDIT-05。
if [[ "$STATUS_AR" == "PASS" ]]; then
    write_step_verdict "ENGINE-AUDIT-05" PASS "auto-refactor 静态引擎多维自审通过"
else
    write_step_verdict "ENGINE-AUDIT-05" BLOCK "auto-refactor 静态引擎多维自审未通过"
fi

# 日志输出与清理：子进程失败后回显末尾 15 行日志
if [[ "$STATUS_WT" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_WT" ]]; then
        echo "✖ BLOCK  workspace-timing 审查未通过:"
        tail -n 15 "$LOG_WT" | sed 's/^/   /'
    fi
fi

if [[ "$STATUS_WG" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_WG" ]]; then
        echo "✖ BLOCK  WebGames 审查未通过:"
        tail -n 15 "$LOG_WG" | sed 's/^/   /'
    fi
fi

if [[ "$STATUS_AR" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_AR" ]]; then
        echo "✖ BLOCK  auto-refactor 审查未通过:"
        tail -n 15 "$LOG_AR" | sed 's/^/   /'
    fi
fi

if [[ "$STATUS_FG" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_FG" ]]; then
        echo "✖ BLOCK  fractal-git 审查未通过:"
        tail -n 15 "$LOG_FG" | sed 's/^/   /'
    fi
fi

if [[ "$FAILED" -ne 0 ]]; then
    DIAG_DIR="$ROOT_DIR/.audit-logs/failures"
    mkdir -p "$DIAG_DIR" 2>/dev/null || true
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S" 2>/dev/null || echo "unknown")
    [[ "$STATUS_WT" != "PASS" && -s "$LOG_WT" ]] && cp "$LOG_WT" "$DIAG_DIR/fail-timing-03-workspace-timing-$TIMESTAMP.err.log" 2>/dev/null || true
    [[ "$STATUS_WG" != "PASS" && -s "$LOG_WG" ]] && cp "$LOG_WG" "$DIAG_DIR/fail-webgames-04-domain-audit-$TIMESTAMP.err.log" 2>/dev/null || true
    [[ "$STATUS_AR" != "PASS" && -s "$LOG_AR" ]] && cp "$LOG_AR" "$DIAG_DIR/fail-engine-05-auto-refactor-$TIMESTAMP.err.log" 2>/dev/null || true
    [[ "$STATUS_FG" != "PASS" && -s "$LOG_FG" ]] && cp "$LOG_FG" "$DIAG_DIR/fail-rust-06-fractal-git-$TIMESTAMP.err.log" 2>/dev/null || true
    echo "💡 失败审查完整日志已保留至: .audit-logs/failures/" >&2
    "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --prune >/dev/null 2>&1 || true
fi

rm -f "$LOG_AR" "$LOG_WT" "$LOG_WG" "$LOG_AR_SELF" "$LOG_FG"

# --- 治理快照漂移归口：仅时间戳变化回滚，语义变化留待显式提交 ---
# 全量扫描必然重写 governance-supervisor.json 的 lastUpdated，若不归口会让工作树永久脏，
# 进而锁死 release-tag.sh 的干净树门禁。此处只判定与回滚，绝不代替操作者提交。
SNAPSHOT_NOTE=""
if [[ -f "$ROOT_DIR/auto-refactor/scripts/lib/trajectory-ledger-redact.js" ]]; then
    SNAPSHOT_NOTE=$("$NODE_BIN" "$ROOT_DIR/auto-refactor/scripts/lib/trajectory-ledger-redact.js" --revert-timestamp 2>&1) || true
fi

# 统一合并执行报告、十维质量看板与步骤摘要生成（经结构化 JSON 契约移交，消除位置参数漂移）
SUMMARY_INPUT=$(mktemp)
"$NODE_BIN" -e '
const fs = require("fs");
const [
  outPath, guardsPath, startTime, failed, jsonMode, fastMode, agentMode,
  commitLedger, rootDir, hygieneReportFile, statusHygiene, statusRules,
  statusAr, statusWt, statusWg, statusFg, codeHygiene, codeIso, codeGi,
  codeDensity, codeEloc, guardsExit
] = process.argv.slice(1);
let ruleCodes = [];
let guardResults = null;
try {
  const g = JSON.parse(fs.readFileSync(guardsPath, "utf8"));
  if (Array.isArray(g.codes)) ruleCodes = g.codes.map((c) => Number(c) || 0);
  if (g.guards && typeof g.guards === "object") guardResults = g.guards;
} catch (_) {}
if (ruleCodes.length === 0) {
  const fallback = Number(guardsExit) || 1;
  ruleCodes = new Array(23).fill(fallback);
}
const payload = {
  startTime: Number(startTime) || Date.now(),
  failed: failed === "1",
  jsonMode: jsonMode === "1",
  agentMode: agentMode === "1",
  fastMode: fastMode === "1",
  commitLedger: commitLedger === "1",
  runner: "sh",
  rootDir,
  hygieneReportFile,
  statuses: {
    hygiene: statusHygiene,
    rules: statusRules,
    ar: statusAr,
    wt: statusWt,
    wg: statusWg,
    fg: statusFg
  },
  codes: {
    hygiene: Number(codeHygiene) || 0,
    iso: Number(codeIso) || 0,
    gi: Number(codeGi) || 0,
    density: Number(codeDensity) || 0,
    eloc: Number(codeEloc) || 0,
    catalog: Number(ruleCodes[0]) || 0
  },
  ruleCodes,
  guardResults
};
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
' "$SUMMARY_INPUT" "$GUARDS_JSON" "$START_TIME" "$FAILED" "$JSON_MODE" "$FAST_MODE" "$AGENT_MODE" \
  "$COMMIT_LEDGER" "$ROOT_DIR" "$LOG_HYGIENE" "$STATUS_HYGIENE" "$STATUS_RULES" \
  "$STATUS_AR" "$STATUS_WT" "$STATUS_WG" "$STATUS_FG" "$CODE_HYGIENE" "$CODE_ISO" "$CODE_GI" \
  "$CODE_DENSITY" "$CODE_ELOC" "$GUARDS_EXIT"

REPORT_EXIT=0
"$NODE_BIN" "$ROOT_DIR/scripts/common/render-audit-all-summary.js" --input "$SUMMARY_INPUT" || REPORT_EXIT=$?

if [[ "$REPORT_EXIT" -ne 0 ]]; then
    FAILED=1
fi

if [[ "$JSON_MODE" -eq 1 || "$AGENT_MODE" -eq 1 ]]; then
    exit "$FAILED"
fi

if [[ -n "$SNAPSHOT_NOTE" ]]; then
    echo "ℹ️  $SNAPSHOT_NOTE"
fi

if [[ "$FAILED" -ne 0 ]]; then
    echo "✖ BLOCK  审查中枢检测到未通过项，请排查修复对应项目"
    exit 1
else
    echo "✔ 全工作区审查完成，所有项目健康合规"
    exit 0
fi
