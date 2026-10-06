#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 门禁体系 (Gate · 示例检查门禁)
# 文件路径: scripts/sh/example-gate.sh
# 架构定位: 本地与 CI 自动化检查门禁 (Linux Bash)
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在质量违规阻断
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "🔒 启动本地质量门禁检查..."

# 1. 内存单遍流式暂存区预审
FAST_GATE="$ROOT/scripts/common/gate-fast-staged.js"
if [[ -f "$FAST_GATE" ]]; then
  echo "⚡ 执行暂存区流式 6 大 Gate 快速判定..."
  STATUS=0
  node "$FAST_GATE" || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "❌ [FAIL] 暂存区流式门禁未通过" >&2
    exit "$STATUS"
  fi
fi

# 2. 受影响项目智能分流调度 (Impact-Driven Routing)
SUBPROJECT="$ROOT/auto-refactor"
if [[ -d "$SUBPROJECT" ]]; then
  echo "🔍 执行目标子项目隔离测试与审查..."
  STATUS=0
  (cd "$SUBPROJECT" && npm test) || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "❌ [FAIL] 子项目测试失败" >&2
    exit "$STATUS"
  fi
fi

echo "✅ [PASS] 全部门禁检查通过"
exit 0
