---
name: gate-governance
description: >-
  通用双层门禁架构与跨平台脚本工程化治理。指导 Agent 落实 Tier 1 本地左移极速流式判定（gate-fast-staged.js <90ms、
  validate-commit-msg.js）与 Tier 2 远端 CI 同构防御，运用受影响项目智能分流（auto-refactor 27 分析器与 308 规则自测）、
  子进程显式工作目录隔离（-WorkingDirectory）与 pwsh 7+ 优先原则，看守代码卫生与零黑话纪律。
---

# gate-governance — 通用双层门禁架构与跨平台脚本工程治理

本技能规定了跨项目通用的双层同构门禁体系架构标准、受影响项目智能分流机制、跨平台脚本工程契约及子进程执行上下文隔离原则。

---

## 一、 双层同构门禁架构体系 (Two-Tier Isomorphic Gates)

门禁系统严禁依赖单层防线，必须实施端到端双层纵深防御，确保本地极速反馈与远端主干看守 100% 规则同构：

### 1. 第一层：本地左移防御 (Tier 1 Local Shift-Left Gates)
- **`pre-commit`（内存单遍流式判定，耗时 <90ms）**：
  核心由 `gate-fast-staged.js` 驱动，在单一 Node.js 进程内单遍流式读取暂存区文件，直接在内存中完成 6 大门禁判定：
  1. **物理空文件守卫**：一票否决 0 字节物理空文件与纯空白字符虚空文件；
  2. **换行契约守卫**：PowerShell 脚本（`.ps1`）在磁盘必须严格保持 CRLF 换行；Bash（`.sh`）、GDScript（`.gd`）、TypeScript/JavaScript（`.ts`/`.js`）、Markdown（`.md`）与 JSON（`.json`）严格保持 LF 换行；
  3. **缩进契约守卫**：TypeScript 源码保持 4 空格缩进，其余源码与配置文件保持 2 空格缩进；
  4. **密钥与敏感信息守卫**：拦截硬编码 Token、API 密钥与绝对路径；
  5. **单文件双轨体积与 1:3 动态包络**：看守有效代码行 $\text{ELOC} \le 900$ 与物理行 $\text{LOC} \le 1400$ 预算及高负荷契约注释密度；
  6. **AST 切片局部复杂度守卫 (`GATE-AST-001`)**：暂存区生产代码切片受单函数圈复杂度 $\text{CC} \le 15$（分发器与探针弹性包络 20~25）、控制流嵌套深度 $\text{Depth} \le 4$、单行噪声比 $\text{Noise} \le 4.0$ 刚性约束。
- **`commit-msg`（单进程统一提交信息流式检验）**：
  由 `validate-commit-msg.js` 驱动，毫秒级流式完成提交说明各项合规校验：
  1. **Conventional Commits 格式**：`<type>(<scope>): <祈使句中文摘要标题>`（长度 5~80 字符，结尾不加句号）；
  2. **受控四大项目归属 (`CMG-PRJ-001`)**：正文首行/首区块必须显式声明 `[Project]`，枚举严格限定于：`workspace-timing | auto-refactor | WebGames | governance`；
  3. **结构化必填区块**：必须包含 `[Why]`、`[Added]`、`[Changed]`、`[Fixed]`（如有修复缺陷）、`[Verification]`，正文非空白字数 $\ge 30$；
  4. **6 类禁词风格与零黑话拦截**：严格拦截临时敷衍（`CMG-STY-001`）、过度夸大（`CMG-STY-002`）、过度贬损（`CMG-STY-003`）、风格元叙事（`CMG-STY-004`）、程序化流水账（`CMG-STY-005`）与执行数字量词（`CMG-STY-006`）；拦截任何施工批次代号；
  5. **单源规则反虚构 (`RCFG-RULE-DRIFT`)**：提交信息中引用的所有规则 ID 必须在 `scripts/common/rule-catalog.json` 中真实登记。
- **`pre-push`（全域双重回归与基线看守）**：
  结合智能分流调度执行受影响项目的全量单元测试、跨模块静态审查与质量基线 Ratchet。

### 2. 第二层：远端主干看守 (Tier 2 Remote CI Gate)
- 远端 CI 流水线（`.github/workflows/`）完整镜像本地 Tier 1 全套判定（Hygiene + AST Slice + Style + Test + Audit）；
- 阻断任何由于本地 `--no-verify` 绕过提交的问题代码合入主干（触发 `GATE-ISO-001` 熔断）；
- 远端 CI 步骤中如需动态生成多行文件，统一使用 `printf "%s\n"` 语法，杜绝 `echo` 平台差异行为。

---

## 二、 受影响项目智能分流 (Impact-Driven Routing)

为避免单次微小改动触发全工作区重构测试的膨胀开销，门禁调度系统采用基于路径特征的受影响项目智能分流机制：

### 1. 路径特征探测与精准映射
通过 `git diff --cached --name-only` 提取暂存区文件路径向量，精确映射至四大受控域：
- **`workspace-timing/**`** $\rightarrow$ 路由至 VS Code 扩展套件：触发快速增量编译（`npm run compile`）、单元测试（`npm run test:fast`）与双语字典审查（`npm run review`）；
- **`auto-refactor/**`** $\rightarrow$ 路由至 CLI 引擎套件：触发 27 分析器与 308 规则自测（`npm test`）、Rust/TS 双轨内核等价性校验与项目中立性守卫（`npm run gate`）；
- **`WebGames/**`** $\rightarrow$ 路由至 Godot 引擎套件：触发 GDScript 语法审查（`check-gdscript.sh`）、无头回归套件（`test-run.ps1`）与配置同构审计；
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
- **换行符契约**：PowerShell 脚本（`.ps1`）在磁盘必须严格保持 CRLF 换行。

### 3. Bash 严格错误标志与平铺退出码
- **严格管道安全**：Bash 脚本开头必须声明 `set -euo pipefail`；
- **平铺退出码捕获**：预期允许非 0 退出码的探测指令，严禁裸调导致脚本隐式中断，必须采用 `STATUS=0; cmd || STATUS=$?` 平铺捕获或 `if cmd; then` 守卫分支。

---

## 五、 零黑话纪律与技术事实守则

1. **零施工黑话**：门禁脚本日志、测试断言输出与提交检查中，严禁出现任何施工批次代号（`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip` 等）；
2. **客观质性断言**：门禁日志输出必须陈述纯粹客观的技术事实与输入输出质性结论，禁止输出“退出码0”或统计数字等形式主义流水账。
