---
name: coding-craft
description: >-
  【触发：写代码/重构/命名/错误处理/类型设计/SSOT/空捕获】编写、生成或审查任何代码时必须遵循。坚持命名即契约、显式失败语义、类型穷尽、最小接口暴露与单向依赖，对接 534 条 SSOT 规则。
---

# coding-craft — 通用编程工艺、多语言惯用法与六大规范性思维约束

本技能回答**动手写一个函数时，除体积与复杂度预算外必须守住的工艺底线與元认知防线**。规则真源位于 `scripts/common/rule-catalog.json`（<!-- METRICS:BEGIN rule-family-count-all -->**70 个规则族**<!-- METRICS:END rule-family-count-all -->、<!-- METRICS:BEGIN rule-total -->**534 条规则**<!-- METRICS:END rule-total -->）。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)；并行支援 `constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`、`algorithmic-operator-engineering`。
- **领域**：门禁与命令面基础设施（链上第 3 步）；另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：pwsh 与 bash 门禁语义漂移 → `gate-governance` + `coding-craft` + `debugging-and-error-recovery`；破坏性删除或路径穿越 → `defensive-security-and-taint-safety` + `gate-governance` + `coding-craft`
<!-- SKILL-LINKS:END -->

## 一、 七域编程工艺核心判据矩阵

| 工艺域 | 刚性可判定判据 | 典型违规反模式（命中即阻断） | 关联规则族 |
| :--- | :--- | :--- | :--- |
| **1. 命名即契约** | 不读实现即可推断输入、输出与副作用；函数用动词、布尔用 `is/has/should`、集合用复数；长度 $3\sim 30$ 字符；**兼容别名用具名重导出 `export { orig as alias };`** | `data`、`res`、`tmp`、`handleData`、单字母变量（非循环）、批次代号（`phase2`）、`export const alias = orig;` | `NAM-VAG-001`、`NAM-SGL-001`、`NAM-DEC-001`、`NAM-JRG-002` |
| **2. 失败语义显式** | 同模块仅用一种失败表达（判别联合 `Result` 或带 `code` 强类型异常）；错误消息含【动作+对象+期望+实际】；**降级 catch 必须显式注释意图** | `catch {}` 空捕获（`GOV-EXC-001` 定级 Critical）、裸 `unwrap()`/`expect()`、`|| true` 吞错、以 `null` 代替失败 | `ERR-FLT-001`、`ERR-MSG-001`、`GOV-EXC-001`、`RSM-UNWRAP-001`、`PS-ERROR-001` |
| **3. 类型收窄与穷尽** | 联合字面量显式声明契约（避免拓宽）；多遍消费迭代器前显式物化为数组（`Array.from`）；联合类型经 `switch` + `assertNever` 穷尽 | `as any`、双重断言 `as unknown as T`、`!` 非空断言、`let v = 0` 拓宽破坏联合类型推断、多遍消费未物化的 `IterableIterator` 导致数据耗尽 | `TSM-ANY-001`、`TSM-TYPE-001` |
| **4. 接口最小暴露** | 默认私有，仅跨模块调用方才导出；`export type` 与值分离；门面满足 $\text{ELOC}\ge 15$ 或 `Object.freeze`；**虚表代理豁免标记须落在函数声明行及其上方五行窗口内，`HYG-WRAP-001` 才不会判为空心转发** | 全量 `export *`、为单测导出私有函数、$\le 3$ 行纯转发跳板（见 [facade-discipline](../facade-discipline/SKILL.md)）、豁免注释超出该窗口致漏检 | `EXP-*`、`ARCH-FAC-001`、`ARCH-ABS-001`、`HYG-WRAP-001` |
| **5. 依赖方向单向** | 严格自上而下 `Interface -> Service -> Domain -> Infra`；同层零环；开发依赖禁入生产路径 | 基础设施反向 import 领域模型、动态 import 掩盖循环依赖、未声明幽灵依赖 | `DEP-INV-001`、`DEP-DEV-001`、`MOD-BWD-001` |
| **6. 可测性设计** | 时间（`Clock`）与随机（Seed PRNG）可注入；纯计算与薄 I/O 适配层分离；无模块加载期副作用单例 | 函数内直调 `Date.now()`/`Math.random()`、顶层 `setInterval`、同义反复断言 | `TST-DEN-001`、`TST-SKP-001`、`TST-ORC-001`、`TST-TAU-001` |
| **7. 排版与有效密度** | 纯空格缩进契约（TS 4 空格整倍数，其余 2 空格）；复杂三元提升为前置卫语句或 `if-else` 分支；单行 $\le 100$ 字符且 Token 密度 $\tau \in [2.5, 22.0]$；形参 $\ge 4$ 封装为只读参数对象 | 对象字面量内嵌套三元致 14/18/22 缩进破位（`HYG-IND-001`）、多形参垂直展开致 $\tau < 2.5$、单行堆叠致 $\tau > 22.0$、孤立标点占行 | `SIM-ARGS-001`、`VOL-DIL-001`、`HYG-IND-001`、`GUARD-AST-001` |

> [!IMPORTANT]
> **GOV-EXC-001 异常安全与降级注释契约**：空 `catch {}` 块不仅会吞没未知错误，更会被 AST 语法分析器定级为 Critical 级技术债务阻断门禁。任何预期内的 fail-soft 或降级 catch 块，其体内**必须包含显式意图标注**（如 `// ignore: fallback to cumulative...` 或 `// intentional: soft fail`）。

---

## 二、 六大语言现代惯用法速查表

| 语言栈 | 强制现代写法 | 严禁反模式 |
| :--- | :--- | :--- |
| **TypeScript** | `const` 优先、`readonly` 不可变字段、`satisfies` 保字面量类型、`let v: 0 \| 1 = 0` 显式字面量注记、`Array.from(map.values())` 迭代器多遍物化、`assertNever`、具名重导出兼容别名 (`export { orig as alias }`)、`@override` 紧邻函数头 | `any`（`TSM-ANY-001`）、`var`（`TSM-VAR-001`）、`require()`（`TSM-REQUIRE-001`）、对象字面量内嵌套三元致缩进偏斜、复用已耗尽的单遍 `IterableIterator`、`export const alias = orig;` 污染前缀符号表 |
| **Python** | `collections.abc`、内建泛型 `list[int]`、`X \| None`、`pathlib.Path`、`datetime.UTC`、`@dataclass(slots=True)`、`raise ... from err` | `typing.List/Optional`（`PYM-GENERIC-001`/`PYM-UNION-001`）、`async def` 内同步阻塞（`PYM-ASYNC-001`）、可变默认参数（`PYM-DEFAULT-001`） |
| **Rust** | `let-else`、`&str` 形参、`thiserror` 枚举、`// SAFETY:` 不变量证明、CAS 无锁 | 生产路径裸 `unwrap()`（`RSM-UNWRAP-001`）、跨 `.await` 持锁（`RSM-LOCK-001`）、`panic!`（`RSM-PNC-001`） |
| **GDScript** | 强类型节点引用、信号连接与断开成对、对象池 `reset_state()`、`apply_snapshot()` | 循环内 `.new()`（`ADV-PRF-002`）、视图层内嵌业务公式或 `randf()` |
| **Bash** | `set -euo pipefail`、变量双引号包裹、`trap` 对称清理、三步删除污点守卫 | 无引号变量展开（`SH-QUOTE-001`）、`|| true` 掩盖错误（`SH-ERR-001`） |
| **PowerShell** | `Verb-Noun`、`try/finally` 释放句柄、GNU 包装器用 `$MyInvocation.ExpectingInput` | 包装器内写 `[Parameter()]`（`GUARD-SHELL-001`）、写只读自动变量（`GUARD-VAR-001`）、`iex`（`PS-SEC-001`） |

---

## 三、 六大高级编程规范性思维约束（元认知防线）

动手写任何逻辑前，必须内化以下六条元认知约束（完整推导见 [normative-thinking-constraints.md](references/normative-thinking-constraints.md)）：
1. **状态空间闭合思维**：先用判别联合或 Type-State 让非法状态不可表示；带作用域的状态标志必须成对声明进入与花括号/栈深度退出归位条件；
2. **单源派生与双向闭包思维**：凡有两处表达同一事实，必有一处为 SSOT 真源，另一处由脚本派生或经双向差集守卫（$A \setminus B = \varnothing \land B \setminus A = \varnothing$）锁死；
3. **反机械应付（Anti-Gaming）与复杂度守恒**：降复杂度只能靠卫语句早退、查表派发与职责内聚，严禁删注释压 LOC（`CMT-VMD-001`）或拆出 $\le 3$ 行跳板（`ARCH-ABS-001`）；
4. **负空间与边界退化思维**：先写空输入、尺寸上限、超时强杀与路径三步污点守卫（[defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md)），再写主干 Happy Path；
5. **数据拓扑与对称生命周期思维**：先定扁平内存布局与获取-释放对称路径（[state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)），热路径循环零瞬态堆分配；
6. **可证伪守卫思维**：任何校验器或门禁脚本必须内置 `runSelfProbes()` 正反双向内存探针，未验证负样本检出能力的守卫等同于未编写。

---

## 四、 本地预审命令与关联参考资源

```powershell
node scripts/common/validate-skills.js && node scripts/common/validate-family-contract.js
node scripts/common/validate-rule-id-closure.js && node scripts/common/validate-docs-consistency.js
node scripts/common/evaluate-eloc-budget.js && node scripts/common/validate-code-density.js --all
```

| 资源 | 用途 |
| :--- | :--- |
| [rule-family-map.md](references/rule-family-map.md) | <!-- METRICS:BEGIN rule-family-count-all -->**70 个规则族**<!-- METRICS:END rule-family-count-all -->、<!-- METRICS:BEGIN rule-total -->**534 条规则**<!-- METRICS:END rule-total -->的「一句话准则 + 全量 ID」权威映射表 |
| [normative-thinking-constraints.md](references/normative-thinking-constraints.md) | Agent 六大高级编程规范性思维约束（状态闭合、双向闭包、反机械应付、负空间、零分配、自证探针） |
| [python-idioms.md](references/python-idioms.md) | 七域编程工艺改写范例与 `PYM` 族现代 Python 惯用法完整指南 |
| [code-review-checklist.md](templates/code-review-checklist.md) | 可直接用于评审与自检的七域工艺检查清单 |
