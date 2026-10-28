---
name: spec-driven-development
description: >-
  【触发：需求澄清/质询/能力拓扑/规格书/X-Y/返工】遇到模糊需求、重大架构重构或开发新特性前触发。通过每次一问消除歧义与 X-Y 问题，先确立能力拓扑图与接口契约规格，再行动手编码。
---

# spec-driven-development — 需求单点质询与规范先行开发工作流

本技能将**交互式需求质询（Reverse ESR）**与**规范先行驱动开发（Spec-Driven Development）**统一收口为编码前的标准前置闭环。规格书是人类工程师与 Agent 之间的单一事实源（SSOT）：先通过单点质询消除模糊假设，再锁定单向能力拓扑与接口契约，经人类确认后方可进入施工。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 4 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：新玩法先出四阶段方案 → `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 一、 适用时机与触发条件

1. **需求抽象、留白较多或存在多种架构权衡**；
2. **启动新功能、新服务、跨层协作组件或数据协议升级**；
3. **涉及破坏性改动、持久化迁移或高复杂度状态机演化**。

*免除情形*：纯文本错别字修正、单行确定性判空修复、已被完备规格书覆盖的局部微调。

---

## 二、 五阶段前置门禁工作流

```text
阶段 -1: 逆向单点质询 ──▶ 阶段 0: 能力拓扑分解 ──▶ 阶段 1: 编制规格说明 ──▶ 阶段 2: 原子任务拆解 ──▶ 阶段 3: 契约驱动施工
   (Reverse ESR)           (Capability Map)          (Feature Spec)         (Task Breakdown)        (Implementation)
```

### 阶段 -1：逆向提问与单点质询 (Reverse ESR & One Question at a Time)
面对模糊需求或疑似伪需求时，严禁一次性抛出问卷轰炸或盲目猜测：
1. **一次只问一个核心阻塞问题**：每次互动仅聚焦一个最高优先级的架构或边界决策点；
2. **提供具象候选项并标明 `(Recommended)`**：控制在 2~3 个选项，首选项前标注 `(Recommended)` 并用一句话说明权衡动因；
3. **X-Y 问题侦测**：当用户指定的手段（Y）违背分层解耦或并发安全时，礼貌探寻原始目标（X）并给出合规替代方案；
4. **报障四元组补全**：遇到简短报障时，引导补全【运行环境、触发输入、预期表现、客观错误堆栈】。

### 阶段 0：范围与能力拓扑分解 (Capability Map)
当需求包含多个可独立验证的子模块时，先输出单向能力依赖图：
- 每个模块赋予稳定唯一的 `module-id`；
- 严格遵循自底向上单向依赖：`Contract/Shared -> Storage -> Core/Engine -> Service/Controller -> Interface/UI`；
- 核心计算与存储契约必须支持脱离宿主环境（如 VS Code / Godot 渲染树）独立运行内存单测。
详见：[questioning-and-capability-mapping.md](references/questioning-and-capability-mapping.md)。

### 阶段 1：编制规格说明书 (Feature Spec)
依据参数化模板 [feature-spec-template.md](templates/feature-spec-template.md) 编写 `SPEC.md`，必须包含：
1. **质询决策记录与范围边界**：明确 In Scope 与 Out of Scope；
2. **架构层级与单向依赖**：明确所属子系统及上下游调用边界；
3. **强类型数据模型与接口契约**：明确输入输出类型、量纲后缀（如 `*Ms`）与前置不变式；
4. **负空间、容灾与资源预算**：空集/超限退化短路、原子落盘恢复、复杂度与内存预算；
5. **可证伪验收测试矩阵**：覆盖正常流、边界值与故障降级分支。

### 阶段 2 & 3：原子任务规划与多维质量交割
将规格书拆解为独占文件粒度的原子微任务，按红-绿-重构闭环施工：
- **编写纪律**：卫语句平铺控制流（$\text{CC} \le 15, \text{Depth} \le 4$）、热路径循环零瞬态堆分配（`CPX-SPACE-001`）、消融 $\le 3$ 行透传跳板（`ARCH-ABS-001`）、首行六字段 JSDoc 契约；
- **三重自检底线**：测试全绿仅为必要底线，交割前必须同时通过静态编译、单元测试与领域静态规则扫描。

---

## 三、 关联参考与模板资产

- [questioning-and-capability-mapping.md](references/questioning-and-capability-mapping.md)：逆向提问协议、通用/宿主特化质询题库与五层能力拓扑分解指南；
- [feature-spec-template.md](templates/feature-spec-template.md)：含质询决策记录与宿主扩展可选段的参数化功能规格书样板。
