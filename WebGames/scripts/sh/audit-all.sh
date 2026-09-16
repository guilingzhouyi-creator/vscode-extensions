#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/sh/audit-all.sh
# 架构定位: CLI 入口 Runner (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / CI workflow | 上游: scripts/py/audit_runner.py | 下游: 门禁聚合报告 | 运行时: Bash 4+
# 职责说明: 异步并行调度全域 20 项静态门禁审查，透传执行切片、差异检查与基线参数
# 退出语义与设计依据: 退出码: 0=全门禁通过, 1=存在阻断违规, 2=环境异常 | 设计依据: AGENTS.md 构建门禁通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-all.sh
#   bash scripts/sh/audit-all.sh --diff
#   bash scripts/sh/audit-all.sh --slice inventory
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
  echo "【audit-all】python3/python 缺失"
  exit 1
fi

exec "$PY" -X utf8 "$ROOT_DIR/scripts/py/audit_runner.py" "$@"
