#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 性能基线与基准测试 (Performance · 基准测试体系)
# 文件路径: WebGames/scripts/sh/bench-run.sh
# 架构定位: 测试执行 Wrapper (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / 调优评估 | 上游: Godot Engine (Headless) | 下游: 性能指标输出 | 运行时: Bash 4+
# 职责说明: 执行单次 Godot 无头基准性能测试，度量每秒帧率、瞬态内存与耗时分位
# 退出语义与设计依据: 退出码: 0=测试成功且达标, 1=基准不达标或运行异常 | 设计依据: 高承压性能治理契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/bench-run.sh
#   bash scripts/sh/bench-run.sh --iterations 5
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
OUT_DIR="$ROOT_DIR/benchmarks/reports"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out 需要目录参数}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "【用法错误】未知参数: $1"; exit 2 ;;
  esac
done

if ! command -v "$GODOT_BIN" >/dev/null 2>&1; then
  echo "【bench-run】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/bench_${STAMP}.json"
LATEST="$OUT_DIR/bench_latest.json"

echo "【bench-run】开始运行基准（godot=$GODOT_BIN）..."
# P39 S3：显式捕获真实退出码（禁止 if ! 取反吞码）
"$GODOT_BIN" --headless --path "$ROOT_DIR" -s res://benchmarks/bench_runner.gd -- "$REPORT"
CODE=$?
if [ "$CODE" -ne 0 ]; then
  echo "【bench-run】基准运行失败（真实退出码=$CODE）"
  exit "$CODE"
fi
cp "$REPORT" "$LATEST"
echo "【bench-run】完成: $REPORT"
echo "【bench-run】最新快照: $LATEST"
exit 0
