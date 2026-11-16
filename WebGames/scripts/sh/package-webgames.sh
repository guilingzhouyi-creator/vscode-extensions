#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 跨平台构建工具链 (Build · 游戏导出流水线)
# 文件路径: WebGames/scripts/sh/package-webgames.sh
# 架构定位: 游戏打包 Runner (Linux Bash)
# 依赖与触发: 触发方: 发布流程 / 本地打包 | 上游: Godot Export Presets | 下游: dist/WebGames | 运行时: Bash 4+
# 职责说明: 调度 Godot 导出预设完成 Web/PC 目标产物打包并归集至发行目录
# 退出语义与设计依据: 退出码: 0=打包成功, 1=导出失败 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/package-webgames.sh
#   bash scripts/sh/package-webgames.sh --target Windows --export-release --include-mod-sdk
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
OUT_DIR="$ROOT_DIR/dist"
TARGET="Windows"
EXPORT_RELEASE=0
INCLUDE_MOD_SDK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out 需要参数}"; shift 2 ;;
    --target) TARGET="${2:?--target 需要参数}"; shift 2 ;;
    --export-release) EXPORT_RELEASE=1; shift 1 ;;
    --include-mod-sdk) INCLUDE_MOD_SDK=1; shift 1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "【用法错误】未知参数: $1"; exit 2 ;;
  esac
done

if ! command -v "$GODOT_BIN" >/dev/null 2>&1 && command -v "${GODOT_BIN}.exe" >/dev/null 2>&1; then
  GODOT_BIN="${GODOT_BIN}.exe"
fi

if ! command -v "$GODOT_BIN" >/dev/null 2>&1; then
  echo "【package-webgames】未找到 Godot 可执行文件: $GODOT_BIN"
  exit 2
fi

case "$TARGET" in
  Windows|"Windows Desktop") PRESET_NAME="Windows Desktop" ;;
  Linux) PRESET_NAME="Linux" ;;
  Web) PRESET_NAME="Web" ;;
  *) PRESET_NAME="$TARGET" ;;
esac

find_python_bin() {
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
  elif command -v python >/dev/null 2>&1; then
    echo "python"
  fi
}

bundle_mod_sdk_assets() {
  local py_bin="$1"
  local sync_sdk_py="$ROOT_DIR/scripts/py/sync_mod_sdk.py"
  local build_sdk_bin_py="$ROOT_DIR/scripts/py/build_kalar_mod_binary.py"
  if [[ -n "$py_bin" ]]; then
    "$py_bin" -X utf8 "$sync_sdk_py" --check-only >/dev/null || {
      echo "【package-webgames】MOD SDK 契约存在漂移，拒绝携带分发！"
      exit 1
    }
    "$py_bin" -X utf8 "$build_sdk_bin_py" --check >/dev/null || {
      echo "【package-webgames】kalar-mod CLI 构建前置校验未通过！"
      exit 1
    }
  fi
  rm -rf "$OUT_DIR/mod_sdk"
  cp -R "$ROOT_DIR/mod_sdk" "$OUT_DIR/mod_sdk"
  find "$OUT_DIR/mod_sdk" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
}

run_release_bundle_audit() {
  local py_bin="$1"
  local audit_release_py="$ROOT_DIR/scripts/py/audit_release_bundle.py"
  if [[ -z "$py_bin" ]] || [[ ! -f "$audit_release_py" ]]; then
    return 0
  fi
  local audit_flags=(--dir "$OUT_DIR")
  if [[ $INCLUDE_MOD_SDK -eq 1 ]]; then
    audit_flags+=(--require-sdk)
  fi
  "$py_bin" -X utf8 "$audit_release_py" "${audit_flags[@]}" >/dev/null || {
    echo "【package-webgames】发行产物净度或 SDK 捆绑门禁未通过！"
    exit 1
  }
}

if [[ $EXPORT_RELEASE -eq 1 ]]; then
  EXPORT_MODE="--export-release"
  EXPORT_LABEL="release"
  case "$PRESET_NAME" in
    "Windows Desktop") ARTIFACT_NAME="pure_world_engine.exe" ;;
    Linux) ARTIFACT_NAME="pure_world_engine.x86_64" ;;
    Web) ARTIFACT_NAME="index.html" ;;
    *) ARTIFACT_NAME="pure_world_engine.pck" ;;
  esac
else
  EXPORT_MODE="--export-pack"
  EXPORT_LABEL="pack"
  ARTIFACT_NAME="pure_world_engine.pck"
fi

mkdir -p "$OUT_DIR"
ARTIFACT_PATH="$OUT_DIR/$ARTIFACT_NAME"

echo "【package-webgames】开始导出产物 (Target=$PRESET_NAME, Mode=$EXPORT_MODE)..."
echo "  • 引擎: $($GODOT_BIN --version 2>/dev/null || echo "$GODOT_BIN")"
echo "  • 产物路径: $ARTIFACT_PATH"

cd "$ROOT_DIR" || exit 1
"$GODOT_BIN" --headless "$EXPORT_MODE" "$PRESET_NAME" "$ARTIFACT_PATH"
code=$?

if [[ $code -eq 0 ]] && [[ -f "$ARTIFACT_PATH" ]]; then
  FILE_SIZE=$(wc -c < "$ARTIFACT_PATH" | tr -d ' ')
  SHA=$(sha256sum "$ARTIFACT_PATH" 2>/dev/null | awk '{print $1}' || echo "N/A")
  echo "【package-webgames】导出成功！"
  echo "  • 文件大小: $FILE_SIZE 字节"
  echo "  • SHA-256: $SHA"

  # 验证 dev_harness 与 tests 绝对排除 (零测试/调试脚手架污染)
  SCAN_TARGETS=("$ARTIFACT_PATH")
  SIDECAR_PCK="${ARTIFACT_PATH%.*}.pck"
  if [[ -f "$SIDECAR_PCK" ]] && [[ "$SIDECAR_PCK" != "$ARTIFACT_PATH" ]]; then
    SCAN_TARGETS+=("$SIDECAR_PCK")
  fi
  for SCAN_FILE in "${SCAN_TARGETS[@]}"; do
    if grep -aq "res://dev_harness/" "$SCAN_FILE" 2>/dev/null; then
      echo "【package-webgames】安全门禁拦截：导出产物包含 res://dev_harness/ 调试脚手架代码 ($SCAN_FILE)！"
      exit 1
    fi
  done
  echo "  • 安全门禁: dev_harness 零调试脚手架排除验证通过"

  # 外部加载 assets 捆绑：config.kdat 与 mods/ (.kmod 归档)
  MODS_OUT_DIR="$OUT_DIR/mods"
  mkdir -p "$MODS_OUT_DIR"
  PY_BIN=""
  if command -v python3 >/dev/null 2>&1; then
    PY_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PY_BIN="python"
  fi
  KALAR_MOD_PY="$ROOT_DIR/mod_sdk/tools/kalar_mod.py"
  KDAT_PATH="$OUT_DIR/config.kdat"
  MODS_BUNDLED=0

  if [[ -n "$PY_BIN" ]] && [[ -f "$KALAR_MOD_PY" ]]; then
    "$PY_BIN" "$KALAR_MOD_PY" bake "$ROOT_DIR/config" --monolithic -o "$KDAT_PATH" >/dev/null || {
      echo "【package-webgames】config.kdat 烘焙失败！"
      exit 1
    }
    if [[ -d "$ROOT_DIR/mods" ]]; then
      for dir in "$ROOT_DIR/mods"/*; do
        if [[ -d "$dir" ]] && [[ -f "$dir/pack.json" ]]; then
          mod_name="$(basename "$dir")"
          "$PY_BIN" "$KALAR_MOD_PY" pack "$dir" -o "$MODS_OUT_DIR/${mod_name}.kmod" >/dev/null || {
            echo "【package-webgames】MOD 打包失败: $mod_name"
            exit 1
          }
          MODS_BUNDLED=$((MODS_BUNDLED + 1))
        fi
      done
    fi
  fi

  if [[ -d "$ROOT_DIR/mods" ]]; then
    for kmod_file in "$ROOT_DIR/mods"/*.kmod; do
      if [[ -f "$kmod_file" ]]; then
        cp -f "$kmod_file" "$MODS_OUT_DIR/$(basename "$kmod_file")"
        MODS_BUNDLED=$((MODS_BUNDLED + 1))
      fi
    done
  fi

  KDAT_PRESENT="false"
  if [[ -f "$KDAT_PATH" ]]; then
    KDAT_PRESENT="true"
  fi

  MOD_SDK_INCLUDED="false"
  if [[ $INCLUDE_MOD_SDK -eq 1 ]]; then
    bundle_mod_sdk_assets "${PY_BIN:-$(find_python_bin)}"
    MOD_SDK_INCLUDED="true"
  fi
  run_release_bundle_audit "${PY_BIN:-$(find_python_bin)}"

  # 追加式构建元数据指纹留痕（统一 UTC Z 时区与目标元数据）
  GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  MANIFEST_PATH="$OUT_DIR/build_manifest.jsonl"
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  echo "{\"timestamp\":\"$TIMESTAMP\",\"git_commit\":\"$GIT_COMMIT\",\"target\":\"$PRESET_NAME\",\"export_mode\":\"$EXPORT_LABEL\",\"artifact_name\":\"$ARTIFACT_NAME\",\"size_bytes\":$FILE_SIZE,\"sha256\":\"$SHA\",\"mods_bundled\":$MODS_BUNDLED,\"mod_sdk_included\":$MOD_SDK_INCLUDED,\"config_kdat_present\":$KDAT_PRESENT,\"status\":\"SUCCESS\"}" >> "$MANIFEST_PATH"
  echo "  • 外部资产捆绑: config.kdat=$KDAT_PRESENT, mods=$MODS_BUNDLED, mod_sdk=$MOD_SDK_INCLUDED"
  echo "  • 构建元数据指纹已留痕: $MANIFEST_PATH"
  exit 0
else
  echo "【package-webgames】导出失败 (退出码: $code)"
  exit 1
fi
