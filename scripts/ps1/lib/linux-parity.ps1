# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · Linux 命令面兼容层)
# 文件路径: scripts/ps1/lib/linux-parity.ps1
# 架构定位: 跨平台命令面桥接库 (Windows PowerShell 7+，由 Profile 与门禁脚本点源加载)
# 依赖与触发: 触发方: Microsoft.PowerShell_profile.ps1 / scripts/ps1/*.ps1 / 本地 CLI
#             上游: Git for Windows 自带 GNU coreutils (<git-root>\usr\bin)
#                  与 scoop 现代化 CLI (rg / fd / bat / sd / jq / yq)
#             下游: 交互式终端会话与 Agent 非交互子进程
#             运行时: PowerShell 7+
# 职责说明: 以「别名消解 + GNU 实体绑定 + 语义桥接」三层结构，把 Linux 惯用命令面
#           投影到 Windows PowerShell 7，使同一段命令在两种宿主下产生一致行为
# 退出语义与设计依据: 无独立退出码（点源库）。设计依据: PowerShell 的解析顺序为
#   别名 > 函数 > cmdlet > 外部程序，任何 PATH 垫片都会被内建别名遮蔽；因此兼容层必须
#   先以 -Force 移除只读别名，再定义同名函数。包装器刻意不声明 [CmdletBinding()]，
#   因为通用参数会抢占 -e / -i / -f 等 GNU 短选项，使 sed -i、grep -f 产生参数歧义
# ------------------------------------------------------------------------------
# 用法示例:
#   . "$PSScriptRoot/lib/linux-parity.ps1"
#   Initialize-LinuxParity                 # 幂等装配，重复点源无副作用
#   Initialize-LinuxParity -Quiet          # 抑制装配摘要（Agent 子进程推荐）
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

$script:LinuxParityGnuRoot = $null
$script:LinuxParityShimRoot = $null
$script:LinuxParityRegistered = [System.Collections.Generic.List[string]]::new()
$script:LinuxParityMissing = [System.Collections.Generic.List[string]]::new()

# ------------------------------------------------------------------------------
# 一、 实体根目录解析
#     Git for Windows 自带完整 coreutils，是唯一不依赖额外安装的 GNU 真源；
#     探测顺序为环境变量覆盖、git.exe 实际安装位置、两个 well-known 路径。
#     目录必须含哨兵二进制才算命中，避免残缺安装注册出无法执行的命令。
# ------------------------------------------------------------------------------
function Resolve-LinuxParityGnuRoot {
    <#
    .SYNOPSIS
        Locates the GNU coreutils directory shipped with Git for Windows.
    .OUTPUTS
        System.String. Absolute directory path, or $null when no qualifying root exists.
    #>
    [CmdletBinding()]
    param()

    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($env:LINUX_PARITY_GNU_ROOT) {
        $pinned = $env:LINUX_PARITY_GNU_ROOT
        if (-not (Test-Path -LiteralPath $pinned -PathType Container -ErrorAction SilentlyContinue)) { return $null }
        $pinnedSentinel = Join-Path $pinned 'head.exe'
        if (Test-Path -LiteralPath $pinnedSentinel -PathType Leaf -ErrorAction SilentlyContinue) {
            return (Resolve-Path -LiteralPath $pinned).Path
        }
        return $null
    }
    $gitCmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($gitCmd -and $gitCmd.Source) {
        # git.exe 位于 <root>\cmd\git.exe 或 <root>\bin\git.exe，coreutils 位于 <root>\usr\bin
        $gitRoot = Split-Path (Split-Path $gitCmd.Source -Parent) -Parent
        if ($gitRoot) { $candidates.Add((Join-Path $gitRoot 'usr/bin')) }
    }
    # well-known 安装根由环境变量提供，不写入字面路径：安装盘符与目录名随宿主变化，
    # 写死的路径会在非默认安装位置静默失效，且把宿主布局烙进仓库。
    foreach ($programRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($programRoot) { $candidates.Add((Join-Path $programRoot 'Git/usr/bin')) }
    }

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if (-not (Test-Path -LiteralPath $candidate -PathType Container -ErrorAction SilentlyContinue)) { continue }
        $sentinel = Join-Path $candidate 'head.exe'
        if (Test-Path -LiteralPath $sentinel -PathType Leaf -ErrorAction SilentlyContinue) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Resolve-LinuxParityShimRoot {
    <#
    .SYNOPSIS
        Locates the user-level shim directory holding hand-written .cmd bridges.
    .OUTPUTS
        System.String. Absolute directory path, or $null when the directory is absent.
    #>
    [CmdletBinding()]
    param()

    $candidate = Join-Path $HOME '.local/bin'
    if (Test-Path -LiteralPath $candidate -PathType Container -ErrorAction SilentlyContinue) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }
    return $null
}

# ------------------------------------------------------------------------------
# 二、 别名消解
#     这是兼容层的地基。ls / cat / rm / sort / diff 等既是内建别名，部分还是只读别名，
#     必须 -Force 移除；移除失败时如实返回 $false，由装配摘要暴露而不是静默带过。
# ------------------------------------------------------------------------------
function Remove-LinuxParityAlias {
    <#
    .SYNOPSIS
        Removes a built-in PowerShell alias, including read-only ones.
    .PARAMETER Name
        Alias name to remove.
    .OUTPUTS
        System.Boolean. True when the alias is gone afterwards.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Alias -Name $Name -ErrorAction SilentlyContinue)) { return $true }
    try {
        Remove-Item -LiteralPath "Alias:$Name" -Force -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# ------------------------------------------------------------------------------
# 三、 GNU 命令包装器
#     两条硬约束决定了实现形态：
#     ① 包装器体内不得出现 [Parameter()] 声明。一旦声明，PowerShell 就把函数升级为
#        高级函数，并注入 -Verbose/-ErrorAction 等通用参数，使 -v / -e / -i / -f 等
#        GNU 短选项被前缀匹配吞掉，sed -i、grep -f 会在绑定阶段直接报歧义错误。
#     ② 管道判定必须用 $MyInvocation.ExpectingInput，不能用 `if ($input)`。
#        后者在非管道调用时会读取并阻塞等待标准输入，使 grep pattern file 永久挂起。
# ------------------------------------------------------------------------------
function New-LinuxParityGnuCommand {
    <#
    .SYNOPSIS
        Builds a script block that forwards arguments and pipeline input to a GNU executable.
    .PARAMETER Executable
        Absolute path of the GNU binary to bind.
    .OUTPUTS
        System.Management.Automation.ScriptBlock. Closure capturing the executable path.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Executable)

    $exe = $Executable
    return {
        if ($MyInvocation.ExpectingInput) {
            $input | & $exe @args
        } else {
            & $exe @args
        }
        $global:LASTEXITCODE = $LASTEXITCODE
    }.GetNewClosure()
}

function Register-LinuxParityCommand {
    <#
    .SYNOPSIS
        Registers one Linux command name against a resolved executable path.
    .PARAMETER Name
        Linux command name to expose.
    .PARAMETER Executable
        Absolute path of the backing executable.
    .OUTPUTS
        System.Boolean. True when the function was registered.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Executable
    )

    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf -ErrorAction SilentlyContinue)) {
        return $false
    }
    if (-not (Remove-LinuxParityAlias -Name $Name)) { return $false }
    $block = New-LinuxParityGnuCommand -Executable $Executable
    Set-Item -Path "function:global:$Name" -Value $block -Force
    return $true
}

# ------------------------------------------------------------------------------
# 四、 命令绑定表
#     覆盖 GNU coreutils 中与日常研发相关的全部条目。未列出的命令（如 gunzip）
#     即使实体缺失也不会注册，装配摘要会如实列出不可用项。
# ------------------------------------------------------------------------------
$script:LinuxParityGnuCommands = [ordered]@{
    'ls'        = 'ls.exe'
    'cat'       = 'cat.exe'
    'cp'        = 'cp.exe'
    'mv'        = 'mv.exe'
    'rm'        = 'rm.exe'
    'mkdir'     = 'mkdir.exe'
    'rmdir'     = 'rmdir.exe'
    'ln'        = 'ln.exe'
    'chmod'     = 'chmod.exe'
    'touch'     = 'touch.exe'
    'stat'      = 'stat.exe'
    'du'        = 'du.exe'
    'df'        = 'df.exe'
    'basename'  = 'basename.exe'
    'dirname'   = 'dirname.exe'
    'realpath'  = 'realpath.exe'
    'readlink'  = 'readlink.exe'
    'head'      = 'head.exe'
    'tail'      = 'tail.exe'
    'wc'        = 'wc.exe'
    'nl'        = 'nl.exe'
    'sort'      = 'sort.exe'
    'uniq'      = 'uniq.exe'
    'cut'       = 'cut.exe'
    'tr'        = 'tr.exe'
    'seq'       = 'seq.exe'
    'paste'     = 'paste.exe'
    'comm'      = 'comm.exe'
    'tac'       = 'tac.exe'
    'split'     = 'split.exe'
    'sed'       = 'sed.exe'
    'awk'       = 'awk.exe'
    'grep'      = 'grep.exe'
    'find'      = 'find.exe'
    'xargs'     = 'xargs.exe'
    'diff'      = 'diff.exe'
    'cmp'       = 'cmp.exe'
    'patch'     = 'patch.exe'
    'tee'       = 'tee.exe'
    'env'       = 'env.exe'
    'date'      = 'date.exe'
    'printf'    = 'printf.exe'
    'expr'      = 'expr.exe'
    'true'      = 'true.exe'
    'false'     = 'false.exe'
    'which'     = 'which.exe'
    'mktemp'    = 'mktemp.exe'
    'timeout'   = 'timeout.exe'
    'sha256sum' = 'sha256sum.exe'
    'base64'    = 'base64.exe'
    'gzip'      = 'gzip.exe'
    'tar'       = 'tar.exe'
    'unzip'     = 'unzip.exe'
    'less'      = 'less.exe'
    'yes'       = 'yes.exe'
}

# ------------------------------------------------------------------------------
# 五、 现代化 CLI 登记表
#     这些命令无同名内建别名冲突，仍统一登记以便装配摘要如实反映可用性。
#     未安装时保持缺失状态，绝不静默回退到语义不同的 cmdlet。
# ------------------------------------------------------------------------------
$script:LinuxParityModernCommands = [ordered]@{
    'rg'     = 'rg'
    'fd'     = 'fd'
    'bat'    = 'bat'
    'sd'     = 'sd'
    'jq'     = 'jq'
    'yq'     = 'yq'
    'gh'     = 'gh'
    'eza'    = 'eza'
    'fzf'    = 'fzf'
    'zoxide' = 'zoxide'
}

function Resolve-LinuxParityModernCommand {
    <#
    .SYNOPSIS
        Resolves a modern CLI tool to its executable path through PATH.
    .PARAMETER Name
        Executable base name.
    .OUTPUTS
        System.String. Absolute executable path, or $null when not installed.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Name)

    $cmd = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    return $null
}

# ------------------------------------------------------------------------------
# 六、 语义桥接
#     这些命令在 Windows 上没有 GNU 实体，或以 GNU 形态表达更符合 Linux 直觉。
#     每个桥接函数只接受语义可精确映射的写法，无法映射时显式报错而非近似。
#     与 GNU 包装器同理，桥接函数一律使用 $args 而不声明 [Parameter()]，
#     否则 command -v / alias -x 等短选项会被通用参数吞掉。
# ------------------------------------------------------------------------------
function global:export {
    <#
    .SYNOPSIS
        Sets environment variables using Linux `export NAME=VALUE` syntax.
    .DESCRIPTION
        PowerShell has no `export`; the idiomatic form is `$env:NAME = 'VALUE'`. This bridge
        accepts `export NAME=VALUE`. A bare `export NAME` is a no-op because every PowerShell
        environment variable is already process-wide.
    .EXAMPLE
        export NODE_ENV=production
    #>
    foreach ($item in $args) {
        $text = [string]$item
        $eq = $text.IndexOf('=')
        if ($eq -lt 1) { continue }
        $name = $text.Substring(0, $eq)
        $value = $text.Substring($eq + 1)
        Set-Item -Path "Env:$name" -Value $value
    }
}

function global:unset {
    <#
    .SYNOPSIS
        Removes environment variables using Linux `unset` syntax.
    .EXAMPLE
        unset NODE_ENV
    #>
    foreach ($item in $args) {
        $name = [string]$item
        if (Test-Path -LiteralPath "Env:$name") {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        }
    }
}

function global:printenv {
    <#
    .SYNOPSIS
        Prints environment variables, optionally filtered by name.
    .EXAMPLE
        printenv PATH
    #>
    if ($args.Count -eq 0) {
        Get-ChildItem Env: | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }
        return
    }
    foreach ($item in $args) {
        $value = [System.Environment]::GetEnvironmentVariable([string]$item)
        if ($null -ne $value) { $value }
    }
}

function global:test {
    <#
    .SYNOPSIS
        Evaluates file and string predicates using Linux `test` syntax.
    .DESCRIPTION
        Unlike the GNU binary, this bridge emits a PowerShell boolean so the idiomatic
        `if (test -f path)` form behaves as expected. `test -f path` alone therefore prints
        True/False instead of setting $LASTEXITCODE; callers needing an exit code use
        `if (-not (test -f path)) { exit 1 }`.
    .EXAMPLE
        if (test -f package.json) { 'present' }
    #>
    if ($args.Count -lt 2) { return $false }
    $flag = [string]$args[0]
    $target = [string]$args[1]
    switch ($flag) {
        '-f' { return (Test-Path -LiteralPath $target -PathType Leaf) }
        '-d' { return (Test-Path -LiteralPath $target -PathType Container) }
        '-e' { return (Test-Path -LiteralPath $target) }
        '-s' {
            if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return $false }
            return ((Get-Item -LiteralPath $target).Length -gt 0)
        }
        '-r' { return (Test-Path -LiteralPath $target) }
        '-w' { return (Test-Path -LiteralPath $target) }
        '-x' { return (Test-Path -LiteralPath $target) }
        '-z' { return [string]::IsNullOrEmpty($target) }
        '-n' { return (-not [string]::IsNullOrEmpty($target)) }
        default { return $false }
    }
}

function global:source {
    <#
    .SYNOPSIS
        Dot-sources a script into the current scope, matching the Linux `source` builtin.
    .EXAMPLE
        source ./scripts/ps1/lib/linux-parity.ps1
    #>
    if ($args.Count -eq 0) {
        Write-Error 'source: missing file operand' -ErrorAction Continue
        return
    }
    . ([string]$args[0])
}

function global:command {
    <#
    .SYNOPSIS
        Implements the Linux `command -v` probe surface.
    .DESCRIPTION
        `command -v NAME` prints the resolved path. Other forms are rejected rather than
        approximated, because silently accepting `command -V` or `command -p` would hide the gap.
    .EXAMPLE
        command -v node
    #>
    if ($args.Count -eq 0) { return }
    if ([string]$args[0] -ne '-v') {
        Write-Error "command: only -v is supported; received '$($args[0])'" -ErrorAction Continue
        return
    }
    foreach ($name in ($args | Select-Object -Skip 1)) {
        $cmd = Get-Command -Name ([string]$name) -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) {
            if ($cmd.Source) { $cmd.Source } else { $cmd.Name }
        }
    }
}

function global:alias {
    <#
    .SYNOPSIS
        Lists or inspects PowerShell aliases using Linux `alias` syntax.
    .EXAMPLE
        alias grep
    #>
    if ($args.Count -eq 0) {
        Get-Alias | Sort-Object Name | ForEach-Object { "alias $($_.Name)='$($_.Definition)'" }
        return
    }
    foreach ($item in $args) {
        $found = Get-Alias -Name ([string]$item) -ErrorAction SilentlyContinue
        if ($found) { "alias $($found.Name)='$($found.Definition)'" }
    }
}

function global:open {
    <#
    .SYNOPSIS
        Opens a path or URL with the platform default handler.
    .EXAMPLE
        open .
    #>
    if ($args.Count -eq 0) { Start-Process -FilePath '.'; return }
    foreach ($item in $args) { Start-Process -FilePath ([string]$item) }
}

function global:wget {
    <#
    .SYNOPSIS
        Downloads a URL, mapping `wget -O <file> <url>` onto curl.
    .DESCRIPTION
        Windows ships curl but not wget. Only flags whose semantics map exactly are accepted;
        anything else fails loudly instead of producing a different file than expected.
    .EXAMPLE
        wget -O out.zip https://example.com/a.zip
    #>
    if ($args.Count -eq 0) {
        Write-Error 'wget: missing URL' -ErrorAction Continue
        return
    }
    $output = $null
    $url = $null
    for ($i = 0; $i -lt $args.Count; $i++) {
        $token = [string]$args[$i]
        if ($token -eq '-O' -or $token -eq '--output-document') {
            $i++
            if ($i -lt $args.Count) { $output = [string]$args[$i] }
            continue
        }
        if ($token -eq '-q' -or $token -eq '--quiet') { continue }
        if ($token.StartsWith('-')) {
            Write-Error "wget: unsupported flag '$token'" -ErrorAction Continue
            return
        }
        $url = $token
    }
    if (-not $url) {
        Write-Error 'wget: missing URL' -ErrorAction Continue
        return
    }
    $curlArgs = @('-L', '--fail', '--silent', '--show-error')
    if ($output) { $curlArgs += @('-o', $output) } else { $curlArgs += @('-O') }
    $curlArgs += $url
    & curl.exe @curlArgs
    $global:LASTEXITCODE = $LASTEXITCODE
}

# ------------------------------------------------------------------------------
# 八、 沙箱与宿主模式探测
#     沙箱会话的特征是「工具可见但关键路径被拒」：PATH 仍含 scoop 与 DevTools，
#     但目录访问、用户配置读写会抛拒绝访问。这里不做启发式猜测，而是对一组
#     关键路径做真实读取探测，任何一项被拒即判定为受限宿主。
# ------------------------------------------------------------------------------
function Test-LinuxParityGnuExecutable {
    <#
    .SYNOPSIS
        Verifies that a GNU coreutil actually executes in this host.
    .DESCRIPTION
        Directory presence is not evidence of usability. In a restricted host the MSYS2
        runtime aborts at NtCreateDirectoryObject with 0xC0000022 before producing output,
        so every coreutil fails while the directory still looks healthy. This probe runs the
        sentinel binary once and requires a clean zero exit, turning that silent crash into a
        detectable condition instead of a fail-open.
    .PARAMETER GnuRoot
        Absolute path of the GNU coreutils directory.
    .OUTPUTS
        System.Boolean. True only when the sentinel binary ran and exited zero.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$GnuRoot)

    $sentinel = Join-Path $GnuRoot 'true.exe'
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf -ErrorAction SilentlyContinue)) {
        return $false
    }
    try {
        $output = & $sentinel 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { return $false }
        # MSYS2 运行时崩溃时会打印 fatal error 前缀，个别包装器仍返回 0，故必须按内容判定。
        if ($output -match "fatal error|0xC0000022|NtCreateDirectoryObject") { return $false }
        return $true
    } catch {
        return $false
    }
}

function Test-LinuxParityRestrictedHost {
    <#
    .SYNOPSIS
        Detects whether the current session runs in a restricted (sandboxed) host.
    .DESCRIPTION
        Probes a small set of paths that a normal interactive session can always read. A denial
        rather than an absence is the signal: absence only means the file was never created, while
        a denial proves the host intercepts filesystem access.
    .OUTPUTS
        System.Boolean. True when at least one probe path is access-denied.
    #>
    [CmdletBinding()]
    param()

    $probes = @(
        (Join-Path $HOME '.gitconfig'),
        (Join-Path $HOME '.config/git/ignore'),
        (Join-Path $HOME 'scoop/shims')
    )
    foreach ($probe in $probes) {
        try {
            $null = Test-Path -LiteralPath $probe -ErrorAction Stop
        } catch {
            return $true
        }
    }
    return $false
}

function Get-LinuxParityMode {
    <#
    .SYNOPSIS
        Reports the resolved command-surface mode for the current session.
    .DESCRIPTION
        Three modes are possible. `gnu` means the Git for Windows coreutils are reachable and
        every Linux command is backed by its real implementation. `native` means the GNU root is
        unreachable, so only PowerShell-native fallbacks are bound and GNU-only tools stay absent.
        `restricted` additionally marks a sandboxed host where filesystem probes are intercepted.
    .OUTPUTS
        PSCustomObject with Mode, Restricted, GnuRoot and Fallback members.
    #>
    [CmdletBinding()]
    param()

    $restricted = Test-LinuxParityRestrictedHost
    $gnuRoot = Resolve-LinuxParityGnuRoot
    # 目录存在不等于可执行：此处与装配器共用同一判据，避免两处口径漂移。
    $executable = if ($gnuRoot) { Test-LinuxParityGnuExecutable -GnuRoot $gnuRoot } else { $false }
    $mode = if ($executable) { 'gnu' } else { 'native' }
    return [PSCustomObject]@{
        Mode       = $mode
        Restricted = $restricted
        GnuRoot    = $gnuRoot
    }
}

# ------------------------------------------------------------------------------
# 九、 装配入口
#     幂等：重复点源或重复调用只更新绑定，不累积状态。
#     -Quiet 供 Agent 非交互子进程使用，避免装配摘要污染机器可读输出。
# ------------------------------------------------------------------------------
function Initialize-LinuxParity {
    <#
    .SYNOPSIS
        Installs the Linux command surface into the current PowerShell session.
    .DESCRIPTION
        Resolution order is GNU first, PowerShell fallback second. When the Git for Windows
        coreutils are reachable every command binds to its real implementation. When they are
        not, commands with a faithful PowerShell equivalent bind to that fallback, while
        stream editors and column tools stay unbound so a missing tool remains a hard failure
        instead of a silent semantic change.
    .PARAMETER Quiet
        Suppresses the assembly summary. Recommended for Agent and CI subprocesses.
    .OUTPUTS
        PSCustomObject with Mode, Restricted, GnuRoot, ShimRoot, Registered, Fallback and Missing.
    #>
    [CmdletBinding()]
    param([switch]$Quiet)

    $script:LinuxParityRegistered.Clear()
    $script:LinuxParityMissing.Clear()

    $restricted = Test-LinuxParityRestrictedHost
    $script:LinuxParityGnuRoot = Resolve-LinuxParityGnuRoot
    # 目录存在不等于二进制可运行：受限宿主中 MSYS2 运行时会在此崩溃，必须实测一次。
    $gnuExecutable = if ($script:LinuxParityGnuRoot) { Test-LinuxParityGnuExecutable -GnuRoot $script:LinuxParityGnuRoot } else { $false }
    $script:LinuxParityShimRoot = Resolve-LinuxParityShimRoot
    $fallbackBound = @()

    foreach ($name in $script:LinuxParityGnuCommands.Keys) {
        $registered = $false
        if ($gnuExecutable) {
            $exe = Join-Path $script:LinuxParityGnuRoot $script:LinuxParityGnuCommands[$name]
            $registered = Register-LinuxParityCommand -Name $name -Executable $exe
        }
        if ($registered) {
            [void]$script:LinuxParityRegistered.Add($name)
        } else {
            [void]$script:LinuxParityMissing.Add($name)
        }
    }

    if (-not $gnuExecutable -and $script:LinuxParityMissing.Count -gt 0) {
        $fallbackBound = Register-LinuxParityFallback -Names @($script:LinuxParityMissing)
        foreach ($name in $fallbackBound) {
            [void]$script:LinuxParityRegistered.Add($name)
            [void]$script:LinuxParityMissing.Remove($name)
        }
    }

    foreach ($name in $script:LinuxParityModernCommands.Keys) {
        $resolved = Resolve-LinuxParityModernCommand -Name $name
        if ($resolved) {
            [void](Remove-LinuxParityAlias -Name $name)
            [void]$script:LinuxParityRegistered.Add($name)
        } else {
            [void]$script:LinuxParityMissing.Add($name)
        }
    }

    $executable = if ($gnuExecutable) { $true } else { $false }
    $mode = if ($executable) { 'gnu' } else { 'native' }
    $summary = [PSCustomObject]@{
        Mode       = $mode
        Restricted = $restricted
        GnuRoot    = $script:LinuxParityGnuRoot
        ShimRoot   = $script:LinuxParityShimRoot
        Registered = @($script:LinuxParityRegistered)
        Fallback   = @($fallbackBound)
        Missing    = @($script:LinuxParityMissing)
    }

    if (-not $Quiet) {
        $modeLabel = if ($mode -eq 'gnu') { 'GNU coreutils (Git for Windows)' } else { 'PowerShell native fallback' }
        Write-Host "[linux-parity] mode: $modeLabel" -ForegroundColor DarkGray
        if ($restricted) {
            Write-Host '[linux-parity] restricted host detected; filesystem probes are intercepted' -ForegroundColor Yellow
        }
        if ($gnuExecutable) {
            Write-Host "[linux-parity] GNU root: $($script:LinuxParityGnuRoot)" -ForegroundColor DarkGray
        }
        Write-Host ("[linux-parity] registered {0} commands, {1} unavailable" -f `
            $script:LinuxParityRegistered.Count, $script:LinuxParityMissing.Count) -ForegroundColor DarkGray
        if ($fallbackBound.Count -gt 0) {
            Write-Host ("[linux-parity] native fallback: {0}" -f ($fallbackBound -join ' ')) -ForegroundColor DarkGray
        }
        if ($script:LinuxParityMissing.Count -gt 0) {
            Write-Host ("[linux-parity] unavailable: {0}" -f ($script:LinuxParityMissing -join ' ')) -ForegroundColor DarkGray
        }
    }
    return $summary
}

# ------------------------------------------------------------------------------
# 七、 PowerShell 原生降级层
#     当 GNU coreutils 根目录不可用时（例如受限沙箱、精简 Windows 容器、仅装 Git
#     Portable 的机器），用 PowerShell 7 原生命令实现同一语义。降级只在 GNU 实体
#     缺失时启用，且每项都声明其能力边界——宁可缺失也不静默给出错误结果。
# ------------------------------------------------------------------------------
function Get-LinuxParityFallbackCommand {
    <#
    .SYNOPSIS
        Returns a PowerShell-native script block that approximates one Linux command.
    .DESCRIPTION
        Only commands whose semantics map onto a PowerShell cmdlet without loss are provided.
        Stream editors (sed/awk/cut/tr) and column tools are deliberately absent: a partial
        emulation would silently produce different text than the GNU original.
    .PARAMETER Name
        Linux command name.
    .OUTPUTS
        System.Management.Automation.ScriptBlock, or $null when no faithful fallback exists.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Name)

    switch ($Name) {
        'ls' {
            return {
                $showAll = $false; $long = $false; $one = $false; $paths = @()
                foreach ($a in $args) {
                    switch -Regex ([string]$a) {
                        '^-[a-zA-Z]*a' { $showAll = $true; continue }
                        '^-[a-zA-Z]*l' { $long = $true; continue }
                        '^-[a-zA-Z]*1' { $one = $true; continue }
                        '^-' { continue }
                        default { $paths += [string]$a }
                    }
                }
                if ($paths.Count -eq 0) { $paths = @('.') }
                $items = foreach ($p in $paths) {
                    if (Test-Path -LiteralPath $p -PathType Container) {
                        Get-ChildItem -LiteralPath $p -Force:$showAll
                    } else {
                        Get-Item -LiteralPath $p
                    }
                }
                if ($long) { $items | Format-Table Mode, LastWriteTime, Length, Name -AutoSize }
                elseif ($one) { $items | ForEach-Object { $_.Name } }
                else { $items | ForEach-Object { $_.Name } }
            }
        }
        'cat' {
            return {
                $number = $false; $files = @()
                foreach ($a in $args) {
                    if ([string]$a -match '^-[a-zA-Z]*n') { $number = $true; continue }
                    if ([string]$a -like '-*') { continue }
                    $files += [string]$a
                }
                if ($files.Count -eq 0) {
                    $stdin = @($input)
                    if ($number) { $i = 0; $stdin | ForEach-Object { $i++; "$i`t$_" } } else { $stdin }
                    return
                }
                foreach ($f in $files) {
                    if ($number) { $i = 0; Get-Content -LiteralPath $f | ForEach-Object { $i++; "$i`t$_" } }
                    else { Get-Content -LiteralPath $f }
                }
            }
        }
        'head' {
            return {
                $count = 10; $files = @()
                for ($i = 0; $i -lt $args.Count; $i++) {
                    $t = [string]$args[$i]
                    if ($t -eq '-n') { $i++; if ($i -lt $args.Count) { $count = [int]$args[$i] }; continue }
                    if ($t -match '^-(\d+)$') { $count = [int]$Matches[1]; continue }
                    if ($t -like '-*') { continue }
                    $files += $t
                }
                if ($files.Count -eq 0) { $input | Select-Object -First $count; return }
                foreach ($f in $files) { Get-Content -LiteralPath $f -TotalCount $count }
            }
        }
        'tail' {
            return {
                $count = 10; $files = @()
                for ($i = 0; $i -lt $args.Count; $i++) {
                    $t = [string]$args[$i]
                    if ($t -eq '-n') { $i++; if ($i -lt $args.Count) { $count = [int]$args[$i] }; continue }
                    if ($t -match '^-(\d+)$') { $count = [int]$Matches[1]; continue }
                    if ($t -like '-*') { continue }
                    $files += $t
                }
                if ($files.Count -eq 0) { $input | Select-Object -Last $count; return }
                foreach ($f in $files) { Get-Content -LiteralPath $f | Select-Object -Last $count }
            }
        }
        'wc' {
            return {
                $linesOnly = $false; $files = @()
                foreach ($a in $args) {
                    if ([string]$a -match '^-[a-zA-Z]*l') { $linesOnly = $true; continue }
                    if ([string]$a -like '-*') { continue }
                    $files += [string]$a
                }
                if ($files.Count -eq 0) { return @($input).Count }
                foreach ($f in $files) {
                    $n = @(Get-Content -LiteralPath $f).Count
                    if ($linesOnly) { "$n $f" } else { "$n $f" }
                }
            }
        }
        'grep' {
            return {
                $recursive = $false; $lineNumber = $false; $ignoreCase = $false; $countOnly = $false
                $pattern = $null; $paths = @()
                foreach ($a in $args) {
                    $t = [string]$a
                    if ($t -match '^-[a-zA-Z]*r') { $recursive = $true; continue }
                    if ($t -match '^-[a-zA-Z]*n') { $lineNumber = $true; continue }
                    if ($t -match '^-[a-zA-Z]*i') { $ignoreCase = $true; continue }
                    if ($t -match '^-[a-zA-Z]*c') { $countOnly = $true; continue }
                    if ($t -like '-*') { continue }
                    if ($null -eq $pattern) { $pattern = $t } else { $paths += $t }
                }
                if ($null -eq $pattern) { return }
                if ($paths.Count -eq 0) { $paths = @('.') }

                # Select-String 的 -Path 不接受管道输入，因此先把目标展开成文件清单，
                # 再逐个以 -LiteralPath 检索；把目录直接交给 -Path 会丢失递归语义。
                $files = [System.Collections.Generic.List[string]]::new()
                foreach ($p in $paths) {
                    if (Test-Path -LiteralPath $p -PathType Container) {
                        Get-ChildItem -LiteralPath $p -Recurse:$recursive -File -Force -ErrorAction SilentlyContinue |
                            ForEach-Object { $files.Add($_.FullName) }
                    } elseif (Test-Path -LiteralPath $p -PathType Leaf) {
                        $files.Add((Resolve-Path -LiteralPath $p).Path)
                    }
                }

                $hits = [System.Collections.Generic.List[object]]::new()
                foreach ($f in $files) {
                    Select-String -LiteralPath $f -Pattern $pattern -SimpleMatch -CaseSensitive:(-not $ignoreCase) -ErrorAction SilentlyContinue |
                        ForEach-Object { $hits.Add($_) }
                }
                if ($countOnly) { return $hits.Count }
                foreach ($h in $hits) {
                    $rel = [System.IO.Path]::GetRelativePath((Get-Location).Path, $h.Path).Replace('\', '/')
                    if ($lineNumber) { "$rel`:$($h.LineNumber):$($h.Line)" } else { "$rel`:$($h.Line)" }
                }
            }
        }
        'find' {
            return {
                $namePattern = $null; $typeFilter = $null; $roots = @()
                for ($i = 0; $i -lt $args.Count; $i++) {
                    $t = [string]$args[$i]
                    if ($t -eq '-name') { $i++; if ($i -lt $args.Count) { $namePattern = [string]$args[$i] }; continue }
                    if ($t -eq '-type') { $i++; if ($i -lt $args.Count) { $typeFilter = [string]$args[$i] }; continue }
                    if ($t -like '-*') { continue }
                    $roots += $t
                }
                if ($roots.Count -eq 0) { $roots = @('.') }
                foreach ($root in $roots) {
                    $items = Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
                    if ($typeFilter -eq 'f') { $items = $items | Where-Object { -not $_.PSIsContainer } }
                    elseif ($typeFilter -eq 'd') { $items = $items | Where-Object { $_.PSIsContainer } }
                    if ($namePattern) { $items = $items | Where-Object { $_.Name -like $namePattern } }
                    $items | ForEach-Object { './' + [System.IO.Path]::GetRelativePath((Get-Location).Path, $_.FullName).Replace('\', '/') }
                }
            }
        }
        'cp' {
            return {
                $recurse = $false; $operands = @()
                foreach ($a in $args) {
                    if ([string]$a -match '^-[a-zA-Z]*[rR]') { $recurse = $true; continue }
                    if ([string]$a -like '-*') { continue }
                    $operands += [string]$a
                }
                if ($operands.Count -lt 2) { Write-Error 'cp: missing destination operand' -ErrorAction Continue; return }
                $dest = $operands[-1]
                $sources = $operands[0..($operands.Count - 2)]
                foreach ($s in $sources) { Copy-Item -LiteralPath $s -Destination $dest -Recurse:$recurse -Force }
            }
        }
        'mv' {
            return {
                $operands = @()
                foreach ($a in $args) { if ([string]$a -notlike '-*') { $operands += [string]$a } }
                if ($operands.Count -lt 2) { Write-Error 'mv: missing destination operand' -ErrorAction Continue; return }
                $dest = $operands[-1]
                foreach ($s in $operands[0..($operands.Count - 2)]) { Move-Item -LiteralPath $s -Destination $dest -Force }
            }
        }
        'rm' {
            return {
                $recurse = $false; $force = $false; $operands = @()
                foreach ($a in $args) {
                    if ([string]$a -match '^-[a-zA-Z]*[rR]') { $recurse = $true; continue }
                    if ([string]$a -match '^-[a-zA-Z]*f') { $force = $true; continue }
                    if ([string]$a -like '-*') { continue }
                    $operands += [string]$a
                }
                foreach ($p in $operands) {
                    Remove-Item -LiteralPath $p -Recurse:$recurse -Force:$force -ErrorAction SilentlyContinue
                }
            }
        }
        'mkdir' {
            return {
                $parents = $false; $operands = @()
                foreach ($a in $args) {
                    if ([string]$a -match '^-[a-zA-Z]*p') { $parents = $true; continue }
                    if ([string]$a -like '-*') { continue }
                    $operands += [string]$a
                }
                foreach ($p in $operands) { New-Item -ItemType Directory -Path $p -Force:$parents | Out-Null }
            }
        }
        'touch' {
            return {
                foreach ($a in $args) {
                    if ([string]$a -like '-*') { continue }
                    $p = [string]$a
                    if (Test-Path -LiteralPath $p) { (Get-Item -LiteralPath $p).LastWriteTime = Get-Date }
                    else { New-Item -ItemType File -Path $p -Force | Out-Null }
                }
            }
        }
        'sort' {
            return {
                $unique = $false; $files = @()
                foreach ($a in $args) {
                    if ([string]$a -match '^-[a-zA-Z]*u') { $unique = $true; continue }
                    if ([string]$a -like '-*') { continue }
                    $files += [string]$a
                }
                $data = if ($files.Count -eq 0) { @($input) } else { $files | ForEach-Object { Get-Content -LiteralPath $_ } }
                $sorted = $data | Sort-Object
                if ($unique) { $sorted | Select-Object -Unique } else { $sorted }
            }
        }
        'diff' {
            return {
                $files = @()
                foreach ($a in $args) { if ([string]$a -notlike '-*') { $files += [string]$a } }
                if ($files.Count -lt 2) { Write-Error 'diff: missing operand' -ErrorAction Continue; return }
                $left = Get-Content -LiteralPath $files[0]
                $right = Get-Content -LiteralPath $files[1]
                Compare-Object -ReferenceObject $left -DifferenceObject $right
            }
        }
        'which' {
            return {
                foreach ($a in $args) {
                    if ([string]$a -like '-*') { continue }
                    $cmd = Get-Command -Name ([string]$a) -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($cmd) { if ($cmd.Source) { $cmd.Source } else { $cmd.Name } }
                }
            }
        }
        'true' { return { $global:LASTEXITCODE = 0 } }
        'false' { return { $global:LASTEXITCODE = 1 } }
        'date' {
            return {
                $fmt = $null
                foreach ($a in $args) { if ([string]$a -like '+*') { $fmt = [string]$a } }
                if ($fmt -eq '+%s') { return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
                if ($fmt -eq '+%Y-%m-%d') { return (Get-Date -Format 'yyyy-MM-dd') }
                if ($fmt) { return (Get-Date -Format ($fmt.TrimStart('+'))) }
                Get-Date
            }
        }
        'basename' {
            return {
                $operands = @($args | Where-Object { [string]$_ -notlike '-*' })
                if ($operands.Count -eq 0) { return }
                $leaf = Split-Path -Leaf ([string]$operands[0])
                if ($operands.Count -gt 1) {
                    $suffix = [string]$operands[1]
                    if ($leaf.EndsWith($suffix)) { $leaf = $leaf.Substring(0, $leaf.Length - $suffix.Length) }
                }
                $leaf
            }
        }
        'dirname' {
            return {
                foreach ($a in $args) {
                    if ([string]$a -like '-*') { continue }
                    $parent = Split-Path -Parent ([string]$a)
                    if (-not $parent) { '.' } else { $parent.Replace('\', '/') }
                }
            }
        }
        'seq' {
            return {
                $nums = @($args | Where-Object { [string]$_ -notlike '-*' } | ForEach-Object { [int]$_ })
                if ($nums.Count -eq 1) { 1..$nums[0] }
                elseif ($nums.Count -ge 2) { $nums[0]..$nums[1] }
            }
        }
        'xargs' {
            return {
                $command = @($args)
                $data = @($input)
                if ($command.Count -eq 0) { return $data }
                $verb = [string]$command[0]
                $rest = @($command | Select-Object -Skip 1 | Where-Object { [string]$_ -notlike '-*' })
                foreach ($item in $data) { & $verb @rest ([string]$item) }
            }
        }
        default { return $null }
    }
}

function Register-LinuxParityFallback {
    <#
    .SYNOPSIS
        Registers PowerShell-native fallbacks for every Linux command whose GNU binary is absent.
    .PARAMETER Names
        Candidate Linux command names.
    .OUTPUTS
        System.String[]. Names that received a fallback binding.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$Names)

    $bound = [System.Collections.Generic.List[string]]::new()
    foreach ($name in $Names) {
        $block = Get-LinuxParityFallbackCommand -Name $name
        if (-not $block) { continue }
        if (-not (Remove-LinuxParityAlias -Name $name)) { continue }
        Set-Item -Path "function:global:$name" -Value $block -Force
        [void]$bound.Add($name)
    }
    return $bound.ToArray()
}
