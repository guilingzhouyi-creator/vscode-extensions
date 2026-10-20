# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 控制台渲染基础库)
# 文件路径: scripts/ps1/lib/console-dashboard.ps1
# 架构定位: 纯函数渲染库 (Windows PowerShell，由审查 Runner 点源加载)
# 依赖与触发: 触发方: audit-all.ps1 | 上游: 宽字符显示宽度与评分等级 | 下游: 终端看板与 Markdown 表格 | 运行时: PowerShell 7+
# 职责说明: 提供东亚宽字符显示宽度计算、单元格对齐、看板行封边、进度条与评分等级标签六项纯函数，使审查编排与终端呈现解耦
# 退出语义与设计依据: 无独立退出码（纯函数库，不执行 I/O） | 设计依据: 高内聚渲染契约与单文件双轨体积预算
# ------------------------------------------------------------------------------
# 用法示例:
#   . "$PSScriptRoot/lib/console-dashboard.ps1"
#   Get-DisplayWidth "工作区物理卫生"
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

function Get-DisplayWidth {
    [CmdletBinding()]
    param(
        [string]$Text = ''
    )
    if ([string]::IsNullOrEmpty($Text)) { return 0 }
    $w = 0
    foreach ($ch in $Text.ToCharArray()) {
        $code = [int]$ch
        # 制表符、CJK 统一表意文字、全角标点与状态符号按双列宽计
        if ($code -ge 0x2500 -and $code -le 0x259F) {
            $w += 1
        } elseif (($code -ge 0x2E80 -and $code -le 0x9FFF) -or
                  ($code -ge 0xF900 -and $code -le 0xFAFF) -or
                  ($code -ge 0xFF01 -and $code -le 0xFF60) -or
                  ($code -ge 0xFFE0 -and $code -le 0xFFE6) -or
                  ($code -eq 0x2705 -or $code -eq 0x274C)) {
            $w += 2
        } else {
            $w += 1
        }
    }
    return $w
}

function Format-AlignedCell {
    [CmdletBinding()]
    param(
        [string]$Text = '',
        [int]$Width = 0,
        [string]$Align = 'Left'
    )
    $dw = Get-DisplayWidth $Text
    $pad = [math]::Max(0, $Width - $dw)
    if ($Align -eq 'Right') {
        return (" " * $pad) + $Text
    } elseif ($Align -eq 'Center') {
        $left = [math]::Floor($pad / 2)
        $right = $pad - $left
        return (" " * $left) + $Text + (" " * $right)
    } else {
        return $Text + (" " * $pad)
    }
}

function Format-DashboardRow {
    [CmdletBinding()]
    param(
        [string]$Content = '',
        [int]$TargetWidth = 71
    )
    $dw = Get-DisplayWidth $Content
    $pad = [math]::Max(0, $TargetWidth - $dw)
    return "│" + $Content + (" " * $pad) + "│"
}

function Get-ProgressBar {
    [CmdletBinding()]
    param([double]$Score)
    $filled = [math]::Round(($Score / 100.0) * 20)
    if ($filled -lt 0) { $filled = 0 } elseif ($filled -gt 20) { $filled = 20 }
    $empty = 20 - $filled
    return ("█" * $filled) + ("░" * $empty)
}

function Get-GradeTag {
    [CmdletBinding()]
    param([double]$Score)
    if ($Score -ge 95.0) { return "[A+]" }
    if ($Score -ge 90.0) { return "[A ]" }
    if ($Score -ge 85.0) { return "[B+]" }
    if ($Score -ge 80.0) { return "[B ]" }
    if ($Score -ge 75.0) { return "[C+]" }
    if ($Score -ge 70.0) { return "[C ]" }
    if ($Score -ge 60.0) { return "[D ]" }
    return "[F ]"
}

function Get-GradeFromScore {
    [CmdletBinding()]
    param([double]$Score)
    return (Get-GradeTag $Score).Replace("[", "").Replace("]", "").Trim()
}
