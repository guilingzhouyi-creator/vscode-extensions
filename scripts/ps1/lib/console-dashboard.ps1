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

function Format-QuantDashboardBlock {
    [CmdletBinding()]
    param(
        [psobject]$Quant,
        [int]$TargetWidth = 71
    )
    $sepTitle = "─ [资本负债与量化风险模型 (Financial & Risk)] "
    $sep = "├" + $sepTitle + ("─" * ($TargetWidth - (Get-DisplayWidth $sepTitle))) + "┤"
    Write-GateHost $sep -ForegroundColor Cyan

    $icrVal = [double]$Quant.icr
    $icrStatus = if ($Quant.status -eq "de-leveraging") { "强去杠杆 🟢" } elseif ($Quant.status -eq "balanced") { "平稳受控 🟡" } else { "滑坡在险 🔴" }
    $qsrVal = [double]$Quant.qsr
    $sortinoVal = [double]$Quant.sortino
    $sortinoStatus = if ($sortinoVal -ge 999.0) { "无下行退化 🟢" } elseif ($sortinoVal -ge 5.0) { "低度在险 🟢" } else { "破位退化 🔴" }
    $giniVal = [double]$Quant.debtGini
    $giniStatus = if ($giniVal -ge 0.70) { "寡头集中 🟡" } else { "弥散平铺 🟢" }
    $entropyVal = [double]$Quant.defectEntropy
    $entropyStatus = if ($entropyVal -le 0.40) { "规则聚焦 🟢" } else { "弥散分布 🟡" }
    $varVal = [double]$Quant.var95
    $halfLifeVal = [double]$Quant.halfLifeCommits

    $rows = @(
        @{ text = " · 利息覆盖率 (ICR)   : {0:F2}x  [{1}] (重构偿债/利息覆盖)" -f $icrVal, $icrStatus; color = if ($Quant.status -eq "de-leveraging") { "Green" } elseif ($Quant.status -eq "balanced") { "Yellow" } else { "Red" } },
        @{ text = " · 质量夏普比 (QSR)   : {0:F2}  [质量超额稳健] (单位波动超额收益)" -f $qsrVal; color = if ($qsrVal -ge 1.0) { "Green" } else { "Yellow" } },
        @{ text = " · 索提诺比率 (Sortino): {0:F1}  [{1}] (及格线下行风险)" -f $sortinoVal, $sortinoStatus; color = if ($sortinoVal -ge 1.0) { "Green" } else { "Yellow" } },
        @{ text = " · 债务基尼系数 (Gini) : {0:F2}   [{1}] (文件级债务集中度)" -f $giniVal, $giniStatus; color = if ($giniVal -ge 0.70) { "Yellow" } else { "Green" } },
        @{ text = " · 规则信息熵 (Entropy): {0:F2}   [{1}] (规则类别扩散度)" -f $entropyVal, $entropyStatus; color = if ($entropyVal -le 0.40) { "Green" } else { "Yellow" } },
        @{ text = " · 在险价值 (VaR 95%)  : {0:F2}%  (95%置信单次最大预期下滑)" -f $varVal; color = if ($varVal -le 10.0) { "Green" } else { "Yellow" } },
        @{ text = " · 自愈半衰期 (t1/2)   : {0:F1} 步 (受损回归稳态基线步数)" -f $halfLifeVal; color = if ($halfLifeVal -le 5.0) { "Green" } else { "Yellow" } }
    )
    foreach ($r in $rows) {
        Write-GateHost (Format-DashboardRow $r.text $TargetWidth) -ForegroundColor $r.color
    }
}

function Format-QuantMarkdownBlock {
    [CmdletBinding()]
    param(
        [System.Text.StringBuilder]$Builder,
        [psobject]$Quant
    )
    [void]$Builder.AppendLine("### 📈 资本负债与风险量化看板 (Quantitative Risk Model)")
    [void]$Builder.AppendLine()
    [void]$Builder.AppendLine("| 量化指标 | 观测实值 | 状态/评级 | 业务与战术指导释义 |")
    [void]$Builder.AppendLine("| :--- | :---: | :---: | :--- |")
    $qStatus = if ($Quant.status -eq "de-leveraging") { "🟢 强去杠杆" } elseif ($Quant.status -eq "balanced") { "🟡 平稳受控" } else { "🔴 滑坡在险" }
    $qSortinoStatus = if ([double]$Quant.sortino -ge 999.0) { "🟢 无下行退化" } else { "🟡 破位监控" }
    $qGiniStatus = if ([double]$Quant.debtGini -ge 0.70) { "🟡 寡头集中" } else { "🟢 弥散平铺" }
    $qEntropyStatus = if ([double]$Quant.defectEntropy -le 0.40) { "🟢 规则聚焦" } else { "🟡 弥散分布" }
    [void]$Builder.AppendLine(("| 利息覆盖率 (ICR) | {0:F2}x | {1} | 重构偿债产能与新增负债利息比值 |" -f [double]$Quant.icr, $qStatus))
    [void]$Builder.AppendLine(("| 质量夏普比率 (QSR) | {0:F2} | 稳健度 | 单位工程质量波动下的超额及格收益 |" -f [double]$Quant.qsr))
    [void]$Builder.AppendLine(("| 索提诺比率 (Sortino) | {0:F1} | {1} | 仅惩罚跌破及格线(90分)的下行破位退化 |" -f [double]$Quant.sortino, $qSortinoStatus))
    [void]$Builder.AppendLine(("| 技术债基尼系数 (Gini) | {0:F2} | {1} | 全仓技术债务在文件间的分布不均度 |" -f [double]$Quant.debtGini, $qGiniStatus))
    [void]$Builder.AppendLine(("| 规则家族信息熵 (Entropy) | {0:F2} | {1} | 缺陷在不同规则家族维度的集中/扩散度 |" -f [double]$Quant.defectEntropy, $qEntropyStatus))
    [void]$Builder.AppendLine(("| 在险价值 (VaR 95%) | {0:F2}% | 风险极值 | 95%置信度下单次提交最大预期回撤极限 |" -f [double]$Quant.var95))
    [void]$Builder.AppendLine(("| 最大历史回撤 (MDD) | {0:F2}% | 历史极差 | 历史滑动窗口内相对历史峰值的最大跌落 |" -f [double]$Quant.mdd))
    [void]$Builder.AppendLine(("| 自愈半衰期 (t1/2) | {0:F1} 步 | 恢复速度 | 突发扰动受损后回到基线所需的提交步数 |" -f [double]$Quant.halfLifeCommits))
    [void]$Builder.AppendLine()
}
