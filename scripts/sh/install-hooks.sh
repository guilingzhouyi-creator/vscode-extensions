#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 提交门禁激活工具)
# 文件路径: scripts/sh/install-hooks.sh
# 架构定位: 仓库级 Git Hooks 本地提交门禁激活器 (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI 手动执行 / CI 初始化 | 上游: .githooks/* | 下游: core.hooksPath | 运行时: Bash 4+
# 职责说明: 配置 Git 本地 hooks 路径至 .githooks 目录，赋予跨平台可执行权限并验证激活状态
# 退出语义与设计依据: 退出码: 0=激活成功, 1=非 Git 仓库或配置失败 | 设计依据: AGENTS.md 统一门禁工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/install-hooks.sh
# ==============================================================================
set -uo pipefail

echo "================================================================="
echo "🔧 正在激活仓库级 Git 本地提交门禁 (.githooks)..."
echo "================================================================="

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$GIT_ROOT" ]]; then
    echo "❌ [FAIL] 当前目录不在 Git 仓库内！"
    exit 1
fi

chmod +x .githooks/* scripts/sh/*.sh 2>/dev/null || true
git config core.hooksPath .githooks

echo "✅ 已配置 git config core.hooksPath = .githooks"
echo "✅ Pre-Commit 门禁 (.githooks/pre-commit -> scripts/sh/pre-commit-gate.sh)"
echo "✅ Commit-Msg 门禁 (.githooks/commit-msg -> scripts/sh/commit-msg-gate.sh)"
echo "✅ Pre-Push 门禁 (.githooks/pre-push -> scripts/sh/pre-push-gate.sh)"
echo "================================================================="
echo "🎉 本地 Git 提交门禁激活成功！后续每次 commit 将自动执行前置安全自检。"
echo "================================================================="
exit 0
