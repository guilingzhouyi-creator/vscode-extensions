#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/sh/audit-docs.sh
# 架构定位: 专项门禁 Runner (Linux Bash)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/py/audit_docs.py | 下游: 控制台/JSON 报告 | 运行时: Bash 4+
# 职责说明: 调度文档规范化审计引擎，检查命名、布局、链接与时间戳门禁
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规, 2=用法错误 | 设计依据: AGENTS.md 文档门禁基线棘轮契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-docs.sh
#   bash scripts/sh/audit-docs.sh --json
#   bash scripts/sh/audit-docs.sh --fix
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
if [[ -z "$PY" ]]; then
  echo "【audit-docs】python3/python 缺失"
  exit 2
fi

cd "$ROOT_DIR" || { echo "【audit-docs】无法进入工作目录: $ROOT_DIR"; exit 2; }

# 基线审查完善：基线棘轮引导——传入 --baseline/--update-baseline 且未显式给出基准路径时，
# 自动指向 golden 基线 benchmarks/reports/docs_baseline.json（消除裸跑报 expected one argument 的踩坑）。
# 参数以数组承载而非拼接字符串，含空格的基准路径不会被词切分破坏。
BASELINE_DEFAULT="benchmarks/reports/docs_baseline.json"
FORWARD_ARGS=()
NEED_BASELINE_VALUE=0
INDEX=0
ARGV=("$@")
while [[ "$INDEX" -lt "${#ARGV[@]}" ]]; do
  ARG="${ARGV[$INDEX]}"
  case "$ARG" in
    --baseline|--update-baseline)
      FOLLOWING="${ARGV[$((INDEX + 1))]:-}"
      # 后随项缺失或本身是另一个开关（以 - 起头），均视为未提供基准路径。
      if [[ -z "$FOLLOWING" || "$FOLLOWING" == -* ]]; then
        NEED_BASELINE_VALUE=1
      fi ;;
    --baseline=*|--update-baseline=*) ;;
  esac
  INDEX=$((INDEX + 1))
done
if [[ "$NEED_BASELINE_VALUE" -eq 1 ]]; then
  FORWARD_ARGS+=("--baseline" "$BASELINE_DEFAULT")
fi
FORWARD_ARGS+=("$@")

if [[ "${#FORWARD_ARGS[@]}" -gt 0 ]]; then
  "$PY" scripts/py/audit_docs.py "${FORWARD_ARGS[@]}"
else
  "$PY" scripts/py/audit_docs.py
fi
code=$?
case "$code" in
  0) echo "【audit-docs】审查通过" ;;
  1) echo "【audit-docs】审查未通过（存在 error 级发现，--json 获取全量定位）" ;;
  *) echo "【audit-docs】用法/内部错误 (exit=$code)" ;;
esac
exit "$code"
