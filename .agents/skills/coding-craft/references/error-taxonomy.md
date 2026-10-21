# 失败语义分类学

> 失败不是异常情况，是接口契约的一部分。本指南规定跨语言的失败表达选型、错误层级设计与消息构造标准。

---

## 一、 三种失败表达及其适用边界

| 表达 | 适用 | 不适用 |
| :--- | :--- | :--- |
| **抛出异常 / panic 型** | 编程错误、不变量被破坏、无法继续的初始化失败 | 可预期的业务分支（如「未找到」） |
| **结果类型**（`Result` / 判别联合） | 调用方必须显式处理的可恢复失败 | 构造器内部的前置条件校验 |
| **空值返回** | **仅限**「不存在」与「出错」在语义上完全等价且调用方无需区分 | 一切需要区分原因的场合 |

> [!IMPORTANT]
> 同一模块内只允许一种表达。混用会让调用方无法判断「这个函数失败时我该 catch 还是看返回值」。

---

## 二、 错误层级设计

三层足够，禁止无限细分：

```text
DomainError（基类，携带 code 与上下文）
├── ValidationError   输入不满足契约，可恢复，应回传调用方
├── InfrastructureError  I/O、网络、存储失败，通常可重试
└── InvariantError    内部不变量被破坏，不可恢复，应快速失败
```

规则：

1. **每条错误携带 `code`**：供门禁、日志聚合与 i18n 字典索引；
2. **携带定位上下文**：被操作对象、期望值、实际值（`ERR-MSG-001`）；
3. **保留因果链**：Python `raise ... from err`（`PYM-RAISE-001`）、Rust `#[from]`、TS `{ cause }`；
4. **禁止字符串匹配判错**：调用方依据 `code` 或类型判别，而非消息文本。

---

## 三、 消息构造公式

```text
<动作> <对象> 失败：期望 <期望>，实际 <实际>（<可选定位>）
```

示例：

| 差 | 好 |
| :--- | :--- |
| `Error: failed` | `loadRuleCatalog 失败：期望 JSON 可解析，实际在第 42 行遇到未闭合字符串（scripts/common/rule-catalog.json）` |
| `throw new Error('invalid')` | `throw new ValidationError('RULE_ID_SHAPE', '规则 ID "abc" 不匹配 FAMILY-TOPIC-NNN')` |
| `return null` | `return { ok: false, code: 'NOT_FOUND', detail: 'family=CPX' }` |

---

## 四、 禁止清单

| 反模式 | 危害 | 规则 |
| :--- | :--- | :--- |
| `catch {}` / `except: pass` | 失败被静默吞掉，缺陷延后暴露 | `ERR-FLT-001`、`PS-ERROR-001` |
| 裸 `except Exception` | 吞掉 `KeyboardInterrupt` 与编程错误 | `PYM-RAISE-001` 同源 |
| 生产路径 `unwrap()` / `expect()` | 进程崩溃而非降级 | `RSM-UNWRAP-001`、`RSM-PNC-001` |
| `panic!` / `todo!` / `unimplemented!` | 未实现代码进入生产 | `RSM-PNC-001` |
| `|| true` 掩盖失败 | 门禁永远绿 | `SH-ERR-001` |
| 空值代替失败 | 调用方无法区分原因 | `ERR-PRP-001` |

---

## 五、 降级与重试

- **降级必须显式声明**：函数文档注明「失败时返回 X」或「失败时抛出」，不得两种都有；
- **重试必须有界**：次数与退避策略写入常量，禁止无界重试（`NUM-BND-001`）；
- **幂等性是重试前提**：非幂等操作重试前必须先做去重（`UUID-REENTRANT-001`）；
- **降级路径必须被测试**：只在生产触发的降级等于未验证的代码。

---

## 六、 跨语言映射表

| 概念 | TypeScript | Python | Rust | Shell |
| :--- | :--- | :--- | :--- | :--- |
| 可恢复失败 | 判别联合 / 异常 | 异常 | `Result<T, E>` | 非零退出码 |
| 不可恢复 | `throw` 自定义 `Error` | `raise` | `panic!`（仅库外） | `exit 1` |
| 因果链 | `new Error(msg, { cause })` | `raise ... from err` | `#[from]` | 打印后 `exit` |
| 上下文 | 错误对象字段 | 异常属性 | `thiserror` 字段 | `>&2` 前缀 |
