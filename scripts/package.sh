#!/usr/bin/env bash
# =============================================================================
# 统一扩展打包入口（bash 同构版，与 scripts/package.ps1 同约定）
# -----------------------------------------------------------------------------
# 仓库约定（本地与 CI 同构）：
#   dist/<扩展名>/<扩展名>-<版本>.vsix      # 主产物
#   dist/<扩展名>/SHA256SUMS.txt            # 最新版本的校验和
# - 扩展自动发现：仓库顶层含 package.json 的目录（为后续扩展预留，无需改脚本）
# - 每个扩展目录默认保留最近 5 个版本，更旧的自动清理
# - GitHub CI（.github/workflows/release.yml）产出相同结构并发布到 Releases
#
# 用法：
#   bash scripts/package.sh                              # 打包全部扩展
#   bash scripts/package.sh --name workspace-timing      # 只打包指定扩展
#   bash scripts/package.sh --keep 3                     # 每扩展只保留最近 3 个版本
#   bash scripts/package.sh --skip-build                 # 跳过 compile，直接 vsce 打包
# =============================================================================
set -euo pipefail

KEEP=5
NAME=""
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name|-n) NAME="$2"; shift 2 ;;
    --keep|-k) KEEP="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --help|-h)
      echo "Usage: bash scripts/package.sh [--name <ext>] [--keep <n>] [--skip-build]"
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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
  PKG_VER=$(node -p "require('./$EXT/package.json').version" 2>/dev/null || echo "")
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
