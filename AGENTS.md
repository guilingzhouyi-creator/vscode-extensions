# AGENTS.md — 工作区治理总枢（指针式索引）

> 本文件是工作区唯一的顶层治理总规与一级路由。只在此裁定**不可让渡的刚性公理**与**作业索引**；全部实施细则收口至技能真源。修改代码前先按 §一 命中指针，再精读对应 `SKILL.md` 与 SSOT——**未读指针即动手视为违规**。

---

## 一、 快速作业路由中枢（按需即查矩阵）

| 作业场景 | 一票否决指标 | 真源 / 技能指针 | 本地预审 |
| :--- | :--- | :--- | :--- |
| **Git 提交与分批** | 必填 `[Project]`；实质字数 $\ge 30$；零黑话；跨层改动分批原子提交 | [禁词表](scripts/common/commit-msg-forbidden-terms.json) · [batch-commit](.agents/skills/batch-commit/SKILL.md) | `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>` |
| **代码编写、体积与密度** | $\text{CC}\le 15$、$\text{Depth}\le 4$、$\text{Noise}\le 4.0$；$\text{ELOC}\le 900$、$\text{LOC}\le 1400$；$\tau\in[2.5,22.0]$、$\text{POR}\le 0.60$ | [evaluate-eloc-budget.js](scripts/common/evaluate-eloc-budget.js) · [validate-code-density.js](scripts/common/validate-code-density.js) · [complexity-budget](.agents/skills/complexity-budget/SKILL.md) | `node scripts/common/evaluate-eloc-budget.js` · `node scripts/common/validate-code-density.js` |
| **编程工艺与写法约束** | 命名即契约；失败语义单一且显式；联合类型穷尽；导出面最小；依赖单向向下 | [coding-craft](.agents/skills/coding-craft/SKILL.md) · [rule-family-map.md](.agents/skills/coding-craft/references/rule-family-map.md) | `node scripts/common/validate-skills.js` |
| **模块导出与门面** | $\text{ELOC}\ge 15$ 或不可变冻结；零 $\le 3$ 行透传跳板 (`ARCH-ABS-001`) | [facade-discipline](.agents/skills/facade-discipline/SKILL.md) | `node auto-refactor/scripts/validate-facade-governance.js` |
| **代码精简与跳板消融** | 行为 100% 等价；≤ 3 行纯转发文件物理内联；零机械碎片化 | [code-simplification](.agents/skills/code-simplification/SKILL.md) | `node scripts/common/evaluate-eloc-budget.js` |
| **需求澄清与规格先行** | 单点质询消除歧义；接口契约与验收标准先立后码 | [interview-me](.agents/skills/interview-me/SKILL.md) · [spec-driven-development](.agents/skills/spec-driven-development/SKILL.md) | — |
| **测试驱动与故障排查** | 红-绿-重构闭环；SSCCE 最小复现；两次受挫即停反思 | [test-driven-development](.agents/skills/test-driven-development/SKILL.md) · [debugging-and-error-recovery](.agents/skills/debugging-and-error-recovery/SKILL.md) | `cd auto-refactor && npm test` |
| **注释与架构契约** | 六字段 JSDoc 首部；零幽灵空分支；零批次代号；$\text{ECR}\ge 0.75$ | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) | `node auto-refactor/scripts/validate-comment-governance.js` |
| **终端命令面与 Linux 兼容** | 别名优先级、GNU 实体可执行性实测、包装器零 `[Parameter()]` (`GUARD-SHELL-001`) | [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1) · [validate-shell-parity.js](scripts/common/validate-shell-parity.js) · [gate-governance](.agents/skills/gate-governance/SKILL.md) | `node scripts/common/validate-shell-parity.js` |
| **门禁脚本与调用契约** | 子进程工作目录显式隔离；`pwsh` 7+ 优先；Bash `set -euo pipefail` 平铺捕获；助手先定义于调用点 (`GUARD-ORD-001`) | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [scripts/README.md](scripts/README.md) | `pwsh -File scripts/ps1/pre-commit-gate.ps1` |
| **门禁反馈与步骤登记** | 只用语义步骤标识；状态词闭包 PASS/BLOCK/SKIP/WARN (`GUARD-FBK-001`/`GUARD-STEP-001`) | [gate-step-registry.json](scripts/common/gate-step-registry.json) · [validate-gate-feedback.js](scripts/common/validate-gate-feedback.js) | `node scripts/common/validate-gate-feedback.js` |
| **文档规模数字口径** | 计数由真源渲染进 `METRICS:BEGIN/END`；块外裸字面量须等于活真值 (`GUARD-DOC-001`) | [doc-metrics.json](scripts/common/doc-metrics.json) · [sync-doc-metrics.js](scripts/common/sync-doc-metrics.js) | `node scripts/common/sync-doc-metrics.js` |
| **`workspace-timing/`** | 五层解耦；RingBuffer+Journal 崩溃安全；UI 100% 双语字典；审查规则单源 `review-rules.json`；`declaration: false` | [README](workspace-timing/README.md) · [workspace-timing-dev](.agents/skills/workspace-timing-dev/SKILL.md) | `cd workspace-timing && npm run test:fast` |
| **`auto-refactor/`** | <!-- METRICS:BEGIN analyzer-count -->**30 个**<!-- METRICS:END analyzer-count -->分析器与 <!-- METRICS:BEGIN rule-auto-refactor -->**362 条规则**<!-- METRICS:END rule-auto-refactor -->（SSOT <!-- METRICS:BEGIN rule-total -->**502 条规则**<!-- METRICS:END rule-total -->中一支）；Rust 与 TS 100% 字节等价；关键路径禁 `*Sync` I/O（`PRF-IO-001`）；形参 $\ge 4$ 用参数对象（`SIM-ARGS-001`） | [DOCS.md](auto-refactor/DOCS.md) · [auto-refactor-dev](.agents/skills/auto-refactor-dev/SKILL.md) | `cd auto-refactor && npm test` |
| **`WebGames/`** | 全域 `GameConfig` 驱动；视图零业务计算、数据经 `apply_snapshot()` 注入；对象池循环零堆分配 (`ADV-PRF-002`) 且实现 `reset_state()`；异步派发器须 `pump()`/`flush()`/`teardown()` 并排空；先四阶段方案后编码 | [docs/README.md](WebGames/docs/README.md) · [webgames-workflow](.agents/skills/webgames-workflow/SKILL.md) | `cd WebGames && pwsh scripts/ps1/audit-all.ps1` |
| **`fractal-git/`** | 9 微 Crate 分层；Type-State；零 panic；无锁 CAS (`FGT-LCK-001`)；循环零堆分配 (`FGT-PRF-001`)；`// SAFETY:` (`FGT-SAF-001`)；Clippy `-D warnings` | [README](fractal-git/README.md) · [rust-engineering](.agents/skills/rust-engineering/SKILL.md) | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1` |
| **度量与统计建模** | 零注水纯客观统计；Jeffreys $\text{Beta}(0.5,0.5)$ 共轭后验；AST `symbolIndex` 追踪 | [DOCS.md](auto-refactor/DOCS.md) · [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) | `node auto-refactor/scripts/validate-autonomy-scorer.js` |
| **算法与算子第一性原理** | 五步降维协议；100% 差分基准等价 | [DOCS.md](auto-refactor/DOCS.md) · [algorithmic-operator-engineering](.agents/skills/algorithmic-operator-engineering/SKILL.md) | `node auto-refactor/scripts/bench-hot-paths.js` |
| **测试与性能基准** | 确定性时钟/RNG 隔离；零孤儿用例；TB-REGRESSION 耗时预算 | [DOCS.md](auto-refactor/DOCS.md) · [test-benchmark-engineering](.agents/skills/test-benchmark-engineering/SKILL.md) | `cd auto-refactor && npm test` |
| **产品交付与发布日志** | 面向真实用户；零工程黑话；Keep-a-Changelog | [README](workspace-timing/README.md) · [product-release-docs](.agents/skills/product-release-docs/SKILL.md) | `bash scripts/sh/check-display-assets.sh` |
| **扩展打包与热同步** | 产物自动轮转；`-HotSync` 注册表自愈；SemVer 干净树 | [scripts/README.md](scripts/README.md) · [release-package-workflow](.agents/skills/release-package-workflow/SKILL.md) | `pwsh -File scripts/ps1/package.ps1 -HotSync` |
| **单源规则目录与元治理** | SSOT 零漂移；规则 ID 双向闭包 (`RCFG-RULE-DRIFT`/`RCFG-COUNTS-001`) | [rule-catalog.json](scripts/common/rule-catalog.json) · [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) | `node scripts/common/validate-rule-id-closure.js` |
| **全工作区统一审查** | 5 大支柱 100% 绿色通行 | [scripts/README.md](scripts/README.md) · [gate-governance](.agents/skills/gate-governance/SKILL.md) | `pwsh -File scripts/ps1/audit-all.ps1` |
| **顶层蓝图与历史全宗** | Cell 平权自治；一体两面 Diff；归档元数据规范 | [blueprint](docs/agent-native-system-blueprint.md) · [docs-archive-governance](.agents/skills/docs-archive-governance/SKILL.md) | — |
| **技能集与同构治理** | 物理四件套；JIT 渐进披露；双目录 100% 字节等价 | [validate-skills.js](scripts/common/validate-skills.js) · [sync-skills.js](scripts/common/sync-skills.js) · [skill-governance](.agents/skills/skill-governance/SKILL.md) | `node scripts/common/validate-skills.js` |
| **SubAgent 泛化调度** | (Archetype $\otimes$ Posture) 正交派生；`inherit` 同构继承；独占 Path Jail | [subagent-catalog.json](.agents/subagents/subagent-catalog.json) · [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) | `node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js` |
| **界面工程与交互物理** | 语义明度阶梯；单闭合边框；二阶阻尼谐振子；感知幂律遮罩 | [interaction-design-physics](.agents/skills/interaction-design-physics/SKILL.md) | — |

---

## 二、 全局刚性公理与一票否决

| 公理 | 裁定 | 真源 |
| :--- | :--- | :--- |
| **物理卫生八维** | 零空文件/空壳；`.ps1` CRLF 其余 LF；UTF-8 无 BOM；单 EOF 换行；纯空格缩进（TS 4 空格、其余 2 空格）；零空目录/脏文件；全局 `kebab-case`（WebGames `config/**` 与 `.gd` 用 `snake_case`）；后缀即领域 | [validate-physical-hygiene.js](scripts/common/validate-physical-hygiene.js) · [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **复杂度与体积密度** | $\text{CC}\le 15$ 为导出 API 刚性基线（私有纯函数弹性 20~25）；$\text{Depth}\le 4$、$\text{Noise}\le 4.0$；$\text{ELOC}\le 900$ 第一红线、$\text{LOC}\le 1400$ 兜底；$\tau\in[2.5,22.0]$ 防稀释拥挤；$\text{POR}\le 0.60$（$\text{TSPR}\ge 0.40$）防空门面；循环与调度平铺并卫语句提前返回 | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) · [validate-code-density.js](scripts/common/validate-code-density.js) |
| **注释契约** | 核心模块首行六字段 JSDoc；复杂算法声明退化阈值与前置不变式；零幽灵假分支、零冲刺代号、零机械复述 | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) |
| **门面实质承载** | $\text{ELOC}\ge 15$、聚合 $\ge 3$ 子领域或含不可变冻结；合法包络内高内聚模块禁止机械碎片化 | [facade-discipline](.agents/skills/facade-discipline/SKILL.md) |
| **度量求真** | 严禁倍数放大、基数注水、保底伪造、写死置信区间、固定加分；外部依赖须经 AST 真实符号索引追踪 | [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) |
| **规则元治理** | 规则 ID 必登记于 SSOT；跨项目规则零漂移；表现层与底层诊断去重解耦 | [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) |
| **Rust 工业级** | 零 panic、`thiserror` 强类型错误、Type-State、零瞬态堆分配、CAS 无锁、`unsafe` 最小化、常量 SSOT、Rustdoc 四要素、Clippy `-D warnings` | [rust-engineering](.agents/skills/rust-engineering/SKILL.md) |
| **SubAgent 调度** | `Model: "inherit"` 同构、五层契约注入、独占 Zero-Intersection Path Jail、`review`/`explore` 剥夺写权限、主 Agent 交叉复审 | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) |
| **路径与引用** | 严禁盘符、绝对路径、`file:///`；重命名须闭环 CI、SubAgent archetype、[rule-catalog.json](scripts/common/rule-catalog.json)、`docs/`、`audit-all` 五维引用 | [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **阈值与技术债** | 严禁私改 baseline、linter、naming、门禁阈值；$\text{ELOC}_{semantic}\le 15\%$ 且无真实技术债净消除即触发 `BLOCK_GAMING_DETECTED`；High/Critical Debt 恒为 0 且严禁反弹 | [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) |
| **交付完整性** | 严禁 0 字节文件、占位符、未决 TODO、未获批提前标记完成、未过全量回归的缩水实现；严禁 `--no-verify`、跳过门禁提交/推送、对未跟踪文件 `git rm` | [constraint-driven-development](.agents/skills/constraint-driven-development/SKILL.md) |
| **提交诚实** | 严禁敷衍/夸大/贬损/元叙事（`CMG-STY-001`~`004`）；`[Verification]` 严禁流水账（`CMG-STY-005`/`006`）；严禁书写未登记规则 ID（`RCFG-RULE-DRIFT`） | [batch-commit](.agents/skills/batch-commit/SKILL.md) |

---

## 三、 终端命令面契约（PowerShell ↔ GNU）

命令面由 [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1) 单源装配，交互会话与 Agent 子进程共用同一语义，禁止另立别名、垫片或本地包装。守卫 [validate-shell-parity.js](scripts/common/validate-shell-parity.js) 断言文档承诺的每个命令真实可绑定。完整契约（双登记表、降级清单、语义映射全表、包装器禁令、沙箱自愈、自检断言）见 [linux-command-surface.md](.agents/skills/gate-governance/references/linux-command-surface.md)。

- **别名优先级**：`别名 > 函数 > cmdlet > 外部程序`。PATH 垫片必被内建别名遮蔽（`grep.cmd` 无效）；移除 `sort`/`diff`/`where`/`tee`/`sleep`/`select` 等只读别名须带 `-Force`，否则同名函数定义静默不生效。
- **可执行性优先**：目录存在不等于可用。`Test-LinuxParityGnuExecutable` 实测 `true.exe` 哨兵，受限宿主 MSYS2 崩溃（`0xC0000022`）即降级；`sed`/`awk`/`cut`/`tr` **故意不降级**——部分模拟会静默产出与 GNU 不同的文本。`$env:LINUX_PARITY_GNU_ROOT='<path>'` 钉死语义，无效路径即确定性复现降级。
- **语义映射与包装器**：`2>/dev/null` → `2>$null`；退出码取 `$LASTEXITCODE`（`$?` 是布尔）。包装器须用 `$MyInvocation.ExpectingInput` 判管道，且体内**不得出现 `[Parameter()]`**——否则升级为高级函数，`-v`/`-e`/`-i`/`-f` 被通用参数前缀匹配吞掉。

---

## 四、 标准作业闭环

1. **澄清**：意图不完整或疑似 X-Y 问题 → [interview-me](.agents/skills/interview-me/SKILL.md) 单点质询；长会话遵循 [context-engineering](.agents/skills/context-engineering/SKILL.md) 75% 预算与渐进披露。
2. **定位**：按 §一 精读 SSOT 与 Skill，明确架构边界与红线；方案类改动先立细则获批再编码。
3. **分流**：单域作业严禁跨项目扩散；委派须注入 Path Jail、领域公理与交割自检命令。
4. **交叉复审**：① 沙箱越界审计；② 对抗性证伪（[doubt-driven-development](.agents/skills/doubt-driven-development/SKILL.md)）；③ 独立构建与静态核查（[constraint-driven-development](.agents/skills/constraint-driven-development/SKILL.md)）；④ 本地门禁预审。
5. **回归**：`pwsh -File scripts/ps1/audit-all.ps1` 与项目全量测试 100% 绿色后方可交割。
