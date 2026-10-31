---
name: skill-governance
description: >-
  【触发：编写技能/新增skill/技能治理/同构同步/双目录同步/四件套/JIT披露】创建、修改技能、维护四件套结构(SKILL/references/templates/scripts)或同步双目录字节等价时触发。贯彻 JIT 渐进披露与 50~200 字描述契约。
---

# skill-governance — 技能集工程化结构与生命周期治理规范

本技能确立了全工作区 <!-- METRICS:BEGIN skill-count -->**24 项**<!-- METRICS:END skill-count -->研发技能集（Skills）的标准物理架构、YAML 元数据契约、JIT 渐进式披露（Progressive Disclosure）与防 Token 膨胀原则、根目录与插件包双副本 100% 字节等价同步机制以及自动化校验门禁标准。这些技能共含 <!-- METRICS:BEGIN skill-doc-count -->**63 篇**<!-- METRICS:END skill-doc-count -->技能文档，全部纳入同一份门禁检查。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [rule-catalog-governance](../rule-catalog-governance/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`batch-commit`。
- **领域**：技能与规则元治理（领域入口）
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`
- **何时联动**：新增技能或改技能描述 → `skill-governance` + `docs-archive-governance` + `batch-commit`；新增规则标识并闭合登记 → `rule-catalog-governance` + `skill-governance` + `gate-governance`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新建或扩充工作区技能**：为新领域或新子系统定义专属研发技能；
2. **更新或修正现有技能内容**：对齐工作区规则总规、消除过时术语或更新规范指标；
3. **维护技能模板或参考指南**：在 `references/` 或 `templates/` 下增加深入指南或代码脚手架；
4. **执行技能集双目录同步**：在修改根目录 `.agents/skills/` 后，同步更新至 `.agents/plugins/workspace-governance/skills/`；
5. **排查技能门禁拦截**：定位与修复 `validate-skills.js` 或暂存区门禁报错。

---

## 二、 三层泛化技能拓扑与标准物理架构（Generalization + Unification）

为同时实现**跨领域高度泛化复用**与**全工作区刚性契约单源统一**，<!-- METRICS:BEGIN skill-count -->**24 项**<!-- METRICS:END skill-count -->研发技能按职责解耦为三层正交拓扑（严禁在领域技能中重复抄写通用方法论，彻底杜绝 Token 堆积与多处统计数字硬编码漂移）：

| 拓扑层级 | 技能数量与定位 | 包含技能集 | 泛化与统一机制 |
| :--- | :--- | :--- | :--- |
| **Layer 1: 通用工程与算法突破层**<br/>*(Universal Methodology)* | **11 项** — 跨语言、跨项目通用认知、编程工艺、交互物理学与算子原语 | `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`, `defensive-security-and-taint-safety`, `facade-discipline`, `interaction-design-physics`, `spec-driven-development`, `state-concurrency-and-crash-recovery`, `telemetry-statistical-modeling` | 仅定义恒定不变的工程/数学/算法公理；通过映射表桥接不同语言栈，零项目特定硬编码 |
| **Layer 2: 工作区统一治理底座层**<br/>*(Workspace Unified Governance)* | **8 项** — 全仓同构门禁、单源目录与多智能体协同 | `batch-commit`, `docs-archive-governance`, `gate-governance`, `release-package-workflow`, `rule-catalog-governance`, `skill-governance`, `subagent-orchestration`, `test-benchmark-engineering` | 唯一绑定 `AGENTS.md`、`rule-catalog.json` 与 `subagent-catalog.json` 动态真源 (SSOT) |
| **Layer 3: 子项目领域适配器层**<br/>*(Domain Adapters)* | **5 项** — 四大受控项目专属架构红线与系统工程规范 | `auto-refactor-dev` (Node/Rust), `workspace-timing-dev` (VS Code), `webgames-workflow` (Godot 4.7 GDScript), `fractal-git-dev` (Taxis 10 大内核子系统), `rust-engineering` (Rust 系统工程规范) | 声明子项目与技术栈专有拓扑、生命周期与领域边界，通用复杂度/算子/门面能力通过指针委托至 Layer 1/2 |

每个技能必须作为一个高内聚的自包含工程单元存在，位于 `.agents/skills/<skill-name>/` 下，标准“四件套”目录结构如下：

```text
.agents/skills/<skill-name>/
├── SKILL.md                 # [必选] 技能唯一顶层入口与快速决策中枢 (建议 50~250 行，上限 <= 300 行)
├── references/              # [推荐] 深水区技术实现指南、数学模型与详细背景 (按需查阅)
│   └── *.md
├── templates/               # [推荐] 开箱即用的标准化样板代码、配置文件或测试骨架
│   └── *.{ts,js,gd,json,md}
└── scripts/                 # [可选] 伴生自动化校验工具或 JIT 辅助脚本
    └── *.js
```

---

## 三、 JIT 渐进式披露与防 Token 堆积原则 (JIT Progressive Disclosure)

为严防上下文填充过度（Context Bloat）并提升 Agent 的决策信噪比，技能编写必须遵守以下纪律：

1. **`SKILL.md` 紧凑高信噪比与反注水铁律**：
   - 推荐长度控制在 **50 ~ 250 行**（硬上限 $\le 300$ 行）；
   - **严禁为凑行数注水**：简明方法论技能保持 60~100 行高密度表达即可，严禁堆积冗余形容词、重复示例或大段背景散文消耗上下文 Token；
   - 聚焦：适用场景、核心公理矩阵、关键架构约束、常用验证命令及关联文件指针。
2. **深水区下沉至 `references/`**：
   - 将复杂数学证明、接口完整定义、算法边界或深度协议规范下沉为 `references/` 下的独立 Markdown 文档；
   - 在 `SKILL.md` 尾部通过相对链接提供“按需加载（JIT）”指针，未触及深水区子任务时无需加载。
3. **实操脚手架收口至 `templates/`**：
   - 将标准类定义、测试用例骨架、JSON 配置样板独立放置在 `templates/` 中；
   - 模板代码本身必须严格遵守圈复杂度 $\text{CC} \le 15$、嵌套深度 $\text{Depth} \le 4$ 及模块头六字段 JSDoc 规范。

---

## 四、 YAML Frontmatter 与单源注册表契约

每份 `SKILL.md` 的 frontmatter 与联动块都由 `scripts/common/skill-registry.json` 渲染，注册表是唯一真源，手改会在下一次同步被覆盖：

```markdown
---
name: <skill-name>
description: >-
  【触发：<triggers 用 / 连接>】<pitch 一句调用含义>
---
```

**刚性字段要求**：
- **`name`**：必须与该技能所在的文件夹名称（`kebab-case`）100% 严格一致；
- **`description`**：由注册表 `activation.template` 渲染，命中 50~200 字符窗口；前缀给触发词向量，`pitch` 回答“何时必须用、看守什么”，禁止写成技能名复述或正文摘要；
- **触发词**：6~9 个，跨技能复用不超过 3 次，必须覆盖意图、症状、技术标识中至少两类，否则索引面无法区分同类技能；
- **联动块**：正文 `## 联动技能` 由 `SKILL-LINKS:BEGIN/END` 标记包围，声明定位、前置、接续、并行支援与领域链，同样禁止手改；
- **新增技能**：必须先登记注册表，否则渲染循环不会为它生成描述与联动，激活面永远缺失。

---

## 五、 全局质量契约与排版纪律

所有技能文档与伴生资源均受工作区全局刚性公理管束：
1. **严格换行符**：Markdown（`.md`）、JSON（`.json`）、TypeScript/JavaScript（`.ts`/`.js`）及 Bash（`.sh`）磁盘文件必须严格保持 **LF 换行**；严禁写入 CRLF；
2. **零空文件**：严禁创建或保留 0 字节物理空文件或纯空白字符文件（`HYG-EMP-001`）；
3. **单源规则反虚构 (`RCFG-RULE-DRIFT`)**：技能正文中提及的所有大写规则 ID（如 `ARCH-FAC-001`、`ADV-PRF-002`、`GUARD-AST-001`）必须在 `scripts/common/rule-catalog.json` 中真实登记；
4. **相对链接卫生 (`DOC-LNK-001` / `HC-ABS-PATH`)**：所有超链接必须为有效的相对路径，严禁使用 Windows 盘符绝对路径或 `file:///` URI；目标物理文件必须真实存在；
5. **零黑话与零敏捷代号**：严禁使用 `Phase_{NN}`、`ST{NN}`、`p[0-9]+` 等敏捷施工临时代号，一律采用客观技术主题命名；
6. **单文件双轨体积与契约注释密度**：技能模板与伴生代码文件同样受 $\text{ELOC} \le 900, \text{LOC} \le 1400$ 双轨体积红线与 1:3 动态反推包络约束；高负荷代码（$\text{ELOC} \ge 600$）契约注释密度必须达到 8% 及以上；
7. **全仓零高危技术债务与防反弹红线**：全工作区 High/Critical 技术债务历史性归零（0 项），技能演进与重构坚决捍卫 0 项基线，严禁引入任何高危债务反弹。

---

## 六、 双目录单源同构与自动同步机制

工作区技能体系实行**根目录为单源真源 (SSOT)，插件包同构镜像**的架构：
- **真源目录**：`.agents/skills/`
- **分发镜像**：`.agents/plugins/workspace-governance/skills/`

**同步与防护流程**：
1. **编辑单源**：所有增删改查操作必须且仅需在 `.agents/skills/` 中实施；
2. **一键同步**：完成编辑后运行：
   ```bash
   node scripts/common/sync-skills.js
   ```
   自动将根目录技能树增量镜像至插件包，清理多余孤儿文件并保证 100% 字节等价；
3. **门禁看守**：本地预提交门禁与全仓审计中枢通过 `validate-skills.js` 持续比对两处副本，一旦检出漂移立即熔断阻断提交。

---

## 七、 常用维护与验证命令矩阵

```bash
# 1. 按注册表重渲染每份 SKILL.md 的描述行与联动块（--check 只比对不写盘）
node scripts/common/sync-skill-metadata.js

# 2. 重渲染面向读者的技能调用说明书 docs/skill-catalog.md
node scripts/common/render-skill-catalog.js

# 3. 将根目录技能变更一键同步至插件包镜像（--check 静默比对字节等价）
node scripts/common/sync-skills.js

# 4. 验证技能 YAML、排版卫生、相对链接、注册表闭合与规则真实性
node scripts/common/validate-skills.js

# 5. 执行包含技能验证的全工作区统一质量审查
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```

---

## 八、 参考资源与建站骨架

新建技能时直接从骨架起步，避免遗漏 Frontmatter、章节骨架与资源指针：

| 资源 | 用途 |
| :--- | :--- |
| [progressive-disclosure-patterns.md](references/progressive-disclosure-patterns.md) | 分层披露的完整设计准则：何时把内容下沉至 `references/`、何时抽 `templates/`、入口文件的信噪比预算推导 |
| [skill-activation-and-linkage.md](references/skill-activation-and-linkage.md) | 激活面与联动面运维参考：Agent 为何只看得见 description、触发词正反例、前置/接续/并行支援的语义、字段改动波及哪些文件、三道看守各自看守什么 |
| [docs/skill-catalog.md](../../../docs/skill-catalog.md) | 由注册表渲染的技能调用说明书：三层拓扑、领域联动链与逐技能调用卡片（调用含义、典型情形、验证命令） |
| [skill-entrypoint-skeleton.md](templates/skill-entrypoint-skeleton.md) | `SKILL.md` 入口骨架：Frontmatter、适用场景、公理矩阵、验证命令与资源指针五段式 |
| [skill-reference-skeleton.md](templates/skill-reference-skeleton.md) | `references/*.md` 骨架：前置不变式、操作步骤、反例与失败模式 |

> [!WARNING]
> `references/` 与 `templates/` 下每个物理资产都必须被本技能的至少一篇 Markdown 以相对链接引用。`validate-skills.js` 会以孤儿资产判据阻断，骨架文件同样不豁免。
