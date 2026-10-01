# 06. 多语言现代化规则包与常量单源治理

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：`src/analyzers/ts-modern.ts`、`src/analyzers/python-modern.ts`、`src/analyzers/rust-modern.ts`、`src/analyzers/go-modern.ts`、`src/analyzers/gdscript-modern.ts`、`src/core/constants/`

---

## 1. 五大语言现代化演进规则包 (`*-modern`)

为了消除陈旧语法范式带来的维护隐患与性能损耗，`auto-refactor` 提供了五大语言专属现代化演进分析器（Layer 2 语言族层）：

| 分析器名称 | 规则族前缀 | 核心检测与现代化重构目标 |
| :--- | :--- | :--- |
| **`ts-modern`** | `TSM-*` | 拦截 `var` 声明、不安全类型断言 (`as any`)、冗余 Promise 包装、手动空值链（推荐 Optional Chaining `?.` 与 Nullish Coalescing `??`） |
| **`python-modern`** | `PYM-*` | 推荐 `pathlib.Path` 替代零散 `os.path` 拼接 (`PYM-PATH-001`)、上下文管理器 `with` 资源闭合、f-string 格式化与现代类型注解 |
| **`rust-modern`** | `RSM-*` | 拦截生产路径裸 `.unwrap()` / `.expect()` 恐慌风险、不必要 `.clone()` 堆拷贝、推荐迭代器链与 `?` 错误传播算子 |
| **`go-modern`** | `GOM-*` | 拦截未受 `context.Context` 管控的裸 Goroutine 泄漏、循环变量捕获陷阱、错误包装缺失 (`%w`) 与 `strings.Builder` 预分配优化 |
| **`gdscript-modern`** | `GDM-*` | 强制 Godot 4.x 静态类型标注 (`var x: int = 0` / `-> void`)、信号 Callable 强类型连接 (`signal.connect(fn)`) 与 `@onready` 规范化 |

---

## 2. 常量单一真源拓扑治理 (`src/core/constants/`)

魔法数与散落的重复字符串是破坏代码可维护性的首要污染源，但机械地将所有字面量塞入单个巨型 `constants.ts` 又会造成跨层耦合。`auto-refactor` 确立了**分级常量拓扑治理契约**（由 `npm run validate-constant-governance`、`validate-constants-ssot` 与 `validate-constant-library-topology` 三套门禁联合看守）：

1. **语义字面量智能提纯 (`classifyLiterals: true`)**：
   - `src/core/governance/semanticLiterals.ts` 自动识别良性词汇表字面量（如 UTF-8 编码名、标准换行/路径分隔符、常见 HTTP 状态码与端口字典表），避免无意义提取。
2. **严禁局部遮蔽与嵌套重复定义 (`validate-nested-constant-cleanliness.js`)**：
   - 禁止在函数体内部重复声明与模块级常量同值或同义的局部 `UPPER_SNAKE_CASE` 常量 (`nested-constant`)。
3. **按领域分片而非大泥球单文件**：
   - 全局共享协议常量归入 `src/core/constants/` 领域子文件；模块私有阈值驻留于对应模块顶部，确保依赖方向始终单向朝内。

---

## 3. 结构债 ABC 分类治理准则

针对高圈复杂度（`high-complexity`）与大文件（`large-file`）存量结构债，严禁采用「只拆文件行数而不降函数分支复杂度」的形式主义平推，必须按以下三类对症下药：

- **A 类（扁平状态/规则派发表）**：表现为数十个同构 `if / else if / switch` 分支返回同类结构 $\rightarrow$ **唯一正确解法是改为声明式数据表 (`Map` / `Record`) 查表驱动**（例如 `dimensionRuleTable.ts` 表化后函数 CC 从 23 直接降至 5）。
- **B 类（本质密集算法内核）**：如 Myers 差分、Histogram 求解、Tarjan 强连通分量 $\rightarrow$ **保持算法内聚并在 JSDoc 头显式标注复杂度来源与数学不变量**，严禁强行拆碎破坏局部性。
- **C 类（深层嵌套业务缠绕）**：缺少卫语句（Guard Clauses）与早期返回导致的金字塔缩进 $\rightarrow$ **通过提前 `return/continue` 拍平控制流并按子职责提取纯函数**。

---

## 4. 关联文档导航

- [01. 四层规则金字塔、26 个内置分析器与 243 条全量规则字典](../04-analyzers-and-rules/01-builtin-rules.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](./07-quantified-quality-standard.md)
