---
name: batch-commit
description: >-
  工作区大型改动分批原子提交与门禁离线预审工作流。指导 Agent 按 6 层依赖拓扑自底向上拆分批次（底层契约、基础设施、
  配置、业务、静态治理、文档）、编写高内聚结构化提交信息（严格限定四大受控项目归属、纯技术事实质性断言、
  6 类风格禁词拦截），并执行离线门禁预审与原子提交闭环。
---

# batch-commit — 大型改动分批原子提交与门禁预审工作流

本技能规范了跨域大型改动的自底向上拓扑分批、高内聚结构化提交信息编写、四大受控项目归属声明、6 类风格禁词拦截、门禁离线预审（Pre-flight Check）以及最终全域双重回归的标准工程化作业流程。

---

## 一、 适用场景与触发条件

当出现以下任一场景时，严禁使用单次巨石提交（Monolithic Commit），必须激活本分批提交工作流：
1. **跨架构层次改动堆叠**：同时涉及底层契约/存储、通用基础设施、配置资源同构、业务领域实现、静态审查治理或全宗文档；
2. **改动文件跨度大**：工作区改动涉及超过 15 个文件或跨越 2 个以上顶层项目/架构域；
3. **高敏回滚与独立验证诉求**：改动包含底层数据结构重构或破坏性变更，需保证每一个提交点均可独立编译、独立运行回归测试、且具备干净的 `git bisect` 故障隔离粒度。

---

## 二、 依赖拓扑 6 层分批标准体系 (Bottom-Up Dependency Topology)

分批规划必须严格遵守自底向上、解耦可读、自洽闭环的 6 层拓扑依赖顺序：

```text
[第 1 批: Layer 1 底层契约与存储协议] (refactor/feat: contract, persistence, types)
                    │
                    ▼
[第 2 批: Layer 2 通用基础设施与核心算子] (feat/refactor: infra, pool, alloc, runtime)
                    │
                    ▼
[第 3 批: Layer 3 配置资源与同构规则] (feat/refactor: config, catalog, rules)
                    │
                    ▼
[第 4 批: Layer 4 业务领域与视图表现] (feat/refactor: domain, logic, views)
                    │
                    ▼
[第 5 批: Layer 5 静态治理与质量演进] (refactor/test: quality, complexity, coverage)
                    │
                    ▼
[第 6 批: Layer 6 全宗文档与案卷归档] (docs: blueprint, archive, readme)
```

### 分层落地原则：
- **自洽闭环**：每一批提交入库后，工作树必须能独立通过类型编译与单元测试，严禁前序批次依赖后序批次的代码；
- **原子回滚**：单批提交聚焦单一架构层次与功能主题，若发生线上异常可精准单 commit 回滚；
- **显式边界**：各批次所含文件路径严格正交，禁止同一文件在多个批次间反复改动与暂存。

---

## 三、 标准分批执行四步闭环 (S-P-C-V)

对每个规划批次，必须严格循环执行以下 4 步作业闭环：

### Step 1: 显式精准暂存 (`git add`)
严禁裸调 `git add .` 或 `git add -A`，防止将未准备就绪的跨层文件或临时残留意外打入暂存区。必须显式列出属于当前批次的文件列表：
```powershell
git add path/to/contract.ts path/to/storage.ts
```
*注：若有处于 `.gitignore` 规则边界但确需入库的治理脚本，使用 `git add -f <file>` 显式添加。*

### Step 2: 编写结构化提交信息与离线预审 (`commit-msg-gate`)
在本地临时目录中创建提交信息文件 `commit_batch_N.txt`。必须满足以下刚性规范：

#### 1. 标题契约
- **格式**：`<type>(<scope>): <祈使句中文摘要标题>`；
- **长度约束**：5~80 字符，结尾严禁带句号；
- **`<type>` 严格受限**：`feat` | `fix` | `refactor` | `docs` | `test` | `chore` | `style` | `perf`。

#### 2. 正文首区块：受控四大项目显式归属 (`CMG-PRJ-001`)
关键生产级提交（feat/fix/refactor）正文首个结构化区块必须显式声明项目归属，枚举严格受限四大项目：
```markdown
[Project]
- <workspace-timing | auto-refactor | WebGames | governance>
```
*若遗漏或填写未受控名称，强制触发 `CMG-PRJ-001` 一票否决。*

#### 3. 结构化必填区块
- `[Why]`：阐明技术背景、驱动因素或解决的核心痛点，解释为何做此变更；
- `[Added]`：列举新增的模块、接口、类型定义或测试用例；
- `[Changed]`：列举重构的方法、算法实现替换、依赖调整或参数变更；
- `[Fixed]`：若包含缺陷修复必须提供，详述修复的异常场景与根本原因；
- `[Verification]`：详述本地运行的验证手段与质性技术断言；
- **正文字数门槛**：非轻量提交正文非空白字数 $\ge 30$。

#### 4. 纯客观技术事实质性断言与 6 类禁词风格拦截
提交说明是永久技术档案，受 `commit-msg-forbidden-terms.json` 刚性管束：

| 规则 ID | 禁词类别 | 典型违规词汇 | 治理与替换要求 |
| :--- | :--- | :--- | :--- |
| **`CMG-STY-001`** | **临时敷衍** | `wip`, `temp`, `tmp`, `暂存`, `临时方案`, `随便改改`, `placeholder` | 阐明当前确切的改动范围与已知边界，禁止敷衍词汇 |
| **`CMG-STY-002`** | **过度夸大** | `绝对`, `彻底解决`, `完美`, `100%`, `工业级`, `案卷施工`, `四阶段案卷`, `规则金字塔` | 陈述具体的技术解决手段与覆盖用例，杜绝神话宣扬 |
| **`CMG-STY-003`** | **过度贬损** | `垃圾`, `一团糟`, `烂代码`, `毫无意义`, `useless code`, `broken beyond repair` | 客观说明重构的技术动因，杜绝情绪化负面词汇 |
| **`CMG-STY-004`** | **风格元叙事** | `低调中肯`, `求真务实`, `移除宣扬性词汇`, `调整文案语调`, `风格升级`, `全部PASS` | 直接陈述改动的文件与小节内容，严禁将自省表态当作改动提交 |
| **`CMG-STY-005`** | **程序化流水账** | `退出码0`, `双端返回0`, `双端脚本均返回`, `正常状态`, `运行完成`, `无报错` | `[Verification]` 必须陈述具体的边界用例与功能断言，杜绝套话 |
| **`CMG-STY-006`** | **执行标签零执行数字** | `通过146套测试`, `耗时50.8s`, `419个文件`, `覆盖率98%` | 执行标签区域严禁堆砌数字量词，必须提炼为纯逻辑质性断言（例如“断言边界输入下算法正确回退；断言全量源码文件合规且无空文件”） |

- **严禁敏捷冲刺期过程性代号**：正文中绝对严禁出现 `W1~W9`、`Pass 1..6`、`Sprint 3`、`phase\d+`、`st\d+` 等短期过程代号，所有描述必须转换为恒定技术事实；
- **单源规则反虚构 (`RCFG-RULE-DRIFT`)**：正文中引用的所有规则 ID（如 `GATE-AST-001`、`ARCH-FAC-001`）必须在 `scripts/common/rule-catalog.json` 中真实存在，严禁凭空捏造。

#### 5. 离线预审验证
```powershell
pwsh -File scripts/ps1/commit-msg-gate.ps1 "$dir\commit_batch_N.txt"
```
*必须获得 `Commit-Msg 生产级格式与结构化内容校验全部 PASS！` 方可进入下一步。*

### Step 3: 暂存区物理卫生预审 (`pre-commit-gate`)
在实际调用 `git commit` 前，手动触发 Pre-Commit 门禁脚本执行离线流式预审：
```powershell
pwsh -File scripts/ps1/pre-commit-gate.ps1
```
*检查项目：零空文件、换行契约（ps1 CRLF，其余 LF）、TypeScript 4 空格缩进/其余 2 空格、敏感信息防泄漏、单文件双轨体积预算（ELOC<=900, LOC<=1400）、1:3 动态反推包络、高负荷注释密度 >= 8% 及 AST 切片局部复杂度（CC<=15, Depth<=4, Noise<=4.0）。*

#### 暂存区 AST 切片复杂度阻断自愈指引 (AST Complexity Remediation)
若预审触发 `GATE-AST-001`（`CC > 15`）或控制流嵌套超标（`Depth > 4`）：
1. **卫语句提前返回 (Guard Clauses)**：将深层嵌套的 `if-else` 或循环内分支改写为逆向断言提前 `return` 或 `continue`，压平控制流；
2. **纯判定提取 (Pure Predicate Extraction)**：将复杂的组合条件表达式或路径判定拆分为无副作用的纯函数（如 `isTargetExtension`、`matchRulePattern`）；
3. **重新暂存与二次预审**：重构后执行 `git add <file>`，重新运行 `pre-commit-gate.ps1`，直至绿色通过。

### Step 4: 原子提交与状态推进 (`git commit`)
使用离线预审通过的说明文件执行提交，严禁添加 `--no-verify`：
```powershell
git commit -F "$dir\commit_batch_N.txt"
```
提交完成后执行 `git status -s` 核查工作树剩余文件，继续推进下一批。

> [!CAUTION] 产品发布更新日志防污染隔离
> Git 提交说明陈述的是对代码库的**内部工程技术事实**；**严禁**直接将包含工程重构黑话的提交说明复制给用户端的 `CHANGELOG.md` 或 Release Notes。用户交付文档必须保持纯粹的用户功能与价值导向。

---

## 四、 最终全域双重回归验收

全部批次提交完成、工作树完全 clean 之后，必须同次执行工作区双重全量验证：
1. **跨域全量静态审查门禁**：
   ```powershell
   pwsh -File scripts/ps1/audit-all.ps1
   # 断言全仓各子系统与各维度静态审查 100% 绿色通行
   ```
2. **引擎及子项目无头回归测试**：
   依改动领域执行对应测试套件，断言全量测试通过且无未决缺陷；
3. **全工作区零高危技术债务防线**：
   断言全仓未引入任何 High/Critical 技术债务反弹，保持 0 项历史刚性基线（一票否决）。

---

## 五、 关联模板与参考指南

- [commit-template-standard.txt](templates/commit-template-standard.txt)：标准结构化提交信息模板；
- [forbidden-terms-guide.md](references/forbidden-terms-guide.md)：风格禁词拦截与质性断言编写指引。
