---
name: coding-craft
description: >-
  通用编程工艺与高级工程师写法约束：命名即契约、失败语义显式化、类型收窄与穷尽、
  接口最小暴露、单向依赖、可测性设计与多语言惯用法。回答「写这段代码该遵守什么」，
  并以规则族指针表把 502 条 SSOT 规则接入写作现场。
---

# coding-craft — 通用编程工艺与写法约束

本技能回答一个此前无人回答的问题：**动手写一个函数时，除了体积与复杂度预算之外，还有哪些必须守住的工艺底线**。`complexity-budget` 管的是「多大的代码算超标」，`code-simplification` 管的是「写完怎么削减」，本技能管的是「从第一行起就该长成什么样」。

规则真源在 `scripts/common/rule-catalog.json`；本技能不复制规则正文，只给准则、反例与指针。

---

## 一、 适用场景

1. 新增任何生产代码（`.ts` / `.js` / `.py` / `.rs` / `.gd` / `.sh` / `.ps1`）；
2. 设计对外导出的函数、类型、错误与配置项；
3. 拆分模块、调整 import 方向或收敛导出面；
4. 评审他人代码，需要给出「为什么这样写不行」的客观依据；
5. 接手陌生文件，需要快速判定其工艺水位。

*不适用*：纯文档改写、纯资源替换、纯配置数值调整。

---

## 二、 七域工艺矩阵

| 域 | 核心判据 | 典型反模式 | 深水区指针 |
| :--- | :--- | :--- | :--- |
| **命名** | 名字能否让读者跳过实现就猜到行为与边界 | `data`、`res`、`tmp`、`i`（业务层）、超长前缀堆叠 | [naming-and-contracts.md](references/naming-and-contracts.md) |
| **失败语义** | 每个可失败调用是否有唯一的失败表达方式 | 吞异常、返回 `null` 代替失败、错误消息无上下文 | [error-taxonomy.md](references/error-taxonomy.md) |
| **类型收窄** | 联合类型是否在消费点被穷尽，而非用断言绕过 | `as` 强转、`!` 非空断言、`default: return` 兜底 | [type-narrowing-and-exhaustiveness.md](references/type-narrowing-and-exhaustiveness.md) |
| **接口暴露** | 导出面是否等于调用方真正需要的集合 | 全量 `export *`、内部类型泄漏、为测试导出私有实现 | [api-surface-minimization.md](references/api-surface-minimization.md) |
| **依赖方向** | 箭头是否恒从抽象指向实现，从上层指向下层 | 基础设施反向 import 业务、工具模块 import 领域模型 | [dependency-direction.md](references/dependency-direction.md) |
| **可测性** | 依赖是否可在不启动真实 I/O 的前提下被替换 | 模块级单例、`Date.now()` 直调、隐式全局状态 | [testability-design.md](references/testability-design.md) |
| **语言惯用法** | 是否用了该语言社区公认的现代写法 | `typing.List`、`var`、裸 `unwrap()`、无引号变量展开 | [python-idioms.md](references/python-idioms.md) |

---

## 三、 命名即契约

名字是唯一零成本、零运行时开销的文档。四条硬判据：

1. **可判性**：读到 `collectExpiredSessions` 就能推断它会删除或标记过期会话，读到 `handleData` 则不能——后者按 `NAM-VAG-001` 违规；
2. **粒度一致**：同一层级的名字抽象度必须对齐，`parseConfig` 与 `doStuff` 不得并列；
3. **长度有界**：单字母名仅允许循环计数器与丢弃符号（`NAM-SGL-001`）；超过 30 字符且多符号共享长前缀，说明缺少中间抽象（`NAM-DEC-001`）；
4. **词性正确**：函数用动词短语，布尔用 `is`/`has`/`should`，集合用复数或 `...List`（`NAM-COL-001`）。

> [!IMPORTANT]
> 重命名是重构，不是美化。改名必须同步更新全部引用点、文档指针与测试描述；只改声明处不改调用处的「半重命名」会让代码进入比原名更糟的状态。

---

## 四、 失败语义必须显式

同一模块内只允许**一种**失败表达方式，跨模块边界时必须转换而非混用：

| 语言 | 推荐表达 | 禁止 |
| :--- | :--- | :--- |
| TypeScript | 返回值判别联合 `{ ok: true; value } \| { ok: false; reason }`，或抛出带类型的 `Error` 子类 | `throw new Error('failed')` 无上下文；`catch {}` 空捕获 |
| Python | 自定义异常层级 + `raise ... from err` 保留因果链 | `except Exception: pass`；`except:` 裸捕获 |
| Rust | `Result<T, E>` + `thiserror` 枚举 | 生产路径裸 `unwrap()` / `expect()`（`RSM-UNWRAP-001`）、`panic!`（`RSM-PNC-001`） |
| Shell | 非零退出码 + `set -euo pipefail` 平铺捕获 | `|| true` 掩盖失败；未加引号的变量展开（`SH-QUOTE-001`） |
| PowerShell | `throw` + `try/finally` 释放句柄 | 空 `catch`（`PS-ERROR-001`）；`Invoke-Expression` 动态执行（`PS-SEC-001`） |

三条判据：
- **错误消息必须自带定位信息**：包含被操作对象、期望与实际（`ERR-MSG-001`）；
- **不可恢复与可恢复必须分开**：前者立即失败，后者返回可判别结果交由调用方决策；
- **禁止以空值代替失败**：返回 `undefined` / `None` 让调用方猜「没找到」还是「出错了」，是把缺陷推迟到最远的位置。

---

## 五、 类型收窄与穷尽

```ts
// 反模式：断言关闭了编译器，也关闭了未来的自己
const cfg = input as ServerConfig;

// 正模式：收窄 + 穷尽，新增变体时编译期报错
function describe(state: State): string {
  switch (state.kind) {
    case 'idle': return 'idle';
    case 'running': return `running:${state.pid}`;
    default: return assertNever(state);
  }
}
```

- `as` 只允许出现在**已验证**的边界（如 `JSON.parse` 之后紧跟结构校验），且必须紧邻校验代码；
- `!` 非空断言等价于「我拒绝证明」，除测试夹具外一律禁止；
- 联合类型新增成员时，`assertNever` 让所有遗漏分支变成编译错误——这是唯一能防止「加了枚举值忘了处理」的机制。

---

## 六、 接口最小暴露

导出面是承诺，承诺就要维护。四条纪律：

1. **默认不导出**：只有跨模块调用者才 `export`；同文件内使用一律私有；
2. **禁止 `export *`**：它让导出面随内部文件增长而失控，也让重命名变成破坏性变更；
3. **类型与实现分离导出**：`export type` 与值导出分开，避免消费方被迫加载实现；
4. **门面必须实质承载**：聚合 ≥ 3 个子领域或含不可变冻结，ELOC ≥ 15（`ARCH-FAC-001`）；≤ 3 行的纯转发文件必须内联消融。

> [!WARNING]
> 「为测试而导出」是最常见的泄漏来源。正确做法是把依赖作为参数注入，让测试直接构造被测函数，而不是把私有实现提升为公开 API。

---

## 七、 依赖方向单向

```
        ┌─────────────┐
        │  界面 / CLI  │
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  应用编排层  │
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  领域模型层  │
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ 基础设施/IO  │
        └─────────────┘
```

- 箭头只许向下。基础设施层 import 领域模型即 `DEP-INV-001`（error 级，直接阻断）；
- 同层横向依赖必须单向，出现环即 `import-cycle`；
- 开发依赖不得进入生产路径（`DEP-DEV-001`）；延迟 import 必须有审计说明（`DEP-LAZ-001`）；
- 跨层调用必须经由显式接口，禁止直接伸手进对方内部目录。

---

## 八、 可测性设计

可测性不是测试阶段的问题，是设计阶段的产物。五个前置条件：

1. **时间与随机可注入**：`Date.now()`、`Math.random()`、`crypto.randomUUID()` 一律经参数或模块级 provider 注入，测试可钉死；
2. **I/O 在边界**：纯计算函数不读文件、不发请求；I/O 集中在薄适配层；
3. **无模块级可变单例**：模块加载即建立连接、启动定时器的写法让测试无法隔离；
4. **失败可构造**：每个错误分支都能在测试中被稳定触发，不需要 mock 整个框架；
5. **断言可观察**：函数返回结构化结果，而非只通过日志或副作用体现行为。

对应规则：`TST-DEN-001`（确定性）、`TST-SKP-001`（零跳过）、`TST-ORC-001`（零孤儿用例）、`TST-TAU-001`（反同义反复断言）。

---

## 九、 语言惯用法速查

| 语言 | 必须 | 禁止 |
| :--- | :--- | :--- |
| **TypeScript** | `const` 优先、`readonly` 修饰不可变字段、`satisfies` 保留字面量类型 | `any`（`TSM-ANY-001`）、`var`（`TSM-VAR-001`）、`require()`（`TSM-REQUIRE-001`） |
| **Python** | `collections.abc`、`X \| None`、内建泛型 `list[int]`、`with` 管资源、`raise ... from` | `typing.List`（`PYM-GENERIC-001`）、`Optional[X]`（`PYM-UNION-001`）、可变默认参数（`PYM-DEFAULT-001`） |
| **Rust** | `let-else`、`&str` 形参、`// SAFETY:` 证明、`thiserror` 枚举 | 裸 `unwrap()`（`RSM-UNWRAP-001`）、跨 `.await` 持锁（`RSM-LOCK-001`）、`try!` / `extern crate` |
| **GDScript** | 节点路径集中常量、信号连接与断开成对、对象池 `reset_state()` | 循环内 `new` 节点（`ADV-PRF-002`）、硬编码中文字面量（`VSC-I18N-001` 同源要求） |
| **Bash** | `set -euo pipefail`、变量与替换加引号、`trap` 清理 | 无引号展开（`SH-QUOTE-001`）、无守卫交互读取（`SH-READ-001`） |
| **PowerShell** | `Verb-Noun` 命名、`[CmdletBinding()]`、显式参数类型 | `iex` 动态执行（`PS-SEC-001`）、无 `try/finally` 的句柄（`PS-TRAP-001`） |

---

## 十、 排版折行与有效代码密度平衡

代码排版不仅关乎视觉阅读，还直接受门禁 Token 密度与体积包络约束。三条兼顾单行宽度（$\le 100$ 字符）与 Token 密度（$\tau \in [2.5, 22.0]$）的刚性准则：

1. **形参 $\ge 4$ 个必须采用参数对象 (`SIM-ARGS-001`)**：禁止将多个形参每行一个垂直展开成 10 行以上空壳，造成单行有效 Token 骤降跌破 $\tau \ge 2.5$（`VOL-DIL-001`）；统一封装为 `interface XxxParams` 并整行解构；
2. **紧凑链式调用与自解释中间常量**：禁止单一标点符号独立占行（如孤立的 `);` 或 `.` 换行）；超过 100 字符的长链式调用优先拆解为带语义的具名中间常量，杜绝单行 Token 过度拥挤堆叠（`GUARD-AST-001`，$\tau > 22.0$）；
3. **禁止虚假转接门面 (`ARCH-FAC-001` / `ARCH-ABS-001`)**：任何导出门面文件的接线开销比必须满足 $\text{POR} \le 0.60$（$\text{TSPR} \ge 0.40$）。禁止编写仅做 `import` 后直接原样 `export` 的 $\le 3$ 行透传文件；门面必须聚合 $\ge 3$ 个子领域并带有实质参数校验或不可变深度冻结契约。

---

## 十一、 规则族指针表

七域准则覆盖不到的规则族（安全、数据访问、构建洁净度、门禁、治理等），统一收口至一份按族编排的指针表：

**→ [rule-family-map.md](references/rule-family-map.md)**：60 个族、502 条规则的「一句话准则 + 全量 ID」，`error` 级加粗。

使用方式：写某个域之前先查该族准则；评审时用规则 ID 定位 SSOT 正文，而不是凭印象描述问题。

---

## 十二、 本地预审命令

```powershell
# 1. 技能集与规则引用完整性（含孤儿资产、行数窗口、description 窗口）
node scripts/common/validate-skills.js

# 2. 全仓规则 ID 双向闭包与文档数字口径
node scripts/common/validate-rule-id-closure.js
node scripts/common/validate-docs-consistency.js

# 3. 复杂度、体积、注释密度与有效代码密度
node scripts/common/evaluate-eloc-budget.js
node scripts/common/validate-code-density.js --all
node auto-refactor/scripts/validate-comment-governance.js
```

**质性断言标准**：新代码零 `any` / 零裸 `unwrap` / 零空 `catch`；每个导出符号的名字可在不读实现的前提下被理解；依赖箭头全部向下；时间与随机在测试中可钉死；Token 密度受控于 $[2.5, 22.0]$ 且接线开销 $\text{POR} \le 0.60$。

---

## 十三、 参考资源

| 资源 | 用途 |
| :--- | :--- |
| [naming-and-contracts.md](references/naming-and-contracts.md) | 命名词性、长度、缩写、集合与映射命名的完整判据与改写示例 |
| [error-taxonomy.md](references/error-taxonomy.md) | 跨语言失败语义选型：何时用异常、何时用结果类型、错误层级如何设计 |
| [type-narrowing-and-exhaustiveness.md](references/type-narrowing-and-exhaustiveness.md) | 判别联合、穷尽检查、边界校验与断言允许范围 |
| [api-surface-minimization.md](references/api-surface-minimization.md) | 导出面收敛、类型泄漏、兼容性演进与废弃策略 |
| [dependency-direction.md](references/dependency-direction.md) | 分层契约、环检测、延迟加载审计与跨层调用边界 |
| [testability-design.md](references/testability-design.md) | 时间/随机注入、I/O 边界、单例消解与失败可构造 |
| [python-idioms.md](references/python-idioms.md) | 13 条 `PYM` 规则对应的现代 Python 写法与迁移示例 |
| [code-review-checklist.md](templates/code-review-checklist.md) | 可直接粘贴到评审意见的七域检查清单 |
