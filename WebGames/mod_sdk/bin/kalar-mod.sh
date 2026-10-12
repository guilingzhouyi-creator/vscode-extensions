#!/usr/bin/env bash
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · Launcher)
# 文件路径: WebGames/mod_sdk/bin/kalar-mod.sh
# 架构定位: POSIX / Linux / macOS 平台 MOD SDK 统一门面一键调用脚本
# 依赖与触发: 触发方: CLI / 用户 | 上游: tools/kalar_mod.py | 运行时: Python 3.10+
# 职责说明: 跨平台一键调用 tools/kalar_mod.py CLI 统一门面
# 退出语义与设计依据: 透传 Python 执行退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》
# ------------------------------------------------------------------------------
# 用法示例:
#   ./bin/kalar-mod.sh --version
#   ./bin/kalar-mod.sh check ../templates/starter_story
# ==============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_PY="$SCRIPT_DIR/../tools/kalar_mod.py"

if command -v python3 >/dev/null 2>&1; then
    exec python3 "$TOOLS_PY" "$@"
elif command -v python >/dev/null 2>&1; then
    exec python "$TOOLS_PY" "$@"
else
    echo "错误: 未找到 python3 或 python 解释器，请先安装 Python 3.10+" >&2
    exit 1
fi
