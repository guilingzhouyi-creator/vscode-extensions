#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/sh/audit-arch.sh
# 架构定位: 专项门禁 Runner (Linux Bash)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/py/audit_arch.py | 下游: 控制台日志 | 运行时: Bash 4+
# 职责说明: 调度架构规则与清单一致性门禁，验证领域目录、单例重置与边界隔离
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规 | 设计依据: GD老练风格硬性规范标准 架构解耦契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-arch.sh
#   bash scripts/sh/audit-arch.sh --json
# ==============================================================================
set -uo pipefail

GODOT="${GODOT:-godot}"

# 项目根 = 本文件所在目录 (scripts/sh) 的上两级
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"

if ! command -v "$GODOT" >/dev/null 2>&1; then
	echo "[错误] 未找到 Godot 可执行文件: $GODOT" >&2
	echo "       请安装 Godot 4.x 并通过 GODOT 环境变量指定路径" >&2
	exit 127
fi

echo "[信息] 使用引擎: $($GODOT --version 2>/dev/null || echo "$GODOT")"
echo "[信息] 项目根: $PROJECT_ROOT"

cd "$PROJECT_ROOT" || exit 1
"$GODOT" --headless -s "res://tests/arch_runner.gd"
code=$?

if [ $code -eq 0 ]; then
	echo "[通过] 架构护栏审查通过"
else
	echo "[失败] 架构护栏存在违规项（退出码 $code）" >&2
fi
exit $code
