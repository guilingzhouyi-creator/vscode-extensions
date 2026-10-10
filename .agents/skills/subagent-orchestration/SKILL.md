---
name: subagent-orchestration
description: >-
  全工作区通用泛化 SubAgent 动态装配、四重防线契约注入与多智能体调度工作流。
  在用户提及 SubAgent、并行任务、委派施工、后台审查或多智能体协作时激活本技能。
  指导主 Agent 基于 (Archetype x Posture) 正交派生专员、全量同构继承模型、
  独占 Zero-Intersection Path Jail 物理防冲突机制、只读与写入协同流及主 Agent 8 步交叉复审闭环 SOP。
---

# subagent-orchestration — 全工作区泛化 SubAgent 调度规范

> **架构地位**：本规范指导 Agent 在当前及未来全新会话中，基于工作区 `.agents/subagents/` 配置库动态装配并调度符合工作区治理契约的专属 SubAgent，杜绝提示词硬编码、模型滥用与越界施工冲突。
> **文档边界特别声明**：`docs/` 下的各类架构蓝图是 Praxis 团队的历史随笔与参考文档；本工作区的实际工程刚性依据唯一收口于 [`AGENTS.md`](../../../AGENTS.md) 与本规范。

---

## 一、 四重防线约束机制 (Four-Layer Defense Architecture)

在 VS Code Antigravity (Agy) 体系中，约束**绝不仅是一段普通的提示词**，而是层层递进的四重立体防御：

```text
┌────────────────────────────────────────────────────────┐
│ 防线 1: Agy 平台级工作区规则 (Workspace Rule Injection) │
│ • AGENTS.md 自动由 Agy 内核无条件注入到所有 Agent/SubAgent│
│ • 刚性确立 SUB-AGENT 约束与 12 项一票否决红线          │
├────────────────────────────────────────────────────────┤
│ 防线 2: Runtime 工具链物理门控 (Tool Gating)           │
│ • 审查 (review) / 探索 (explore) 姿态物理关闭写工具    │
│ • enable_write_tools: false 彻底拔除写入/改写工具      │
│ • 锁定 enable_subagent_tools: false 防递归泛滥         │
├────────────────────────────────────────────────────────┤
│ 防线 3: 系统级长效身份契约 (define_subagent.system_prompt)│
│ • 注入 5-Layer System Contract                         │
│ • Path Jail 物理禁区、领域专属公理、交割强制自检命令   │
├────────────────────────────────────────────────────────┤
│ 防线 4: 结构化单次任务外壳与模型同构 (Task Defense Shell & Model Lock) │
│ • Task Scope 明确范围、质量清单、本地验证命令         │
│ • Model: "inherit" 同构继承主会话 (Gemini 3.8 Flash, effort=High) │
└────────────────────────────────────────────────────────┘
```

---

## 二、 核心正交派生模型 (Archetype × Posture)

任何子任务的 SubAgent 均由**领域原型**与**作业姿态**正交计算派生，**默认采用 `inherit` 同构继承主会话模型（当前为 Gemini 3.8 Flash，思考强度 effort=High）**，兼顾深度推理精度与轻量成本：

| 领域原型 (`archetype`) | 适用项目与物理沙箱 (Path Jail) | 关联 SSOT 技能 | 典型本地门禁验证命令 |
| :--- | :--- | :--- | :--- |
| **`vs-extension`** | `workspace-timing/` (VS Code 扩展) | `workspace-timing-dev`, `complexity-budget` | `npm run compile && npm run test:fast && npm run review` |
| **`cli-engine`** | `auto-refactor/` (Node/Rust 双轨静态分析) | `auto-refactor-dev`, `facade-discipline` | `npm run build && node scripts/gate-self.js && npm test` |
| **`game-engine`** | `WebGames/` (Godot 4 游戏引擎与配置驱动) | `webgames-workflow`, `complexity-budget` | `python scripts/py/audit_config.py --strict && pwsh scripts/ps1/audit-all.ps1` |
| **`infra-tool`** | `scripts/` (全仓跨平台门禁与打包脚本) | `gate-governance`, `release-package-workflow` | `pwsh -File scripts/ps1/audit-all.ps1 -Fast` |
| **`workspace-meta`** | 全仓顶层元治理、单源规则总目录、物理卫生 | `rule-catalog-governance`, `complexity-budget` | `node scripts/common/generate-rule-catalog.js` |
| **`skill-governance`** | `.agents/skills/`, 插件包 `skills/` | `skill-governance`, `rule-catalog-governance` | `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check` |

| 作业姿态 (`posture`) | 姿态意图与权限控制 | 核心行为准则 | 推荐工具开关 |
| :--- | :--- | :--- | :--- |
| **`explore`** | 只读探索与依赖图分析 | 严禁写文件；仅输出调用拓扑与死代码证据 | `enable_write_tools: false` |
| **`construct`** | 业务特性与增量代码生产 | 严格限制在 Path Jail 内；强制平铺控制流 (CC<=15, Depth<=4) | `enable_write_tools: true` |
| **`review`** | 静态审查与规则匹配分析 | 严禁直接改代码；对照 410 规则库输出精确行号与质性依据 | `enable_write_tools: false` |
| **`refactor`** | 结构消融与复杂度平铺 | 优先消除循环内瞬态分配；消除空包跳板；动态稀释比 <= 1:3 | `enable_write_tools: true` |
| **`guardian`** | 复合门禁防御与质量裁决 | 严禁改业务代码；执行测试与门禁并执行一票否决裁决 | `enable_write_tools: true` (限测试) |

---

## 三、 独占 Zero-Intersection Path Jail 物理防冲突机制与只读/写入协同流

多智能体协作的核心是**严格的物理隔离**与**有序的读写协同**，避免多 Agent 并发写入导致代码被踩踏或越界修改：

### 1. 独占 Zero-Intersection Path Jail 物理防冲突机制
- **显式独占授权**：向具有写权限的 SubAgent 下发任务时，主 Agent 必须在 Task Scope 中声明绝对严密、颗粒度到具体文件路径的独占文件列表（Exclusive File List）：
  ```markdown
  [Task Scope & Zero-Intersection Path Jail]
  - 授权独占文件列表（严格两两互斥，禁止触碰任何其它文件）：
    1. path/to/fileA.ts
    2. path/to/fileB.ts
  - 严禁触碰路径前缀（越界操作立即阻断）：
    - auto-refactor/
    - workspace-timing/
    - WebGames/
    - scripts/
  ```
- **两两完全正交公理 ($\text{Jail}_A \cap \text{Jail}_B = \emptyset$)**：
  并行派发多个写专员时，各 SubAgent 的 Path Jail 文件集合必须两两正交，交集必须严格为空集：
  $$\forall i \ne j, \quad \text{Jail}_i \cap \text{Jail}_j = \emptyset$$
  严禁任何重叠文件授权或模糊目录宽泛授权，从根源消除并发写入踩踏与代码冲突；
- **系统契约刚性硬绑定**：SubAgent 的 System Prompt Layer 1 强制注入 Path Jail Guard，越界修改任何非授权文件将触发一票阻断，主 Agent 在复审阶段执行强制回滚。

### 2. 只读审查与施工重构协同工作流
在大型特性演进或复杂重构中，推荐实施 **Explore/Review 先行 $\rightarrow$ Construct/Refactor 施工 $\rightarrow$ Guardian 复核** 闭环流：
1. **第一阶段：只读审查勘测 (`enable_write_tools: false`)**：
   - 调度 `review` 或 `explore` 姿态专员，物理拔除写入工具；
   - 专员全量读取 AST、跨文件引用图与 410 规则库，输出精确违规行号、调用链以及质性重构方案；
2. **第二阶段：定点施工重构 (`enable_write_tools: true`)**：
   - 调度 `construct` 或 `refactor` 姿态专员，赋予独占文件列表的写权限；
   - 专员严格按第一阶段输出的方案在 Path Jail 范围内实施小步改动，禁止蔓延扩写；
3. **第三阶段：门禁自检与证据交割**：
   - 施工专员在自身沙箱执行对应的 Layer 4 门禁自检命令，产出执行通过的日志证据后汇报主 Agent。

---

## 四、 标准调度流水线与主 Agent 交叉复审 SOP

### 步骤 1：JIT 合成 SubAgent 契约元数据
在终端运行工作区装配脚本获取完整的结构化参数：
```bash
# 模式 A: 自然语言意图自动推导 (推荐)
node .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js --intent "审查 WebGames 的配置" --task "核查 GameConfig 单源规范" --json

# 模式 B: 精确预置别名装配
node .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js --preset wt-refactor --task "优化时钟调度" --json

# 模式 C: 全仓专员批量导出
node .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js --all
```

常用预置别名速查矩阵（23 个预置）：
* **`vs-extension`**：`wt-construct` / `wt-review` / `wt-refactor` / `wt-explore`
* **`cli-engine`**：`ar-construct` / `ar-review` / `ar-refactor` / `ar-explore`
* **`game-engine`**：`wg-construct` / `wg-review` / `wg-refactor` / `wg-explore`
* **`infra-tool`**：`infra-construct` / `infra-review` / `infra-refactor` / `infra-explore` / `infra-guardian`
* **`workspace-meta`**：`workspace-review` / `workspace-refactor` / `workspace-guardian`
* **`skill-governance`**：`skill-construct` / `skill-review` / `skill-refactor`

### 步骤 2：注册定义动态 SubAgent (`define_subagent`)
使用脚本输出的 `defineArgs` 调用 `define_subagent` 工具：
```typescript
define_subagent({
  name: result.defineArgs.name,
  description: result.defineArgs.description,
  system_prompt: result.defineArgs.system_prompt,
  enable_write_tools: result.defineArgs.enable_write_tools,
  enable_mcp_tools: false,
  enable_subagent_tools: false
});
```

### 步骤 3：启动隔离运行 (`invoke_subagent`)
调用 `invoke_subagent` 委派具体任务。**必须指定 `Model: 'inherit'` 继承主会话配置**，并传入装配好的结构化任务 Prompt：
```typescript
invoke_subagent({
  Subagents: [{
    TypeName: result.subagentName,
    Role: result.displayName,
    Model: "inherit",                // 严格同构继承主会话 (Gemini 3.8 Flash, effort=High)
    Workspace: "inherit",            // 或在并行写入时指定 "branch"
    Prompt: result.invokeArgs.Prompt // 结构化任务外壳
  }]
});
```

### 步骤 4：主 Agent 8 步交叉复审闭环 SOP (Cross-Review Closed-Loop)
SubAgent 汇报任务完成并返回消息后，主 Agent **绝对不能盲目信任其汇报文本**，必须严格独立执行 8 步交叉复审闭环（依据所属领域自适应路由）：
1. **① 沙箱隔离审计 (Path Jail Guard Audit)**：主 Agent 执行 `git status` 与 `git diff --name-only`，比对修改文件是否严格局限于独占 Path Jail 授权列表，严禁发生跨领域越界修改；
2. **② 领域编译构建自检 (Domain Build & Compile Gate)**：在受影响项目子目录执行类型与编译检查（`workspace-timing`: `npm run compile`; `auto-refactor`: `npm run build`; `WebGames`: `python scripts/py/audit_config.py --strict`；`scripts/`: 平台语法检查），确保 0 编译错误，0 类型告警；
3. **③ 体积与复杂度双轨预算 (Complexity & Volume Budget Gate)**：执行 `node scripts/common/evaluate-eloc-budget.js`，核查单文件双轨体积（$\text{ELOC} \le 900 / \text{LOC} \le 1400$）、AST 切片守卫（$\text{CC} \le 15, \text{Depth} \le 4, \text{Noise} \le 4.0$）、1:3 动态包络及高负荷注释密度 $\ge 8\%$；
4. **④ 单源规则目录与防虚构校验 (Rule Catalog Anti-Drift Gate)**：执行 `node scripts/common/generate-rule-catalog.js`，核实 410 条规则目录计数零漂移，任何汇报与提交说明零虚构规则 ID（`RCFG-RULE-DRIFT`）；
5. **⑤ 领域专属架构守卫 (Domain Specialized Architectural Guard)**：
   - `auto-refactor`：执行 `node auto-refactor/scripts/validate-facade-governance.js`（消融空包跳板 `ARCH-ABS-001`）与 `node auto-refactor/scripts/validate-project-neutrality.js`（项目中立性）；
   - `workspace-timing`：执行 `cd workspace-timing && npm run review`（五层解耦与双语字典覆盖）；
   - `WebGames`：执行 `cd WebGames && python scripts/py/audit_runner.py`（配置驱动与循环零瞬态堆分配 `ADV-PRF-002`）；
   - `infra-tool`：执行 `pwsh -File scripts/ps1/pre-commit-gate.ps1`；
   - `skill-governance`：执行 `node scripts/common/validate-skills.js` 与 `node scripts/common/sync-skills.js --check`；
6. **⑥ 自审棘轮基线防反弹 (Monotonic Ratchet Baseline & Zero-High-Debt Gate)**：
   - 若涉及 `auto-refactor`，执行 `node auto-refactor/scripts/gate-self.js`，确保 `0 newBlocking error`，全仓历史基线单调收敛；
   - 全仓刚性看守：严禁引入任何 High/Critical 技术债务反弹，历史性清零（0 项）红线一票否决；
7. **⑦ 受影响领域自动化回归测试 (Domain Test Suite Regression)**：
   - `auto-refactor`：`cd auto-refactor && npm test`（153/153 套测试并发绿色通过，TS/Rust 100% 字节等价）；
   - `workspace-timing`：`cd workspace-timing && npm run test:fast`（145 用例绿色通过）；
   - `WebGames`：`cd WebGames && pwsh scripts/ps1/audit-all.ps1`；
8. **⑧ 工作区五大支柱统一审查 (Workspace Five-Pillar Unified Audit)**：执行 `pwsh -File scripts/ps1/audit-all.ps1 -Fast`，全工作区五大基石（架构、质量、门禁、类型、卫生）综合评分必须 $\ge 98$ 分，全绿通行。

---

## 五、 防冲突与质量保障铁律

1. **同构模型继承纪律**：工作区委派 SubAgent 必须严格指定 `Model: "inherit"` 继承主会话（当前主会话为 Gemini 3.8 Flash，思考强度 effort=High），完整保留深度推理能力同时锁定 Flash 算力成本，严禁擅自切换未受控模型；
2. **物理沙箱禁越界**：SubAgent 提示词中已注入 Path Jail 严禁列表。SubAgent 若修改越界目录文件，主 Agent 必须在合入时予以拦截或还原；
3. **完成自检交割**：任何具有写权限的 SubAgent，在向主 Agent 汇报前必须在其自身提示词 Layer 4 的验证命令下完成全量自检并附带真实执行通过证据；
4. **单源一致性守护**：修改配置或扩展原型时，随时运行：
   ```bash
   node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js
   ```
   确保 100% 通过验证。

---

## 六、 渐进披露参考指南与实操样板 (References & Templates)

为遵循 JIT 渐进披露原则并降低 Agent 顶层上下文负荷，深水区设计理论与开箱即用骨架已全面收口下沉至子目录：

### 1. 技术参考指南 (`references/`)
- [四重防线立体防御机制](references/four-layer-defense-architecture.md)：平台工具剥夺、沙箱约束、系统契约与交叉复审的分层设计；
- [独占 Zero-Intersection Path Jail 机制](references/zero-intersection-path-jail.md)：数学正交公理、路径粒度规范与跨项目并行隔离模式；
- [主 Agent 8 步交叉复审协议](references/cross-review-closed-loop-protocol.md)：领域自适应路由矩阵与历史债务单调收敛原则。

### 2. 开箱即用实操样板 (`templates/`)
- [施工类独占文件任务外壳](templates/task-shell-construct.md)：增量生产与定点重构的标准任务 Prompt 外壳；
- [审查类只读客观事实任务外壳](templates/task-shell-review.md)：静态审查与规则匹配的只读任务 Prompt 外壳；
- [新增领域原型配置脚手架](templates/archetype-scaffold.json)：新增业务领域原型时的标准 JSON 模式模板；
- [新增作业姿态配置脚手架](templates/posture-scaffold.json)：新增作业姿态时的标准 JSON 模式模板。
