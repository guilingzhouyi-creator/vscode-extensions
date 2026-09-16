#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 周期归档流水线)
# 文件路径: WebGames/scripts/sh/archive-volume.sh
# 架构定位: CLI 入口 Wrapper (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / 周期封存任务 | 上游: scripts/py/archive_volume.py | 下游: docs/归档库 | 运行时: Bash 4+
# 职责说明: 自动化完成短期施工区阶段性案卷封存归档，调用 Python 归档内核并透传参数与退出码
# 退出语义与设计依据: 退出码: 0=归档成功, 1=阻断错误, 2=用法错误 | 设计依据: AGENTS.md 周期封存契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/archive-volume.sh --detect
#   bash scripts/sh/archive-volume.sh --cycle --apply
#   bash scripts/sh/archive-volume.sh --all --apply
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(python3.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"

PY=""
for C in python3 python; do
  if command -v "$C" >/dev/null 2>&1; then
    PY="$C"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "【archive-volume】python3/python 缺失"
  exit 2
fi

cd "$ROOT_DIR"
"$PY" scripts/py/archive_volume.py "$@"
exit $?
