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

FAST_MODE=0
JSON_MODE=0

for arg in "$@"; do
    case "$arg" in
        --fast|-f) FAST_MODE=1 ;;
        --json|-j) JSON_MODE=1 ;;
        --help|-h)
            echo "用法: bash scripts/sh/audit-all.sh [选项]"
            echo "选项:"
            echo "  --fast, -f    快速审查模式 (跳过耗时深层自审)"
            echo "  --json, -j    以 JSON 格式输出审查摘要"
            echo "  --help, -h    显示此帮助信息"
            exit 0
            ;;
    esac
done

if [[ "$JSON_MODE" -eq 0 ]]; then
    echo "================================================================="
    echo "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)"
    echo "================================================================="
fi

FAILED=0
START_TIME=$("$NODE_BIN" -e 'process.stdout.write(Date.now().toString())')

# 1. 物理卫生与零空文件看守
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [1/5] 检查全工作区物理卫生与零空文件..."; fi
if ! "$NODE_BIN" scripts/common/validate-no-empty-files.js >/dev/null 2>&1; then
    STATUS_HYGIENE="FAIL"
    FAILED=1
else
    STATUS_HYGIENE="PASS"
fi

# 2. 单源规则注册表与目录一致性
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [2/5] 聚合与校验全工作区单源规则目录..."; fi
if ! "$NODE_BIN" scripts/common/generate-rule-catalog.js >/dev/null 2>&1; then
    STATUS_RULES="FAIL"
    FAILED=1
else
    STATUS_RULES="PASS"
fi

# 3, 4, 5. 多项目并行并发审查调度 (auto-refactor [3/5], workspace-timing [4/5], WebGames [5/5])
if [[ "$JSON_MODE" -eq 0 ]]; then
    echo "▶ [3~5/5] 并行调度执行 auto-refactor、workspace-timing 与 WebGames 审查..."
fi

LOG_AR=$(mktemp)
LOG_WT=$(mktemp)
LOG_WG=$(mktemp)
trap 'rm -f "$LOG_AR" "$LOG_WT" "$LOG_WG"' EXIT

if [[ "$FAST_MODE" -eq 1 ]]; then
    (cd auto-refactor && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js) >"$LOG_AR" 2>&1 & PID_AR=$!
else
    (cd auto-refactor && "$NPM_BIN" test && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js) >"$LOG_AR" 2>&1 & PID_AR=$!
fi

(cd workspace-timing && "$NPM_BIN" run review && "$NPM_BIN" run test:fast) >"$LOG_WT" 2>&1 & PID_WT=$!

("$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict) >"$LOG_WG" 2>&1 & PID_WG=$!

STATUS_AR="PASS"
STATUS_WT="PASS"
STATUS_WG="PASS"

if ! wait "$PID_AR"; then
    STATUS_AR="FAIL"
    FAILED=1
fi

if ! wait "$PID_WT"; then
    STATUS_WT="FAIL"
    FAILED=1
fi

if ! wait "$PID_WG"; then
    STATUS_WG="FAIL"
    FAILED=1
fi

rm -f "$LOG_AR" "$LOG_WT" "$LOG_WG"

END_TIME=$("$NODE_BIN" -e 'process.stdout.write(Date.now().toString())')
ELAPSED_SEC=$("$NODE_BIN" -e "console.log((($END_TIME - $START_TIME) / 1000).toFixed(2))")

if [[ "$JSON_MODE" -eq 1 ]]; then
    cat <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "status": "$([[ $FAILED -eq 0 ]] && echo 'PASS' || echo 'FAIL')",
  "elapsedSeconds": $ELAPSED_SEC,
  "projects": {
    "hygiene": "$STATUS_HYGIENE",
    "rulesCatalog": "$STATUS_RULES",
    "autoRefactor": "$STATUS_AR",
    "workspaceTiming": "$STATUS_WT",
    "webGames": "$STATUS_WG"
  }
}
EOF
    exit "$FAILED"
fi

FMT_HYGIENE=$(printf '%-11s' "$STATUS_HYGIENE")
FMT_RULES=$(printf '%-11s' "$STATUS_RULES")
FMT_AR=$(printf '%-11s' "$STATUS_AR")
FMT_WT=$(printf '%-11s' "$STATUS_WT")
FMT_WG=$(printf '%-11s' "$STATUS_WG")

echo ""
echo "┌───────────────────────────────────────────────────────────────┐"
echo "│              全工作区统一审查报告与质量看板                   │"
echo "├─────────────────────────────┬─────────────┬───────────────────┤"
echo "│ 审查检查项 / 子系统         │ 判定结果    │ 覆盖范围          │"
echo "├─────────────────────────────┼─────────────┼───────────────────┤"
echo "│ 1. 工作区零空文件物理卫生   │ $FMT_HYGIENE │ 全仓代码/脚本/配置│"
echo "│ 2. 单源规则目录一致性 (SSOT)│ $FMT_RULES │ 单源规则总目录    │"
echo "│ 3. auto-refactor 质量基线   │ $FMT_AR │ 质量模型 / 并行自审│"
echo "│ 4. workspace-timing 审查门禁│ $FMT_WT │ L0~L5 / 并行门禁  │"
echo "│ 5. WebGames 配置架构审查    │ $FMT_WG │ 领域配置 / 并行审查│"
echo "├─────────────────────────────┴─────────────┴───────────────────┤"
echo "│ 耗时: ${ELAPSED_SEC}s  |  全局状态: $([[ $FAILED -eq 0 ]] && echo '✅ 检查通过' || echo '❌ 检查未通过')           │"
echo "└───────────────────────────────────────────────────────────────┘"

# 6. 汇流记录工作区统一质量轨迹
if [[ "$FAILED" -ne 0 ]]; then
    "$NODE_BIN" scripts/common/record-workspace-trajectory.js --failed >/dev/null 2>&1 || true
else
    "$NODE_BIN" scripts/common/record-workspace-trajectory.js >/dev/null 2>&1 || true
fi

if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 审查中枢检测到未通过项，请排查修复对应项目"
    exit 1
else
    echo "✅ 全工作区审查完成，所有项目健康合规"
    exit 0
fi
