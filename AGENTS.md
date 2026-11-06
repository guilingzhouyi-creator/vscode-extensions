# AGENTS.md — 工作区治理总枢（指针式索引）

> 本文件是工作区唯一的顶层治理总规与一级路由。只在此裁定**不可让渡的刚性公理**与**作业索引**；全部实施细则收口至技能真源。动手前必先命中指针并精读对应 `SKILL.md` 与 SSOT。

---

## 一、 快速作业路由中枢（按需即查矩阵）

> 只列高频作业面。其余场景见 [技能调用说明书](docs/skill-catalog.md)。

| 作业场景 | 一票否决指标 | 真源 / 技能指针 | 本地预审 |
| :--- | :--- | :--- | :--- |
| **Git 提交与分批** | 必填 `[Project]`；字数 $\ge 30$；零黑话；跨层原子分批提交 | [禁词表](scripts/common/commit-msg-forbidden-terms.json) · [batch-commit](.agents/skills/batch-commit/SKILL.md) | `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>` |
| **门禁与命令面（`scripts/`）** | 子进程目录隔离；`pwsh` 7+/Bash `set -euo pipefail`；零 `[Parameter()]` 包装器；状态词闭包 | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1) · [gate-step-registry.json](scripts/common/gate-step-registry.json) · [scripts/README.md](scripts/README.md) | `pwsh -File scripts/ps1/pre-commit-gate.ps1` · `node scripts/common/validate-gate-feedback.js` · `node scripts/common/validate-shell-parity.js` |
| **代码编写、体积与门面** | $\text{CC}\le 15$、$\text{Depth}\le 4$、$\text{Noise}\le 4.0$；$\text{ELOC}\le 900$、$\text{LOC}\le 1400$；$\text{POR}\le 0.60$；门面 $\text{ELOC}\ge 15$ 且零 $\le 3$ 行透传跳板 | [coding-craft](.agents/skills/coding-craft/SKILL.md) · [complexity-budget](.agents/skills/complexity-budget/SKILL.md) · [facade-discipline](.agents/skills/facade-discipline/SKILL.md) | `node scripts/common/evaluate-eloc-budget.js` · `node scripts/common/validate-code-density.js` |
| **测试、排查与基准** | 确定性时钟/RNG 隔离；两次受挫即停；零孤儿用例 | [test-benchmark-engineering](.agents/skills/test-benchmark-engineering/SKILL.md) · [debugging-and-error-recovery](.agents/skills/debugging-and-error-recovery/SKILL.md) | `cd auto-refactor && npm test` |
| **破坏性文件操作** | 递归删除禁根/家目录与变量别名派生 (`GUARD-DESTR-001`)；禁写只读自动变量 (`GUARD-VAR-001`) | [validate-destructive-ops.js](scripts/common/validate-destructive-ops.js) · [defensive-security-and-taint-safety](.agents/skills/defensive-security-and-taint-safety/SKILL.md) | `node scripts/common/validate-destructive-ops.js` |
| **单源规则目录与元治理** | SSOT 零漂移；规则 ID 双向闭包 (`RCFG-RULE-DRIFT`) | [rule-catalog.json](scripts/common/rule-catalog.json) · [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) | `node scripts/common/validate-rule-id-closure.js` |
| **文档规模数字口径** | 计数由真源渲染进 `METRICS:BEGIN/END`；裸字面量必等活真值 (`GUARD-DOC-001`) | [doc-metrics.json](scripts/common/doc-metrics.json) · [sync-doc-metrics.js](scripts/common/sync-doc-metrics.js) | `node scripts/common/sync-doc-metrics.js --check` |
| **技能集与同构治理** | 物理四件套；JIT 渐进披露；双目录 100% 字节等价 | [validate-skills.js](scripts/common/validate-skills.js) · [sync-skills.js](scripts/common/sync-skills.js) · [skill-governance](.agents/skills/skill-governance/SKILL.md) | `node scripts/common/validate-skills.js` |
| **SubAgent 泛化调度** | `inherit` 同构；独占 Path Jail；<!-- METRICS:BEGIN subagent-archetype-count -->**7 个**<!-- METRICS:END subagent-archetype-count -->原型 × 5 姿态 <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count -->预置；五源闭合 | [subagent-catalog.json](.agents/subagents/subagent-catalog.json) · [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) | `node .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js` |
| **全工作区统一审查** | <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count --> 100% 绿色；AAS v1.0 拓扑聚合报告（Token 削减 $\ge 70\%$） | [scripts/README.md](scripts/README.md) · [gate-governance](.agents/skills/gate-governance/SKILL.md) · [aas-reporter.ts](auto-refactor/src/core/reporting/aas-reporter.ts) | `pwsh -File scripts/ps1/audit-all.ps1` |
| **并行会话与工作区隔离** | 零全局破坏性还原（`restore .`/`clean -fd`）；零通配暂存（`add .`）；外部文件零触碰 | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) · [batch-commit](.agents/skills/batch-commit/SKILL.md) | `git status -s` |
| **云端预测试机与门禁分层** | 严禁越过预测试机直推远端；先过 Tier 1.5 Linux 切片；专属 Path Jail | [remote-sandbox-gate.js](scripts/common/remote-sandbox-gate.js) · [remote-sandbox-test.ps1](scripts/ps1/remote-sandbox-test.ps1) | `pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice staged` |
| **`workspace-timing/`** | 五层解耦；RingBuffer+Journal 崩溃安全；UI 100% 双语字典；`declaration: false` | [README](workspace-timing/README.md) · [workspace-timing-dev](.agents/skills/workspace-timing-dev/SKILL.md) | `cd workspace-timing && npm run test:fast` |
| **`auto-refactor/`** | <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->分析器与 <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->（SSOT <!-- METRICS:BEGIN rule-total -->**533 条规则**<!-- METRICS:END rule-total -->）；Rust/TS 100% 字节等价；热路径禁 `*Sync` I/O | [DOCS.md](auto-refactor/DOCS.md) · [auto-refactor-dev](.agents/skills/auto-refactor-dev/SKILL.md) | `cd auto-refactor && npm test` |
| **`WebGames/`** | 全域 `GameConfig` 驱动；视图零业务计算；循环零堆分配 (`ADV-PRF-002`)；先四阶段方案 | [docs/README.md](WebGames/docs/README.md) · [MOD SDK 规范](WebGames/mod_sdk/docs/SPECIFICATION.md) · [webgames-workflow](.agents/skills/webgames-workflow/SKILL.md) | `cd WebGames && pwsh scripts/ps1/audit-all.ps1` |
| **`fractal-git/`** | 10 大子系统；Type-State；零 panic；无锁 CAS (`FGT-LCK-001`)；循环零堆分配；`// SAFETY:` | [README](fractal-git/README.md) · [fractal-git-dev](.agents/skills/fractal-git-dev/SKILL.md) · [rust-engineering](.agents/skills/rust-engineering/SKILL.md) | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1` |

---
## 二、 全局刚性公理与一票否决

| 公理 | 裁定 | 真源 |
| :--- | :--- | :--- |
| **物理卫生八维** | 零空壳；`.ps1` CRLF 其余 LF；UTF-8 无 BOM；单 EOF 换行；纯空格缩进（TS 4 其余 2）；全局 `kebab-case`（WebGames 配置/脚本 `snake_case`）；后缀即领域 | [validate-physical-hygiene.js](scripts/common/validate-physical-hygiene.js) · [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **复杂度与体积密度** | $\text{CC}\le 15$（纯函数弹性 20~25）、$\text{Depth}\le 4$、$\text{Noise}\le 4.0$；$\text{ELOC}\le 900$、$\text{LOC}\le 1400$；$\tau\in[2.5,22.0]$、$\text{POR}\le 0.60$；卫语句提前返回 | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) · [validate-code-density.js](scripts/common/validate-code-density.js) |
| **智能体审查与 Token 节约** | 遵循 AAS v1.0 协议；按 L1_CONTRACT $\to$ L5_GOVERNANCE 拓扑与文件聚合，内联代码锚点；禁倒原始流水账；Token 压缩比 $\ge 70\%$ | [aas-types.ts](auto-refactor/src/core/reporting/aas-types.ts) · [aas-reporter.ts](auto-refactor/src/core/reporting/aas-reporter.ts) · [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **注释契约** | 核心模块首行六字段 JSDoc；复杂算法声明退化阈值与前置不变式；零幽灵分支、零冲刺代号、零机械复述 | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) |
| **门面实质承载** | $\text{ELOC}\ge 15$、聚合 $\ge 3$ 子领域或含不可变冻结；禁消融高内聚合法模块 | [facade-discipline](.agents/skills/facade-discipline/SKILL.md) |
| **度量求真** | 严禁倍数放大、基数注水、固定加分；外部依赖须 AST 真实追踪 | [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) |
| **规则元治理** | 规则 ID 必登记于 SSOT；跨项目规则零漂移；表现层与底层诊断去重解耦 | [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) |
| **Rust 工业级** | 零 panic、`thiserror` 强类型错误、Type-State、零瞬态堆分配、CAS 无锁、`unsafe` 最小化、Rustdoc 四要素、Clippy `-D warnings` | [rust-engineering](.agents/skills/rust-engineering/SKILL.md) |
| **SubAgent 调度** | `Model: "inherit"` 同构、五层契约注入、独占 Zero-Intersection Path Jail、`review`/`explore` 禁写、主 Agent 8 步交叉复审 | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) |
| **会话隔离与并行避让** | 独占 Path Jail 为界；严禁全局破坏还原（`restore .`/`clean -fd`）与通配暂存（`add .`）；外部改动严格零触碰、零清理、零修复；仅审计本会话变更集 | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) · [batch-commit](.agents/skills/batch-commit/SKILL.md) · [defensive-security-and-taint-safety](.agents/skills/defensive-security-and-taint-safety/SKILL.md) |
| **三级门禁与云端沙箱** | Tier 1 (本地极速) $\to$ Tier 1.5 (云端 Linux 切片/全量) $\to$ Tier 2 (CI) 逐级收紧；专属 Path Jail；保留 1 核防 OOM | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [remote-sandbox-gate.js](scripts/common/remote-sandbox-gate.js) |
| **路径与引用** | 严禁盘符、绝对路径、`file:///`；重命名须闭环 CI、SubAgent archetype、[rule-catalog.json](scripts/common/rule-catalog.json)、`docs/`、`audit-all` 五维引用 | [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **阈值与技术债** | 严禁私改 baseline、linter、门禁阈值；$\text{ELOC}_{semantic}\le 15\%$ 且无真实净消除触发 `BLOCK_GAMING_DETECTED`；债务受动态弹性限额控制 | [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) · [auto-refactor-dev](.agents/skills/auto-refactor-dev/SKILL.md) |
| **交付完整性** | 严禁 0 字节文件、占位符、未决 TODO；严禁 `--no-verify`、跳过门禁、对未跟踪文件 `git rm` | [constraint-driven-development](.agents/skills/constraint-driven-development/SKILL.md) |
| **提交诚实** | 严禁敷衍/夸大/贬损/元叙事（`CMG-STY-001`~`004`）；`[Verification]` 禁流水账；严禁书写未登记规则 ID | [batch-commit](.agents/skills/batch-commit/SKILL.md) |

---

## 三、 终端命令面契约（PowerShell ↔ GNU）

命令面由 [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1) 单源装配，禁止另立别名、垫片或本地包装。完整契约见 [linux-command-surface.md](.agents/skills/gate-governance/references/linux-command-surface.md)。

- **别名优先级**：`别名 > 函数 > cmdlet > 外部程序`。移除 `sort`/`diff`/`where`/`tee`/`sleep`/`select` 等只读别名须带 `-Force`。
- **可执行性优先**：实测 `true.exe` 哨兵，MSYS2 崩溃自动降级；`sed`/`awk`/`cut`/`tr` 不降级；`$env:LINUX_PARITY_GNU_ROOT='<path>'` 钉死语义。
- **语义映射与包装器**：`2>/dev/null` → `2>$null`；退出码取 `$LASTEXITCODE`。包装器须用 `$MyInvocation.ExpectingInput` 判管道，体内严禁 `[Parameter()]`。

---

## 四、 标准作业闭环

1. **澄清**：模糊需求先单点质询；长会话遵循 75% 预算脱水。
2. **定位与现场侦测**：精读 SSOT 与 Skill；执行 `git status -s` 探明基线，外部并行改动划定绝对避让界限；方案类改动先立细则。
3. **分流与精准施工**：单域作业收口独占文件；委派须注入 Path Jail 与自检命令；坚决不触碰并行会话文件。
4. **交叉复审与精准暂存**：① 沙箱越界审计；② 对抗性证伪；③ AAS v1.0 拓扑与密度核验；④ 显式白名单暂存（`git add <files>`，严禁 `git add .`）；⑤ 本地门禁预审。
5. **回归与交付**：`pwsh -File scripts/ps1/audit-all.ps1` 与项目全量测试 100% 绿色后方可交割；外部并行阻塞如实归因，严禁越界强修。
