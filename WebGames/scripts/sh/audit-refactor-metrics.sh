#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 复杂度度量体系)
# 文件路径: WebGames/scripts/sh/audit-refactor-metrics.sh
# 架构定位: 专项门禁 Runner (Linux Bash)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/py/audit_refactor_metrics.py | 下游: 控制台/JSON/Markdown 报告 | 运行时: Bash 4+
# 职责说明: 调度 auto-refactor 代码健康度分析引擎，度量代码圈复杂度、架构纯洁性、性能热点与重构建议
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规, 2=用法错误 | 设计依据: 架构复杂度有界收敛契约与十维质量评估模型
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-refactor-metrics.sh
#   bash scripts/sh/audit-refactor-metrics.sh --score
#   bash scripts/sh/audit-refactor-metrics.sh --json
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(python.exe)无法识别；
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
  echo "【audit-refactor-metrics】python3/python 缺失"
  exit 2
fi

cd "$ROOT_DIR"
"$PY" -X utf8 scripts/py/audit_refactor_metrics.py "$@"
code=$?
case "$code" in
  0) echo "【audit-refactor-metrics】审查通过" ;;
  1) echo "【audit-refactor-metrics】审查未通过（存在严重度超标项）" ;;
  *) echo "【audit-refactor-metrics】用法/执行异常 (exit=$code)" ;;
esac
exit "$code"
