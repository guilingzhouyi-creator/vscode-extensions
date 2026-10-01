#!/usr/bin/env bash
# =============================================================================
# install-hooks.sh — 一键激活仓库级 Git Hooks 本地提交门禁 (Bash 版)
# -----------------------------------------------------------------------------
# 职能域：gate
# 触发方：本地 CLI 手动执行
# 用法：
#   bash scripts/sh/install-hooks.sh
# 退出码：0=成功；非0=失败
# =============================================================================
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
