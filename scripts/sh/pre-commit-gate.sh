#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地提交前置门禁)
# 文件路径: scripts/sh/pre-commit-gate.sh
# 架构定位: 本地 Git 提交前置物理卫生与质量安全门禁 (Linux Bash)
# 依赖与触发: 触发方: .githooks/pre-commit / 本地 CLI 手动触发 | 上游: git commit | 下游: 提交暂存区 | 运行时: Bash 4+
# 职责说明: 执行提交前物理卫生与质量安全检查（挂载 gate-fast-staged.js 极速流式验证 Gates 1-6、规则漂移熔断、精准增量编译、AST 局部切片）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在卫生或质量违规阻断 | 设计依据: AGENTS.md 跨项目全局通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-commit-gate.sh
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

export GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-NUL}"
export GIT_CONFIG_SYSTEM="${GIT_CONFIG_SYSTEM:-NUL}"
export GIT_CONFIG_NOSYSTEM="${GIT_CONFIG_NOSYSTEM:-1}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$ROOT_DIR}"

echo "================================================================="
echo "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查"
echo "================================================================="

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "npm")

# 获取当前暂存区中的文件列表（新增、修改、重命名）
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)

if [[ -z "$STAGED_FILES" ]]; then
    echo "ℹ️  暂存区无文件变更，跳过 pre-commit 检查。"
    exit 0
fi

FAILED=0

# --- Gate 1~6: 快速暂存区统一流式审查 ([1/9] 零空文件, [2/9] 换行契约, [3/9] 绝对路径, [4/9] 零黑话, [5/9] 双轨体积, [6/9] 密钥防泄漏) ---
echo "[1-6/9] 执行暂存区内存流式物理卫生与质量安全检查..."
if ! "$NODE_BIN" scripts/common/gate-fast-staged.js; then
    echo "❌ [FAIL] 暂存区物理卫生与安全审查未通过！"
    FAILED=1
fi

# --- Gate 7: 单源规则漂移熔断 ---
echo "[7/9] 校验单源规则元数据一致性..."
if echo "$STAGED_FILES" | grep -qE "auto-refactor/src/core/rules/|auto-refactor/src/analyzers/"; then
    if ! (cd auto-refactor && "$NPM_BIN" run validate-rules-registry >/dev/null 2>&1); then
        echo "❌ [FAIL] Gate 7: 规则注册表元数据发生漂移 (RCFG-RULE-DRIFT)！"
        FAILED=1
    else
        echo "  ✔ [PASS] 规则元数据单源一致性校验通过"
    fi
fi

TOUCHED_SKILLS=$(echo "$STAGED_FILES" | grep -E '^\.agents/(skills|plugins)/' || true)
if [[ -n "$TOUCHED_SKILLS" ]]; then
    echo "  ▶ 触发工作区技能集规范与插件同构校验..."
    if ! "$NODE_BIN" scripts/common/validate-skills.js; then
        echo "❌ [FAIL] Gate 7: 技能集规范或插件同构校验未通过！"
        FAILED=1
    else
        echo "  ✔ [PASS] 技能集规范与插件同构校验通过"
    fi
fi

# --- Gate 8: 项目增量编译与语法验证 (精准增量触发) ---
echo "[8/9] 检查相关项目增量编译与语法..."
TOUCHED_WT_COMPILE=$(echo "$STAGED_FILES" | grep -E '^workspace-timing/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_AR_COMPILE=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_WG_AUDIT=$(echo "$STAGED_FILES" | grep -E '^WebGames/(config/|scripts/py/audit_config\.py)' || true)

if [[ -n "$TOUCHED_WT_COMPILE" ]]; then
    echo "  ▶ 触发 workspace-timing 增量编译校验..."
    if ! (cd workspace-timing && "$NPM_BIN" run compile >/dev/null 2>&1); then
        echo "❌ [FAIL] Gate 8: workspace-timing 编译失败！"
        FAILED=1
    fi
elif echo "$STAGED_FILES" | grep -q '^workspace-timing/'; then
    echo "  ✔ [Gate 8] workspace-timing 仅文档/配置变更，跳过增量编译"
fi

TOUCHED_WT_DOC=$(echo "$STAGED_FILES" | grep -E '^workspace-timing/(CHANGELOG\.md|README\.md|package\.json)' || true)
if [[ -n "$TOUCHED_WT_DOC" ]]; then
    echo "  ▶ 触发 workspace-timing 文档布局与变更日志真实性门禁 (L3-DOC-LAYOUT)..."
    if ! (cd workspace-timing && "$NODE_BIN" scripts/dist/audit/text-layout.js >/dev/null 2>&1); then
        echo "❌ [FAIL] Gate 8: workspace-timing 文档文本布局或变更日志真实性核验未通过！"
        FAILED=1
    else
        echo "  ✔ [PASS] workspace-timing 文档布局与变更日志真实性校验通过"
    fi
fi

if [[ -n "$TOUCHED_AR_COMPILE" ]]; then
    echo "  ▶ 触发 auto-refactor 增量编译校验..."
    if ! (cd auto-refactor && "$NPM_BIN" run build >/dev/null 2>&1); then
        echo "❌ [FAIL] Gate 8: auto-refactor 编译失败！"
        FAILED=1
    fi
elif echo "$STAGED_FILES" | grep -q '^auto-refactor/'; then
    echo "  ✔ [Gate 8] auto-refactor 仅文档/配置变更，跳过增量编译"
fi

if [[ -n "$TOUCHED_WG_AUDIT" ]]; then
    echo "  ▶ 触发 WebGames 增量配置架构审查..."
    PYTHON_BIN=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")
    if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >/dev/null 2>&1; then
        echo "❌ [FAIL] Gate 8: WebGames 配置架构审查未通过！"
        FAILED=1
    fi
fi

# --- Gate 9: 暂存区增量 AST 切片质量与复杂度审查 ---
echo "[9/9] 审查暂存区 AST 切片复杂度与代码稀释 (CC<=15 [分发器<=25], Depth<=4, Noise<=4.0)..."
TOUCHED_CODE=$(echo "$STAGED_FILES" | grep -E '\.(ts|js)$' | grep -v -E '(\.d\.ts|dist/|out/|fixtures/)' || true)
if [[ -n "$TOUCHED_CODE" ]]; then
    if ! "$NODE_BIN" scripts/common/validate-staged-slice.js; then
        echo "❌ [FAIL] Gate 9: 暂存区 AST 切片审查未通过！"
        FAILED=1
    fi
else
    echo "  ✔ [PASS] 无暂存 TS/JS 代码需执行 AST 切片审查"
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 【门禁结论】Pre-Commit 检查未通过，已阻断提交！请根据上方提示修复后重试。"
    echo "================================================================="
    exit 1
else
    echo "✅ Pre-Commit 检查通过"
    echo "================================================================="
    exit 0
fi
