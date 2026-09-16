#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 跨平台构建工具链 (Build · VS Code 扩展打包流水线)
# 文件路径: scripts/sh/package.sh
# 架构定位: 扩展打包 Runner (Linux Bash)
# 依赖与触发: 触发方: 发布闭环 / 本地打包 | 上游: vsce / npm build | 下游: dist/<ext>/ | 运行时: Bash 4+
# 职责说明: 打包 workspace-timing 等 VS Code 扩展至 dist 目录，执行依赖编译、生成校验和与历史版本轮转
# 退出语义与设计依据: 退出码: 0=打包完成, 1=编译或打包失败 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/package.sh
#   bash scripts/sh/package.sh --name workspace-timing
#   bash scripts/sh/package.sh --keep 3
# ==============================================================================
set -uo pipefail

KEEP=5
NAME=""
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name|-n) NAME="$2"; shift 2 ;;
    --keep|-k) KEEP="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --help|-h)
      echo "Usage: bash scripts/sh/package.sh [--name <ext>] [--keep <n>] [--skip-build]"
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

# ─── 根目录解析：本脚本位于 <根>/scripts/sh/，上溯两级 ───
# 不变量自检：脚本被移动到新目录（如 scripts/ 重构为 scripts/sh/）时，
# 根路径解析与存在性断言必须同步更新，否则立即显式失败而非静默失效。
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for iv_path in "$ROOT/scripts/sh/package.sh" "$ROOT/scripts/ps1/package.ps1" "$ROOT/.github/workflows/release.yml"; do
  if [[ ! -f "$iv_path" ]]; then
    echo "::error::根目录解析失效：找不到 $iv_path。脚本位置变更后必须同步根解析。" >&2
    exit 1
  fi
done

# ─── 发现扩展：顶层含 package.json 且声明 engines.vscode 的目录 ───
#   （engines.vscode 是 VS Code 扩展的强标识；auto-refactor 等纯工具目录
#     虽带 package.json 但无此字段，自动排除，避免被误打包为 .vsix）
mapfile -t EXTS < <(
  find "$ROOT" -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" -printf "%h\n" \
  | sed "s|^$ROOT/||" | grep -Ev "^(dist|scripts|node_modules)$" | sort -u \
  | while read -r d; do
      # 路径作为独立 argv 传入：MSYS 自动将 /c/... 转为 Windows 路径，避免嵌入 -e 字符串丢失转换
      if node -e "process.exit(require(process.argv[1]).engines?.vscode ? 0 : 1)" "$ROOT/$d/package.json" 2>/dev/null; then
        echo "$d"
      fi
    done || true
)

if [[ ${#EXTS[@]} -eq 0 ]]; then
  echo "未发现任何扩展目录（顶层含 package.json）" >&2
  exit 1
fi

if [[ -n "$NAME" ]]; then
  FOUND=false
  for e in "${EXTS[@]}"; do [[ "$e" == "$NAME" ]] && FOUND=true; done
  if ! $FOUND; then
    echo "未找到扩展目录: $NAME（可用: ${EXTS[*]}）" >&2
    exit 1
  fi
  EXTS=("$NAME")
fi

for EXT in "${EXTS[@]}"; do
  DIR="$ROOT/$EXT"
  # 绝对路径经 argv 传入：CWD 无关 + MSYS 自动转换为 Windows 路径
  PKG_VER=$(node -e "const v=require(process.argv[1]).version; process.stdout.write(v||'')" "$DIR/package.json" 2>/dev/null || echo "")
  if [[ -z "$PKG_VER" ]]; then
    echo "跳过 $EXT：无法读取 package.json version" >&2
    continue
  fi
  OUT_DIR="$ROOT/dist/$EXT"
  mkdir -p "$OUT_DIR"

  echo "── 打包 $EXT@$PKG_VER ──────────────────────────"

  if ! $SKIP_BUILD; then
    LOCK="$DIR/package-lock.json"
    NM="$DIR/node_modules"
    NEED_CI=false
    if [[ ! -d "$NM" ]]; then
      NEED_CI=true
    elif [[ -f "$LOCK" && "$LOCK" -nt "$NM" ]]; then
      echo "  检测到 lockfile 比 node_modules 新 → 重新 npm ci"
      NEED_CI=true
    fi
    if $NEED_CI; then
      echo "  npm ci ..."
      (cd "$DIR" && npm ci)
    fi
    echo "  npm run compile ..."
    (cd "$DIR" && npm run compile)
  fi

  VSIX="$OUT_DIR/$EXT-$PKG_VER.vsix"
  echo "  vsce package → $EXT-$PKG_VER.vsix ..."
  (cd "$DIR" && npx --yes @vscode/vsce package -o "$VSIX")

  # ─── SHA256 校验和 ───
  HASH=$(sha256sum "$VSIX" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')
  echo "$HASH  $(basename "$VSIX")" > "$OUT_DIR/SHA256SUMS.txt"

  # ─── 清理旧版本：语义化版本排序保留最近 KEEP 个 ───
  # shellcheck disable=SC2012
  mapfile -t STALE < <(ls -1 "$OUT_DIR"/"$EXT"-*.vsix 2>/dev/null | sort -V | head -n -"$KEEP" || true)
  for f in "${STALE[@]}"; do rm -f "$f"; done

  COUNT=$(ls -1 "$OUT_DIR"/"$EXT"-*.vsix 2>/dev/null | wc -l | tr -d ' ')
  echo "  ✔ 完成（保留 $COUNT 个版本）→ $VSIX"
done

echo ""
echo "全部完成。产物位于 dist/<扩展名>/"
