# 多语言通用 AST 抽象与适配器 (Multilang AST Abstraction)

> **所属模块**：`02-parsers-and-ast`  
> **核心源码**：`src/core/multilang.ts`, `src/core/adapters.ts`, `src/core/typescriptAdapter.ts`, `src/core/rustAdapter.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 为什么需要 NormalizedNode？

不同编程语言与不同 AST 解析库生成的语法树节点结构差异极大：
* TypeScript Compiler API 产生 `ts.Node`，使用数字 `SyntaxKind`；
* Rust `oxc-parser` 产生基于 ESTree 的 JS 对象，使用字符串 `type`；
* `tree-sitter`（Rust 语言分析）产生原生 C 绑定对象。

为了使核心分析规则（常量提取、圈复杂度计算等）**编写一次、多语言通用**，引擎定义了标准归一化节点结构 `NormalizedNode`。

---

## 2. 核心归一化模型 `NormalizedNode`

```typescript
export interface NormalizedNode {
  /** 归一化通用节点类型 (如 FunctionDeclaration, NumericLiteral, IfStatement) */
  kind: NormalizedKind;
  /** 原始解析器保留的类型标识（排查与调试用） */
  rawKind?: string | number;
  /** 源码物理位置区间 (1-based line/column 与 0-based offset) */
  start?: SourceLocation;
  end?: SourceLocation;
  /** 标识符名称或节点字面量文本 */
  name?: string;
  value?: string;
  /** 子节点列表 */
  children?: NormalizedNode[];
  /** 语法语义标记 (只在必要时由适配器按需投影) */
  isConstBound?: boolean;
  isConstructor?: boolean;
  branchWeight?: number;
}
```

---

## 3. 语言适配器接口契约 (`LanguageAdapter`)

每个语言拥有独立的适配器，负责将源码文本转换为 `NormalizedNode` 树：

```typescript
export interface LanguageAdapter {
  id: string; // 'typescript' | 'oxc' | 'rust'
  extensions: string[]; // ['.ts', '.js', '.rs', ...]
  parse(content: string, filePath: string, seed?: IncrementalFileState): ParsedSource;
  createProjector?(content: string, filePath: string): NodeProjector;
}
```

* **TypeScript 适配器** (`typescriptAdapter.ts`)：基于 TypeScript 原生 AST，支持 TSX/JSX、全套装饰器及顶级导出。
* **Rust 适配器** (`rustAdapter.ts`)：基于 `tree-sitter-rust`，自动解析 `fn`、`impl`、`match` 分支、宏声明与字面量，无缝支持 Rust 语言的常量提取与复杂度分析。
* **Python 适配器** (`pythonAdapter.ts`)：基于 `tree-sitter-python`，映射 `def`/`class`/`lambda`/赋值/分支/字面量节点；`def` 在类体内识别为方法、`__init__` 保持 `Class.__init__` 命名、模块级 `UPPER_SNAKE_CASE` 赋值视为常量绑定，docstring/装饰器参数/下标/字典键等字面量按容忍上下文豁免，`and`/`or`/`elif`/`except`/推导式条件均计入圈复杂度。
* **扩展入口**：新增语言只需实现 `LanguageAdapter` 并在 `adapters.ts` 注册工厂；未被任何适配器认领的扩展名会触发 [引擎级 fail-closed 诊断](../04-analyzers-and-rules/01-builtin-rules.md)（`LANG-UNSUPPORTED`），不再静默回退 TypeScript 解析器。
