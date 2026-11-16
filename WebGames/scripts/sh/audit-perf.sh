#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/sh/audit-perf.sh
# 架构定位: 专项门禁 Runner (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / 性能回归基线 | 上游: scripts/py/audit_perf_hotspots.py | 下游: 性能报告 | 运行时: Bash 4+
# 职责说明: 调度热点性能静态审计引擎，扫描循环内瞬态分配与六维转换反模式
# 退出语义与设计依据: 退出码: 0=合规, 1=存在性能违规 | 设计依据: ADV-PRF-002 性能护栏
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-perf.sh
#   bash scripts/sh/audit-perf.sh --json
#   bash scripts/sh/audit-perf.sh --strict
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(python3.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GATE_THRESHOLD="10"
JSON_MODE=0
STRICT_MODE=0
POSITIONAL_SET=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --gate-threshold) GATE_THRESHOLD="${2:?--gate-threshold 需要参数}"; shift 2 ;;
    --json) JSON_MODE=1; shift ;;
    --strict) STRICT_MODE=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    --*) echo "【用法错误】未知参数: $1"; exit 2 ;;
    *)
      if [[ "$POSITIONAL_SET" -eq 0 ]]; then
        GATE_THRESHOLD="$1"
        POSITIONAL_SET=1
        shift
      else
        echo "【用法错误】多余位置参数: $1"; exit 2
      fi
      ;;
  esac
done

PY=""
for C in python3 python; do
  if command -v "$C" >/dev/null 2>&1; then
    PY="$C"
    break
  fi
done
if [[ -z "$PY" ]]; then
  echo "【audit-perf】python3/python 缺失"
  exit 1
fi

HOTSPOT_ARGS=()
if [[ "$JSON_MODE" -eq 1 ]]; then HOTSPOT_ARGS+=("--json"); fi
if [[ "$STRICT_MODE" -eq 1 ]]; then HOTSPOT_ARGS+=("--strict"); fi

if [[ "$JSON_MODE" -eq 0 ]]; then
  echo "=== 1/2 静态热点扫描 audit_perf_hotspots.py ==="
fi
hotspot_code=0
(cd "$ROOT_DIR" && "$PY" scripts/py/audit_perf_hotspots.py ${HOTSPOT_ARGS[@]+"${HOTSPOT_ARGS[@]}"}) || hotspot_code=$?
if [[ "$hotspot_code" -ne 0 ]]; then
  echo "【audit-perf】静态热点扫描未通过 (exit=$hotspot_code)"
  exit "$hotspot_code"
fi
if [[ "$JSON_MODE" -eq 1 ]]; then
  exit 0
fi

GATE_ARGS=("--gate" "$GATE_THRESHOLD")
if [[ "$STRICT_MODE" -eq 1 ]]; then GATE_ARGS+=("--strict"); fi

echo ""
echo "=== 2/2 性能回归门禁（阈值 ${GATE_THRESHOLD}%）==="
code=0
(cd "$ROOT_DIR" && "$PY" scripts/py/report_aggregate.py "${GATE_ARGS[@]}") || code=$?
if [[ "$code" -ne 0 ]]; then
  echo "【audit-perf】性能回归门禁未通过"
  exit "$code"
fi
echo "【audit-perf】性能审查通过"
exit 0
