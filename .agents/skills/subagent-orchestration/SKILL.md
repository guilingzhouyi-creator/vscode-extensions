---
name: subagent-orchestration
description: >-
  【触发：subagent/派发任务/多agent协同/并发开发/隔离边界/上下文预算/交叉复审】派发或编排 SubAgent、处理五层上下文预算治理(75% 脱水)时必须使用。强制同构模型、独占 Zero-Intersection Path Jail 物理防冲突与交叉复审。
---

# subagent-orchestration — 五层上下文治理与泛化 SubAgent 调度规范

本技能将**五层上下文分级与 75% 预算防衰减治理**与**全工作区 (Archetype × Posture) 泛化 SubAgent 动态装配、独占 Path Jail 防冲突及主 Agent 8 步交叉复审闭环**统一收口。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | 技能与规则元治理（领域支援）；工作区元治理与并行交付（领域支援） |
| **前置** | —（作为领域入口，无前置） |
| **接续** | —（链路末端，交回提交与验收） |
| **并行支援** | [coding-craft](../coding-craft/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md)、[batch-commit](../batch-commit/SKILL.md) |
| **领域链** | 技能与规则元治理：skill-governance → rule-catalog-governance → docs-archive-governance → batch-commit；其余领域链见 `docs/skill-catalog.md` |

**何时联动**：新增技能或改技能描述 → `skill-governance` + `docs-archive-governance` + `batch-commit`；新增规则标识并闭合登记 → `rule-catalog-governance` + `skill-governance` + `gate-governance`
<!-- SKILL-LINKS:END -->

## 一、 五层上下文分级架构与四重立体防线

1. **五层上下文分级与 75% 阈值脱水预算**：
   - 按持久度从高到低分为：**L1 全局公理 (`AGENTS.md`) $\to$ L2 规格说明 (`SPEC.md` 按需章节) $\to$ L3 目标源码与局部 AST 切片 $\to$ L4 关键错误栈前 5 行 $\to$ L5 会话历史**；
   - **75% 预警脱水**：上下文达 75% 容量时主动淘汰无效试错过程与冗长控制台流水账，仅保留【原始目标、根因结论、刚性红线】；将刚性总规置于开头（Primacy）、当前原子任务与自检命令置于末尾（Recency），规避中间迷失效应（Lost-in-the-Middle）。
2. **微分 Token 注入与职责解耦 (消融 3x 机械复述)**：
   - **System Contract (5 层系统契约)**：收口工作区全局公理、沙箱前缀、领域技术栈公理、专员姿态限定与 Layer 4 自检闭环，作为不可动摇的刚性底座；
   - **Task Shell (高 SNR 增量任务外壳)**：彻底剔除重复的 7 项通用指标复述与命令列表，仅注入【独占文件列表 (Zero-Intersection Path Jail) $\to$ 核心技术目标 $\to$ 交付前 Layer 4 自检指令】，单次启动净省 ~34% Token，杜绝 Prompt 膨胀与注意力稀释。
3. **SubAgent 四重立体防御**：
   - **防线 1（平台级规则注入）**：`AGENTS.md` 无条件注入所有主/子 Agent；
   - **防线 2（Runtime 工具物理门控）**：`review` / `explore` 姿态强制 `enable_write_tools: false` 物理拔除写权限，且锁定 `enable_subagent_tools: false`；
   - **防线 3（5 层系统契约 `system_prompt`）**：由 `synthesize-subagent.js` 动态注入全局公理、六大规范性思维约束、Path Jail、领域公理与验证命令；
   - **防线 4（任务外壳与同构模型锁定）**：强制 `Model: "inherit"` 同构继承主会话模型，并在任务完成后执行主 Agent 8 步独立交叉复审。

---

## 二、 核心正交派生矩阵 (Archetype × Posture)

<!-- METRICS:BEGIN subagent-archetype-count -->**7 个**<!-- METRICS:END subagent-archetype-count -->领域原型 × 5 种作业姿态正交派生 <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count -->预置专员（单源真源为 `.agents/subagents/agents/*.md`，由 `sync-agents-mirror.js` 单向镜像至插件包；DSH 四模式 `wg-{construct,refactor,review,explore}` 见 [.agents/dsh/README.md](../../dsh/README.md)）：

| 领域原型 (`archetype`) | 物理沙箱 (Path Jail) | 预置专员 (`presets`) | 核心本地验证命令 |
| :--- | :--- | :--- | :--- |
| **`vs-extension`** | `workspace-timing/` | `wt-construct`, `wt-review`, `wt-refactor`, `wt-explore` | `cd workspace-timing && npm run compile && npm run test:fast && npm run review` |
| **`cli-engine`** | `auto-refactor/` | `ar-construct`, `ar-review`, `ar-refactor`, `ar-explore` | `cd auto-refactor && npm run build && node scripts/gate-self.js && npm test` |
| **`game-engine`** | `WebGames/` | `wg-construct`, `wg-review`, `wg-refactor`, `wg-explore` | `cd WebGames && python scripts/py/audit_config.py --strict && pwsh scripts/ps1/audit-all.ps1` |
| **`git-kernel`** | `fractal-git/` | `fg-construct`, `fg-review`, `fg-refactor`, `fg-explore` | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1 && cargo test --workspace --manifest-path fractal-git/Cargo.toml` |
| **`infra-tool`** | `scripts/` | `infra-construct`, `infra-review`, `infra-refactor`, `infra-explore`, `infra-guardian` | `pwsh -File scripts/ps1/pre-commit-gate.ps1 && pwsh -File scripts/ps1/audit-all.ps1 -Fast` |
| **`workspace-meta`** | 全仓顶层元治理 | `workspace-review`, `workspace-refactor`, `workspace-guardian` | `node scripts/common/generate-rule-catalog.js --check-only` |
| **`skill-governance`** | `.agents/skills/` | `skill-construct`, `skill-review`, `skill-refactor` | `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check` |

---

## 三、 独占 Zero-Intersection Path Jail、可重入检查点与焦点防抢占

1. **两两完全正交公理 ($\forall i \ne j,\ \text{Jail}_i \cap \text{Jail}_j = \emptyset$)**：并行派发多个写入专员（`construct`/`refactor`）时，必须在 Task Scope 中列出精确到具名文件的独占列表，严禁整目录宽泛授权或重叠文件授权；跨顶级项目并行时可使用 `Workspace: "branch"`；
2. **读写协同与可重入章节检查点 (`mark_chapter`)**：复杂任务遵循 `Explore/Review 只读勘测 -> Construct/Refactor 定点施工 -> Guardian 复核`；长程跨层任务必须在关键拓扑节点输出章节检查点（已完成文件基线、已通过自检断言、下一原子任务契约），支持随时无损交接或单章回滚；
3. **后台 Agent 焦点防抢占守卫**：后台或只读 SubAgent 严禁弹出系统模态框、强制激活窗口或滥用 `element.focus()` 抢夺人类前台光标；
4. **多会话与外部并行感知公理 (Session Isolation & Parallel Mutex)**：运行中的会话必须识别共享工作树下的外部并行会话活动；当 `git status` 中检测到不属于本任务的文件变动时，严格保持零触碰、零清理、零顺带修复，严禁运行全局破坏性还原命令（`git restore .`、`git clean -fd`），并坚持显式白名单暂存。

---

## 四、 JIT 动态装配命令与主 Agent 8 步交叉复审 SOP

```bash
# 1. 动态合成 SubAgent 契约与任务外壳
node .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js --preset fg-construct --files "fractal-git/crates/fg-index/src/lib.rs" --task "优化无锁索引" --json

# 2. 校验全仓 SubAgent 目录、原型、姿态与单源模板 1:1 合规
node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js
```

SubAgent 返回后，主 Agent **严禁盲信其文字汇报**，必须独立执行 **8 步交叉复审**：
① **沙箱越界审计**（`git status` / `git diff --name-only` 比对独占列表）$\to$ ② **领域编译自检** $\to$ ③ **体积与复杂度预算**（`evaluate-eloc-budget.js` / `validate-code-density.js`）$\to$ ④ **规则目录零漂移**（`validate-rule-id-closure.js`）$\to$ ⑤ **领域专属架构守卫** $\to$ ⑥ **自审棘轮与零 High/Critical 债务防反弹** $\to$ ⑦ **领域回归测试**（`auto-refactor` <!-- METRICS:BEGIN test-suite-count -->**179 套**<!-- METRICS:END test-suite-count -->、`workspace-timing` <!-- METRICS:BEGIN ws-test-case-count -->**205 项**<!-- METRICS:END ws-test-case-count -->）$\to$ ⑧ **全仓 <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count -->统一审查**（`audit-all.ps1 -Fast`）。

---

## 五、 关联参考与模板资产

- [cross-review-closed-loop-protocol.md](references/cross-review-closed-loop-protocol.md)：四重防线、五层上下文信任分级、Path Jail 正交公理与 8 步交叉复审领域路由全表；
- [task-shell-construct.md](templates/task-shell-construct.md)：施工/只读审查双态任务外壳与可重入会话交接检查点样板；
- [archetype-scaffold.json](templates/archetype-scaffold.json)：领域原型与作业姿态 JSON 配置脚手架。
