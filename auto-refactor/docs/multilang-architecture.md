# auto-refactor — 多语言架构与实现

> 状态：**已实现（TS/JS + Rust）**。机制：**每语言独立适配器**（`LanguageAdapter`）。
> TS 输出经字节级回归验证零变化；Rust 经 tree-sitter 纯句法分析端到端打通。

## 1. 为什么现在要抽象

当前 `src/core/traverse.ts` 与三个 analyzer 全部直接依赖 `typescript` API
（`ts.forEachChild` / `ts.isNumericLiteral` / `ts.SyntaxKind` …）。要支持 Rust，
等于重写解析层与每个 analyzer。出路是把"遍历 + 节点识别"抽成语言无关接口，
让 analyzer 面向**归一化节点种类**，而非 `ts.Xxx`。

核心原则：**单遍多路复用引擎保持不变**，只把"如何拿到子节点 / 如何判定节点种类 /
如何推导作用域"交给适配器。analyzer 拿到的是统一后的 `NormalizedNode` + `VisitFrame`，
完全不知道自己在分析哪种语言。

## 2. 归一化节点模型

```ts
// core/multilang.ts

export enum NodeKind {
  SourceFile = 'SourceFile',
  Function = 'Function',          // 自由函数 / fn
  Method = 'Method',              // 结构体/impl/trait 内的方法
  Struct = 'Struct',
  Class = 'Class',
  Impl = 'Impl',                  // Rust impl / TS 类实现
  Trait = 'Trait',                // Rust trait / TS interface(行为)
  Interface = 'Interface',
  Variable = 'Variable',          // let / var
  Constant = 'Constant',          // const
  Field = 'Field',                // 结构体字段
  NumericLiteral = 'NumericLiteral',
  StringLiteral = 'StringLiteral',
  Literal = 'Literal',            // 泛型字面量（无子类型时）
  Call = 'Call',
  BinaryExpr = 'BinaryExpr',
  ControlFlow = 'ControlFlow',     // if/for/while/match/switch
  Block = 'Block',
  Other = 'Other',
}

export interface Position { line: number; column: number; }

export interface NormalizedNode {
  kind: NodeKind;
  rawKind: string;                // 语言原生种类（ts.SyntaxKind 名 / tree-sitter 类型串）
  text: string;                   // 节点源码文本（替代 node.getText）
  start: Position;
  end: Position;
  name?: string | null;           // 声明名 / 标识符名（适用时）
  isNumeric?: boolean;
  isString?: boolean;
  hasFunctionInitializer?: boolean; // 用于绑定名推断（const x = () => …）
  branchWeight?: number;          // 决策点权重（圈复杂度累加用，默认 0）
}

export interface NormalizedAst { root: NormalizedNode; }
```

`branchWeight` 由适配器在解析时标注：TS 的 `if/for/while/switch/case/?/&&/||`
各 +1；Rust 的 `if/while/for/match/?/&&/||` 各 +1。ComplexityAnalyzer 直接累加
`node.branchWeight`，**彻底语言无关**。

## 3. 适配器契约

```ts
export interface LanguageAdapter {
  /** 唯一 id，用于注册表与配置键 */
  id: string;
  /** 本适配器认领的文件后缀 */
  extensions: string[];
  /** 解析源文件 → 归一化 AST（setParentNodes 等由适配器自行决定，引擎不依赖 node.parent） */
  parse(content: string, filePath: string): NormalizedAst;
  /** 取根节点 */
  root(ast: NormalizedAst): NormalizedNode;
  /** 取子节点（引擎据此做单遍下降，threading VisitFrame） */
  children(node: NormalizedNode): NormalizedNode[];
}
```

关键：**遍历与 `VisitFrame`（parent/grandparent/depth/className/binding）仍由引擎持有**，
适配器提供 `children()`；作用域（className/binding）推导由**引擎内联**完成——
语言规则完全基于归一化 flags（`isClassDefining` / `functionLike` /
`introducesBinding` / `bindingName`）。这样单遍多路复用逻辑一行不动。

> 实现注记：设计稿的 `scopeOf(node, parent, grandparent)` 在实现时调整为
> `childScope(node, className, binding)` —— 作用域推导需要**引擎线程化的祖先作用域**
> （className/binding），仅凭 parent/grandparent 两层无法还原，故把语言规则收进适配器、
> 由引擎把线程化值传入。P0-2 起进一步内联：TS 与 Rust 两适配器的 childScope 实现
> 逐字相同，改为在引擎 `traverse.ts` 内用局部变量零分配推导（消除每节点 1 个
> `{className,binding}` 对象）。语义不变。

## 4. 引擎改造（结构不变，仅换节点来源）

`src/core/traverse.ts` 的 `runStreaming` 增加 `adapter` 参数，节点访问从
`ts.forEachChild(node, …)` 改为 `for (const c of adapter.children(node)) …`；
`className`/`binding` 推导由引擎内联完成（基于归一化 flags，见第 3 节注记）。

`VisitFrame` 接口、`StreamingEntry`、`FileMetricCollector`、analyzer 的
`visit(ctx, parent, grandparent, depth, className, binding)` 签名**完全不变**。

## 5. Analyzer 改造（去 TS 化）

三个 analyzer 仅替换"节点识别"手段，逻辑/阈值/输出格式不变：

| 原写法 | 新写法 |
|--------|--------|
| `ts.isNumericLiteral(node)` | `node.kind === NodeKind.NumericLiteral` |
| `ts.isStringLiteral(node)` | `node.kind === NodeKind.StringLiteral` |
| `isFunctionLike(node)` | `node.kind === Function \|\| node.kind === Method` |
| `isTopLevelDecl(node)` | `parent.kind === SourceFile && (node.kind 属于 顶层声明集)` |
| `node.getText(sf)` | `node.text` |
| 圈复杂度 `switch(ts.SyntaxKind)` | `sum(node.branchWeight)` |
| `nameFor(node, className, binding)` | 不变（className/binding 已由适配器归一化） |

`detail.lines`（重复字面量行号）、`FileMetric`、报告格式均与现在一致。

## 6. 两个具体适配器

### 6.1 TypeScriptAdapter（保留现有能力，零行为变更）
- `parse`：`ts.createSourceFile(content, …, setParentNodes:false)` → 包装成
  `NormalizedNode`（递归把 `ts.Node` 映射为 `NormalizedNode`，填 `kind`/`text`/`branchWeight`）。
- `children`：返回当前节点的归一化子节点数组。
- 作用域：class/function/binding 推导已内联进引擎（基于归一化 flags），适配器只预计算
  `isClassDefining`/`functionLike`/`introducesBinding`/`bindingName` 等 flags。
- 依赖：`typescript`（已有）。

### 6.2 RustAdapter（新增）
- `parse`：`tree-sitter-rust` 解析 → 把 tree-sitter 的 `SyntaxNode` 映射为
  `NormalizedNode`（`rawKind` 用 tree-sitter 类型串如 `function_item`/`struct_item`/
  `impl_item`/`let_declaration`/`integer_literal`/`string_literal`，并据此填 `kind`/`branchWeight`）。
- `children`：tree-sitter 游标的子节点。
- 作用域：impl/struct 名作为 `className`；`fn` 名或 `let x = …` 绑定作为 `binding`
  （推导内联进引擎，适配器只预计算对应 flags）。
- 依赖：`tree-sitter` + `tree-sitter-rust`（需原生构建，或用 `web-tree-sitter` 的 WASM
  版以避免 native build）。纯句法分析，**无需 rustc / 类型信息**。

> 可行性结论：**TS + Rust 可行**。两者 analyzer 都是句法级，tree-sitter 的语法树足够。
> "每语言独立适配器"是架构；Rust 适配器内部用 tree-sitter 只是实现选择，不冲突。

## 7. 适配器注册与语言识别

沿用现有"声明式注册"风格：

```ts
const adapters: Record<string, LanguageAdapter> = {
  typescript: new TypeScriptAdapter(),
  rust: new RustAdapter(),
};

function adapterFor(filePath: string): LanguageAdapter {
  const ext = path.extname(filePath);
  return Object.values(adapters).find((a) => a.extensions.includes(ext))
    ?? adapters.typescript; // 兜底
}
```

`ScanConfig.include` 增加 `**/*.rs`；analyzer 加载时按扩展名选适配器，再 `parse →
runStreaming(adapter, ast.root)`。外部 `no-console` 这类无 `visit` 的插件仍走 `analyze`
兜底，不受影响。

## 8. 迁移步骤（已执行）

1. ✅ 新增 `core/multilang.ts`：`NodeKind` / `NormalizedNode` / `LanguageAdapter` / `ScopeInfo`。
2. ✅ `core/typescriptAdapter.ts`：`TypeScriptAdapter`（包装现有 `ts`，行为保持）。
3. ✅ 改造 `runStreaming(adapter, root, entries)`，`traverse.ts` 去 TS 化。
4. ✅ 三个 analyzer 改为 `NodeKind` 判定 + `node.text` + `branchWeight`。
5. ✅ `analyzer.ts` / `worker.ts` 接 `adapterFor()`（`core/adapters.ts` 注册表），
   `ScanConfig.include` 默认含 `**/*.rs`。
6. ✅ `core/rustAdapter.ts`：`RustAdapter`（tree-sitter-rust）+ Rust 语料/基线
   （`scripts/validate-equivalence.js` 新增 `rust-inproc` / `rust-workers` 两场景）。

## 9. 风险与备注（验证结论）

- **tree-sitter 依赖**：`tree-sitter` + `tree-sitter-rust` 已加入 dependencies，native
  binding 正常加载（worker 线程内亦可）。如遇原生构建问题可换 `web-tree-sitter`（WASM），
  适配器内部切换即可。
- **作用域语义**：TS class + 箭头绑定 vs Rust impl + fn 映射进统一 `{className, binding}`
  （Rust 的 `impl Foo` 以实现类型为 className，`let x = |..|` 以 x 为 binding，对齐 TS
  `const x = () => …`）。
- **回归保障**：`scripts/validate-equivalence.js` 现为 **6 场景字节级比对**（TS 4 +
  Rust 2，均含 inproc 与 worker 线程路径）。当前 ALL PASS。
- **性能（2026-08-13 最终实测，QA 独立复测）**：
  | 场景 | NEW（多语言+P0 优化） | MIXED（旧多遍遍历） | 比值 |
  |------|--------|--------------|------|
  | 大文件（12×~2600 行，5 次中位） | 584ms | 853ms | **1.46× 快（-31.5%）** |
  | 中小文件（300，3 次中位） | 119ms | 103ms | 0.86×（慢 ~16%，绝对量 ~0.05ms/文件） |
  | 物化耗时（单文件 200 函数，本机） | 35.5ms（含 createSourceFile 12.4ms，mapNode 23.1ms） | — | 折算物化降幅 ~32% |
  - 优化历程：多语言物化层曾使大文件慢 28%；经**第一轮**（text 懒物化 / introducesBinding
    单次化 / 跳过纯 token）拉回持平，**第二轮 P0 五项**（位置惰性化 / scope 推导零分配 /
    行统计共享 / 定向 name+Rust 单次化 / worker 批处理+transferable 预读）后大文件
    **1.46× 反超**。P0 方案详见 `docs/perf-optimization-plan.md`。
  - 中小文件仍慢 ~16% 是物化固定成本的结构性代价；彻底追平需 roadmap 的
    "TS 零物化懒投影"（P1-1）。
- **worker 路径修复（2026-08-13，重要）**：`BUILTIN_MODULE_PATHS` 原为 `./analyzers/...`
  （从 dist/core/worker.js 解析到不存在的路径），worker 启动即 MODULE_NOT_FOUND →
  静默回退 in-process —— 旧 `corpus-workers`/`rust-workers` 一直在测兜底、从未真跑 worker，
  旧 benchmark "worker 更快"结论不成立。已改为 `../analyzers/...`；QA 以 Worker 构造器计数
  证实 4 线程真实 spawn、workers=1 vs 4 输出逐字节一致。
- **benchmark.js 健壮性（2026-08-13）**：buildCorpus 现先清理 `.bench-corpus`（防残留
  语料污染对比）；`--vs-mixed` 增加 `Module._initPaths()` 使运行时 NODE_PATH 生效
  （此前 MIXED 对比一直报 Cannot find module 'typescript'）。
