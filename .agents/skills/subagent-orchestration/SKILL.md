---
name: subagent-orchestration
description: >-
  全工作区通用泛化 SubAgent 动态装配、四重防线契约注入与多智能体调度工作流。
  在用户提及 SubAgent、并行任务、委派施工、后台审查或多智能体协作时激活本技能。
  指导主 Agent 基于 (Archetype x Posture) 正交派生专员、全量同构继承模型、
  通过独占文件 Path Jail 物理防冲突、只读与写入协同流及主 Agent 交叉全量复审 SOP 安全闭环调度。
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
| **`vs-extension`** | `workspace-timing/` (VS Code 扩展) | `workspace-timing-dev` | `npm run compile && npm run test:fast && npm run review` |
| **`cli-engine`** | `auto-refactor/` (Node/Rust 双轨静态分析) | `auto-refactor-dev` | `npm run build && node scripts/gate-self.js && npm test` |
| **`game-engine`** | `WebGames/` (Godot 4 游戏引擎与配置驱动) | `webgames-workflow` | `python3.12 WebGames/scripts/py/audit_config.py --strict` |
| **`infra-tool`** | `scripts/` (全仓跨平台门禁与打包脚本) | `gate-governance` | `pwsh -File scripts/ps1/audit-all.ps1 -Fast` |
| **`workspace-meta`** | 全仓顶层元治理、单源规则总目录、物理卫生 | `rule-catalog-governance` | `node scripts/common/generate-rule-catalog.js` |
| **`skill-governance`** | `.agents/skills/`, 插件包 `skills/` | `rule-catalog-governance` | `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check` |

| 作业姿态 (`posture`) | 姿态意图与权限控制 | 核心行为准则 | 推荐工具开关 |
| :--- | :--- | :--- | :--- |
| **`explore`** | 只读探索与依赖图分析 | 严禁写文件；仅输出调用拓扑与死代码证据 | `enable_write_tools: false` |
| **`construct`** | 业务特性与增量代码生产 | 严格限制在 Path Jail 内；强制平铺控制流 (CC<=15, Depth<=4) | `enable_write_tools: true` |
| **`review`** | 静态审查与规则匹配分析 | 严禁直接改代码；对照 402 规则库输出精确行号与质性依据 | `enable_write_tools: false` |
| **`refactor`** | 结构消融与复杂度平铺 | 优先消除循环内瞬态分配；消除空包跳板；动态稀释比 <= 1:3 | `enable_write_tools: true` |
| **`guardian`** | 复合门禁防御与质量裁决 | 严禁改业务代码；执行测试与门禁并执行一票否决裁决 | `enable_write_tools: true` (限测试) |

---

## 三、 独占文件 Path Jail 物理防冲突与只读/写入协同流

多智能体协作的核心是**严格的物理隔离**与**有序的读写协同**，避免多 Agent 并发写入导致代码被踩踏或越界修改：

### 1. 独占文件集合 Path Jail 物理防冲突机制
- **显式独占授权**：向具有写权限的 SubAgent 下发任务时，主 Agent 必须在 Task Scope 中声明绝对严密的独占文件列表（Exclusive File List）：
  ```markdown
  [Task Scope & Path Jail]
  - 授权独占文件列表（严格禁止触碰其它文件）：
    1. path/to/fileA.ts
    2. path/to/fileB.ts
  ```
- **禁止交叉重叠**：并行派生多个写专员时，各 SubAgent 的 Path Jail 文件集合必须两两正交，交集必须为空集（$\text{Jail}_A \cap \text{Jail}_B = \emptyset$）；
- **系统契约硬绑定**：SubAgent 的 System Prompt Layer 1 强制注入 Path Jail Guard，越界修改任何文件将直接视为致命违规。

### 2. 只读审查与施工重构协同工作流
在大型特性演进或复杂重构中，推荐实施 **Explore/Review 先行 $\rightarrow$ Construct/Refactor 施工 $\rightarrow$ Guardian 复核** 闭环流：
1. **第一阶段：只读审查勘测 (`enable_write_tools: false`)**：
   - 调度 `review` 或 `explore` 姿态专员，物理拔除写入工具；
   - 专员全量读取 AST、跨文件引用图与 402 规则库，输出精确违规行号、调用链以及质性重构方案；
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

### 步骤 4：主 Agent 交叉全量复审 SOP (Cross-Review 8 步闭环)
SubAgent 汇报任务完成并返回消息后，主 Agent **绝对不能盲目信任其汇报文本**，必须严格独立执行 8 步交叉复审闭环：
1. **物理范围与 Path Jail 契约核验**：主 Agent 执行 `git status` 与 `git diff --name-only`，比对修改文件是否严格局限于独占 Path Jail 授权列表；严禁发生越界修改；
2. **物理卫生与排版契约审计**：检查新增与修改文件，零 0 字节文件，PowerShell 脚本严格保持 CRLF 换行，其余文件严格保持 LF 换行；
3. **AST 切片复杂度与双轨体积预审**：运行 `node scripts/common/evaluate-eloc-budget.js`，核实函数单切片 $\text{CC} \le 15, \text{Depth} \le 4, \text{Noise} \le 4.0$，单文件 $\text{ELOC} \le 900, \text{LOC} \le 1400$；
4. **代码注释与架构契约审查**：核查模块头部是否具备六字段 JSDoc，零敏捷过程黑话代号（如 `p[0-9]+`、`W1-W9`），零幽灵假逻辑分支；
5. **门面实质承载与跳板消融核验**：针对重构与导出入口，核查是否满足 $\text{ELOC} \ge 15$ 或不可变封装，彻底消融单行空包跳板；
6. **项目专属构建与全量测试回归**：主 Agent 在主会话中亲自执行领域编译与回归测试（如 `npm run build && node scripts/gate-self.js && npm test`），确保 153/153 套测试套件 100% 通过；
7. **全工作区统一审查终审**：执行 `pwsh -File scripts/ps1/audit-all.ps1 -Fast`，确认工作区五大核心子系统基石得分 100% 绿色通行；
8. **零高危技术债与防反弹核验**：确认改动未引入任何新的 High/Critical 技术债务，全仓技术债务保持 0 项历史刚性基线（一票否决）。

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
