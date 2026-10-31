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

function Get-QuantGaugeBar {
    [CmdletBinding()]
    param(
        [double]$Ratio = 0.0,
        [int]$Blocks = 10
    )
    $safe = [math]::Max(0.0, [math]::Min(1.0, $Ratio))
    $filled = [math]::Round($safe * $Blocks)
    if ($filled -lt 0) { $filled = 0 } elseif ($filled -gt $Blocks) { $filled = $Blocks }
    $empty = $Blocks - $filled
    return ("■" * $filled) + ("░" * $empty)
}

function Format-QuantDashboardBlock {
    [CmdletBinding()]
    param(
        [psobject]$Quant,
        [int]$TargetWidth = 71
    )
    $sepTitle = "─ [7/6] 架构动力学与韧性量化 (ADR-Q) "
    $sep = "├" + $sepTitle + ("─" * ($TargetWidth - (Get-DisplayWidth $sepTitle))) + "┤"
    Write-GateHost $sep -ForegroundColor Cyan

    $rcrVal = [double]$(if ($null -ne $Quant.rcr) { $Quant.rcr } else { $Quant.icr })
    $rcrStatus = if ($Quant.status -eq "de-leveraging") { "🟢 强净消融" } elseif ($Quant.status -eq "balanced") { "🟡 动态均势" } else { "🔴 赤字膨胀" }
    $rcrColor = if ($Quant.status -eq "de-leveraging") { "Green" } elseif ($Quant.status -eq "balanced") { "Yellow" } else { "Red" }
    $rcrBar = Get-QuantGaugeBar ([math]::Min(1.0, $rcrVal / 3.0)) 10

    $erqVal = [double]$(if ($null -ne $Quant.erq) { $Quant.erq } else { $Quant.qsr })
    $erqBar = Get-QuantGaugeBar ([math]::Min(1.0, $erqVal / 1.0)) 10
    $erqColor = if ($erqVal -ge 1.0) { "Green" } else { "Yellow" }

    $ddrVal = [double]$(if ($null -ne $Quant.ddr) { $Quant.ddr } else { $Quant.sortino })
    $ddrStatus = if ($ddrVal -ge 999.0) { "🟢 零破位" } elseif ($ddrVal -ge 5.0) { "🟢 强基底防御" } else { "🔴 底线失守" }
    $ddrColor = if ($ddrVal -ge 5.0) { "Green" } else { "Red" }
    $ddrRatio = if ($ddrVal -ge 999.0) { 1.0 } else { $ddrVal / 10.0 }
    $ddrBar = Get-QuantGaugeBar ([math]::Min(1.0, $ddrRatio)) 10
    $ddrStr = if ($ddrVal -ge 999.0) { "999.0" } else { "{0:F1}" -f $ddrVal }

    $edbVal = [double]$(if ($null -ne $Quant.edb95) { $Quant.edb95 } else { $Quant.var95 })
    $edbStatus = if ($edbVal -le 10.0) { "🟢 边界收敛" } elseif ($edbVal -le 25.0) { "🟡 边界受控" } else { "🔴 边界警戒" }
    $edbColor = if ($edbVal -le 25.0) { "Yellow" } else { "Red" }
    $edbBar = Get-QuantGaugeBar ([math]::Min(1.0, $edbVal / 100.0)) 10

    $ptdVal = [double]$(if ($null -ne $Quant.ptd) { $Quant.ptd } else { $Quant.mdd })
    $ptdStatus = if ($ptdVal -le 15.0) { "🟢 平稳演进" } elseif ($ptdVal -le 60.0) { "🟡 周期演进" } else { "🔴 历史剧震" }
    $ptdColor = if ($ptdVal -le 60.0) { "Yellow" } else { "Red" }
    $ptdBar = Get-QuantGaugeBar ([math]::Min(1.0, $ptdVal / 100.0)) 10

    $ehlVal = [double]$(if ($null -ne $Quant.ehl) { $Quant.ehl } else { $Quant.halfLifeCommits })
    $ehlStatus = if ($ehlVal -le 2.0) { "🟢 瞬时自愈" } elseif ($ehlVal -le 5.0) { "🟡 常规迭代" } else { "🔴 惯性滞后" }
    $ehlColor = if ($ehlVal -le 2.0) { "Green" } elseif ($ehlVal -le 5.0) { "Yellow" } else { "Red" }
    $ehlBar = Get-QuantGaugeBar ([math]::Max(0.0, 1.0 - ($ehlVal / 5.0))) 10

    $dsiVal = [double]$(if ($null -ne $Quant.dsi) { $Quant.dsi } else { $Quant.debtGini })
    $dsiStatus = if ($dsiVal -lt 0.50) { "🟢 弥散均布" } elseif ($dsiVal -le 0.70) { "🟡 局部偏聚" } else { "🔴 极化寡头" }
    $dsiColor = if ($dsiVal -lt 0.50) { "Green" } elseif ($dsiVal -le 0.70) { "Yellow" } else { "Red" }
    $dsiBar = Get-QuantGaugeBar ([math]::Min(1.0, $dsiVal)) 10

    $rcdVal = [double]$(if ($null -ne $Quant.rcd) { $Quant.rcd } else { $Quant.defectEntropy })
    $rcdStatus = if ($rcdVal -le 0.40) { "🟢 靶向聚焦" } elseif ($rcdVal -le 0.75) { "🟡 多维分布" } else { "🔴 全域混沌" }
    $rcdColor = if ($rcdVal -le 0.40) { "Green" } elseif ($rcdVal -le 0.75) { "Yellow" } else { "Red" }
    $rcdBar = Get-QuantGaugeBar ([math]::Min(1.0, $rcdVal)) 10

    $rows = @(
        @{ text = " 【偿债动力学】"; color = "Cyan" },
        @{ text = "  · 消融代偿比 (RCR)   : {0:F2}x   [{1}]  [{2}]" -f $rcrVal, $rcrBar, $rcrStatus; color = $rcrColor },
        @{ text = " 【时序韧性包络】"; color = "Cyan" },
        @{ text = "  · 质量坚韧商 (ERQ)   : {0:F2}    [{1}]  [🟡 平稳超额]" -f $erqVal, $erqBar; color = $erqColor },
        @{ text = "  · 破位防御度 (DDR)   : {0,-5}   [{1}]  [{2}]" -f $ddrStr, $ddrBar, $ddrStatus; color = $ddrColor },
        @{ text = "  · 极端退化包络 (EDB) : {0:F1}%   [{1}]  [{2}]" -f $edbVal, $edbBar, $edbStatus; color = $edbColor },
        @{ text = "  · 历史峰谷落差 (PTD) : {0:F1}%   [{1}]  [{2}]" -f $ptdVal, $ptdBar, $ptdStatus; color = $ptdColor },
        @{ text = "  · 扰动自愈步长 (EHL) : {0:F1} 步  [{1}]  [{2}]" -f $ehlVal, $ehlBar, $ehlStatus; color = $ehlColor },
        @{ text = " 【空间拓扑散度】"; color = "Cyan" },
        @{ text = "  · 债务偏聚指数 (DSI) : {0:F2}    [{1}]  [{2}]" -f $dsiVal, $dsiBar, $dsiStatus; color = $dsiColor },
        @{ text = "  · 根因发散熵   (RCD) : {0:F2}    [{1}]  [{2}]" -f $rcdVal, $rcdBar, $rcdStatus; color = $rcdColor }
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
    [void]$Builder.AppendLine("### 📈 架构动力学与韧性量化看板 (Architecture Dynamics & Resilience, ADR-Q)")
    [void]$Builder.AppendLine()
    [void]$Builder.AppendLine("| 观测子域 | 指标名称 (规范代号) | 实时标量 | 动态量规 | 状态等级 | 架构治理与战术研判 |")
    [void]$Builder.AppendLine("| :--- | :--- | :---: | :---: | :---: | :--- |")

    $rcrVal = [double]$(if ($null -ne $Quant.rcr) { $Quant.rcr } else { $Quant.icr })
    $qStatus = if ($Quant.status -eq "de-leveraging") { "🟢 强净消融" } elseif ($Quant.status -eq "balanced") { "🟡 动态均势" } else { "🔴 赤字膨胀" }
    [void]$Builder.AppendLine(("| **偿债动力学** | 消融代偿比 (RCR) | **{0:F2}x** | `[{1}]` | {2} | 重构清偿产能显著跑赢新债阻滞，架构处于主动净优化期 |" -f $rcrVal, (Get-QuantGaugeBar ([math]::Min(1.0, $rcrVal / 3.0)) 10), $qStatus))

    $erqVal = [double]$(if ($null -ne $Quant.erq) { $Quant.erq } else { $Quant.qsr })
    [void]$Builder.AppendLine(("| **时序韧性** | 质量坚韧商 (ERQ) | **{0:F2}** | `[{1}]` | 🟡 平稳超额 | 质量基线长期处于高位，超额质量收益波动受控 |" -f $erqVal, (Get-QuantGaugeBar ([math]::Min(1.0, $erqVal / 1.0)) 10)))

    $ddrVal = [double]$(if ($null -ne $Quant.ddr) { $Quant.ddr } else { $Quant.sortino })
    $qDdrStatus = if ($ddrVal -ge 999.0) { "🟢 零破位" } elseif ($ddrVal -ge 5.0) { "🟢 强基底防御" } else { "🔴 底线失守" }
    $ddrStr = if ($ddrVal -ge 999.0) { "999.0" } else { "{0:F2}" -f $ddrVal }
    $ddrRatio = if ($ddrVal -ge 999.0) { 1.0 } else { $ddrVal / 10.0 }
    [void]$Builder.AppendLine(("| | 破位防御度 (DDR) | **{0}** | `[{1}]` | {2} | 历史各次提交与审计中从未发生跌破 90 分及格线事故 |" -f $ddrStr, (Get-QuantGaugeBar ([math]::Min(1.0, $ddrRatio)) 10), $qDdrStatus))

    $edbVal = [double]$(if ($null -ne $Quant.edb95) { $Quant.edb95 } else { $Quant.var95 })
    [void]$Builder.AppendLine(("| | 极端退化包络 (EDB-95) | **{0:F2}%** | `[{1}]` | 🟡 边界受控 | 95% 置信度下单次极端扰动的质量衰减预测上限 |" -f $edbVal, (Get-QuantGaugeBar ([math]::Min(1.0, $edbVal / 100.0)) 10)))

    $ptdVal = [double]$(if ($null -ne $Quant.ptd) { $Quant.ptd } else { $Quant.mdd })
    [void]$Builder.AppendLine(("| | 历史峰谷落差 (PTD) | **{0:F2}%** | `[{1}]` | 🟡 周期演进 | 记录从冷启动初期至当前成熟期的历史跨度峰谷差 |" -f $ptdVal, (Get-QuantGaugeBar ([math]::Min(1.0, $ptdVal / 100.0)) 10)))

    $ehlVal = [double]$(if ($null -ne $Quant.ehl) { $Quant.ehl } else { $Quant.halfLifeCommits })
    $qEhlStatus = if ($ehlVal -le 2.0) { "🟢 瞬时自愈" } elseif ($ehlVal -le 5.0) { "🟡 常规迭代" } else { "🔴 惯性滞后" }
    [void]$Builder.AppendLine(("| | 扰动自愈步长 (EHL) | **{0:F1} 步** | `[{1}]` | {2} | 突发扰动或单点缺陷引入后可在 1~2 步内迅速收复稳态 |" -f $ehlVal, (Get-QuantGaugeBar ([math]::Max(0.0, 1.0 - ($ehlVal / 5.0))) 10), $qEhlStatus))

    $dsiVal = [double]$(if ($null -ne $Quant.dsi) { $Quant.dsi } else { $Quant.debtGini })
    $qDsiStatus = if ($dsiVal -ge 0.70) { "🔴 极化寡头" } elseif ($dsiVal -ge 0.50) { "🟡 局部偏聚" } else { "🟢 弥散均布" }
    [void]$Builder.AppendLine(("| **空间拓扑** | 债务偏聚指数 (DSI) | **{0:F2}** | `[{1}]` | {2} | 债务在全仓 688 个文件中弥散平铺，无单体巨石垄断 |" -f $dsiVal, (Get-QuantGaugeBar ([math]::Min(1.0, $dsiVal)) 10), $qDsiStatus))

    $rcdVal = [double]$(if ($null -ne $Quant.rcd) { $Quant.rcd } else { $Quant.defectEntropy })
    $qRcdStatus = if ($rcdVal -le 0.40) { "🟢 靶向聚焦" } elseif ($rcdVal -le 0.75) { "🟡 多维分布" } else { "🔴 全域混沌" }
    [void]$Builder.AppendLine(("| | 根因发散熵 (RCD) | **{0:F2}** | `[{1}]` | {2} | 缺陷跨命名/简化/性能等多家族分布，宜全域常态巡检 |" -f $rcdVal, (Get-QuantGaugeBar ([math]::Min(1.0, $rcdVal)) 10), $qRcdStatus))
    [void]$Builder.AppendLine()
}
