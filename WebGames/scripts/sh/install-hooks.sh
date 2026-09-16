#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 开发者工作流基建 (Workflow · Git 自动化挂钩)
# 文件路径: WebGames/scripts/sh/install-hooks.sh
# 架构定位: 工具链安装脚本 (Linux Bash)
# 依赖与触发: 触发方: 本地开发者主动执行 | 上游: .git/hooks | 下游: pre-commit 守卫 | 运行时: Bash 4+
# 职责说明: 配置本地 Git 预提交钩子，注入提交前自动静态门禁自检看守
# 退出语义与设计依据: 退出码: 0=安装成功, 1=非 git 仓库或权限不足 | 设计依据: 门禁前置防御契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/install-hooks.sh
#   bash scripts/sh/install-hooks.sh --uninstall
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBGAMES_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${WEBGAMES_DIR}/.." && pwd)"
GIT_HOOKS_DIR="${REPO_ROOT}/.git/hooks"

if [ "${1:-}" = "--uninstall" ]; then
    echo "【Git Hooks】正在移除预提交门禁钩子..."
    rm -f "${GIT_HOOKS_DIR}/pre-commit"
    echo "【Git Hooks】已成功移除 pre-commit 钩子。"
    exit 0
fi

echo "=========================================="
echo "🏛️ 卡拉尔世界引擎：Git 预提交门禁装配"
echo "=========================================="

if command -v pre-commit >/dev/null 2>&1; then
    echo "检测到已安装 pre-commit CLI，正在激活官方 hooks..."
    (cd "${WEBGAMES_DIR}" && pre-commit install --config .pre-commit-config.yaml)
    echo "【装配成功】已成功激活 .pre-commit-config.yaml 门禁！"
    exit 0
fi

echo "未检测到 pre-commit CLI，正在使用原生轻量钩子模式..."
mkdir -p "${GIT_HOOKS_DIR}"
cat << 'EOF' > "${GIT_HOOKS_DIR}/pre-commit"
#!/usr/bin/env sh
echo "【Git Hook】正在执行 WebGames 提交前安全审查..."
if command -v pwsh >/dev/null 2>&1; then
    pwsh -NoProfile -File "WebGames/scripts/ps1/audit-all.ps1"
elif [ -f "WebGames/scripts/sh/audit-all.sh" ]; then
    bash "WebGames/scripts/sh/audit-all.sh"
else
    echo "未找到可用执行器，跳过门禁。"
    exit 0
fi
EOF
chmod +x "${GIT_HOOKS_DIR}/pre-commit"
echo "【装配成功】已成功向 .git/hooks/pre-commit 写入原生门禁！"
