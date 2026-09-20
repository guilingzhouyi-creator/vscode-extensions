# 多语言通用 AST 抽象与适配器 (Multilang AST Abstraction)

> **所属模块**：`02-parsers-and-ast`  
> **核心源码**：`src/core/multilang.ts`, `src/core/adapters.ts`, `src/core/typescriptAdapter.ts`, `src/core/pythonAdapter.ts`, `src/core/rustAdapter.ts`, `src/core/gdscriptAdapter.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 为什么需要统一的 NormalizedNode？

现代多语言工程（如跨前端、后端、游戏引擎与脚本系统）使用的语法解析器各不相同：
* **TypeScript / JavaScript**：官方 TypeScript 编译器产生 `ts.Node`（数字 `SyntaxKind`）；
* **Rust oxc-parser**：Rust 原生解析输出 ESTree 格式的纯 JS 对象；
* **Python**：基于 `tree-sitter-python` 生成原生 C 绑定的语法树；
* **Rust**：基于 `tree-sitter-rust` 生成原生语法树；
* **GDScript**：针对 Godot 引擎脚本的专门结构映射；
* **Markdown**：针对工程契约与技术规范文档的词法与语义解析。

为了使核心分析器（如圈复杂度、常量提取、大文件拆分与全域治理）能够**编写一次、全语言通用生效**，引擎定义了通用的归一化语法树节点模型 `NormalizedNode`。

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
  /** 语法语义标记 (按需投影，杜绝全局内存膨胀) */
  isConstBound?: boolean;
  isConstructor?: boolean;
  branchWeight?: number;
}
```

---

## 3. 语言适配器矩阵与契约 (`LanguageAdapter`)

每个语言拥有独立的适配器，实现标准接口契约：

```typescript
export interface LanguageAdapter {
  id: string;
  extensions: string[];
  parse(content: string, filePath: string, seed?: IncrementalFileState): ParsedSource;
  createProjector?(content: string, filePath: string): NodeProjector;
}
```

### 五语言适配矩阵

| 语言 | 适配实现 | 底层引擎 | 核心语法映射能力 |
| :--- | :--- | :--- | :--- |
| **TypeScript / JS** | `typescriptAdapter.ts` | TS Compiler API / oxc | 支持 TSX/JSX、装饰器、顶层命名导出、模块调用链 |
| **Python** | `pythonAdapter.ts` | `tree-sitter-python` | 映射 `def`/`class`/`lambda`，类内方法识别，`and`/`or`/推导式分支权重 |
| **Rust** | `rustAdapter.ts` | `tree-sitter-rust` | 映射 `fn`/`impl`/`match` 分支、宏声明、常量提取与复杂度计算 |
| **GDScript** | `gdscriptAdapter.ts` | Godot 词法与语法解析器 | 识别静态类型 `:=`、信号 `signal`、枚举绑定、方法与循环控制流 |
| **Markdown** | `src/analyzers/docs.ts` | 专用 Markdown 语义分析器 | 校验代码围栏平衡性、相对链接存在性及段落单源卫生 |

* **安全闭环 (Fail-Closed)**：未被任何适配器领受的扩展名会触发 `LANG-UNSUPPORTED` 告警，严禁静默回退导致假绿通过。
