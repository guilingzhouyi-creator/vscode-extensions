#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 跨平台构建工具链 (Test · 自动化测试底座)
# 文件路径: WebGames/scripts/sh/test-run.sh
# 架构定位: 单元与集成测试 Runner (Linux Bash)
# 依赖与触发: 触发方: CI 流水线 / 本地验收 | 上游: Godot CLI / test_runner.gd | 下游: 控制台测试报告 | 运行时: Bash 4+
# 职责说明: 以 Headless 模式运行全量 109 套测试套件，实时输出断言通过率与汇总报告
# 退出语义与设计依据: 退出码: 0=全部通过 (100%), 1=存在用例失败 | 设计依据: AGENTS.md 构建门禁第一条
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/test-run.sh
#   bash scripts/sh/test-run.sh --json
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
OUT_DIR="$ROOT_DIR/tests/reports"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out 需要目录参数}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "【用法错误】未知参数: $1"; exit 2 ;;
  esac
done

if ! command -v "$GODOT_BIN" >/dev/null 2>&1; then
  echo "【test-run】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/test_${STAMP}.json"
LATEST="$OUT_DIR/test_latest.json"
LOG="$(mktemp)"

echo "【test-run】开始运行单元测试（godot=$GODOT_BIN）..."
# P39 S3：显式捕获 Godot 真实退出码（禁止 if ! 取反吞码），失败日志保留至验收完成
# 增加 180s 运行守护兜底，防死锁/阻塞挂起导致 CI 或终端永久卡死
if command -v timeout >/dev/null 2>&1; then
  timeout 180s "$GODOT_BIN" --headless --path "$ROOT_DIR" -s res://tests/test_runner.gd >"$LOG" 2>&1
  CODE=$?
  if [ "$CODE" -eq 124 ]; then
    echo "【test-run】测试执行超时（超过 180s 未退出，判定为异常阻塞挂起），进程已被终止"
    exit 1
  fi
else
  "$GODOT_BIN" --headless --path "$ROOT_DIR" -s res://tests/test_runner.gd >"$LOG" 2>&1
  CODE=$?
fi
if [ "$CODE" -ne 0 ]; then
  echo "【test-run】Godot 运行异常（真实退出码=$CODE），最近输出："
  tail -20 "$LOG"
  echo "【test-run】失败日志已保留: $LOG"
  exit 1
fi

# 解析断言汇总行：断言通过率: 139 / 139 测试项 (100.0%)
LINE="$(grep -oE '断言通过率: [0-9]+ / [0-9]+' "$LOG" | head -1)"
TOTAL="$(echo "$LINE" | grep -oE '[0-9]+' | tail -1)"
PASSED="$(echo "$LINE" | grep -oE '[0-9]+' | head -1)"
FAILED=$(( ${TOTAL:-0} - ${PASSED:-0} ))
GODOT_VER="$("$GODOT_BIN" --version 2>/dev/null | head -1)"
OK=1
if [ "${TOTAL:-0}" -gt 0 ] && [ "$FAILED" = "0" ]; then OK=0; fi

printf '{\n  "tool": "test_runner.gd",\n  "godot_version": "%s",\n  "timestamp": "%s",\n  "passed": %s,\n  "total": %s,\n  "failed": %s,\n  "ok": %s\n}\n' \
  "$GODOT_VER" "$(date +%Y-%m-%dT%H:%M:%S)" "${PASSED:-0}" "${TOTAL:-0}" "$FAILED" "$OK" > "$REPORT"
cp "$REPORT" "$LATEST"
rm -f "$LOG"

# 滚动淘汰留痕：保留最近 10 份历史快照，清理更早的历史文件。
# 注意：xargs -r 为 GNU 扩展（BSD/macOS 非法），改用 POSIX 空集守卫写法。
OLD_FILES="$(ls -t "$OUT_DIR"/test_*.json 2>/dev/null | grep -v 'test_latest.json' | tail -n +11)"
if [ -n "$OLD_FILES" ]; then
  printf '%s\n' "$OLD_FILES" | xargs rm -f
fi

if [ "$OK" = "0" ]; then
  echo "【test-run】通过: $PASSED / $TOTAL 项断言全部通过"
  echo "【test-run】完成: $REPORT"
  exit 0
fi
echo "【test-run】失败: $FAILED / ${TOTAL:-0} 项断言未通过（详见 $LOG 输出与 $REPORT）"
grep -E "\[ FAIL \]" "$LATEST" 2>/dev/null | head -10
exit 1
