#!/usr/bin/env bash
# ==============================================================================
# 模块归属: CI/CD 自动化流水线 (Automation · 门禁共享规则库)
# 文件路径: scripts/sh/gate-common.sh
# 架构定位: 门禁规则共享库 (Linux Bash · 被 source，不可直接执行)
# 依赖与触发: 触发方: pr-gate.sh / auto-merge-gate.sh | 上游: 冲突文件清单 | 下游: C0-C3 分级 | 运行时: Bash 4+
# 职责说明: 提供 PR 门禁冲突分级的单源规则（高危文件模式 + C1/C2/C3 判定），供两道门禁共用，防规则漂移
# 退出语义与设计依据: 库文件无退出码；导出函数见下 | 设计依据: 门禁治理 §4.8 冲突分级准入
# ------------------------------------------------------------------------------
# 用法示例:
#   source "$(dirname "${BASH_SOURCE[0]}")/gate-common.sh"
#   CONFLICT_LEVEL=$(gate_classify_conflicts "$CONFLICT_FILES")
# ==============================================================================
set -uo pipefail

# 高危冲突文件模式（单源）：数据迁移 / schema / 数据库 / 核心逻辑 / 依赖清单 → 升 C3
# 注意：pr-gate 与 auto-merge-gate 必须共用本模式，两侧各自维护已发生过漂移事故
GATE_HIGH_RISK_PATTERN='migrat|schema|database|\.sql$|src/core|src/main|package(-lock)?\.json'

# 冲突文件数不超过该阈值 → C1（可自动化解）；更多 → C2（需审查判断）
GATE_C1_FILE_LIMIT=2

# gate_is_high_risk <files-string>：空格分隔的冲突文件清单中是否含高危模式
gate_is_high_risk() {
  [[ -n "${1:-}" ]] && grep -Eq "$GATE_HIGH_RISK_PATTERN" <<< "$1"
}

# gate_classify_conflicts <files-string>：按单源规则分级
#   高危文件 → C3；冲突文件 ≤ GATE_C1_FILE_LIMIT 个 → C1；否则 → C2；无文件 → C2
# （无文件名却预演失败的场景按 C2 需审查处理，与既有两脚本行为一致）
gate_classify_conflicts() {
  local files="${1:-}"
  if gate_is_high_risk "$files"; then
    echo "C3"
  elif [[ -n "$files" ]] && [[ "$(wc -w <<< "$files")" -le "$GATE_C1_FILE_LIMIT" ]]; then
    echo "C1"
  else
    echo "C2"
  fi
}
