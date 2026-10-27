---
name: gate-governance
description: >-
  【触发：门禁/全仓审查/提交门禁/脚本编写/跨平台/pwsh/bash/子进程】编写修改门禁脚本、运行全仓审查或处理跨平台脚本兼容时触发。落实 Tier 1 本地左移流式判定、工作目录隔离契约与零黑话规范。
---

# gate-governance — 三层同构门禁体系与跨平台脚本工程治理

本技能规定了跨项目通用的三层同构门禁体系架构标准（本地 Tier 1 -> 云端预测试机 Tier 1.5 -> GitHub CI Tier 2）、受影响项目智能切片机制、MicroVM 云端沙箱隔离公理及跨平台脚本工程契约。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | VS Code 扩展与计时视图（领域支援）；门禁与命令面基础设施（领域入口）；技能与规则元治理（领域支援）；工作区元治理与并行交付（领域支援） |
| **前置** | —（作为领域入口，无前置） |
| **接续** | [defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md) |
| **并行支援** | [coding-craft](../coding-craft/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md) |
| **领域链** | VS Code 扩展与计时视图：workspace-timing-dev → state-concurrency-and-crash-recovery → interaction-design-physics → test-benchmark-engineering → release-package-workflow；其余领域链见 `docs/skill-catalog.md` |

**何时联动**：计时视图卡顿或丢帧 → `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering`；进程被杀后缓冲区数据丢失 → `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 一、 三层同构门禁架构体系 (Three-Tier Isomorphic Gates)

门禁系统严禁依赖单层防线，必须实施端到端三层逐级收紧的纵深防御，确保本地极速反馈、沙箱平台预演与远端主干看守 100% 规则同构：

### 1. 第一层：本地左移防御 (Tier 1 Local Shift-Left Gates)
- **`pre-commit`（内存单遍流式判定，内存判定约 1 ms / 端到端约 160 ms）**：
  核心由 `gate-fast-staged.js` 驱动，在单一 Node.js 进程内单遍流式读取暂存区文件，直接在内存中完成 6 大门禁判定：
  1. **物理空文件守卫**：一票否决 0 字节物理空文件与纯空白字符虚空文件；
  2. **换行契约守卫**：PowerShell 脚本（`.ps1`）在磁盘必须严格保持 CRLF 换行；Bash（`.sh`）、GDScript（`.gd`）、TypeScript/JavaScript（`.ts`/`.js`）、Markdown（`.md`）与 JSON（`.json`）严格保持 LF 换行；
  3. **缩进契约守卫**：TypeScript 源码保持 4 空格缩进，其余源码与配置文件保持 2 空格缩进；
  4. **密钥与敏感信息守卫**：拦截硬编码 Token、API 密钥与绝对路径；
  5. **单文件双轨体积与 1:3 动态包络**：看守有效代码行 $\text{ELOC} \le 900$ 与物理行 $\text{LOC} \le 1400$ 预算、1:3 动态反推包络及 $\text{ELOC} \ge 600$ 高负荷契约注释密度 $\ge 8\%$；
  6. **AST 切片局部复杂度守卫 (`GUARD-AST-001`)**：暂存区生产代码切片受单函数圈复杂度 $\text{CC} \le 15$（分发器与探针弹性包络 20~25）、控制流嵌套深度 $\text{Depth} \le 4$、单行噪声比 $\text{Noise} \le 4.0$ 刚性约束。
- **`commit-msg`（单进程统一提交信息流式检验）**：
  由 `validate-commit-msg.js` 驱动，毫秒级流式完成提交说明各项合规校验：
  1. **Conventional Commits 格式**：`<type>(<scope>): <祈使句中文摘要标题>`（长度 5~80 字符，结尾不加句号）；
  2. **受控四大项目归属 (`CMG-PRJ-001`)**：正文首行/首区块必须显式声明 `[Project]`，枚举严格限定于：`workspace-timing | auto-refactor | WebGames | governance`；
  3. **结构化必填区块**：必须包含 `[Why]`、`[Added]`、`[Changed]`、`[Fixed]`（如有修复缺陷）、`[Verification]`，正文非空白字数 $\ge 30$；
  4. **6 类禁词风格与零黑话拦截**：严格拦截临时敷衍（`CMG-STY-001`）、过度夸大（`CMG-STY-002`）、过度贬损（`CMG-STY-003`）、风格元叙事（`CMG-STY-004`）、程序化流水账（`CMG-STY-005`）与执行数字量词（`CMG-STY-006`）；拦截任何施工批次代号；
  5. **单源规则反虚构 (`RCFG-RULE-DRIFT`)**：提交信息中引用的所有规则 ID 必须在 `scripts/common/rule-catalog.json` 中真实登记。
- **`pre-push`（全域双重回归与基线看守）**：
  结合智能分流调度执行受影响项目的全量单元测试、跨模块静态审查、零高危技术债务防线与质量基线 Ratchet（`GUARD-BASE-001`：多维自审的体量预算、逆向层耦合与前后端标准化均衡不得跌破冻结基线）。

### 2. 第 1.5 层：云端预测试机预演 (Tier 1.5 Remote Linux Sandbox Gate - Instabox)
- **架构定位**：消解 Windows 本地开发机与 GitHub Actions Ubuntu CI 之间的跨平台环境断层，在真正向远端推进提交前，由与 GitHub Actions 1:1 等价的 Linux 原生沙箱进行先行拦截。
- **双模式审查机制**：
  1. **定向切片 (Targeted Slices)**：
     - `hygiene`: 仓库八维物理卫生、文档规模一致性、规则ID闭包、反馈词表与 Shell 兼容（~5s）；
     - `rust`: fractal-git 微 Crate 拓扑、零堆分配边界、`cargo fmt --check`、`cargo check`、`cargo clippy -D warnings`（~8s）；
     - `timing`: workspace-timing 编译与 205+ 项单元测试（~7s）；
     - `auto-refactor`: 静态引擎多维自审与 AST 单元测试（~8s）；
     - `webgames`: 129 张配置表静态审查与 349 个 Mermaid 图表解析（~8s）；
     - `staged`: 动态扫描改动集，自动路由并组合受影响领域的切片。
  2. **全量预审 (Full Audit - `all`)**：
     - 调度 `bash scripts/sh/audit-all.sh --fast`（或深度模式），全量覆盖全仓 6 大核心支柱，生成十维质量全景雷达。
- **云端 MicroVM 多租户安全隔离公理**：
  1. **Path Jail 独占隔离**：必须严格收口于 `/data/workspace/vscode-extensions/`，严禁向宿主根盘 `/`、`/data/services/` 或其他项目目录倾倒文件；
  2. **并发与内存配额保护**：宿主 4 vCPU 必须保留 1 核防 OOM（命令加设最大并行度保护，如 `-j 3`）；
  3. **端口零直接暴露**：严禁占用宿主常驻端口（`8788`, `8789`, `10801`, `5901`），临时测试报告一律通过 `instabox-port` 动态派发与按需唤醒；
  4. **执行目录与临时产物**：跨子项目命令必须使用 `(cd <dir> && <cmd>)` 子 Shell 隔离，杜绝工作目录累积漂移；临时文件即用即销。
- **本地调度命令面契约**：
  - Node 调度中枢：`node scripts/common/remote-sandbox-gate.js --slice <name> [--remote|--local]`
  - PowerShell 入口：`pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice <name> [-Local]`
  - Bash 入口：`bash scripts/sh/remote-sandbox-test.sh --slice <name> [--local]`
- **细水长流分批联动**：
  - 调度器（`staggered-push-orchestrator.js`）严禁硬编码绕过门禁标志；在推进候选批次指针前，强制执行 `preflightCheckpointAudit` 并联动预测试机进行真实 Linux 切片预演（`--verify-remote` / `-RemoteSlice`），预检不通过坚决不推。

### 3. 第二层：远端主干看守 (Tier 2 Remote CI Gate)
- 远端 CI 流水线（`.github/workflows/`）作为最终的 Clean-Room 生产级构建、多矩阵验证与 VSIX 打包防线；
- 由于前两层已排空一切跨平台与依赖隐患，Tier 2 保持 100% 预期绿灯；
- 阻断任何由于本地 `--no-verify` 绕过提交的问题代码合入主干（触发 `GUARD-ISO-001` 熔断）；
- 远端 CI 步骤中如需动态生成多行文件，统一使用 `printf "%s\n"` 语法，杜绝 `echo` 平台差异行为。

---

## 二、 受影响项目智能分流 (Impact-Driven Routing)

为避免单次微小改动触发全工作区重构测试的膨胀开销，门禁调度系统采用基于路径特征的受影响项目智能分流机制：

### 1. 路径特征探测与精准映射
通过 `git diff --cached --name-only` 提取暂存区文件路径向量，精确映射至五大受控域：
- **`workspace-timing/**`** $\rightarrow$ 路由至 VS Code 扩展套件：触发快速增量编译（`npm run compile`）、单元测试（`npm run test:fast`）与双语字典审查（`npm run review`）；
- **`auto-refactor/**`** $\rightarrow$ 路由至 CLI 引擎套件：触发 <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->与 <!-- METRICS:BEGIN rule-auto-refactor -->**374 条规则**<!-- METRICS:END rule-auto-refactor -->的 auto-refactor 规则自测（`npm test`，套件总数由运行期汇总输出）、Rust/TS 双轨内核等价性校验与项目中立性守卫（`npm run gate`）；
- **`WebGames/**`** $\rightarrow$ 路由至 Godot 引擎套件：触发 GDScript 语法审查（`check-gdscript.sh`）、无头回归套件（`test-run.ps1`）与配置同构审计；
- **`fractal-git/**`** $\rightarrow$ 路由至 Rust 原生版本控制内核套件：触发 10 微 Crate 编译与 Clippy 零容忍检查（`cargo clippy --all-targets -- -D warnings`）、内核单元测试（`cargo test`）与 Taxis 专项架构审计（`fractal-git/scripts/ps1/audit-taxis.ps1`）；
- **`scripts/**` / `.github/**` / `AGENTS.md` / `.agents/skills/**` / 根目录配置** $\rightarrow$ 标记为 `governance` 域：触发工作区单源规则目录一致性、技能集规范性核验与全宗审计（`audit-all.ps1`，内置 `validate-skills.js`）。

### 2. 分流执行原则
- **增量收敛**：若改动仅局限于单一子项目，门禁仅调度该子项目的测试与审查，其余项目跳过；
- **跨域扩散**：若改动触及公共基础脚本、规则目录或多个子项目，自动升级为跨域级联审查；
- **零漏检契约**：分流器默认采用悲观安全策略，未识别路径自动归类为 `governance` 触发全面核验。

---

## 三、 受限递归门禁脚本探测规范

在项目治理分析器中检索门禁脚本时，严禁仅做顶层单级扫描：
1. **探测目录**：覆盖 `scripts/`、`tools/`、`gate/`、`gates/` 等标准路径；
2. **受限递归深度**：设置 `maxDepth = 2`，精准检出多级子目录（如 `scripts/ps1/`、`scripts/sh/`、`scripts/common/`），避免过度扫描进入构建输出或依赖目录；
3. **特征正则收口**：匹配 `/gate|audit|check|verify|lint|hygiene|commit|push|catalog|review-rules/i` 及对应脚本后缀（`.ps1`、`.sh`、`.js`、`.py`）。

---

## 四、 跨平台脚本与子进程工程契约

### 1. 子进程显式 WorkingDirectory 绑定
- **PowerShell**：调用子项目流水线必须使用 `-WorkingDirectory (Join-Path $repoRoot "<subproject>")`；
- **Bash**：调用子项目必须使用 `(cd "<subproject>" && ...)` 子 Shell 隔离；
- **严禁仅依赖 `--prefix`**：Node 工具链（Prettier、ESLint、Jest 等）使用 `--prefix` 时仍会向上查找父级目录的配置文件或失配相对 glob 模式，导致环境漂移与误判。

### 2. PowerShell 7+ 优先与编码安全
- **pwsh 优先原则**：统一路由至跨平台 `pwsh`（PowerShell 7+），严禁裸调 `powershell.exe`（Windows PS 5.1 解析无 BOM UTF-8 会发生乱码）；非 Windows 环境下优雅回退至 Bash；
- **严格安全指令**：脚本开头必须显式声明 `$ErrorActionPreference = 'Stop'` 与 `Set-StrictMode -Version Latest`；
- **Linux 语义开关注入**：脚本前言必须显式声明 `$PSNativeCommandUseErrorActionPreference = $true`（原生程序非 0 退出触发异常阻断）与 `$PSNativeCommandArgumentPassing = 'Standard'`（原生参数原样传递，杜绝参数裂解与转义异常）；输出锁定 UTF-8；
- **Linux 现代平替工具优先**：全仓禁止编写冗长脆弱的 `Get-ChildItem -Recurse | Where-Object | ForEach-Object` 或 `Select-String` 管道，必须优先调用已配置的现代化 Linux 等价工具链（`rg` 替代 grep、`fd` 替代 find、`bat` 替代 cat、`sd` 替代 sed、`jq` 解析 JSON、`which` 与 `touch` 垫片）或直接调用 `scripts/common/*.js`、`scripts/sh/*.sh`；
- **换行符契约**：PowerShell 脚本（`.ps1`）在磁盘必须严格保持 CRLF 换行；
- **Linux 命令面兼容层**：Windows 宿主上的 GNU 语义对齐（别名优先级、可执行性哨兵与降级判据、语义映射表、包装器形态禁令）由 `scripts/ps1/lib/linux-parity.ps1` 单源装配，完整契约见 [linux-command-surface.md](references/linux-command-surface.md)；
- **沙箱隔离与环境自愈**：在 Windows 沙箱或自动化子进程中执行 Git 相关命令时，若遭遇用户级 `.gitconfig` 访问受限，统一前置声明 `$env:GIT_CONFIG_GLOBAL="NUL"; $env:GIT_CONFIG_SYSTEM="NUL"` 屏蔽外部全局文件依赖。

### 3. Bash 严格错误标志与平铺退出码
- **严格管道安全**：Bash 脚本开头必须声明 `set -euo pipefail`；
- **平铺退出码捕获**：预期允许非 0 退出码的探测指令，严禁裸调导致脚本隐式中断，必须采用 `STATUS=0; cmd || STATUS=$?` 平铺捕获或 `if cmd; then` 守卫分支。

### 4. Windows 二进制路径硬锁定规范 (Trusted Binary Path Hardening)
- **拒绝系统 PATH 模糊检索**：调用外部可执行程序（如 `ssh.exe`、`git.exe`、`node.exe`、`tar.exe`）时，严禁直接依赖系统环境变量 `PATH` 模糊查找，以防当前工作目录或不受信临时目录下的同名假冒二进制被意外优先执行（PATH 劫持防御）；
- **显式探测与受信任安全路径单源绑定**：必须按确定性优先级探测受信任的绝对安全路径（如 `$env:WINDIR\System32\OpenSSH\ssh.exe`、`$env:ProgramFiles\Git\bin\git.exe`、`[System.Environment]::GetFolderPath('ProgramFiles')`），探测失败时抛出带有确定性解决指引的异常，严禁静默退化至未经验证的模糊路径；
- **物理存在性与执行权限前置断言**：在将可执行程序路径传入子进程管道之前，必须前置执行 `Test-Path -PathType Leaf`（PowerShell）或 `[ -f "$BIN_PATH" ] && [ -x "$BIN_PATH" ]`（POSIX Shell）物理校验。

### 5. 跨平台带空格命令行双引号硬包裹防御契约 (Space-Safe Quoting Discipline)
- **参数硬包裹防转义裂化**：在跨平台脚本（PowerShell/Bash）拼接命令字符串或传递动态路径（包含 Windows 常见带空格目录如 `Program Files`、`Game Development`）时，所有路径变量与动态参数必须强制采用外层或转义双引号硬包裹（如 `"`$targetPath`"` 或 `"$TARGET_PATH"`）；
- **参数列表传参优先**：调用子进程时优先使用参数列表（ArgumentList 数组）形式替代原始字符串拼接执行，从语义层面彻底阻断 Shell 字符重分词与命令注入隐患；
- **路径规范化统一收口**：在 Windows 平台统一使用 `Join-Path` 或 `Convert-Path` 规整斜杠与盘符，Bash 脚本统一规整绝对路径后再行双引号包裹。

### 6. 平台与门禁脚本更名五维拓扑闭环规范 (Script Rename 5D Topology Checklist)

当重命名、移动或废弃 `scripts/` 下的门禁、治理或测试工具脚本时（例如 `validate-hygiene.js` $\to$ `validate-physical-hygiene.js`），严禁仅修改单一入口。必须严格依序排查并同步更新以下五维引用拓扑：

```mermaid
flowchart LR
    Rename["重命名/废弃目标脚本"] --> D1["1. CI 流水线<br/>.github/workflows/*.yml"]
    Rename --> D2["2. SubAgent 原型<br/>.agents/subagents/archetypes/*.json"]
    Rename --> D3["3. 单源规则目录<br/>scripts/common/rule-catalog.json"]
    Rename --> D4["4. 架构与规范文档<br/>docs/**/*.md, AGENTS.md"]
    Rename --> D5["5. 聚合门禁总督<br/>scripts/ps1/audit-all.ps1 等"]
```

1. **第一维：远端 CI 自动化流水线 (`.github/workflows/`)**：
   检索 CI 工作流 YAML 中所有的 `run: node scripts/...` 与 `run: pwsh scripts/...`，确保 Actions 步骤调用的脚本路径 100% 有效；
2. **第二维：SubAgent 原型与角色元数据 (`.agents/subagents/archetypes/`)**：
   检索 `tool_requirements`、`responsibilities` 及自检建议命令中的脚本名称，避免派生的 SubAgent 执行不存在的废弃命令；
3. **第三维：全工作区单源规则目录 (`scripts/common/rule-catalog.json`)**：
   若该脚本负责承载或检验特定规则，同步更新规则元数据中的 `source` 或说明字段，运行 `node scripts/common/generate-rule-catalog.js --check-only` 验证；
4. **第四维：治理规范与蓝图说明文档 (`docs/`, `AGENTS.md`)**：
   同步更新 `AGENTS.md` 快速作业路由中枢及 `docs/system-spec/` 中的脚本指针，消除所有相对断链；
5. **第五维：聚合门禁脚本与本地 Git 钩子 (`scripts/ps1/`, `scripts/sh/`)**：
   同步更新 `audit-all.ps1/sh`、`pre-commit-gate.ps1` 中的受控调用链。

### 7. 破坏性文件操作溯源守卫 (Destructive Operand Provenance)

递归删除的安全前提不是「逻辑正确」，而是「收到的路径就是作者意图的路径」。路径一旦经由变量传入，源码通常不再说明它从哪来。因此该族约束是**来源约束**，由 [`validate-destructive-ops.js`](../../../scripts/common/validate-destructive-ops.js) 在 `DESTRUCTIVE-OPS-38` 步骤静态执行：

1. **操作数溯源 (`GUARD-DESTR-001`)**：递归删除的操作数不得是文件系统根、工作目录或其祖先、家目录/用户配置目录，也不得经由任意长度的赋值链、循环别名（`foreach ($x in ...)`、`for x in ...`、`for (const x of ...)`、`.forEach((x)`）间接派生自这些表达式。检出为**污点分析**而非「操作数必须是字面量」——后者会对每处合法 fixture 清理误报，而误报二十次的守卫一定会被关掉；
2. **只读自动变量遮蔽 (`GUARD-VAR-001`)**：禁止对 `$HOME`/`$PSHOME`/`$PID`/`$Host`/`$Error`/`$ExecutionContext`/`$ShellId`/`$PSVersionTable`/`$IsWindows`/`$IsLinux`/`$IsMacOS`/`$PSCulture`/`$PSUICulture`/`$PSEdition` 赋值。写入必然抛错，而抛错被忽略后该名字**保持原值**，后续每次读取都静默指向另一个对象。该清单经 `Set-Variable -ErrorAction Stop` 逐一实测得出；可写的形似名（`$PROFILE`/`$PWD`/`$INPUT`/`$ARGS`/`$MATCHES`/`$LASTEXITCODE`）与类型受限名（`$OutputEncoding`/`$MyInvocation`/`$PSBoundParameters`）按实测排除，误报会直接阻断正确写法；
3. **运行时同名守卫**：命令面兼容层的 `rm` 在 GNU 与降级两条绑定路径上都必须前置 `Test-LinuxParityRemovalTarget`，拒绝时写 stderr 并置 `$LASTEXITCODE = 1`。**静默跳过不可接受**：残留目录会成为下次运行的「有效输入」。守卫只在降级分支安装而 GNU 分支裸转发，等于守卫从未被调用——「守卫存在」与「守卫生效」必须分别实测（`(Get-Command rm).Definition` 含守卫符号）；
4. **清理钩子的前置断言**：退出钩子内不得直接删除脚本作用域变量，应经 `-MessageData` 显式传参并断言目标以 `[System.IO.Path]::GetTempPath()` 为前缀；作用域捕获失败时变量退化为 `$null`，删除动作随即作用于任意路径。

---

## 五、 零黑话纪律与技术事实守则

1. **零施工黑话**：门禁脚本日志、测试断言输出与提交检查中，严禁出现任何施工批次代号（`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip` 等）；
2. **客观质性断言**：门禁日志输出必须陈述纯粹客观的技术事实与输入输出质性结论，禁止输出“退出码0”或统计数字等形式主义流水账。

---

## 六、 常用门禁命令与零高危技术债务防线

1. **零高危技术债务防线**：全工作区 High/Critical 技术债务历史性归零（0 项），门禁系统一票否决任何导致债务反弹的改动；
2. **常用本地预审命令矩阵**：
   - 暂存区极速体检：`pwsh -File scripts/ps1/pre-commit-gate.ps1`
   - 提交信息预审：`pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>`
   - 单源规则零漂移断言：`node scripts/common/generate-rule-catalog.js --check-only`
   - 技能集规范与同构核验：`node scripts/common/validate-skills.js`
   - 双轨体积评估：`node scripts/common/evaluate-eloc-budget.js`
   - MOD SDK 双向同步核验：`python WebGames/scripts/py/audit_sdk_sync.py`
   - 全工作区快速统一审查：`pwsh -File scripts/ps1/audit-all.ps1 -Fast`

---

## 七、 参考资源与门禁脚手架

深水区协议与开箱即用骨架按需加载（JIT），未涉及对应子任务时无需读取：

| 资源 | 用途 |
| :--- | :--- |
| [cross-platform-subprocesses.md](references/cross-platform-subprocesses.md) | 跨目录子进程的工作目录显式绑定、错误平铺捕获与平台环境兼容契约 |
| [linux-command-surface.md](references/linux-command-surface.md) | Linux 命令面兼容层：别名优先级、GNU 可执行性哨兵、选择性降级、语义映射与包装器形态禁令 |
| [gate-script-skeleton.ps1](templates/gate-script-skeleton.ps1) | PowerShell 门禁脚本骨架：`$PSNativeCommandUseErrorActionPreference`、UTF-8 锁定与语义步骤登记 |
| [gate-script-skeleton.sh](templates/gate-script-skeleton.sh) | Bash 同构骨架：`set -euo pipefail`、平铺错误捕获与同构步骤标识 |

> [!IMPORTANT]
> 两份骨架的语义步骤标识必须与 `scripts/common/gate-step-registry.json` 登记项逐字一致（`GUARD-STEP-001`），否则 `validate-gate-feedback.js` 直接阻断。
