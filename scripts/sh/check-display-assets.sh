#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 跨平台构建工具链 (Build · 资产完整性校验体系)
# 文件路径: scripts/sh/check-display-assets.sh
# 架构定位: 资产校验 Runner (Linux Bash)
# 依赖与触发: 触发方: 发布流水线 / 本地打包预检 | 上游: package.json / README.md | 下游: 校验结果 | 运行时: Bash 4+
# 职责说明: 校验扩展包图标与展示素材在打包前后完整存在，拦截死链与资源遗漏
# 退出语义与设计依据: 退出码: 0=资产健全, 1=资产缺失, 2=用法错误 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/check-display-assets.sh workspace-timing pre
#   bash scripts/sh/check-display-assets.sh workspace-timing post dist/workspace-timing.vsix
# ==============================================================================
set -uo pipefail

EXT_DIR="${1:?用法: check-display-assets.sh <扩展目录> pre|post [vsix路径]}"
MODE="${2:?用法: check-display-assets.sh <扩展目录> pre|post [vsix路径]}"

# ─── 路径归一化：接受 Windows 风格路径（PowerShell 用户直接传参）───
# 反斜杠统一转正斜杠；Git Bash 环境下经 cygpath 转 POSIX（供 unzip 使用）
EXT_DIR="${EXT_DIR//\\//}"
if command -v cygpath >/dev/null 2>&1; then
  EXT_DIR=$(cygpath -u "$EXT_DIR" 2>/dev/null || echo "$EXT_DIR")
fi

if [[ ! -f "$EXT_DIR/package.json" ]]; then
  echo "::error::[$MODE] 扩展目录无效（无 package.json）: $EXT_DIR"
  exit 2
fi

# ─── 收集被引用资产：package.json 的 icon 字段 + README 中相对引用的 images/* 图片 ───
# 注意：package.json 路径必须经 path.resolve 转绝对路径（CWD 无关）——
#   裸路径 require('x/package.json') 会被当作模块名解析而 MODULE_NOT_FOUND，
#   此前被 `|| true` 吞掉导致 icon 校验静默失效（回归守卫见 .github/workflows/ci.yml）。
REF_ASSETS=$( {
  node -e "const p=require(require('path').resolve(process.argv[1])); if (p.icon) console.log(p.icon)" "$EXT_DIR/package.json" 2>/dev/null || true
  grep -oE '\]\(\.?/?images/[^)]+\)' "$EXT_DIR/README.md" 2>/dev/null || true
} | sed -E 's/^\]\(|\)$//g; s#^\.?/##' | sort -u )

if [[ -z "$REF_ASSETS" ]]; then
  echo "ℹ️ 未引用任何展示资产，跳过校验。"
  exit 0
fi

# ─── post 模式前置：unzip 必须可用（缺工具是环境故障，必须显式报错而非误报"未包含"）───
if [[ "$MODE" == "post" ]]; then
  VSIX="${3:?post 模式需要提供 vsix 路径}"
  VSIX="${VSIX//\\//}"
  if command -v cygpath >/dev/null 2>&1; then
    VSIX=$(cygpath -u "$VSIX" 2>/dev/null || echo "$VSIX")
  fi
  if ! command -v unzip >/dev/null 2>&1; then
    echo "::error::[post] 环境缺少 unzip 工具，无法校验 vsix 内容"
    exit 1
  fi
  if [[ ! -f "$VSIX" ]]; then
    echo "::error::[post] vsix 产物不存在: $VSIX"
    exit 1
  fi
fi

FAIL=0
# post 模式：zip 目录清单只解包一次，逐资产 grep 复用（旧实现每资产重新 unzip -l）
VSIX_LISTING=""
if [[ "$MODE" == "post" ]]; then
  VSIX_LISTING=$(unzip -l "$VSIX" 2>/dev/null || true)
fi
while IFS= read -r asset; do
  [[ -z "$asset" ]] && continue
  if [[ "$MODE" == "pre" ]]; then
    if [[ -f "$EXT_DIR/$asset" ]]; then
      echo "✔ [$MODE] $asset 存在"
    else
      echo "::error::[$MODE] 展示资产缺失（需提交入库）: $EXT_DIR/$asset"
      FAIL=1
    fi
  elif [[ "$MODE" == "post" ]]; then
    if [[ -n "$VSIX_LISTING" ]] && grep -q "extension/$asset" <<< "$VSIX_LISTING"; then
      echo "✔ [$MODE] $asset 已打进 vsix"
    else
      echo "::error::[$MODE] 产物 $VSIX 未包含 $asset（.vscodeignore 或打包配置异常）"
      FAIL=1
    fi
  else
    echo "::error::未知模式: $MODE（可选 pre|post）"
    exit 2
  fi
done <<< "$REF_ASSETS"

exit $FAIL
