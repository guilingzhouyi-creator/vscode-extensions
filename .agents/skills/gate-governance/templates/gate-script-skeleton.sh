#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 门禁体系 (Gate · 示例检查门禁)
# 文件路径: scripts/sh/example-gate.sh
# 架构定位: 本地与 CI 自动化检查门禁 (Linux Bash)
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在质量违规阻断
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUBPROJECT="$ROOT/subproject"

echo "🔒 启动本地质量门禁检查..."

if [[ -d "$SUBPROJECT" ]]; then
  # 显式子 shell 隔离工作目录
  STATUS=0
  (cd "$SUBPROJECT" && npm test) || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "❌ [FAIL] 子项目测试失败" >&2
    exit 1
  fi
fi

echo "✅ [PASS] 门禁检查通过"
exit 0
