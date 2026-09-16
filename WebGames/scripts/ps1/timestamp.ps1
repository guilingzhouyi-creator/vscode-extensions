# ==============================================================================
# 模块归属: 开发者工作流基建 (Workflow · 时间戳工具)
# 文件路径: WebGames/scripts/ps1/timestamp.ps1
# 架构定位: 辅助工具 CLI (Windows PowerShell)
# 依赖与触发: 触发方: 施工细则生成器 / 开发者 CLI | 上游: 系统时钟 | 下游: 细则日期字段 | 运行时: PowerShell 7+
# 职责说明: 格式化获取当前本地系统时间，输出 ISO8601 与施工细则标准日期戳（YYYY-MM-DD）
# 退出语义与设计依据: 退出码: 0=成功 | 设计依据: 施工细则真实时间戳门禁
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\timestamp.ps1
#   .\scripts\ps1\timestamp.ps1 -Format DateOnly
# ==============================================================================
[CmdletBinding()]
param(
  [switch]$Full
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 六刻度判定纯函数（入参小时 0~23，返回刻度名；与 timestamp.sh resolve_period_by_hour 逐小时一致）
function Resolve-PeriodByHour {
  param([int]$Hour)
  if ($Hour -ge 22 -or $Hour -lt 2) {
    return "半夜"
  } elseif ($Hour -lt 6) {
    return "凌晨"
  } elseif ($Hour -lt 10) {
    return "早上"
  } elseif ($Hour -lt 14) {
    return "中午"
  } elseif ($Hour -lt 18) {
    return "下午"
  } else {
    return "晚上"
  }
}

$now = Get-Date
$period = Resolve-PeriodByHour -Hour $now.Hour

$day = $now.ToString("yyyy-MM-dd")

if ($Full) {
  $clock = $now.ToString("HH:mm")
  Write-Output "$day $clock $period"
} else {
  Write-Output "$day $period"
}
