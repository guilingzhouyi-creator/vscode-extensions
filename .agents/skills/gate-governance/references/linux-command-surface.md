# Linux 命令面兼容层契约（PowerShell ↔ GNU）

本参考指南规定了 Windows 宿主上 `pwsh` 与 GNU 命令行语义的对齐契约。命令面由 `scripts/ps1/lib/linux-parity.ps1` 单源装配，交互会话与 Agent 子进程共用同一语义，**禁止另立别名、垫片或本地包装**。

---

## 一、 别名优先级与替换纪律

PowerShell 的解析顺序为 `别名 > 函数 > cmdlet > 外部程序`。由此推出两条硬性后果：

- **PATH 垫片永远无效**：`grep.cmd`、`ls.cmd` 一类的同名可执行文件必被内建别名或函数遮蔽，写了也不会被执行。想改变某个命令的行为，只能替换函数，不能投放垫片。
- **移除必须先 `-Force`**：`sort`/`diff`/`where`/`tee`/`sleep`/`select` 是只读内建别名，`Remove-Item -LiteralPath "Alias:<name>"` 缺 `-Force` 直接失败，后续同名函数定义便静默不生效。

标准形态：

```powershell
Remove-Item -LiteralPath "Alias:$Name" -Force -ErrorAction SilentlyContinue
function global:$Name { ... }
```

---

## 二、 GNU 真源与现代化工具登记

兼容层维护两张登记表，语义不同、不可混用：

| 登记表 | 内容 | 解析方式 |
| :--- | :--- | :--- |
| GNU 绑定表 | `ls cat cp mv rm mkdir touch stat basename dirname head tail wc nl sort uniq cut tr seq sed awk grep find xargs diff tee env date printf true false which mktemp timeout sha256sum base64 gzip tar unzip` 等 | Git for Windows 自带 coreutils（`<git-root>/usr/bin`），无需额外安装 |
| 现代化工具表 | `rg` `fd` `bat` `sd` `jq` `yq` `gh` `eza` `fzf` `zoxide` | 按 PATH 探测，未安装即如实报缺失 |

两张表都**绝不静默回退到语义不同的 cmdlet**。缺失就是缺失：`Select-String` 冒充 grep 会给出与 GNU 不同的输出格式，`Get-ChildItem` 冒充 find 会漏掉符号链接与权限位——错误的结果比没有结果更糟。

新增文档承诺时必须同步绑定表，否则 `validate-shell-parity.js` 以 `UNBOUND_COMMAND` 阻断。

---

## 三、 可执行性优先与降级判据

**目录存在不等于可用**。这是本契约最重要的一条，也是历史缺陷的来源：

受限宿主（沙箱、容器、加固 Windows）中，MSYS2 运行时会在 `NtCreateDirectoryObject` 处失败并返回 `0xC0000022`。此时 `<git-root>/usr/bin` 目录看起来完好无损，内部每个 `.exe` 也都在，但任何一次调用都会立刻崩溃。旧的模式判定只检查目录存在，于是一路报 `gnu` 模式，而实际每个命令都不可用。

判定因此改为**实测哨兵**：`Test-LinuxParityGnuExecutable` 真实执行 `true.exe`，要求退出码为 0 且输出不含 `fatal error` 或 `0xC0000022`。哨兵失败即降级为 PowerShell 原生实现。

降级是**选择性**的：

- **允许降级**：语义可无损映射的命令（`ls`、`cat`、`cp`、`mkdir` 等）；
- **故意不降级**：`sed`/`awk`/`cut`/`tr` 等流编辑器与列工具。部分模拟会在边缘输入上静默产出与 GNU 不同的文本——正则方言差异、行尾处理差异、字段分割差异。宁可缺失也不给错结果。

**确定性复现降级**：设置 `$env:LINUX_PARITY_GNU_ROOT='<path>'` 可钉死 GNU 根目录语义；指向无效路径即稳定复现降级路径，无需真的制造沙箱。

---

## 四、 语义映射表

| Linux 写法 | PowerShell 等价 | 说明 |
| :--- | :--- | :--- |
| `2>/dev/null` | `2>$null` | 重定向目标不同，不可照抄 |
| `export FOO=1` | 兼容层桥接函数 | PowerShell 无 `export`，惯用法是 `$env:FOO = '1'` |
| `command -v <cmd>` | 兼容层桥接函数 | 需区分别名、函数与外部程序 |
| `test -f <path>` | 兼容层桥接函数 | 返回布尔而非退出码 |
| `date +%s` | `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()` | 兼容层的 `date` 仅支持可精确映射的格式 |
| `$?` 取退出码 | `$LASTEXITCODE` | `$?` 是布尔值，不是退出码 |
| `< file` | 管道输入 | `<` 在 PowerShell 中是保留运算符 |
| here-doc `<<EOF` | `@"..."@` here-string | 注意 `@"` 后必须立刻换行 |
| `&&` / `||` | 原生可用 | 仅 PowerShell 7+；5.1 不支持 |
| `$(...)` 命令替换 | `$(...)` 子表达式 | 语义相近，但内部是对象而非文本 |

---

## 五、 包装器形态禁令

包装器与桥接函数体内有两条不可违背的形态约束，二者都源自 PowerShell 的参数绑定机制：

1. **管道判定必须用 `$MyInvocation.ExpectingInput`**。严禁 `if ($input)`——该属性访问会**读取**标准输入流，在非管道调用时阻塞等待 stdin，使 `grep pattern file` 这类常规调用永久挂起。
2. **函数体内不得出现 `[Parameter()]`**。一旦声明任何参数特性，函数即升级为高级函数（advanced function），PowerShell 自动注入 `-Verbose`/`-Debug`/`-ErrorAction` 等通用参数。此时 `-v`、`-e`、`-i`、`-f` 会被通用参数的前缀匹配吞掉，`sed -i`、`grep -f` 在参数绑定阶段就报歧义，根本到不了函数体。包装器一律用纯 `$args` 手工解析。

---

## 六、 禁用清单

| 禁用写法 | 原因 |
| :--- | :--- |
| `Get-ChildItem -Recurse \| Where-Object \| ForEach-Object` 长管道 | 语义与性能均不等价于 `find`/`fd`，且无法表达 `-maxdepth`、`-newer` 等条件 |
| `Select-String` 冒充 `grep` | 输出格式、退出码、`-o`/`-A`/`-B` 语义全部不同 |
| 直接调用系统目录中的 `find.exe` | 这是 Windows 的字符串查找工具，与 GNU `find` 语义完全不同 |
| 依赖 `mkdir -p` 的侥幸解析 | Windows `mkdir` 是 cmdlet 包装，`-p` 会被当作目录名而非选项 |
| `if ($input)` 探测管道 | 非管道调用时阻塞等待 stdin |

---

## 七、 子进程与沙箱

- **工作目录显式隔离**：跨目录调用子项目必须显式传 `-WorkingDirectory (Join-Path $repoRoot "<sub>")`（PowerShell）或 `(cd "<sub>" && ...)`（Bash）。依赖继承的 CWD 会让相对 glob 与配置文件查找漂移到仓库根。
- **`pwsh` 7+ 优先**：Git 钩子与门禁路由统一指向 `pwsh`，严禁回退 PowerShell 5.1——5.1 解析无 BOM 的 UTF-8 文件会产生乱码，且不支持 `&&`/`||`。
- **受限宿主探测**：`Test-LinuxParityRestrictedHost` 以真实读取探测判定受限（拒绝访问即受限，路径不存在不算受限）。两者是不同的故障，混为一谈会掩盖真实原因。
- **Git 配置自愈**：沙箱内用户级 `.gitconfig` 常被拒绝访问。此时前置声明 `$env:GIT_CONFIG_GLOBAL='NUL'; $env:GIT_CONFIG_SYSTEM='NUL'`，屏蔽对外部全局文件的依赖。
- **执行权限**：涉及 `node`/`rg` 的门禁验证需要真实执行权限；被沙箱拒绝时 `pre-commit-gate` 以 `GUARD-SYS-001` 按 fail-closed 阻断，而不是跳过检查。

---

## 八、 PowerShell 编码约定

`.ps1` 头部必须声明两条同义于 Linux 严格模式的开关：

```powershell
$PSNativeCommandUseErrorActionPreference = $true   # 等价 set -e：原生程序非 0 退出即抛错
$PSNativeCommandArgumentPassing = 'Standard'        # 原生参数原样传递，杜绝裂解与转义异常
```

全仓输出锁定 UTF-8，杜绝 936 代码页乱码。缺少上述任一声明会被 `validate-script-isomorphism.js` 以 `Missing '$PSNativeCommandUseErrorActionPreference = $true'` 阻断。

---

## 九、 守卫与自检

`node scripts/common/validate-shell-parity.js` 是该契约的可执行证明，四类断言缺一不可：

1. 绑定表覆盖文档承诺的每个命令，缺一即 `UNBOUND_COMMAND`；
2. 兼容层同时具备 GNU 与原生降级两条路径（`MISSING_GNU_PATH` / `MISSING_FALLBACK_PATH`）；
3. 受限宿主探测与可执行性哨兵均存在（`MISSING_RESTRICTED_PROBE` / `MISSING_EXEC_PROBE`）；
4. 报 `gnu` 模式时必须由真实执行的哨兵背书，否则 `FAIL_OPEN_MODE` 阻断。

文档侧同步校验：AGENTS.md 必须出现兼容层路径、别名优先级、`2>$null` 与 `$env:LINUX_PARITY_GNU_ROOT` 四处锚点，缺失即 `DOC_GAP`。这条设计保证「文档承诺」与「实际可绑定」不会各自漂移（`GUARD-SHELL-001`）。
