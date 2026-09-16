#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 跨平台构建工具链 (Release · 语义化版本递增体系)
# 文件路径: scripts/sh/version-bump.sh
# 架构定位: 版本管理 CLI (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / release-tag.sh | 上游: package.json / CHANGELOG.md | 下游: 递增版本与日志迁移 | 运行时: Bash 4+
# 职责说明: 执行 SemVer 语义化版本递增与 Keep-a-Changelog 变更段落迁移，强制干净树门禁
# 退出语义与设计依据: 退出码: 0=版本递增成功, 1=业务阻断, 2=用法错误 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/version-bump.sh workspace-timing patch
#   bash scripts/sh/version-bump.sh workspace-timing 1.0.0 --dry-run
# ==============================================================================
set -uo pipefail

EXT="${1:-}"
MODE="${2:-}"
DRY_RUN=false
ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --root) ROOT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: bash scripts/sh/version-bump.sh <ext> <major|minor|patch|X.Y.Z> [--dry-run] [--root <dir>]"
      exit 0
      ;;
    # 位置参数（<ext> <mode>）透传跳过；仅未知旗标显式报错，防 --dryrun 类拼写错误被静默吞掉
    -*) echo "未知参数: $1" >&2; exit 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$EXT" || -z "$MODE" ]]; then
  echo "用法: bash scripts/sh/version-bump.sh <扩展目录> <major|minor|patch|X.Y.Z> [--dry-run] [--root <dir>]" >&2
  exit 2
fi

# ─── 根目录解析（与 package.sh 同构；夹具模式覆盖）───
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

EXT_DIR="$ROOT/$EXT"
PKG_FILE="$EXT_DIR/package.json"
CHANGELOG_FILE="$EXT_DIR/CHANGELOG.md"

# ─── 严格门禁 1：扩展身份（engines.vscode 强标识，与 CI 发现逻辑同源）───
if [[ ! -f "$PKG_FILE" ]]; then
  echo "::error::[$EXT] 扩展目录无效（无 package.json）: $EXT_DIR" >&2
  exit 1
fi
if ! node -e "process.exit(require(process.argv[1]).engines?.vscode ? 0 : 1)" "$PKG_FILE" 2>/dev/null; then
  echo "::error::[$EXT] 非 VS Code 扩展（缺少 engines.vscode），拒绝执行版本递增" >&2
  exit 1
fi
if [[ ! "$EXT" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "::error::[$EXT] 扩展目录名不合法（须 kebab-case）" >&2
  exit 1
fi

# ─── 严格门禁 2：干净工作树（夹具模式豁免）───
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DIRTY=$(git -C "$ROOT" status --porcelain)
  if [[ -n "$DIRTY" ]]; then
    echo "::error::[$EXT] 工作树不干净，拒绝版本递增（先提交或暂存所有变更）:" >&2
    echo "$DIRTY" | head -20 >&2
    exit 1
  fi
fi

# ─── 读取现版本 ───
CUR_VER=$(node -e "process.stdout.write(require(process.argv[1]).version||'')" "$PKG_FILE" 2>/dev/null || echo "")
if [[ ! "$CUR_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::[$EXT] package.json 版本非法: '$CUR_VER'（须 X.Y.Z）" >&2
  exit 1
fi

# ─── 计算新版本 ───
NEW_VER=""
case "$MODE" in
  major|minor|patch)
    IFS='.' read -r -a parts <<< "$CUR_VER"
    case "$MODE" in
      major) NEW_VER="$((parts[0] + 1)).0.0" ;;
      minor) NEW_VER="${parts[0]}.$((parts[1] + 1)).0" ;;
      patch) NEW_VER="${parts[0]}.${parts[1]}.$((parts[2] + 1))" ;;
    esac
    ;;
  *)
    if [[ "$MODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      NEW_VER="$MODE"
    else
      echo "::error::[$EXT] 无效递增模式: '$MODE'（须 major|minor|patch 或 X.Y.Z）" >&2
      exit 2
    fi
    ;;
esac

# ─── 严格门禁 3：版本单调递增（node 语义比较，杜绝回退/重复）───
if ! node -e "const c=process.argv[1].split('.').map(Number); const n=process.argv[2].split('.').map(Number); process.exit(n[0]>c[0]||(n[0]===c[0]&&n[1]>c[1])||(n[0]===c[0]&&n[1]===c[1]&&n[2]>c[2])?0:1)" "$CUR_VER" "$NEW_VER"; then
  echo "::error::[$EXT] 新版本 $NEW_VER 未严格大于现版本 $CUR_VER" >&2
  exit 1
fi

# ─── CHANGELOG 迁移计划 ───
TODAY=$(date +%Y-%m-%d)
CL_PLAN=""
if [[ -f "$CHANGELOG_FILE" ]]; then
  # 提取 [Unreleased] 段内容（至下一个 `## [` 为止）
  UNRELEASED_LINES=$(awk '/^## \[Unreleased\]/{flag=1; next} /^## \[/{if(flag){exit}} flag && NF{print}' "$CHANGELOG_FILE" | wc -l | tr -d ' ')
  CL_PLAN="新版本段落: ## [$NEW_VER] — $TODAY
$([ "$UNRELEASED_LINES" -gt 0 ] && echo "[Unreleased] 现有 $UNRELEASED_LINES 行内容将迁入新段落，[Unreleased] 置空保留" || echo "[Unreleased] 当前为空，仅插入新段落头")"
else
  CL_PLAN="警告：$EXT 无 CHANGELOG.md（仓库约定要求 keep-a-changelog，仅警告不阻断）"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "【dry-run】$EXT $CUR_VER → $NEW_VER"
  echo "【dry-run】package.json version 字段改写"
  echo "【dry-run】$CL_PLAN"
  exit 0
fi

# ─── 落盘 1：package.json 版本改写（定向文本替换，保留原始格式与键序）───
node -e '
const fs = require("fs");
const file = process.argv[1];
const from = process.argv[2];
const to = process.argv[3];
const text = fs.readFileSync(file, "utf8");
const re = new RegExp(`^(\\s*"version"\\s*:\\s*")${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(")`, "m");
if (!re.test(text)) { console.error("version 字段未按预期命中（格式漂移?）: " + from); process.exit(1); }
fs.writeFileSync(file, text.replace(re, `$1${to}$2`), "utf8");
' "$PKG_FILE" "$CUR_VER" "$NEW_VER" || exit 1

# ─── 落盘 2：CHANGELOG 段落迁移（keep-a-changelog）───
if [[ -f "$CHANGELOG_FILE" ]]; then
  node -e '
const fs = require("fs");
const file = process.argv[1];
const ver = process.argv[2];
const today = process.argv[3];
let text = fs.readFileSync(file, "utf8");
const headerRe = /^## \[Unreleased\][^\n]*\n/m;
if (!headerRe.test(text)) {
  console.error("CHANGELOG 缺少 [Unreleased] 段（keep-a-changelog 约定）: " + file);
  process.exit(1);
}
const marker = "## [Unreleased]";
const start = text.indexOf(marker);
const bodyStart = text.indexOf("\n", start) + 1;
const nextSection = text.indexOf("\n## [", bodyStart);
const bodyEnd = nextSection === -1 ? text.length : nextSection;
let body = text.slice(bodyStart, bodyEnd);
const section = `## [${ver}] — ${today}\n${body}`;
// 新段落落位：紧跟 [Unreleased] 头之后（原 body 被替换），[Unreleased] 置空
text = text.slice(0, bodyStart) + "\n" + section + text.slice(bodyEnd);
fs.writeFileSync(file, text, "utf8");
' "$CHANGELOG_FILE" "$NEW_VER" "$TODAY" || exit 1
fi

echo "【$EXT】版本递增完成: $CUR_VER → $NEW_VER"
echo "【$EXT】$CL_PLAN"
echo "【$EXT】请检查 package.json 与 CHANGELOG.md 后提交（提交信息须以 v$NEW_VER 开头，release.yml 自动发布门禁）"
