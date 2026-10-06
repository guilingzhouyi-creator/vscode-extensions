# 跨平台子进程隔离与严格错误捕获规范

本参考指南规定了跨平台门禁脚本在调用各子项目时的执行上下文隔离机制、错误平铺捕获范式及平台环境兼容契约。

---

## 一、 子进程工作目录显式绑定 (`-WorkingDirectory`)

在父级门禁脚本跨目录调度子项目流水线时，严禁依赖当前工作目录（CWD），亦严禁仅依赖参数前缀透传：

### 1. 为什么 `--prefix` 存在环境漂移风险
- **配置向上溢出**：Prettier、ESLint 等代码检查工具会递归向上回溯查找父级 `.eslintrc.*` 或 `.prettierrc.*`，导致子项目使用了错误的根配置；
- **测试框架根路径错乱**：Jest、Vitest 等框架在识别相对路径模式（如 `<rootDir>`）时，若 CWD 处于根目录，会错误匹配到全仓其他子目录的同名文件；
- **相对 Glob 展开失效**：许多 npm scripts 中定义的相对 glob（如 `src/**/*.ts`）在根目录下执行会匹配为空或误伤其他目录。

### 2. 标准工作目录隔离实现

#### PowerShell 7+ 规范实现：
```powershell
# 1. Start-Process 显式目录绑定与退出码捕获
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$subprojectDir = Join-Path $repoRoot "auto-refactor"

$proc = Start-Process -FilePath "npm" `
  -ArgumentList "test" `
  -WorkingDirectory $subprojectDir `
  -NoNewWindow -PassThru -Wait

if ($proc.ExitCode -ne 0) {
  Write-Error "子项目测试执行失败，退出码: $($proc.ExitCode)"
  exit $proc.ExitCode
}
```

#### Bash 子 Shell 规范实现：
```bash
# 2. (cd ... && ...) 子 Shell 物理隔离
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUBPROJECT="$ROOT/auto-refactor"

if [[ -d "$SUBPROJECT" ]]; then
  STATUS=0
  (cd "$SUBPROJECT" && npm test) || STATUS=$?
  if [[ "$STATUS" -ne 0 ]]; then
    echo "❌ 子项目测试执行失败，退出码: $STATUS" >&2
    exit "$STATUS"
  fi
fi
```

---

## 二、 Bash 退出码平铺捕获 (`set -euo pipefail`)

在声明了 `set -euo pipefail` 的严格脚本中：
- 任何裸调且预期返回非 0 退出码的测试或探测指令（如负向测试、分支判定）会导致脚本提前隐匿中断或崩溃；
- **标准平铺捕获模式**：
  ```bash
  STATUS=0
  command_that_may_fail || STATUS=$?
  if [[ "$STATUS" -eq 0 ]]; then
    echo "❌ 预期返回非 0 退出码，但实际执行成功" >&2
    exit 1
  fi
  ```

---

## 三、 PowerShell 7+ 优先原则与 UTF-8 编码安全

1. **统一路由至 `pwsh`**：
   - 严禁在脚本或钩子中裸调 `powershell.exe`（Windows PowerShell 5.1 解析无 BOM UTF-8 文件会出现中文与特殊字符乱码）；
   - 在跨平台脚本调度器中，必须优先定位并调用 `pwsh`；在无 pwsh 的 Unix 环境下优雅降级至 Bash；
2. **严格模式标配**：
   - PowerShell 脚本开头必须声明：
     ```powershell
     Set-StrictMode -Version Latest
     $ErrorActionPreference = 'Stop'
     ```
3. **换行契约守卫**：
   - 磁盘上的 `.ps1` 脚本必须严格维持 CRLF 换行；
   - 磁盘上的 `.sh` 脚本必须严格维持 LF 换行。
