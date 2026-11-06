#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与版本控制自动化 (Tooling · 错峰推送自动化)
# 文件路径: scripts/sh/run-daily-staggered-push.sh
# 架构定位: 每日错峰推送执行器 (Linux Bash)
# 依赖与触发: 触发方: cron / CI 调度 / 本地 CLI | 上游: 本地 main 分支与远端 origin/main | 下游: Git 远端推送与审查日志 | 运行时: Bash 4+ 与 Node.js
# 职责说明: 计算未推送提交积压，随机抽取 3~6 个提交并受控推进远端指针，记录审计日志
# 退出语义与设计依据: 退出码: 0=执行成功或正常跳过, 1=执行失败 | 设计依据: AGENTS.md 错峰平滑发布契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/run-daily-staggered-push.sh --dry-run
#   bash scripts/sh/run-daily-staggered-push.sh
#   bash scripts/sh/run-daily-staggered-push.sh --count 4 --force
#   bash scripts/sh/run-daily-staggered-push.sh --impact --dry-run
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ORCHESTRATOR_JS="$REPO_ROOT/scripts/common/staggered-push-orchestrator.js"

if [[ ! -f "$ORCHESTRATOR_JS" ]]; then
  echo "✖ Orchestrator script not found: $ORCHESTRATOR_JS" >&2
  exit 1
fi

NODE_CMD="node"
if ! command -v "$NODE_CMD" >/dev/null 2>&1; then
  echo "✖ Node.js runtime not found in PATH" >&2
  exit 1
fi

exec "$NODE_CMD" "$ORCHESTRATOR_JS" "$@"
