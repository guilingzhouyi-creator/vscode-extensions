# 内置分析器与重构规则 (Built-in Analyzers & Rules)

> **所属模块**：`04-analyzers-and-rules`  
> **核心源码**：`src/analyzers/constants.ts`, `src/analyzers/complexity.ts`, `src/analyzers/fileSize.ts`, `src/analyzers/largeFile.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 常量与字面量分析器 (`constants`)

负责检测代码库中散落的硬编码常量，提供自动重构命名建议：

| 规则 ID | 级别 | 触发条件 | 自动重构建议 |
| :--- | :--- | :--- | :--- |
| `magic-number` | `warning` | 出现非琐碎（非 0, 1, -1 等）的未绑定数字字面量。 | `const CONST_<num> = <num>;` |
| `hardcoded-string` | `warning` | 长度超过阈值（默认 ≥ 3）的硬编码字符串。 | `const EXTRACTED_STRING = "...";` |
| `duplicate-literal` | `warning` | 同一文件内相同字面量出现频次超标（默认 ≥ 3 次）。 | 自动聚合多处行号并提示提取共享常量。 |

---

## 2. 圈复杂度分析器 (`complexity`)

计算函数、类方法、箭头函数与静态块内的 McCabe 圈复杂度：

* **基础分值**：基础复杂度为 1。
* **分支计数**：每个 `if`, `for`, `while`, `catch`, `case`, `&&`, `||`, `??`, 三元表达式 `? :` 均递增 1。
* **分级告警**：
  * 复杂度 $\ge \text{complexityWarn}$（默认 10）：发出 `warning` 级别告警；
  * 复杂度 $\ge \text{complexityFail}$（默认 20）：升级为 `error` 级别告警。

---

## 3. 文件尺寸与超长函数分析器 (`fileSize` / `largeFile`)

* **文件行数告警 (`large-file`)**：源码总行数（排除空行后）超过 `maxFileLines`（默认 500 行）时发出告警，建议进行模块拆分。
* **函数行数告警 (`large-function`)**：单个函数体行数超过 `maxFunctionLines`（默认 80 行）时告警，建议提炼子函数。
