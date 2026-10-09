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
#   bash scripts/sh/package.sh --name workspace-timing --hotsync
#   bash scripts/sh/package.sh --name workspace-timing --install
#   bash scripts/sh/package.sh --keep 3
# ==============================================================================
set -euo pipefail

KEEP=5
NAME=""
SKIP_BUILD=false
HOT_SYNC=false
INSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name|-n|-Name) NAME="$2"; shift 2 ;;
    --keep|-k|-Keep) KEEP="$2"; shift 2 ;;
    --skip-build|-SkipBuild|--SkipBuild) SKIP_BUILD=true; shift ;;
    --hotsync|-HotSync|--HotSync) HOT_SYNC=true; shift ;;
    --install|-Install|--Install|-i) INSTALL=true; shift ;;
    --help|-h|-Help)
      echo "用法: bash scripts/sh/package.sh [选项]"
      echo "选项:"
      echo "  --name, -n, -Name <ext>     指定扩展名称 (如 workspace-timing)"
      echo "  --keep, -k, -Keep <n>       保留最近历史版本数量 (默认: 5)"
      echo "  --skip-build, -SkipBuild    跳过 npm ci 与编译阶段"
      echo "  --hotsync, -HotSync         增量编译并热同步至本机 IDE 扩展目录 (跳过 vsce 打包)"
      echo "  --install, -Install, -i     打包完成后自动安装至 VS Code / Cursor"
      echo "  --help, -h                  显示此帮助信息"
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

# ─── 扩展注册表自愈与热同步辅助函数 ───
repair_extension_registry() {
  local full_ext_id="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const fullExtId = process.argv[1];
    const candidateBases = [];
    if (process.env.USERPROFILE) candidateBases.push(process.env.USERPROFILE);
    if (process.env.HOME) candidateBases.push(process.env.HOME);

    for (const base of Array.from(new Set(candidateBases))) {
      for (const ide of [".vscode", ".cursor"]) {
        const ideDir = path.join(base, ide, "extensions");
        const extJsonPath = path.join(ideDir, "extensions.json");
        if (!fs.existsSync(extJsonPath)) continue;
        try {
          const raw = fs.readFileSync(extJsonPath, "utf8");
          const entries = JSON.parse(raw);
          if (!Array.isArray(entries)) continue;
          const valid = entries.filter((entry) => {
            if (entry && entry.identifier && entry.identifier.id === fullExtId) {
              const relLoc = entry.relativeLocation || "";
              const targetDir = path.join(ideDir, relLoc);
              return fs.existsSync(targetDir);
            }
            return true;
          });
          if (valid.length !== entries.length) {
            fs.writeFileSync(extJsonPath, JSON.stringify(valid), "utf8");
            console.log(`  已清理悬空扩展注册项 (${ideDir})`);
          }
        } catch (_) {}
      }
    }
  ' "$full_ext_id" 2>/dev/null || true
}

sync_installed_extension_files() {
  local source_dir="$1"
  local full_ext_id="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const sourceDir = process.argv[1];
    const fullExtId = process.argv[2];
    let syncedCount = 0;

    const candidateBases = [];
    if (process.env.USERPROFILE) candidateBases.push(process.env.USERPROFILE);
    if (process.env.HOME) candidateBases.push(process.env.HOME);

    function copyDirRecursive(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyDirRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    for (const base of Array.from(new Set(candidateBases))) {
      for (const ide of [".vscode", ".cursor"]) {
        const ideDir = path.join(base, ide, "extensions");
        if (!fs.existsSync(ideDir)) continue;
        let subdirs = [];
        try {
          subdirs = fs.readdirSync(ideDir, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        for (const sd of subdirs) {
          if (!sd.isDirectory() || !sd.name.startsWith(fullExtId + "-")) continue;
          const targetExtDir = path.join(ideDir, sd.name);
          const srcOut = path.join(sourceDir, "out");
          const destOut = path.join(targetExtDir, "out");
          if (fs.existsSync(srcOut)) {
            copyDirRecursive(srcOut, destOut);
          }
          for (const meta of ["package.json", "package.nls.json", "package.nls.zh-CN.json"]) {
            const metaSrc = path.join(sourceDir, meta);
            if (fs.existsSync(metaSrc)) {
              fs.copyFileSync(metaSrc, path.join(targetExtDir, meta));
            }
          }
          syncedCount++;
          console.log(`  ⚡ 已热同步至: ${targetExtDir}`);
        }
      }
    }
    process.stdout.write(syncedCount.toString());
  ' "$source_dir" "$full_ext_id"
}

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
  if [[ "$FOUND" != "true" ]]; then
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
  PUBLISHER=$(node -e "const p=require(process.argv[1]).publisher; process.stdout.write(p||'')" "$DIR/package.json" 2>/dev/null || echo "")
  FULL_EXT_ID="${PUBLISHER}.${EXT}"
  OUT_DIR="$ROOT/dist/$EXT"
  mkdir -p "$OUT_DIR"

  if [[ "$HOT_SYNC" == "true" ]]; then
    echo "── 增量编译并热同步 $EXT@$PKG_VER ──────────────────────────"
  else
    echo "── 打包 $EXT@$PKG_VER ──────────────────────────"
  fi

  if [[ "$SKIP_BUILD" != "true" ]]; then
    LOCK="$DIR/package-lock.json"
    NM="$DIR/node_modules"
    NEED_CI=false
    if [[ ! -d "$NM" ]]; then
      NEED_CI=true
    elif [[ -f "$LOCK" && "$LOCK" -nt "$NM" ]]; then
      echo "  检测到 lockfile 比 node_modules 新 → 重新 npm ci"
      NEED_CI=true
    fi
    if [[ "$NEED_CI" == "true" ]]; then
      echo "  npm ci ..."
      (cd "$DIR" && npm ci)
    fi
    echo "  npm run compile ..."
    (cd "$DIR" && npm run compile)
  fi

  # ─── 校验展示资产 (pre 模式) ───
  if [[ -f "$ROOT/scripts/sh/check-display-assets.sh" ]]; then
    echo "  核验展示资产 (pre) ..."
    bash "$ROOT/scripts/sh/check-display-assets.sh" "$DIR" pre
  fi

  if [[ "$HOT_SYNC" == "true" ]]; then
    repair_extension_registry "$FULL_EXT_ID"
    SYNCED_CNT=$(sync_installed_extension_files "$DIR" "$FULL_EXT_ID")
    if [[ "$SYNCED_CNT" == "0" ]]; then
      echo "::warning::未检测到已安装目录 ($FULL_EXT_ID)，请先使用 --install 执行首次安装。" >&2
    fi
    continue
  fi

  VSIX="$OUT_DIR/$EXT-$PKG_VER.vsix"
  echo "  vsce package → $EXT-$PKG_VER.vsix ..."
  (cd "$DIR" && npx --yes @vscode/vsce package -o "$VSIX")

  # ─── 校验展示资产 (post 模式) ───
  if [[ -f "$ROOT/scripts/sh/check-display-assets.sh" ]]; then
    echo "  核验展示资产 (post) ..."
    bash "$ROOT/scripts/sh/check-display-assets.sh" "$DIR" post "$VSIX"
  fi

  # ─── 清理旧版本：语义化版本排序保留最近 KEEP 个 ───
  # shellcheck disable=SC2012
  mapfile -t STALE < <(ls -1 "$OUT_DIR"/"$EXT"-*.vsix 2>/dev/null | sort -V | head -n -"$KEEP" || true)
  for f in "${STALE[@]}"; do rm -f "$f"; done

  # ─── 全量 SHA256 校验和（包含当前保留包与 legacy 归档包）───
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const outDir = process.argv[1];
    const ext = process.argv[2];

    function hashFile(p) {
      const buf = fs.readFileSync(p);
      return crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
    }

    const shaLines = [];
    const files = fs.readdirSync(outDir).filter((f) => f.startsWith(ext + "-") && f.endsWith(".vsix")).sort();
    for (const f of files) {
      shaLines.push(`${hashFile(path.join(outDir, f))}  ${f}`);
    }
    const legacyDir = path.join(outDir, "legacy");
    if (fs.existsSync(legacyDir)) {
      const legFiles = fs.readdirSync(legacyDir).filter((f) => f.startsWith(ext + "-") && f.endsWith(".vsix")).sort().reverse();
      for (const lf of legFiles) {
        shaLines.push(`${hashFile(path.join(legacyDir, lf))}  legacy/${lf}`);
      }
    }
    fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), shaLines.join("\n") + "\n", "utf8");
  ' "$OUT_DIR" "$EXT"

  # ─── 自动安装至 VS Code / Cursor (--install) ───
  if [[ "$INSTALL" == "true" ]]; then
    repair_extension_registry "$FULL_EXT_ID"
    VSCODE_CLI=""
    if command -v code >/dev/null 2>&1; then
      VSCODE_CLI="code"
    elif [[ -n "${LOCALAPPDATA:-}" && -f "$LOCALAPPDATA/Programs/Microsoft VS Code/bin/code.cmd" ]]; then
      VSCODE_CLI="$LOCALAPPDATA/Programs/Microsoft VS Code/bin/code.cmd"
    elif [[ -n "${LOCALAPPDATA:-}" && -f "$LOCALAPPDATA/Programs/Microsoft VS Code/bin/code" ]]; then
      VSCODE_CLI="$LOCALAPPDATA/Programs/Microsoft VS Code/bin/code"
    fi

    if [[ -n "$VSCODE_CLI" ]]; then
      echo "  正在安装至 Microsoft VS Code ..."
      "$VSCODE_CLI" --install-extension "$VSIX" --force || true
    fi

    if command -v cursor >/dev/null 2>&1; then
      echo "  正在安装至 Cursor ..."
      cursor --install-extension "$VSIX" --force || true
    fi

    sync_installed_extension_files "$DIR" "$FULL_EXT_ID" >/dev/null || true
  fi

  COUNT=$(ls -1 "$OUT_DIR"/"$EXT"-*.vsix 2>/dev/null | wc -l | tr -d ' ')
  echo "  ✔ 完成（保留 $COUNT 个版本）→ $VSIX"
done

echo ""
if [[ "$HOT_SYNC" == "true" ]]; then
  echo "全部完成。增量产物已热同步至本机 IDE 扩展目录。"
else
  echo "全部完成。产物位于 dist/<扩展名>/"
fi
