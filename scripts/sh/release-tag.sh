#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 跨平台构建工具链 (Release · 发布闭环与标签发布)
# 文件路径: scripts/sh/release-tag.sh
# 架构定位: 发布流水线编排器 (Linux Bash)
# 依赖与触发: 触发方: 发布负责人 CLI | 上游: version-bump.sh / package.sh | 下游: Git Tag / GitHub Release | 运行时: Bash 4+
# 职责说明: 编排版本递增、构建验证、资产校验、Git 提交与发布标签创建的完整交付闭环
# 退出语义与设计依据: 退出码: 0=成功, 1=业务阻断, 2=用法错误 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/release-tag.sh workspace-timing patch --message 'release note'
#   bash scripts/sh/release-tag.sh workspace-timing patch --no-push
# ==============================================================================
set -uo pipefail

EXT="${1:-}"
MODE="${2:-}"
MESSAGE=""
NO_PUSH=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message|-m) MESSAGE="$2"; shift 2 ;;
    --no-push) NO_PUSH=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: bash scripts/sh/release-tag.sh <ext> <major|minor|patch> --message \"vX.Y.Z — 标题\" [--no-push] [--dry-run]"
      exit 0
      ;;
    *) shift ;;
  esac
done

if [[ -z "$EXT" || -z "$MODE" ]]; then
  echo "用法: bash scripts/sh/release-tag.sh <扩展目录> <major|minor|patch> --message \"vX.Y.Z — 标题 | 英文副标题\" [--no-push] [--dry-run]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXT_DIR="$ROOT/$EXT"
PKG_FILE="$EXT_DIR/package.json"
OUT_DIR="$ROOT/dist/$EXT"

# ─── 严格门禁 0：参数与身份 ───
if [[ -z "$MESSAGE" ]]; then
  echo "::error::--message 必填（提交信息须以 vX.Y.Z 开头，供 release.yml 自动发布门禁识别）" >&2
  exit 2
fi
if [[ ! -f "$PKG_FILE" ]]; then
  echo "::error::[$EXT] 扩展目录无效（无 package.json）: $EXT_DIR" >&2
  exit 1
fi
if ! node -e "process.exit(require(process.argv[1]).engines?.vscode ? 0 : 1)" "$PKG_FILE" 2>/dev/null; then
  echo "::error::[$EXT] 非 VS Code 扩展（缺少 engines.vscode），拒绝发布" >&2
  exit 1
fi
if [[ ! -f "$EXT_DIR/CHANGELOG.md" ]]; then
  echo "::error::[$EXT] 缺少 CHANGELOG.md（keep-a-changelog 是发布前置契约）" >&2
  exit 1
fi
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "::error::[$EXT] 不在 git 仓库内，release-tag 必须从仓库内执行" >&2
  exit 1
fi

# ─── 严格门禁 1：干净工作树 ───
DIRTY=$(git -C "$ROOT" status --porcelain)
if [[ -n "$DIRTY" ]]; then
  echo "::error::[$EXT] 工作树不干净，拒绝发布:" >&2
  echo "$DIRTY" | head -20 >&2
  exit 1
fi

# ─── 严格门禁 2：现版本与目标版本合法性 ───
CUR_VER=$(node -e "process.stdout.write(require(process.argv[1]).version||'')" "$PKG_FILE" 2>/dev/null || echo "")
if [[ ! "$CUR_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::[$EXT] package.json 版本非法: '$CUR_VER'" >&2
  exit 1
fi
case "$MODE" in
  major|minor|patch) ;;
  *) echo "::error::[$EXT] 无效递增模式: '$MODE'（须 major|minor|patch）" >&2; exit 2 ;;
esac

# ─── 严格门禁 3：提交信息前缀与目标版本一致性 ───
# 支持 bare `vX.Y.Z ...` 与 conventional-commit 前缀 `feat(x): vX.Y.Z ...`（与 release.yml 同规）
# 注意：正则必须存入变量再用于 [[ =~ ]]（括号/竖线若直接内联会被解析为条件运算符）
RE_BARE='^v([0-9]+\.[0-9]+\.[0-9]+)[[:space:]]'
RE_CONV='^(feat|fix|refactor|perf|chore|docs|test|style|build|ci|revert)\([^)]*\):[[:space:]]*v([0-9]+\.[0-9]+\.[0-9]+)[[:space:]]'
MSG_VER=""
if [[ "$MESSAGE" =~ $RE_BARE ]]; then
  MSG_VER="${BASH_REMATCH[1]}"
elif [[ "$MESSAGE" =~ $RE_CONV ]]; then
  MSG_VER="${BASH_REMATCH[2]}"
fi
if [[ -z "$MSG_VER" ]]; then
  echo "::error::[$EXT] --message 必须以 vX.Y.Z 开头（可带 conventional-commit 前缀），当前: $MESSAGE" >&2
  exit 2
fi

# ─── 严格门禁 4：目标 Tag 幂等（防重复发布，与 release.yml 同源）───
TARGET_VER="$MSG_VER"
TAG="$EXT-v$TARGET_VER"
if git -C "$ROOT" tag -l "$TAG" | grep -qx "$TAG"; then
  echo "::error::[$EXT] Tag 已存在: $TAG（拒绝重复发布）" >&2
  exit 1
fi

# ─── 严格门禁 5：目标版本单调（dry-run 与真实路径一致，提前拦截回退/重复）───
if ! node -e "const c=process.argv[1].split('.').map(Number); const n=process.argv[2].split('.').map(Number); process.exit(n[0]>c[0]||(n[0]===c[0]&&n[1]>c[1])||(n[0]===c[0]&&n[1]===c[1]&&n[2]>c[2])?0:1)" "$CUR_VER" "$TARGET_VER"; then
  echo "::error::[$EXT] 目标版本 $TARGET_VER 未严格大于现版本 $CUR_VER" >&2
  exit 1
fi

# ─── dry-run：只打印全流程计划，不执行任何写操作 ───
if [[ "$DRY_RUN" == "true" ]]; then
  echo "【dry-run】$EXT 发布计划:"
  echo "【dry-run】版本: $CUR_VER → $TARGET_VER（mode=$MODE）"
  echo "【dry-run】步骤: version-bump → npm ci → compile → vsce package → 资产校验 pre/post"
  echo "【dry-run】提交: 仅 $EXT/package.json + $EXT/CHANGELOG.md，信息: $MESSAGE"
  echo "【dry-run】Tag:   $TAG"
  [[ "$NO_PUSH" == "true" ]] && echo "【dry-run】--no-push：Tag 与分支均不推送（本地留痕）"
  exit 0
fi

echo "【$EXT】发布开始: $CUR_VER → $TARGET_VER"
echo "【$EXT】步骤 1/6: 版本递增（version-bump.sh）..."
bash "$ROOT/scripts/sh/version-bump.sh" "$EXT" "$TARGET_VER" || { echo "::error::版本递增失败" >&2; exit 1; }

# ─── 步骤 2：构建验证（npm ci 保证与 CI 同依赖树）───
# 与 package.sh 同规：node_modules 缺失，或 lockfile 比 node_modules 新（依赖已变更）
# 时强制 npm ci，杜绝用陈旧依赖构建出与 CI 不同的发布产物
echo "【$EXT】步骤 2/6: npm ci + compile ..."
LOCK="$EXT_DIR/package-lock.json"
NM="$EXT_DIR/node_modules"
if [[ ! -d "$NM" || ( -f "$LOCK" && "$LOCK" -nt "$NM" ) ]]; then
  [[ -f "$LOCK" && "$LOCK" -nt "$NM" ]] && echo "  检测到 lockfile 比 node_modules 新 → 重新 npm ci"
  (cd "$EXT_DIR" && npm ci) || { echo "::error::npm ci 失败" >&2; exit 1; }
fi
(cd "$EXT_DIR" && npm run compile) || { echo "::error::compile 失败" >&2; exit 1; }

# ─── 步骤 3：资产预检 ───
echo "【$EXT】步骤 3/6: 展示资产预检 ..."
bash "$ROOT/scripts/sh/check-display-assets.sh" "$EXT" pre || exit 1

# ─── 步骤 4：vsce 打包到统一 dist/<ext>/ 布局 ───
echo "【$EXT】步骤 4/6: vsce package → dist/$EXT/$EXT-$TARGET_VER.vsix ..."
mkdir -p "$OUT_DIR"
VSIX="$OUT_DIR/$EXT-$TARGET_VER.vsix"
(cd "$EXT_DIR" && npx --yes @vscode/vsce package -o "$VSIX") || { echo "::error::vsce package 失败" >&2; exit 1; }
[[ -f "$VSIX" ]] || { echo "::error::产物缺失: $VSIX" >&2; exit 1; }

# SHA256 校验和（与 release.yml 同构）
HASH=$(sha256sum "$VSIX" | awk '{print $1}')
echo "$HASH  $(basename "$VSIX")" > "$OUT_DIR/SHA256SUMS.txt"

# ─── 步骤 5：资产后检（icon 与 README 图片必须真实打进 vsix）───
echo "【$EXT】步骤 5/6: 展示资产后检 ..."
bash "$ROOT/scripts/sh/check-display-assets.sh" "$EXT" post "$VSIX" || exit 1

# ─── 步骤 6：提交 + 打 Tag + 推送（构建验证全部通过后才执行）───
echo "【$EXT】步骤 6/6: 提交 + Tag + 推送 ..."
if [[ -n "$(git -C "$ROOT" diff --name-only -- "$EXT/package.json" "$EXT/CHANGELOG.md")" ]]; then
  git -C "$ROOT" add "$EXT/package.json" "$EXT/CHANGELOG.md"
  git -C "$ROOT" commit -m "$MESSAGE" || { echo "::error::commit 失败" >&2; exit 1; }
else
  echo "::warning::[$EXT] 未检测到 package.json/CHANGELOG.md 变更（版本已被手工递增?），仍继续 Tag"
fi
git -C "$ROOT" tag -a "$TAG" -m "Release $TAG" || { echo "::error::打 Tag 失败" >&2; exit 1; }

if [[ "$NO_PUSH" != "true" ]]; then
  git -C "$ROOT" push origin HEAD || { echo "::error::分支推送失败" >&2; exit 1; }
  git -C "$ROOT" push origin "$TAG" || { echo "::error::Tag 推送失败" >&2; exit 1; }
fi

echo "✔ [$EXT] 发布闭环完成: $TAG"
echo "✔ [$EXT] 产物: $VSIX（SHA256: $HASH）"
echo "✔ [$EXT] 远端 Tag $TAG 推送后，.github/workflows/release.yml 的 Tag 触发路径将自动补建 Release（产物已同构）"
