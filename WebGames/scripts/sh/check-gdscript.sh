#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 语法分析体系)
# 文件路径: WebGames/scripts/sh/check-gdscript.sh
# 架构定位: 静态检查 Runner (Linux Bash)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: Godot CLI | 下游: 控制台输出 | 运行时: Bash 4+
# 职责说明: 执行 GDScript 批量语法分析与类型检查，警告视同错误严格阻断
# 退出语义与设计依据: 退出码: 0=语法无告警, 1=存在语法错误或警告 | 设计依据: AGENTS.md 警告即错误铁律
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/check-gdscript.sh
#   bash scripts/sh/check-gdscript.sh --scope all
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
SCOPE="all"
LOG="$(mktemp)"

PER_FILE=0
# ==============================================================================
# G3 审查收敛：.gd 扫描目录清单 —— 唯一事实源为 tests/batch_syntax_checker.gd 顶部
# SCAN_DIRS（主路径单进程批处理与逐文件兜底模式共用同一清单，禁止手工维护第二份）。
# 新增含 .gd 的顶层目录仅需在 batch_syntax_checker.gd 登记一处，两路径自动同口径。
# ==============================================================================
SCAN_DIRS_RAW="$(grep -A8 '^const SCAN_DIRS' "$ROOT_DIR/tests/batch_syntax_checker.gd" \
  | grep -oE 'res://[A-Za-z0-9_]+' | sed 's|res://||')"
if [ -z "$SCAN_DIRS_RAW" ]; then
  echo "【check-gdscript】无法从 batch_syntax_checker.gd 提取 SCAN_DIRS（单一真源缺失，请先登记）"
  exit 2
fi
DIRS=($SCAN_DIRS_RAW)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope) SCOPE="${2:?--scope 需要参数}"; shift 2 ;;
    --per-file) PER_FILE=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "【用法错误】未知参数: $1"; exit 2 ;;
  esac
done
case "$SCOPE" in all|backend|benchmarks|tests|frontend) ;; *) echo "【用法错误】--scope 取值: all|backend|benchmarks|tests|frontend"; exit 2 ;; esac

if ! command -v "$GODOT_BIN" >/dev/null 2>&1; then
  if command -v "${GODOT_BIN}.exe" >/dev/null 2>&1; then
    GODOT_BIN="${GODOT_BIN}.exe"
  else
    echo "【check-gdscript】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
    exit 1
  fi
fi

cd "$ROOT_DIR" || exit 1

if [ "$PER_FILE" -eq 0 ]; then
  # P2 审查收敛：--scope 单域同样走单进程批处理（batch_syntax_checker.gd 支持
  # 命令行用户参数指定扫描目录），消除单域检查的逐文件冷启动；--per-file 显式
  # 逐文件模式不受影响（故障定位手段）。
  echo "【check-gdscript】执行单进程极速批处理语法检查（scope=$SCOPE）..."
  if [ "$SCOPE" != "all" ]; then
    "$GODOT_BIN" --headless -s "res://tests/batch_syntax_checker.gd" -- "res://$SCOPE" >"$LOG" 2>&1
  else
    "$GODOT_BIN" --headless -s "res://tests/batch_syntax_checker.gd" >"$LOG" 2>&1
  fi
  if [ $? -eq 0 ]; then
    rm -f "$LOG"
    echo "【check-gdscript】通过"
    exit 0
  fi
  # 性能优化（审查完善）：批处理已输出失败明细（✗ res://…）且退出码 1 →
  # 仅对失败文件清单逐个冷启动复验（通常 <10 个），消除对全量数百个 .gd
  # 逐个冷启动的性能浪费；仅当批处理异常退出且无失败明细时才回落全量定位。
  cat "$LOG"
  FAILED_FILES="$(grep -E '^✗ res://' "$LOG" | sed -E 's/^✗ (res:\/\/[^ ]+).*/\1/' | sort -u)"
  if [ -n "$FAILED_FILES" ]; then
    echo "【check-gdscript】批处理失败明细 ${#FAILED_FILES} 项，对失败清单逐个复验定位..."
    CHECKED=0
    FAILS=0
    while IFS= read -r res_path; do
      [ -z "$res_path" ] && continue
      rel="${res_path#res://}"
      CHECKED=$((CHECKED + 1))
      # P39 S3：显式捕获真实退出码（禁止 if ! 取反吞码），失败日志保留至验收完成
      "$GODOT_BIN" --headless --quiet --check-only -s "$res_path" >"$LOG" 2>&1
      CODE=$?
      if [ "$CODE" -ne 0 ]; then
        FAILS=$((FAILS + 1))
        echo "✗ $rel (exit=$CODE)"
        grep -E "SCRIPT ERROR|Parse Error|ERROR" "$LOG" | head -3
      else
        echo "✓ $rel (批处理误报，复验通过)"
      fi
    done <<< "$FAILED_FILES"
    if [ "$FAILS" -ne 0 ]; then
      echo "【check-gdscript】失败日志已保留: $LOG"
      echo "【check-gdscript】检查 $CHECKED 个失败文件，复验失败 $FAILS 个"
      echo "【check-gdscript】未通过：存在解析错误，请先修复"
      exit 1
    fi
    rm -f "$LOG"
    echo "【check-gdscript】失败清单复验 $CHECKED 个全部通过（批处理误报已澄清）"
    echo "【check-gdscript】通过"
    exit 0
  fi
  echo "【check-gdscript】批处理异常退出且无失败明细，切入全量逐文件定位模式..."
fi

if [ "$SCOPE" != "all" ]; then
  DIRS=("$SCOPE")
fi
FILES=""
for D in "${DIRS[@]}"; do
  FILES+="$(find "$ROOT_DIR/$D" -name '*.gd' -not -path '*/.godot/*' -not -name '*.uid' 2>/dev/null)\n"
done
FILES="$(printf '%b' "$FILES" | sort -u | sed '/^$/d')"

CHECKED=0
FAILS=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  rel="${f#"$ROOT_DIR"/}"
  rel_res="res://${rel//\\//}"
  CHECKED=$((CHECKED + 1))
  # P39 S3：显式捕获真实退出码（禁止 if ! 取反吞码），失败日志保留至验收完成
  "$GODOT_BIN" --headless --quiet --check-only -s "$rel_res" >"$LOG" 2>&1
  CODE=$?
  if [ "$CODE" -ne 0 ]; then
    FAILS=$((FAILS + 1))
    echo "✗ $rel (exit=$CODE)"
    grep -E "SCRIPT ERROR|Parse Error|ERROR" "$LOG" | head -3
  fi
done <<< "$FILES"

if [ "$FAILS" -ne 0 ]; then
  echo "【check-gdscript】失败日志已保留: $LOG"
  echo "【check-gdscript】检查 $CHECKED 个 .gd，失败 $FAILS 个（scope=$SCOPE）"
  echo "【check-gdscript】未通过：存在解析错误，请先修复"
  exit 1
fi
rm -f "$LOG"
echo "【check-gdscript】检查 $CHECKED 个 .gd，失败 0 个（scope=$SCOPE）"
echo "【check-gdscript】通过"
exit 0
