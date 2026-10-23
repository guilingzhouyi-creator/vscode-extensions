# 七域编程工艺深水区范例与 Python 现代惯用法指南

> 本指南整合了七域编程工艺（命名契约、失败语义层级、判别联合穷尽、最小暴露面、依赖倒置、可测性注入）的标准改写范式，以及 `PYM` 族 <!-- METRICS:BEGIN rule-family-pym -->**13 条**<!-- METRICS:END rule-family-pym -->现代 Python 规则的完整迁移对照。

---

## 一、 七域编程工艺标准改写范式

1. **命名即契约 (`NAM-*`)**：
   - 纯计算用 `computeXxx` / `deriveXxx`；副作用写入用 `applyXxx` / `persistXxx`；布尔用 `is/has/can`；映射用 `ruleByFamily`（禁止 `handleData`、`res`、`tmp`、`list1`）；
   - 重命名必须同步更新声明处、调用处、文档指针与测试描述，严禁“半重命名”。
2. **失败语义三层模型 (`ERR-*` / `RSM-*`)**：
   - 统一划分为 `ValidationError`（输入违约，可恢复）、`InfrastructureError`（I/O 失败，有界重试 `NUM-BND-001` + 幂等去重 `UUID-REENTRANT-001`）、`InvariantError`（内部不变量破坏，快速失败）；
   - 错误消息公式：`<动作> <对象> 失败：期望 <期望>，实际 <实际>（<定位>）`（`ERR-MSG-001`）。
3. **判别联合收窄与边界校验 (`TSM-*`)**：
   ```typescript
   function assertNever(value: never): never {
     throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
   }
   ```
   外部数据（`JSON.parse`、环境变量、IPC 载荷）在系统边界执行一次 Schema 解析收窄，内部禁止 `as` 强转与 `!` 非空断言。
4. **最小导出面与依赖倒置 (`EXP-*` / `DEP-*` / `MOD-*`)**：
   - 严禁 `export *` 与“为测试而导出私有实现”；公开函数签名引用的类型必须公开导出，防止内部类型泄漏；
   - 领域层（L2）定义 `Clock` / `RuleStore` 接口，基础设施层（L1）实现接口并由入口（L4）注入；L1 反向 import L2 即触发 `DEP-INV-001`（error 级阻断），严禁用动态 `import()` 掩盖循环依赖（`DEP-LAZ-001` / `import-cycle`）。

---

## 二、 Python 现代惯用法（`PYM` 族 13 条规则对照）

| 领域 | 旧写法（违规） | 现代标准写法（合规） | 对应规则 |
| :--- | :--- | :--- | :--- |
| **泛型与联合类型** | `from typing import List, Dict, Optional, Union` | `list[int]`、`dict[str, int]`、`X \| None` | `PYM-GENERIC-001`、`PYM-UNION-001` |
| **抽象容器接口** | `from typing import Iterable, Sequence, Mapping` | `from collections.abc import Iterable, Sequence, Mapping` | `PYM-ABC-001` |
| **文件与路径管理** | `f = open(p); f.close()`、`os.path.join/exists` | `with open(p, encoding="utf-8") as f:`、`pathlib.Path` | `PYM-OPEN-001`、`PYM-PATH-001` |
| **UTC 时间与异步** | `datetime.timezone.utc`、`async def` 内调 `time.sleep` / `requests` | `datetime.UTC`、`await asyncio.sleep()` / 异步客户端 | `PYM-DATETIME-001`、`PYM-ASYNC-001` |
| **默认参数与内建名** | `def f(items=[])`、参数名用 `list` / `id` / `type` | `items: list[str] \| None = None`、避免遮蔽内建符号 | `PYM-DEFAULT-001`、`PYM-SHADOW-001` |
| **异常链与格式化** | `except Exception: raise ValueError("x")`、`"%s" % x` | `raise CatalogError(...) from err`、`f"{name}: {count}"` | `PYM-RAISE-001`、`PYM-FSTRING-001` |
| **数据类与导入分组** | `@dataclass` 无 slots、导入顺序混乱 | `@dataclass(slots=True, frozen=True)`、标准库/第三方/本地三段式 | `PYM-SLOTS-001`、`PYM-IMPORT-001` |
