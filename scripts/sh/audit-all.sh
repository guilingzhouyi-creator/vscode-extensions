#!/usr/bin/env bash
# =============================================================================
# audit-all.sh — 全工作区统一审查与质量治理中枢 (Unified Workspace Review Orchestrator)
# -----------------------------------------------------------------------------
# 职能域：audit / review
# 适用范围：workspace-timing, auto-refactor, WebGames 三项目全域
# 用法：
#   bash scripts/sh/audit-all.sh [--fast] [--json]
# 依赖：bash, node, npm
# 退出码：0=全部通过；1=存在审查未通过项
# =============================================================================
set -uo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR"

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
START_TIME=$(node -e 'process.stdout.write(Date.now().toString())')

# 1. 物理卫生与零空文件看守
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [1/4] 检查全工作区物理卫生与零空文件..."; fi
if ! node auto-refactor/scripts/validate-no-empty-scripts.js >/dev/null 2>&1; then
    STATUS_HYGIENE="FAIL"
    FAILED=1
else
    STATUS_HYGIENE="PASS"
fi

# 2. 单源规则注册表与目录一致性
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [2/4] 聚合与校验全工作区单源规则目录..."; fi
if ! node scripts/common/generate-rule-catalog.js >/dev/null 2>&1; then
    STATUS_RULES="FAIL"
    FAILED=1
else
    STATUS_RULES="PASS"
fi

# 3. auto-refactor 静态重构与审查引擎自检
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [3/4] 执行 auto-refactor 十维质量基线与多维自审..."; fi
if [[ "$FAST_MODE" -eq 1 ]]; then
    if ! node auto-refactor/scripts/validate-self-multidimensional-audit.js >/dev/null 2>&1; then
        STATUS_AR="FAIL"
        FAILED=1
    else
        STATUS_AR="PASS"
    fi
else
    if ! (cd auto-refactor && npm test >/dev/null 2>&1) || ! node auto-refactor/scripts/validate-self-multidimensional-audit.js >/dev/null 2>&1; then
        STATUS_AR="FAIL"
        FAILED=1
    else
        STATUS_AR="PASS"
    fi
fi

# 4. workspace-timing L0~L5 六层审查门禁
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [4/4] 执行 workspace-timing L0~L5 六层审查门禁与单元自检..."; fi
if ! (cd workspace-timing && npm run review >/dev/null 2>&1) || ! (cd workspace-timing && npm run test:fast >/dev/null 2>&1); then
    STATUS_WT="FAIL"
    FAILED=1
else
    STATUS_WT="PASS"
fi

END_TIME=$(node -e 'process.stdout.write(Date.now().toString())')
ELAPSED_SEC=$(node -e "console.log((($END_TIME - $START_TIME) / 1000).toFixed(2))")

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
    "workspaceTiming": "$STATUS_WT"
  }
}
EOF
    exit "$FAILED"
fi

echo ""
echo "┌───────────────────────────────────────────────────────────────┐"
echo "│              全工作区统一审查报告与质量看板                   │"
echo "├─────────────────────────────┬─────────────┬───────────────────┤"
echo "│ 审查检查项 / 子系统         │ 判定结果    │ 覆盖范围          │"
echo "├─────────────────────────────┼─────────────┼───────────────────┤"
echo "│ 1. 工作区零空文件物理卫生   │ $(printf '%-11s' "$STATUS_HYGIENE") │ 全仓代码/脚本/配置│"
echo "│ 2. 单源规则目录一致性 (SSOT)│ $(printf '%-11s' "$STATUS_RULES") │ 336+ 条规则总目录 │"
echo "│ 3. auto-refactor 质量基线   │ $(printf '%-11s' "$STATUS_AR") │ 10 维模型 / 134套 │"
echo "│ 4. workspace-timing 审查门禁│ $(printf '%-11s' "$STATUS_WT") │ L0~L5 六层权重门禁│"
echo "├─────────────────────────────┴─────────────┴───────────────────┤"
echo "│ 耗时: ${ELAPSED_SEC}s  |  全局状态: $([[ $FAILED -eq 0 ]] && echo '✅ ALL PASS' || echo '❌ SOME CHECKS FAILED')           │"
echo "└───────────────────────────────────────────────────────────────┘"

if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 审查中枢检测到违规，请按上述失败项目逐一排查修复！"
    exit 1
else
    echo "🎉 全工作区所有项目审查全部通过，代码库处于健康合规状态。"
    exit 0
fi
