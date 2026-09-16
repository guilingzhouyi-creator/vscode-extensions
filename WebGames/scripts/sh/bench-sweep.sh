#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 性能基线与基准测试 (Performance · 扫描调优体系)
# 文件路径: WebGames/scripts/sh/bench-sweep.sh
# 架构定位: 参数扫描 Runner (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / 压力调优 | 上游: scripts/py/report_sweep.py | 下游: 扫频报告 | 运行时: Bash 4+
# 职责说明: 自动化执行多档位参数扫描与承压测试，输出负载吞吐与损耗拐点数据
# 退出语义与设计依据: 退出码: 0=扫频完成, 1=异常中断 | 设计依据: 极限承压与对象池契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/bench-sweep.sh
#   bash scripts/sh/bench-sweep.sh -n 3
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
RUNS=3
OUT_DIR="$ROOT_DIR/benchmarks/reports"
KEEP=0
PY=""
for C in python3 python; do
  if command -v "$C" >/dev/null 2>&1; then PY="$C"; break; fi
done

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs) RUNS="${2:?--runs 需要参数}"; shift 2 ;;
    --out) OUT_DIR="${2:?--out 需要目录参数}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "【用法错误】未知参数: $1"; exit 2 ;;
  esac
done
if ! [[ "$RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "【用法错误】--runs 需为正整数"; exit 2
fi
if ! command -v "$GODOT_BIN" >/dev/null 2>&1; then
  echo "【bench-sweep】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"; exit 1
fi
if [ -z "$PY" ]; then
  echo "【bench-sweep】python3/python 缺失"; exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_FILES=()
for i in $(seq 1 "$RUNS"); do
  TMP="$OUT_DIR/.bench_sweep_run_${STAMP}_${i}.json"
  echo "【bench-sweep】第 ${i}/${RUNS} 次运行基准..."
  # P39 S3：显式捕获真实退出码（禁止 if ! 取反吞码）
  "$GODOT_BIN" --headless --path "$ROOT_DIR" -s res://benchmarks/bench_runner.gd -- "$TMP"
  CODE=$?
  if [ "$CODE" -ne 0 ]; then
    echo "【bench-sweep】第 ${i} 次基准运行失败（真实退出码=$CODE）"; exit "$CODE"
  fi
  RUN_FILES+=("$TMP")
done

MERGED="$OUT_DIR/bench_sweep_${STAMP}.json"
echo "【bench-sweep】聚合 ${RUNS} 次运行中位数..."
(cd "$ROOT_DIR" && "$PY" scripts/py/report_sweep.py "${RUN_FILES[@]}" --out "$MERGED" >/dev/null) || exit 1
if [ "$KEEP" = "0" ]; then
  rm -f "${RUN_FILES[@]}"
fi
cp "$MERGED" "$OUT_DIR/bench_latest.json"

# 滚动淘汰留痕：保留最近 10 份 sweep 快照，清理更早的历史文件。
# 注意：xargs -r 为 GNU 扩展（BSD/macOS 非法），改用 POSIX 空集守卫写法。
OLD_FILES="$(ls -t "$OUT_DIR"/bench_sweep_*.json 2>/dev/null | grep -v 'bench_latest.json' | tail -n +11)"
if [ -n "$OLD_FILES" ]; then
  printf '%s\n' "$OLD_FILES" | xargs rm -f
fi

echo "【bench-sweep】完成: $MERGED（已同步 bench_latest.json）"
exit 0
