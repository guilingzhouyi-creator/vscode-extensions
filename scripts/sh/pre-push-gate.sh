#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地推送前置门禁)
# 文件路径: scripts/sh/pre-push-gate.sh
# 架构定位: 本地 Git 推送前置全量回归与质量门禁 (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 远程主干分支 | 运行时: Bash 4+
# 职责说明: 执行 8 重全量回归门禁（零空文件、规则目录、auto-refactor 全套、十维自审、timing 测试与审查、账本边界、WebGames 配置）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在未通过项阻断推送 | 设计依据: AGENTS.md 工作区治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-push-gate.sh
# ==============================================================================
set -uo pipefail

echo "================================================================="
echo "🚀 执行本地 Pre-Push 远程推送前置全量质量与回归门禁"
echo "================================================================="

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR"

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "npm")
PYTHON_BIN=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")

FAILED=0

# --- Gate 1: 全工作区零空文件与物理卫生守卫 ---
echo "[1/8] 校验全工作区零物理空文件与空白脚本守卫..."
if ! "$NODE_BIN" auto-refactor/scripts/validate-no-empty-scripts.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 1: 发现物理 0 字节或语义虚空文件！"
    FAILED=1
else
    echo "  ✔ [PASS] 全工作区零空文件校验通过"
fi

# --- Gate 2: 规则单源目录一致性同步 ---
echo "[2/8] 校验全工作区单源规则目录同步..."
if ! "$NODE_BIN" scripts/common/generate-rule-catalog.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 2: 单源规则目录生成失败！"
    FAILED=1
else
    echo "  ✔ [PASS] 全工作区单源规则目录同步通过"
fi

# --- Gate 3: auto-refactor 引擎全量门禁与回归套件 ---
echo "[3/8] 执行 auto-refactor 全量门禁与回归套件 (139 套，Rust/Build/Lint/Comments/Self/Tests)..."
if ! (cd auto-refactor && "$NPM_BIN" run gate >/dev/null 2>&1); then
    echo "❌ [FAIL] Gate 3: auto-refactor 全量门禁与回归套件未全部通过！"
    FAILED=1
else
    echo "  ✔ [PASS] auto-refactor 全量门禁与 139 套测试全部通过"
fi

# --- Gate 4: auto-refactor 多维自审与质量基线 Ratchet ---
echo "[4/8] 执行 auto-refactor 十维质量基线与多维自审 (LOC预算/熵/密度/BIF)..."
if ! "$NODE_BIN" auto-refactor/scripts/validate-self-multidimensional-audit.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 4: auto-refactor 多维自审或十维质量基线未达标！"
    FAILED=1
else
    echo "  ✔ [PASS] auto-refactor 十维质量基线多维自审全部达标"
fi

# --- Gate 5: workspace-timing 单元测试套件 ---
echo "[5/8] 执行 workspace-timing 单元测试回归..."
if ! (cd workspace-timing && "$NPM_BIN" test >/dev/null 2>&1); then
    echo "❌ [FAIL] Gate 5: workspace-timing 单元测试失败！"
    FAILED=1
else
    echo "  ✔ [PASS] workspace-timing 130 套单元测试全部通过"
fi

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
echo "[6/8] 执行 workspace-timing L0~L5 六层审查门禁..."
if ! (cd workspace-timing && "$NPM_BIN" run review >/dev/null 2>&1); then
    echo "❌ [FAIL] Gate 6: workspace-timing L0~L5 审查门禁未通过！"
    FAILED=1
else
    echo "  ✔ [PASS] workspace-timing 审查门禁全部 PASS"
fi

# --- Gate 7: auto-refactor 长期轨迹账本物理约束守卫 ---
echo "[7/8] 校验 auto-refactor 长期轨迹账本物理约束 (<350B/条, <=2MB)..."
if ! "$NODE_BIN" scripts/common/validate-trajectory-ledger.js >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 7: auto-refactor 轨迹账本物理约束未达标！"
    FAILED=1
else
    echo "  ✔ [PASS] auto-refactor 长期轨迹账本物理约束通过"
fi

# --- Gate 8: WebGames 配置架构与必需表一致性审查 ---
echo "[8/8] 执行 WebGames 配置架构与必需表一致性审查..."
if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py >/dev/null 2>&1; then
    echo "❌ [FAIL] Gate 8: WebGames 配置架构审查未通过！"
    FAILED=1
else
    echo "  ✔ [PASS] WebGames 配置架构审查全部 PASS"
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 【推送阻断】Pre-Push 全量门禁校验失败，已阻止推送至远程分支！"
    echo "   请在本地修复上述失败项并通过自测后再执行 git push。"
    echo "================================================================="
    exit 1
else
    echo "🎉 【门禁放行】Pre-Push 8 重质量与回归门禁全部 PASS！允许推送至远程。"
    echo "================================================================="
    exit 0
fi

