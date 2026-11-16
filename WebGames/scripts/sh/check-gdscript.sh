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
#   bash scripts/sh/check-gdscript.sh --per-file
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
SCOPE="all"
LOG="$(mktemp)"
# 临时文件必须在任何退出路径（含早期参数校验 exit 2 与中断）被回收，避免 /tmp 遗留脏文件；
# 失败分支需保留日志供定位，故以 LOG_KEEP 标记豁免回收。
LOG_KEEP=0
trap 'if [[ "${LOG_KEEP:-0}" -eq 0 ]]; then rm -f "$LOG"; fi' EXIT INT TERM

PER_FILE=0
# ==============================================================================
# G3 审查收敛：.gd 扫描目录清单 —— 唯一事实源为 tests/batch_syntax_checker.gd 顶部
# SCAN_DIRS（主路径单进程批处理与逐文件兜底模式共用同一清单，禁止手工维护第二份）。
# 新增含 .gd 的顶层目录仅需在 batch_syntax_checker.gd 登记一处，两路径自动同口径。
# ==============================================================================
BATCH_CHECKER="$ROOT_DIR/tests/batch_syntax_checker.gd"
if [[ ! -f "$BATCH_CHECKER" ]]; then
  echo "【check-gdscript】无法找到 batch_syntax_checker.gd（单一真源缺失，请先登记）"
  exit 2
fi
SCAN_DIRS_RAW="$(awk '/^const[ \t]+SCAN_DIRS/{in_blk=1; next} in_blk{print; if(/\]/) exit}' "$BATCH_CHECKER" \
  | grep -oE 'res://[A-Za-z0-9_]+' | sed 's|res://||' || true)"
if [[ -z "$SCAN_DIRS_RAW" ]]; then
  echo "【check-gdscript】无法从 batch_syntax_checker.gd 提取 SCAN_DIRS（单一真源缺失，请先登记）"
  exit 2
fi
DIRS=()
while IFS= read -r dir_item; do
  [[ -n "$dir_item" ]] && DIRS+=("$dir_item")
done <<< "$SCAN_DIRS_RAW"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope) SCOPE="${2:?--scope 需要参数}"; shift 2 ;;
    --per-file) PER_FILE=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "【用法错误】未知参数: $1"; exit 2 ;;
  esac
done

VALID_SCOPE=0
if [[ "$SCOPE" == "all" ]]; then
  VALID_SCOPE=1
else
  for d in "${DIRS[@]}"; do
    if [[ "$SCOPE" == "$d" ]]; then
      VALID_SCOPE=1
      break
    fi
  done
fi
if [[ "$VALID_SCOPE" -ne 1 ]]; then
  SCOPES_JOINED="$(IFS='|'; echo "${DIRS[*]}")"
  echo "【用法错误】--scope 取值: all|${SCOPES_JOINED}"
  exit 2
fi

if ! command -v "$GODOT_BIN" >/dev/null 2>&1; then
  if command -v "${GODOT_BIN}.exe" >/dev/null 2>&1; then
    GODOT_BIN="${GODOT_BIN}.exe"
  else
    echo "【check-gdscript】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
    exit 1
  fi
fi

if ! "$GODOT_BIN" --headless --version </dev/null >/dev/null 2>&1; then
  echo "【check-gdscript】godot 探测失败（无法执行 --headless --version）"
  exit 1
fi

extract_godot_user_diagnostics() {
  local log_file="$1"
  awk '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        line = lines[i]
        if (line ~ /^(SCRIPT ERROR:|Parse Error:|ERROR:[[:space:]]+Failed to load script)/) {
          loc = ""
          for (j = i + 1; j <= i + 3 && j <= NR; j++) {
            if (lines[j] ~ /at:.*res:\/\//) {
              loc = lines[j]
              sub(/^[[:space:]]+/, "", loc)
              break
            }
          }
          msg = (loc != "" ? line " [" loc "]" : line)
          if (!(msg in seen)) { seen[msg] = 1; print msg }
          continue
        }
        if (line ~ /^WARNING:/) {
          is_user = (line ~ /res:\/\/|\.gd([:[:space:]]|$)|GDScript/)
          loc = ""
          for (j = i + 1; j <= i + 3 && j <= NR; j++) {
            if (lines[j] ~ /at:.*(res:\/\/|\.gd([:[:space:]]|$)|GDScript::)/) {
              is_user = 1
              loc = lines[j]
              sub(/^[[:space:]]+/, "", loc)
              break
            }
          }
          if (is_user) {
            msg = (loc != "" ? line " [" loc "]" : line)
            if (!(msg in seen)) { seen[msg] = 1; print msg }
          }
        }
      }
    }
  ' "$log_file"
}

cd "$ROOT_DIR" || exit 1

if [[ "$PER_FILE" -eq 0 ]]; then
  echo "【check-gdscript】执行单进程极速批处理语法检查（scope=$SCOPE）..."
  BATCH_CODE=0
  if [[ "$SCOPE" != "all" ]]; then
    "$GODOT_BIN" --headless --debug --ignore-error-breaks --path "$ROOT_DIR" -s "res://tests/batch_syntax_checker.gd" -- "res://$SCOPE" </dev/null >"$LOG" 2>&1 || BATCH_CODE=$?
  else
    "$GODOT_BIN" --headless --debug --ignore-error-breaks --path "$ROOT_DIR" -s "res://tests/batch_syntax_checker.gd" </dev/null >"$LOG" 2>&1 || BATCH_CODE=$?
  fi
  BATCH_DIAGS="$(extract_godot_user_diagnostics "$LOG")"
  if [[ "$BATCH_CODE" -eq 0 && -z "$BATCH_DIAGS" ]]; then
    rm -f "$LOG"
    echo "【check-gdscript】通过"
    exit 0
  fi

  grep -E '^(✗|【batch-syntax-check】|SCRIPT ERROR:|Parse Error:|ERROR:[[:space:]]+Failed to load script)' "$LOG" || true
  DIAG_COUNT=0
  if [[ -n "$BATCH_DIAGS" ]]; then
    DIAG_COUNT="$(printf '%s\n' "$BATCH_DIAGS" | grep -c .)"
    echo "【check-gdscript】检测到 Godot 编译器错误/告警 ${DIAG_COUNT} 项:"
    while IFS= read -r diag_line; do
      [[ -n "$diag_line" ]] && echo "  ! $diag_line"
    done <<< "$BATCH_DIAGS"
  fi

  FAILED_FILES="$(grep -E '^✗ res://' "$LOG" | sed -E 's/^✗ (res:\/\/[^ ]+).*/\1/' | sort -u || true)"
  if [[ -n "$FAILED_FILES" ]]; then
    FAILED_COUNT="$(printf '%s\n' "$FAILED_FILES" | grep -c .)"
    echo "【check-gdscript】批处理失败明细 ${FAILED_COUNT} 项，对失败清单逐个复验定位..."
    CHECKED=0
    FAILS=0
    while IFS= read -r res_path; do
      [[ -z "$res_path" ]] && continue
      rel="${res_path#res://}"
      CHECKED=$((CHECKED + 1))
      CODE=0
      "$GODOT_BIN" --headless --debug --ignore-error-breaks --quiet --path "$ROOT_DIR" --check-only -s "$res_path" </dev/null >"$LOG" 2>&1 || CODE=$?
      RECHECK_DIAGS="$(extract_godot_user_diagnostics "$LOG")"
      if [[ "$CODE" -ne 0 || -n "$RECHECK_DIAGS" ]]; then
        FAILS=$((FAILS + 1))
        echo "✗ $rel (exit=$CODE)"
        printf '%s\n' "$RECHECK_DIAGS" | head -5 | sed 's/^/    /'
      else
        echo "✓ $rel (批处理误报，复验通过)"
      fi
    done <<< "$FAILED_FILES"
    if [[ "$FAILS" -ne 0 || "$DIAG_COUNT" -ne 0 ]]; then
      LOG_KEEP=1
      echo "【check-gdscript】失败日志已保留: $LOG"
      echo "【check-gdscript】检查 $CHECKED 个失败文件，复验失败 $FAILS 个，编译器告警/错误 ${DIAG_COUNT} 项"
      echo "【check-gdscript】未通过：存在解析错误或编译器告警，请先修复"
      exit 1
    fi
    rm -f "$LOG"
    echo "【check-gdscript】失败清单复验 $CHECKED 个全部通过（批处理误报已澄清）"
    echo "【check-gdscript】通过"
    exit 0
  fi

  if [[ "$DIAG_COUNT" -ne 0 ]]; then
    LOG_KEEP=1
    echo "【check-gdscript】失败日志已保留: $LOG"
    echo "【check-gdscript】未通过：存在 ${DIAG_COUNT} 项编译器告警或错误，请先修复"
    exit 1
  fi
  echo "【check-gdscript】批处理异常退出且无失败明细，切入全量逐文件定位模式..."
fi

if [[ "$SCOPE" != "all" ]]; then
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
  [[ -z "$f" ]] && continue
  rel="${f#"$ROOT_DIR"/}"
  rel_res="res://${rel//\\//}"
  CHECKED=$((CHECKED + 1))
  CODE=0
  "$GODOT_BIN" --headless --debug --ignore-error-breaks --quiet --path "$ROOT_DIR" --check-only -s "$rel_res" </dev/null >"$LOG" 2>&1 || CODE=$?
  FILE_DIAGS="$(extract_godot_user_diagnostics "$LOG")"
  if [[ "$CODE" -ne 0 || -n "$FILE_DIAGS" ]]; then
    FAILS=$((FAILS + 1))
    echo "✗ $rel (exit=$CODE)"
    printf '%s\n' "$FILE_DIAGS" | head -5 | sed 's/^/    /'
  fi
done <<< "$FILES"

if [[ "$FAILS" -ne 0 ]]; then
  LOG_KEEP=1
  echo "【check-gdscript】失败日志已保留: $LOG"
  echo "【check-gdscript】检查 $CHECKED 个 .gd，失败 $FAILS 个（scope=$SCOPE）"
  echo "【check-gdscript】未通过：存在解析错误或编译器告警，请先修复"
  exit 1
fi
rm -f "$LOG"
echo "【check-gdscript】检查 $CHECKED 个 .gd，失败 $FAILS 个（scope=$SCOPE）"
echo "【check-gdscript】通过"
exit 0
