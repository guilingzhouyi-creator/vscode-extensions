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
#   bash scripts/sh/package-webgames.sh --target Windows
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(godot.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
GODOT_BIN="${GODOT_BIN:-godot}"
OUT_DIR="$ROOT_DIR/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out 需要参数}"; shift 2 ;;
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

mkdir -p "$OUT_DIR"
PCK_NAME="kalar_world_engine.pck"
PCK_PATH="$OUT_DIR/$PCK_NAME"

echo "【package-webgames】开始导出 PCK 资源包..."
echo "  • 引擎: $($GODOT_BIN --version 2>/dev/null || echo "$GODOT_BIN")"
echo "  • 产物路径: $PCK_PATH"

cd "$ROOT_DIR" || exit 1
"$GODOT_BIN" --headless --export-pack "Windows Desktop" "$PCK_PATH"
code=$?

if [ $code -eq 0 ] && [ -f "$PCK_PATH" ]; then
  FILE_SIZE=$(wc -c < "$PCK_PATH" | tr -d ' ')
  SHA=$(sha256sum "$PCK_PATH" 2>/dev/null | awk '{print $1}' || echo "N/A")
  echo "【package-webgames】导出成功！"
  echo "  • 文件大小: $FILE_SIZE 字节"
  echo "  • SHA-256: $SHA"

  # 追加式构建元数据指纹留痕（字节级开销，杜绝二进制归档膨胀）
  GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  MANIFEST_PATH="$OUT_DIR/build_manifest.jsonl"
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  echo "{\"timestamp\":\"$TIMESTAMP\",\"git_commit\":\"$GIT_COMMIT\",\"pck_name\":\"$PCK_NAME\",\"size_bytes\":$FILE_SIZE,\"sha256\":\"$SHA\",\"status\":\"SUCCESS\"}" >> "$MANIFEST_PATH"
  echo "  • 构建元数据指纹已留痕: $MANIFEST_PATH"
  exit 0
else
  echo "【package-webgames】导出失败 (退出码: $code)"
  exit 1
fi
