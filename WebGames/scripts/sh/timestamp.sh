#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 开发者工作流基建 (Workflow · 时间戳工具)
# 文件路径: WebGames/scripts/sh/timestamp.sh
# 架构定位: 辅助工具 CLI (Linux Bash)
# 依赖与触发: 触发方: 文档日期标记工具 / 开发者 CLI | 上游: 系统时钟 | 下游: 文档日期字段 | 运行时: Bash 4+
# 职责说明: 格式化获取当前本地系统时间，输出 ISO8601 与开发文档标准日期戳（YYYY-MM-DD）
# 退出语义与设计依据: 退出码: 0=成功 | 设计依据: 开发文档真实时间戳门禁
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/timestamp.sh
#   bash scripts/sh/timestamp.sh --date-only
# ==============================================================================
set -uo pipefail

# 六刻度判定纯函数（入参小时 0~23，返回刻度名；供逐小时断言复用）
resolve_period_by_hour() {
  local hour="$1"
  if [[ "$hour" -ge 22 ]] || [[ "$hour" -lt 2 ]]; then
    echo "半夜"
  elif [[ "$hour" -lt 6 ]]; then
    echo "凌晨"
  elif [[ "$hour" -lt 10 ]]; then
    echo "早上"
  elif [[ "$hour" -lt 14 ]]; then
    echo "中午"
  elif [[ "$hour" -lt 18 ]]; then
    echo "下午"
  else
    echo "晚上"
  fi
}

full_mode=0
if [[ "${1:-}" = "--full" ]]; then
  full_mode=1
fi

# 小时取无前导零（Git Bash 支持 %-H；兼容 sed 去零）
hour=$(date +%-H 2>/dev/null || date +%H | sed 's/^0//')
period=$(resolve_period_by_hour "$hour")

day=$(date +%F)

if [[ "$full_mode" -eq 1 ]]; then
  clock=$(date +%H:%M)
  echo "$day $clock $period"
else
  echo "$day $period"
fi
