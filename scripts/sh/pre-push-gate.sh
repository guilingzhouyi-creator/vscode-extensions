#!/usr/bin/env bash
# =============================================================================
# pre-push-gate.sh — 本地 Git 推送前置全量回归与质量门禁
# -----------------------------------------------------------------------------
# 职能域：gate
# 触发方：.githooks/pre-push 或 本地 CLI 手动触发
# 用法：
#   bash scripts/sh/pre-push-gate.sh
# 依赖：git, bash, node, npm
# 退出码：0=通过；1=门禁阻断
# =============================================================================
set -uo pipefail

echo "================================================================="
echo "🚀 执行本地 Pre-Push 远程推送前置全量质量与回归门禁"
echo "================================================================="

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR"

FAILED=0

# --- Gate 1: 全工作区零空文件与物理卫生守卫 ---
echo "[1/6] 校验全工作区零物理空文件与空白脚本守卫..."
if ! node auto-refactor/scripts/validate-no-empty-scripts.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 1: 发现物理 0 字节或语义虚空文件！"
    FAILED=1
else
    echo "  ✔ [PASS] 全工作区零空文件校验通过"
fi

# --- Gate 2: 规则单源目录一致性同步 ---
echo "[2/6] 校验全工作区单源规则目录同步..."
if ! node scripts/common/generate-rule-catalog.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 2: 单源规则目录生成失败！"
    FAILED=1
else
    echo "  ✔ [PASS] 全工作区单源规则目录同步通过"
fi

# --- Gate 3: auto-refactor 引擎全量并行测试套件 ---
echo "[3/6] 执行 auto-refactor 全量回归测试套件 (138 套)..."
if ! (cd auto-refactor && npm test >/dev/null 2>&1); then
    echo "❌ [FAIL] Gate 3: auto-refactor 回归测试套件未全部通过！"
    FAILED=1
else
    echo "  ✔ [PASS] auto-refactor 全量测试套件全部通过"
fi

# --- Gate 4: auto-refactor 多维自审与质量基线 Ratchet ---
echo "[4/6] 执行 auto-refactor 十维质量基线与多维自审 (LOC预算/熵/密度/BIF)..."
if ! node auto-refactor/scripts/validate-self-multidimensional-audit.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 4: auto-refactor 多维自审或十维质量基线未达标！"
    FAILED=1
else
    echo "  ✔ [PASS] auto-refactor 十维质量基线多维自审全部达标"
fi

# --- Gate 5: workspace-timing 单元测试套件 ---
echo "[5/6] 执行 workspace-timing 单元测试回归..."
if ! (cd workspace-timing && npm test >/dev/null 2>&1); then
    echo "❌ [FAIL] Gate 5: workspace-timing 单元测试失败！"
    FAILED=1
else
    echo "  ✔ [PASS] workspace-timing 130 套单元测试全部通过"
fi

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
echo "[6/6] 执行 workspace-timing L0~L5 六层审查门禁..."
if ! (cd workspace-timing && npm run review >/dev/null 2>&1); then
    echo "❌ [FAIL] Gate 6: workspace-timing L0~L5 审查门禁未通过！"
    FAILED=1
else
    echo "  ✔ [PASS] workspace-timing 审查门禁全部 PASS"
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 【推送阻断】Pre-Push 全量门禁校验失败，已阻止推送至远程分支！"
    echo "   请在本地修复上述失败项并通过自测后再执行 git push。"
    echo "================================================================="
    exit 1
else
    echo "🎉 【门禁放行】Pre-Push 全量质量与回归门禁全部 PASS！允许推送至远程。"
    echo "================================================================="
    exit 0
fi

