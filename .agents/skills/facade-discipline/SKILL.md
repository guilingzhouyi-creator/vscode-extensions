---
name: facade-discipline
description: >-
  【触发：门面/跳板/透传/ARCH-ABS/参数收敛/消融/空壳膨胀】消融<=3行纯转发跳板(ARCH-ABS-001)、压缩多形参对象(SIM-ARGS-001)或重构模块导出面时触发。确保门面具备实质承载(ARCH-FAC-001)与不可变冻结。
---

# facade-discipline — 门面实质承载、跳板消融与代码精简规范

本技能将**门面层实质承载契约（`ARCH-FAC-001`）**、**单行空包跳板消融（`ARCH-ABS-001`）**与**100% 行为等价代码精简（`SIM-ARGS-001` / `HYG-CLN-001`）**统一收口，根除无意义的转发间接层、参数泥团与结构克隆。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 3 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：精简模块导出面与消除空门面 → `fractal-git-dev` + `facade-discipline` + `rust-engineering`；消融纯转发跳板与参数收敛 → `auto-refactor-dev` + `facade-discipline` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

1. **创建或重构门面、网关与 Barrel 入口**（`Facade`、`Gateway`、`Adapter`、`index.ts`）；
2. **消融 $\le 3$ 行纯转发跳板文件或无语义透传包装函数**（`ARCH-ABS-001`）；
3. **精简高复杂度模块**：收敛多形参函数（`SIM-ARGS-001`）、抽取异构通道重复解码流（`HYG-CLN-001`）、平铺深层分支。

---

## 二、 门面层实质承载四支柱 (`ARCH-FAC-001`)

任何门面或顶层导出文件必须满足 $\text{POR} \le 0.60$（$\text{TSPR} \ge 0.40$）并至少具备以下实质承载特征之一（处于 $\text{ELOC} \le 900 / \text{LOC} \le 1400$ 包络内的高内聚模块严禁机械碎片化）：

| 承载支柱 | 刚性指标 | 架构职责与防护目标 |
| :--- | :--- | :--- |
| **最低有效行预算** | $\text{ELOC} \ge 15$ | 具备真实业务编排、上下文生命周期管理、守护进程异常守卫或事件桥接逻辑 |
| **不可变快照保障** | `Object.freeze` / `deepFreeze` | 对外透出的状态快照、配置字典或 SDK 契约执行深度冻结，封死外部越权突变 |
| **多子域实质聚合** | 聚合 $\ge 3$ 个正交子领域 | 统一编排 $\ge 3$ 个底层子系统（如 `PraxisReviewClient` 聚合扫描、语义图、Diff、MoE 路由与指令包） |
| **运行时边界防腐** | 显式参数/Schema 校验 | 在入口处执行前置条件断言与降级守卫，阻断脏数据向领域层渗透 |

> **内核-扩展 AST 静态萃取门面**：在 MOD/SDK 架构中，由离线 AST 解析器从核心层萃取只读 SDK 门面，并由门禁断言 $\text{Diff}(\text{Core}_{\text{public}}, \text{SDK}_{\text{exported}}) \equiv \emptyset$。

---

## 三、 跳板文件消融 (`ARCH-ABS-001`) 与等价精简六铁律

1. **100% 可观测行为等价**：精简仅改变内部结构表达，严禁改变输入输出、副作用次序、异常语义或删减测试断言；
2. **$\le 3$ 行空包跳板坚决内联 (`ARCH-ABS-001`)**：除去注释后 $\text{ELOC} \le 3$、仅含 `export * from './sub'` 且无本地声明的单目标转发文件（每跳产生 $+3.0\text{ units}$ 认知惩罚），必须按「全局检索引用 $\to$ 原子重定向导入源头 $\to$ 物理移除跳板」三步消融；子领域入口就地充实原则：创建新子目录时，若该领域仅有单一核心实现，禁止采用 `index.ts` 纯转发 `single-module.ts` 的结构，必须直接将实现逻辑安置于 `index.ts` 中或保持单文件平铺，确保任何 `index.ts` 均自洽满足 $\text{ELOC} \ge 15$ 的实质承载标准；
3. **形参 $\ge 4$ 收敛为只读参数对象 (`SIM-ARGS-001`)**：禁止长位置参数列表或单参数占行导致 Token 密度跌破 $\tau \ge 2.5$（`VOL-DIL-001`），统一封装为 `interface XxxParams`；
4. **异构通道解码流去重 (`HYG-CLN-001`)**：不同传输介质（如 stdio 与 Socket）共享同一协议时，抽取统一纯函数解码状态机，严禁复制粘贴循环；
5. **保护六字段 JSDoc 架构注释**：精简代码时严禁通过删除模块头契约注释压减行数（`CMT-VMD-001`）；
6. **UI 单闭合边框消融**：单条视线至多穿透 1 层闭合边框，容器内子控件降级为 `Ghost` 或表面填充。

---

## 四、 本地验证命令与参考资产

```powershell
node auto-refactor/scripts/validate-facade-governance.js
node scripts/common/evaluate-eloc-budget.js
node scripts/common/validate-code-density.js
```

- [trampoline-elimination-guide.md](references/trampoline-elimination-guide.md)：跳板与多余间接层识别判据、三步安全消融 SOP 及精简前后度量对照矩阵；
- [contract-facade.ts](templates/contract-facade.ts)：聚合多子域、深度不可变冻结与边界校验的标准门面模板。
