#!/usr/bin/env bash
# =============================================================================
# 展示资产校验（CI 打包前后统一入口，本地亦可直接调用）
# -----------------------------------------------------------------------------
# 职责：确保扩展的展示资产（package.json 的 icon 字段 + README 中相对引用的
#       images/* 图片）已入库且真实打进 vsix —— 防打包半途失败 / 市场挂图。
# 用法：
#   scripts/sh/check-display-assets.sh <扩展目录> pre              # 打包前：资产必须存在
#   scripts/sh/check-display-assets.sh <扩展目录> post <vsix路径>   # 打包后：资产必须打进 vsix
# 说明：零配置——不硬编码资产清单，自动从 package.json / README.md 提取引用，
#       未来扩展无需改脚本即可接入。
# =============================================================================
set -euo pipefail

EXT_DIR="${1:?用法: check-display-assets.sh <扩展目录> pre|post [vsix路径]}"
MODE="${2:?用法: check-display-assets.sh <扩展目录> pre|post [vsix路径]}"

# ─── 收集被引用资产：package.json 的 icon 字段 + README 中相对引用的 images/* 图片 ───
REF_ASSETS=$( {
  node -e "const p=require('$EXT_DIR/package.json'); if (p.icon) console.log(p.icon)" 2>/dev/null || true
  grep -oE '\]\(images/[^)]+\)' "$EXT_DIR/README.md" 2>/dev/null || true
} | sed -E 's/^\]\(|\)$//g' | sort -u )

if [[ -z "$REF_ASSETS" ]]; then
  echo "ℹ️ 未引用任何展示资产，跳过校验。"
  exit 0
fi

FAIL=0
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
    VSIX="${3:?post 模式需要提供 vsix 路径}"
    if unzip -l "$VSIX" 2>/dev/null | grep -q "extension/$asset"; then
      echo "✔ [$MODE] $asset 已打进 vsix"
    else
      echo "::error::[$MODE] 产物 $VSIX 未包含 $asset（.vscodeignore 或打包配置异常）"
      FAIL=1
    fi
  else
    echo "::error::未知模式: $MODE（可选 pre|post）"
    exit 1
  fi
done <<< "$REF_ASSETS"

exit $FAIL
