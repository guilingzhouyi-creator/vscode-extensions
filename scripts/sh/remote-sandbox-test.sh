#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与持续集成门禁 (Tooling · Tier 1.5 预测试机切片审查)
# 文件路径: scripts/sh/remote-sandbox-test.sh
# 架构定位: 预测试机切片与全量审查执行器 (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / 预推送钩子 / 分批调度器 | 上游: 本地工作区 | 下游: Instabox Linux 预测试机 | 运行时: Bash 4+ 与 Node.js
# 职责说明: 调度 Instabox Linux MicroVM 预测试机运行定向切片或全量审查，消解跨平台 CI 差异
# 退出语义与设计依据: 退出码: 0=切片或全量通过, 1=审查违规, 2=参数错误 | 设计依据: AGENTS.md 预测试分层公理
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/remote-sandbox-test.sh --slice hygiene
#   bash scripts/sh/remote-sandbox-test.sh --slice rust
#   bash scripts/sh/remote-sandbox-test.sh --slice impact
#   bash scripts/sh/remote-sandbox-test.sh --slice staged
#   bash scripts/sh/remote-sandbox-test.sh --slice all
#   bash scripts/sh/remote-sandbox-test.sh --local
#   bash scripts/sh/remote-sandbox-test.sh --sync
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SANDBOX_GATE_JS="$REPO_ROOT/scripts/common/remote-sandbox-gate.js"

if [[ ! -f "$SANDBOX_GATE_JS" ]]; then
  echo "✖ Remote sandbox gate script not found: $SANDBOX_GATE_JS" >&2
  exit 1
fi

NODE_CMD="node"
if ! command -v "$NODE_CMD" >/dev/null 2>&1; then
  echo "✖ Node.js runtime not found in PATH" >&2
  exit 1
fi

exec "$NODE_CMD" "$SANDBOX_GATE_JS" "$@"
