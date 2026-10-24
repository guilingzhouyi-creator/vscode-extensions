#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 提交门禁激活工具)
# 文件路径: scripts/sh/install-hooks.sh
# 架构定位: 仓库级 Git Hooks 本地提交门禁激活器 (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI 手动执行 / CI 初始化 | 上游: .githooks/* | 下游: core.hooksPath | 运行时: Bash 4+
# 职责说明: 配置 Git 本地 hooks 路径至 .githooks 目录，赋予跨平台可执行位并回读验证激活状态
# 退出语义与设计依据: 退出码: 0=激活成功, 1=非 Git 仓库/缺少必需入口/回读失败 | 设计依据: AGENTS.md 统一门禁工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/install-hooks.sh
# ==============================================================================
set -euo pipefail

echo "================================================================="
echo "🔧 正在激活仓库级 Git 本地提交门禁 (.githooks)..."
echo "================================================================="

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$GIT_ROOT" ]]; then
    echo "✖ BLOCK 当前目录不在 Git 仓库内！"
    exit 1
fi
cd "$GIT_ROOT" || exit 1

REQUIRED_HOOKS=(pre-commit commit-msg pre-merge-commit post-commit post-merge pre-push)
missing_hooks=()
for hook in "${REQUIRED_HOOKS[@]}"; do
    if [[ ! -f ".githooks/$hook" ]]; then
        missing_hooks+=("$hook")
    fi
done
if (( ${#missing_hooks[@]} > 0 )); then
    echo "✖ BLOCK .githooks 缺少必需入口: ${missing_hooks[*]}"
    exit 1
fi

chmod +x .githooks/* scripts/sh/*.sh 2>/dev/null || true
git config core.hooksPath .githooks

effective_hooks_path=$(git config --get core.hooksPath || true)
if [[ "$effective_hooks_path" != ".githooks" ]]; then
    echo "✖ BLOCK core.hooksPath 回读失败 (实际: ${effective_hooks_path:-未设置})"
    exit 1
fi

# Windows 文件系统不携带 POSIX 执行位，必须通过索引 chmod 记录，
# 否则 Linux / macOS 全新克隆后 hook 会因缺少执行位被 Git 静默忽略。
for hook in "${REQUIRED_HOOKS[@]}"; do
    if ! git update-index --chmod=+x ".githooks/$hook"; then
        echo "✖ BLOCK 写入索引可执行位失败: $hook"
        exit 1
    fi
done

exec_mode_count=0
for hook in "${REQUIRED_HOOKS[@]}"; do
    record=$(git ls-files -s ".githooks/$hook")
    if [[ "$record" == 100755* ]]; then
        exec_mode_count=$((exec_mode_count + 1))
    fi
done
if (( exec_mode_count != ${#REQUIRED_HOOKS[@]} )); then
    echo "✖ BLOCK hook 索引可执行位未生效 (100755: ${exec_mode_count}/${#REQUIRED_HOOKS[@]})"
    echo "  修复: git update-index --chmod=+x .githooks/<hook>"
    exit 1
fi

if [[ -f scripts/common/gate-receipts.js ]]; then
    if ! node scripts/common/gate-receipts.js baseline; then
        echo "✖ BLOCK 门禁收据基线写入失败"
        exit 1
    fi
    echo "✅ 已写入门禁收据基线 (gate-receipts baseline)"
else
    echo "⚠️ SKIP 未找到 scripts/common/gate-receipts.js，跳过收据基线"
fi

echo "✅ 已配置 git config core.hooksPath = $effective_hooks_path"
echo "✅ 已为 ${REQUIRED_HOOKS[*]} 设置并回读索引可执行位 100755"
for hook in "${REQUIRED_HOOKS[@]}"; do
    echo "✅ $hook 门禁 (.githooks/$hook -> pwsh / bash 双运行期路由)"
done
echo "================================================================="
echo "🎉 本地 Git 提交门禁激活成功！后续每次 commit 将自动执行前置安全自检。"
echo "================================================================="
exit 0
