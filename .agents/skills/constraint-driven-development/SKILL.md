---
name: constraint-driven-development
description: >-
  【触发：交割/验收/证伪/Doubt/阈值下调/测试弱化/半成品】完成特性交付、声称修复完成或合入前对抗性证伪时必须触发。落实 Floor Guard 刚性底线与单调棘轮，主动推翻边界假设与脆弱实现。
---

# constraint-driven-development — 刚性底线守卫、质量棘轮与对抗性证伪规范

本技能将编码前的**约束驱动底线守卫（Floor Guard & Ratchet Principle）**与编码完成后的**五步怀疑驱动对抗性证伪复审（Doubt Cycle）**合二为一：先以不可妥协的机器量化预算锁死底线，再在交割前假设作者过度自信，主动证伪未言明的边界假设与隐式耦合。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[batch-commit](../batch-commit/SKILL.md) → **本技能** → [docs-archive-governance](../docs-archive-governance/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`debugging-and-error-recovery`、`test-benchmark-engineering`。
- **领域**：工作区元治理与并行交付（链上第 2 步）；另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：并行会话改动混杂需要精准暂存 → `batch-commit` + `subagent-orchestration` + `constraint-driven-development`；评分口径被注水或刷分 → `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev`
<!-- SKILL-LINKS:END -->

## 一、 质量契约四大物理支柱与底线守卫 (The Floor Guard)

所有质量标准必须量化为脚本可离线检验的刚性指标，严禁为“让测试变绿”而发生以下**六大逆流退化行为**（任一命中即一票否决）：

```text
┌──────────────────────────────────────────────────────────────┐
│                 底线守卫 (The Floor Guard)                   │
├──────────────────────────────────────────────────────────────┤
│ 1. 阈值私自下调 ──▶ 严禁修改 baseline/linter/门禁放宽门槛     │
│ 2. 抑制检查消音 ──▶ 严禁新增 @ts-ignore / eslint-disable 消音 │
│ 3. 测试断言弱化 ──▶ 严禁删测试、加 it.skip 或删减既有 expect  │
│ 4. 虚假半成品   ──▶ 严禁提交 0 字节文件、TODO 占位、空 catch  │
│ 5. 规则目录漂移 ──▶ 严禁书写未在 rule-catalog.json 登记的 ID  │
│ 6. 跨会话越界   ──▶ 严禁全局破坏性还原或篡改外部并行会话文件  │
└──────────────────────────────────────────────────────────────┘
```

- **单向单调棘轮 (The Ratchet Principle)**：覆盖率、性能耗时基线（`TB-REGRESSION`）、文件体积基线（`eloc-budget-baseline.json`）与全仓 High/Critical 技术债（恒为 **0 项**）只许优化收紧，严禁向下突破或反弹；
- **反刷分熔断 (`BLOCK_GAMING_DETECTED`)**：语义改动率 $\text{ELOC}_{\text{semantic}} \le 15\%$ 且无真实技术债净消除的刷分重构直接熔断；
- **会话边界与零破坏性还原**：严禁执行 `git restore .`、`git clean -fd` 或对非本会话文件顺手“修复”，严格坚守并行避让公理。

---

## 二、 交割前五步对抗性证伪循环 (The 5-Step Doubt Cycle)

当改动涉及**核心分支重构、跨模块接口变更、并发/幂等时序假设或持久化迁移**时，交割前必须执行怀疑循环：

```text
1. 声称 (CLAIM) ──▶ 2. 隔离 (EXTRACT) ──▶ 3. 证伪 (DOUBT) ──▶ 4. 仲裁 (RECONCILE) ──▶ 5. 收敛 (STOP <= 3轮)
```

1. **声称 (CLAIM)**：用 2~3 行技术语言明确写出当前改动依赖的核心不变量断言及其破坏后果；
2. **隔离 (EXTRACT)**：剥离作者的主观自洽心路历程，仅将**代码 Diff 切片 (ARTIFACT)** 与**前置/后置契约 (CONTRACT)** 摆上审查台，避免顺从偏见（Validation Bias）；
3. **证伪 (DOUBT)**：对照五大对抗性探针（退化空/超大输入、循环隐式堆分配、异常早退句柄泄漏、可变引用跨层污染、落盘半写损坏）主动找茬；
4. **仲裁 (RECONCILE)**：将发现的问题客观归入【契约不清 $\to$ 修正文档】、【真实缺陷 $\to$ 立即修复】、【合理权衡 $\to$ 注释备案】、【环境噪音 $\to$ 忽略】；
5. **收敛停机 (STOP)**：真实缺陷清零或满 3 轮即停（若 3 轮仍有分歧则上报人类裁决）。

---

## 三、 关联参考与模板资产

- [floor-guard.md](references/floor-guard.md)：底线守卫退出码契约、五大对抗性证伪探针清单与怀疑循环记录表；
- [floor-guard-contract.json](templates/floor-guard-contract.json)：机器可检验的质量预算与底线守卫配置模板。
