# OXC 解析器替换可行性调研报告（oxc-parser → 替换 ts.createSourceFile）

> 调研人：架构师（高见远）｜日期：2026-08-13｜状态：**结论 A — 字节等价可行（已按本文档实现）**
> 范围：只做调研 + 最小 POC，未改动 `src/`、`scripts/validate-equivalence.js`、`scripts/baselines/*`。POC 脚本位于 `C:/tmp/oxc-poc/`（oxc-poc.mjs / oxc-compare.cjs / oxc-measure.cjs / oxc-pos-text.mjs），已从仓库清理。
> 环境：`oxc-parser@0.144.0`（已 `npm install --no-save`，可保留给工程师用）；`typescript@5.9.3`；Node v22.22.2。

---

## 实施完成状态（2026-08-13，团队：架构师→工程师→QA→QA 复验）

**Phase 1 + Phase 1.5 已完成并通过 QA 无条件验收**：
- 新增 `src/core/oxcAdapter.ts`（实现 LanguageAdapter，id 'oxc'，严格按本文档 §5 规则 + §5.7 后补充的下降修复）
- `parser: 'typescript' | 'oxc'` 配置开关（默认 `'typescript'`；CLI `--parser`、`ScanOptions.parser`、config.schema.json 同步）
- validate 新增 3 个 oxc 场景（samples-default-oxc / corpus-inproc-oxc / corpus-workers-oxc，**复用现有 TS 基线**）→ **9 场景全 PASS**
- 依赖：`oxc-parser@0.144.0` 锁版本进 dependencies（ESM-only，Node ≥22.12 的 require(esm) 惰性加载，默认 TS 路径不触碰 native binding）
- Phase 1.5 修复（QA 实测发现的高流行度漏报）：TSAsExpression 家族（as const/as any/satisfies）与 Decorator 从"整节点跳过"改为**下降**；collectLiteralsInType 的 tolerated 仅对 NumericLiteral（对齐 TS：字符串类型字面量报 hardcoded-string）
- 性能（QA 复测）：纯解析 **~1.3-4.5×** 快（机器/负载浮动）；总扫描提升温和（物化 normalize 占大头，oxc 反射式 normalize 吃掉部分 parse 增益）
- **Known Divergences（全部为 oxc 漏报方向，无误报；语料/夹具已覆盖项全部字节等价）**：
  1. `export * from './mod'` → 模块说明符字符串不物化（TS 报 hardcoded-string）【QA 实测确认】
  2. StaticBlock → 内层函数/嵌套不计数（functions/maxNestingDepth 差异）【QA 实测确认】
  3. TSParameterProperty（`constructor(private x = 5)` 默认值字面量）【声明未复验】
  4. `.d.ts`（lang:'ts' 而非 dts 模式）【未测】
  5. 枚举 3+ 相同值 duplicate-literal 边角【未复验】
  6. JSX 属性字符串双端一致报 hardcoded-string（语义差异但字节等价）【未复验】
  - `import x = require('foo')` 曾列差异，QA 实测**两侧一致**（已从清单移除）

---

## 1. 结论（TL;DR）

**判定：A. 字节等价可行。** 用一个 ~300 行的 oxc 分支适配器，可以在**不改引擎（traverse.ts）、不改 3 个 analyzer、不改 validate 脚本与基线**的前提下，对 validate 全部 6 场景覆盖的语料产出**逐字节一致的 issue + FileMetric**。

**核心证据（POC 实测）：**

| 实验 | 结果 |
|---|---|
| 原型 oxc 适配器 vs 现有 TS 适配器，经真实引擎（runStreaming + constants/complexity/large-file/FileMetricCollector）逐字节比对 | **18/18 文件 PASS**（6 个 validate 模板×2、sample.ts、run-from-script.js、legacy.js(CommonJS)、bigfile.ts(重复字面量排序)、extra-edge.ts(interface/enum/type alias/默认导出/模板串/对象方法/binding)、widget.tsx(JSX)） |
| 位置等价（前有注释/空行/缩进/非 ASCII/emoji） | **0 失配**（leading/nonAscii/unicodeLiteral/textCases 共 18 个关键节点全对） |
| 文本等价（raw/span-slice vs TS getText：单双引号、转义、模板串、16 进制、BigInt、正则、JSX 属性） | **0 失配**（10/10） |
| 性能（~200 函数 / ~3000 行 / 98.9KB，10 次均值） | `oxc.parseSync 4.89ms` vs `ts.createSourceFile 14.90ms` → **3.05x**，单文件省 ~10ms |
| `npm run validate`（现状基线） | 6 场景全 PASS（48/60/68/68/15/15 issues） |

---

## 2. oxc-parser Node API 调研结论

### 2.1 安装与版本
- `npm install oxc-parser --no-save` → **0.144.0**（ESM-only 包，`"type": "module"`，Node 需 ^20.19 或 >=22.12）。
- 原生绑定走 `@oxc-parser/binding-<platform>`（可选依赖，自动装当前平台；本机为 `binding-win32-x64-msvc`）。另有 wasm 回退。

### 2.2 关键 API（`src-js/index.d.ts` 实测）
- `parseSync(filename, sourceText, options?): ParseResult`（同步，推荐，文档明确 async 收益低：反序列化在 JS 线程，占比可达 3–20 倍于 Rust 侧解析，异步仅省 Rust 侧耗时）。
- `parse(...)` 异步版：**不建议**。多文件并行应走 worker 线程 + `parseSync`（本项目 scan 已支持 workers，天然适配）。
- `ParserOptions`：`lang: 'js'|'jsx'|'ts'|'tsx'|'dts'`；`sourceType: 'script'|'module'|'commonjs'|'unambiguous'`；`astType: 'js'|'ts'`（默认按 lang/扩展名推断）；`range`（默认 false，额外加 `[start,end]` 数组，无用）；`preserveParens`（默认 true，保留 ParenthesizedExpression——**与 TS 树一致，必须保持默认**）；`showSemanticErrors`（默认 false，勿开，会多一次语义 pass）。
- `ParseResult`：`.program`（ESTree 风格 Program）、`.comments`、`.errors`（语法+语义错误数组，**AST 仍然产出**——与 TS `createSourceFile` 不抛错、只记 parseDiagnostics 的行为对齐；当前管线本就不消费 TS 诊断，故行为等价）。

### 2.3 节点模型（与 TS 的关键差异）
- 每个节点有 `type`（ESTree 字符串，如 `"VariableDeclaration"`）+ `span {start, end}`。
- **span 是 UTF-16 码元偏移，与 JS 字符串下标、TS 偏移完全一致**（用中文、emoji 实测：`src.slice(n.start, n.end) === 源码片段`）。不是 Rust 侧文档里的 UTF-8 字节偏移——NAPI 反序列化已换算。**这是位置可等价的前提。**
- **没有 line/column**：只有 span，需自己按源码换行换算（见 §4）。
- 文本：`Literal` 有 `raw`（含引号原样文本，== TS `getText`）；其余节点需 `src.slice(span)`。
- 子节点遍历：**无通用 forEachChild**。但包内置 `visitorKeys`（`generated/visit/keys.js`）与 `Visitor`（enter/exit）类；也可**反射对象字段**（跳过 `parent`/`type`，对 `{type: string}` 对象与数组递归）——POC 用反射实现并验证等价。
- `parent` 指针默认**不填充**（类型上可选，实测 `'parent' in node === false`）。适配器自上而下构造，不需要父指针。
- 常见类型名差异（映射表见 §5.2）：
  - 字面量统一为 `"Literal"`（靠 `typeof value` 区分 number/string/bigint；`raw` 拿文本）；
  - 标识符统一 `"Identifier"`（不区分 Binding/Reference/Name——反正都会被跳过）；
  - `a && b`/`a || b`/`a ?? b` 是 `LogicalExpression`（TS 是 BinaryExpression，**都要映射成 NodeKind.BinaryExpr**）；
  - 模板串是 `TemplateLiteral`（无插值 == TS `NoSubstitutionTemplateLiteral` → NodeKind.StringLiteral；有插值 == TS `TemplateExpression` → Other）；
  - `export`/`import` 是**包装节点**（`ExportNamedDeclaration` 等），TS 是语句上的 modifier——需拍平（§5.3）；
  - `switch default` 也是 `SwitchCase`（`test: null`），TS 是 `DefaultClause`——**branchWeight 必须为 0**（POC 抓到的唯一 bug，已修复验证）。

### 2.4 语法容错（实测 errors=0 的语法）
装饰器、enum、type alias、.tsx/.jsx、CommonJS `module.exports`、async/await、try/catch/finally、nullish/可选链、getter/setter、generator —— **全部 0 errors 解析成功**。仅 `a && b || c ?? d`（无括号混用）报 1 个语义错误但 AST 正常产出（TS 同样报错，行为对齐）。

---

## 3. 关键差异清单（POC 逐项对比结论）

### 3.1 顶层语句类型映射（oxc type vs ts.SyntaxKind）
```
oxc                          ts                      备注
TSInterfaceDeclaration      InterfaceDeclaration     kind→NodeKind.Interface
VariableDeclaration         FirstStatement           kind→NodeKind.Variable（无 VariableStatement 包装层）
ExportNamedDeclaration      FunctionDeclaration     包装节点，拍平后用 declaration 映射，位置取包装.start
ExportNamedDeclaration      FirstStatement           export const ...
FunctionDeclaration         FunctionDeclaration     裸函数（无包装）
ExpressionStatement         ExpressionStatement     module.exports = ... 等
```
差异点全部由 §5 的适配器映射补偿，无需改下游。

### 3.2 位置差异（最大风险点，已实测消除）
- oxc span == TS 偏移（UTF-16），**前有注释/空行/缩进的节点、非 ASCII 前置、emoji 前置，换算后 0 失配**。
- 唯一系统性差异：**导出的函数/类**——TS `getStart()` 含 modifier（指到 `export`），oxc FunctionDeclaration span 从 `function` 开始（不含 export）。补偿：被 ExportNamedDeclaration/ExportDefaultDeclaration 包装的 functionLike/class，**位置用包装节点的 `start`**。POC 已验证该补偿让 unit_complex 等 location 精确落在 `export` 处（行 1 列 1）。
- MethodDefinition/PropertyDefinition 的 span **含 accessibility/static/async 前缀**（`private method()` 从 `private` 起）——与 TS `getStart` 含 modifier 一致，无需补偿。

### 3.3 文本差异（0 失配）
- 字符串/数字/BigInt/正则：`Literal.raw` == TS `getText`（含引号原样）。
- 无插值模板串：`src.slice(span)` == TS `getText`（含反引号）。
- JSX 属性字符串、转义引号：一致。

### 3.4 子节点遍历
- 反射 oxc 字段 == TS `forEachChild` 去 skippable token 后的节点集合（由 18/18 引擎级比对间接证明：CC 求和、maxNestingDepth、重复字面量首现序、functions 计数全部一致）。
- 注意：**方法（MethodDefinition / 对象方法简写 Property.method=true）的 `value: FunctionExpression` 必须“内联”**——TS 方法节点没有嵌套 FunctionExpression，参数/函数体是方法节点的直接子节点；否则会多出一层 Function 节点（POC 首轮失败点：functions 计数翻倍、方法名变 anonymous）。
- 类型节点（`TSTypeAnnotation` 等 TS*）不物化；但**类型内的字面量要物化且 tolerated=true**（TS 会物化 `type X = 5` 里的 5）。

### 3.5 性能
- 200 函数文件：`oxc.parseSync 4.89ms` vs `ts.createSourceFile 14.90ms`（3.05x，省 ~10ms/文件）。
- 对原 profile（createSourceFile 12.4ms / 单文件总 35.5ms）：解析变成 ~4.1ms → **单文件总耗时约 27ms，约省 23%**（仅解析部分；normalize/物化成本不变）。
- 全量 `TypeScriptAdapter.parse`（解析+物化）实测 49.88ms——**物化占大头**。换解析器只省解析段，物化段若想再省需另做向量化（超出本次范围）。

---

## 4. 位置换算函数（适配器内实现）

由于 oxc span 已是 UTF-16 偏移，换算与 TS `getLineAndCharacterOfPosition` 完全等价，O(log n) 二分：

```ts
// 构建行起点表（每行第一个字符的偏移；\n 后为下一行起点）
const lineStarts: number[] = [];
for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);

function posOf(off: number): Position {           // 1-based line/column
  let lo = -1, hi = lineStarts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
  return { line: lo + 2, column: off - (lo >= 0 ? lineStarts[lo] : 0) + 1 };
}
```

---

## 5. 适配器改造方案（TypeScriptAdapter 内加 oxc 分支 / 或新文件 `src/core/oxcAdapter.ts`）

> 引擎与 analyzer 零改动（继续消费 `NormalizedNode` 语义字段）。仅新增一个实现 `LanguageAdapter` 的 oxc 适配器，并在 `adapters.ts` 注册、config 加 `parser: 'typescript' | 'oxc'` 开关。

### 5.1 parse 入口
```ts
const res = parseSync(filePath, content, {
  lang: /\.tsx?$/.test(filePath) ? (filePath.endsWith('x') ? 'tsx' : 'ts') : filePath.endsWith('jsx') ? 'jsx' : 'js',
  sourceType: 'unambiguous',   // 对齐 TS createSourceFile 的自动 module/script 判定
  preserveParens: true,        // 必须保持默认，与 TS 树一致
});
// res.errors 忽略（与现状一致：不消费 TS 诊断）
```

### 5.2 kindOf 映射表（oxc type → NodeKind）
| oxc type | NodeKind | 备注 |
|---|---|---|
| Program | SourceFile | |
| FunctionDeclaration / FunctionExpression / ArrowFunctionExpression | Function | |
| MethodDefinition；Property(method===true) | Method | 后者是对象方法简写 `m(){}`（TS MethodDeclaration）；`isConstructor = kind==='constructor'` |
| ClassDeclaration / ClassExpression | Class | |
| TSInterfaceDeclaration | Interface | |
| VariableDeclaration | Variable | |
| Literal（`typeof value==='number'`） | NumericLiteral | |
| Literal（`typeof value==='string'`） / TemplateLiteral(expressions.length===0) | StringLiteral | 无插值模板串文本 = `src.slice(span)` |
| Literal（bigint） | Other | 与 TS BigIntLiteral→Other 一致 |
| CallExpression / NewExpression | Call | |
| BinaryExpression / LogicalExpression / AssignmentExpression | BinaryExpr | 逻辑/赋值都归 BinaryExpr（对齐 TS） |
| If/For/ForIn/ForOf/While/DoWhile/SwitchStatement/SwitchCase/CatchClause/TryStatement | ControlFlow | |
| BlockStatement | Block | |
| 其余（VariableDeclarator、Property、PropertyDefinition、ExpressionStatement、ObjectExpression、ImportDeclaration、TSEnumDeclaration…） | Other | 参照 TS default |

### 5.3 结构/标志补偿（POC 已验证的全部规则）
1. **拍平 export 包装**：Program.body 遇 `ExportNamedDeclaration/ExportDefaultDeclaration` → 用其 `declaration` 映射为语句，置 `exported=true`，并把该声明（若 functionLike/Class）的 **start 换成包装.start**（§3.2）。`ExportAllDeclaration`（无 declaration）跳过。这保证 topLevel 计数、maxNestingDepth、exportedSymbols 与 TS 一致（**不能**把包装物化成节点，否则深度 +1 破坏 maxNestingDepth）。
2. **方法 value 内联**：MethodDefinition / Property(method) 的 `value: FunctionExpression` 不物化，其 children（params/returnType/body）直接挂到方法节点下。
3. **字面量判定**：`isLiteral`（需要 text/start/end/constBound/tolerated）仅 NumericLiteral/StringLiteral。
4. **introducesBinding / bindingName**：`VariableDeclarator.init` 是函数值；`Property(!method).value` 函数值；`PropertyDefinition.value` 函数值；`AssignmentExpression(operator '=').right` 函数值。bindingName 分别取 `id.name` / `key` 文本 / `key` 文本 / 左 MemberExpression 的 property 文本（或左 Identifier name）。
5. **isConstBound**：`parent=VariableDeclarator && parent.init===node && grandparent=VariableDeclaration && kind==='const'`；或 `parent=TSEnumMember`。（TS 的三层 VariableDeclarationList→VariableDeclaration→init 对应 oxc 的 VariableDeclaration→VariableDeclarator→init。）
6. **tolerated（精确移植 TS 谓词）**：
   - 数字：父为 `MemberExpression`（computed 与否都 true，对齐 PropertyAccess/ElementAccess）；`Property.key===node`；`TSEnumMember`；类型节点；`SwitchCase.test===node`。
   - 字符串：`ImportDeclaration`/`TSImportEqualsDeclaration`；`Property.key===node`；`MemberExpression && !computed`（**computed=true 不算**，对齐 TS ElementAccess 不在豁免表）；`JSXAttribute.name===node`（对属性值字符串实际不命中——精确复刻 TS 语义）；JSXElement/JSXOpeningElement → false；`CallExpression.arguments` 含 node 且 callee 文本匹配 `/\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/`。
7. **branchWeight**：If/For/ForIn/ForOf/While/DoWhile/SwitchStatement/CatchClause/ConditionalExpression → 1；BinaryExpression/LogicalExpression 的 `&&/||/??` → 1；**SwitchCase：`test===null`（default）→ 0**；其余 0。
8. **increasesNesting**（=TS CONTROL_OR_BLOCK，**不含 CaseClause/CatchClause**）：BlockStatement/If/For/ForIn/ForOf/While/DoWhile/SwitchStatement/TryStatement。
9. **topLevel/exported**：`parent.type==='Program' && type ∈ {Function,Class,TSInterface,TSEnum,TSTypeAlias,TSModule,VariableDeclaration}`；exported = topLevel && 被 export 包装。
10. **text**：Literal 用 `raw`；无插值 TemplateLiteral 用 `src.slice(span)`；其余不物化（与现状懒物化一致）。
11. **名称**：函数/类取 `id.name`；方法取 `key.name`（或 key 文本）。

### 5.4 子节点遍历策略（推荐）
反射字段 + 白名单式跳过：
```ts
function* oxcChildren(n) {
  for (const k of Object.keys(n)) {
    if (k === 'parent' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) for (const x of v) if (x && typeof x.type === 'string') yield x;
    else if (v && typeof v.type === 'string') yield v;
  }
}
```
- 跳过集合 = 全部 `Identifier`/`TemplateElement`/`PrivateIdentifier`/`TSTypeAnnotation`/`TS*` 类型节点/`Decorator`/JSX 文本等（约等于 `isSkippableToken` 的语义：标识符与标点天然不存在于 oxc 树，类型节点额外跳过）。
- 类型节点跳过前先 `collectLiteralsInType`（把其中 Literal 物化为字面量节点、tolerated=true，对齐 TS 对 `type X = 5` 的行为）。
- 备选：用包内置 `visitorKeys`/`Visitor`；POC 用反射已证明稳定，二选一均可。

### 5.5 已知死代码（无需处理）
`complexity.ts` 的 `first.rawKind === 'FunctionKeyword'` 分支**在当前 TS 树里永远不命中**（实测 TS `forEachChild` 从不产出 FunctionKeyword 子节点），因此 oxc 适配器**不需要**合成 FunctionKeyword 节点。若未来想严谨，可给 oxc 适配器补一个 rawKind='FunctionKeyword' 的假首子节点，但**不是字节等价的前提**。

### 5.6 工作量与改动面
- 新增 `src/core/oxcAdapter.ts`（约 250–350 行）+ `adapters.ts` 注册 + config schema 加 `parser` 字段（约 10 行）。
- **零改动**：traverse.ts、3 个 analyzer、multilang.ts、types.ts、validate 脚本、基线。
- 估算：工程师 0.5–1 人日；验收门 = `npm run build && npm run validate` 全绿 + `scripts/benchmark.js`。

### 5.7 风险与缓解
| 风险 | 说明 | 缓解 |
|---|---|---|
| 字节等价依赖谓词精确移植 | POC 18/18 全对但语料有限 | 交付时以 `npm run validate` 6 场景为硬门；额外补非语料夹具（见下） |
| 非语料语法边角 | 插值模板串（TS 物化 TemplateHead 为 StringLiteral，oxc 需取 `quasis[0]`（tail=false）文本 `\`a${`）、`declare`/namespace/`.d.ts`（未测）、装饰器方法 span 起点 | 实施时补 fixture 测试；`.d.ts` 用 `astType:'dts'` 或先排除 |
| oxc 版本漂移 | API 在 0.7–0.15+ 有变化，实测 0.144.0 | **锁定精确版本**（建议 `oxc-parser@0.144.0` 进 dependencies） |
| 原生依赖引入 | `@oxc-parser/binding-*` 新增平台二进制 | 有 wasm 回退；CI 需验证 |
| 语义错误不阻断 | `a && b || c ?? d` 报错但仍出 AST，与 TS 一致 | 无需处理；如担心可加 errors 计数日志 |

---

## 6. 预期收益（实测数据）

| 指标 | ts.createSourceFile | oxc.parseSync | 收益 |
|---|---|---|---|
| 200 函数 / ~3000 行文件解析（10 次均值） | 14.90 ms | 4.89 ms | **3.05x，省 ~10ms** |
| 原 profile 折算（解析 12.4ms / 总 35.5ms） | 12.4 ms | ~4.1 ms | **单文件总耗时约省 23%** |

注意：收益仅来自“解析”段；`mapNode` 物化（占全量 parse 的大头，实测 ~45ms）不变。若未来要更大收益，方向是物化向量化/惰性化（不在本次范围）。

---

## 7. 建议实施路径

**推荐：双适配器共存 + 默认仍走 TS，逐步切换（低风险渐进式）。**

1. **Phase 1（0.5–1 人日）**：实现 `OxcTypeScriptAdapter`（按 §5 规则），`adapters.ts` 注册，config 加 `parser: 'typescript' | 'oxc'`（默认 `'typescript'`）。跑 `npm run build && npm run validate`：**TS 分支必须维持全绿**；`parser:'oxc'` 分支 6 场景也全绿（POC 已证明）。
2. **Phase 2**：补非语料夹具（插值模板、declare、.d.ts、装饰器、getter/setter + 修饰符）并过引擎比对；跑 benchmark 对比真实收益。
3. **Phase 3**：确认无回归后，默认值翻转为 `'oxc'`；保留 TS 分支作为 fallback（config 可切；解析抛异常/errors 异常时自动回退 TS）。
4. **Phase 4（可选）**：稳定后移除 TS 分支，`oxc-parser` 从 devDependency 提升为 dependencies 并锁版本。

**不建议**：全量一次性替换（风险集中在非语料边角）；也不建议维持现状（收益明确且验证充分）。

---

## 8. Anything UNCLEAR / 假设

- **插值模板串**（`\`a${x}b\``）不在 validate 语料内；POC 已验证 oxc 能解析且 quasi span 与 TS TemplateHead 一致，但**未做引擎级字节比对**，实施时需补夹具。
- `.d.ts`（astType 'dts'）与 `declare`/namespace 未覆盖；若产品要扫 .d.ts 需补测。
- 装饰器场景未在引擎级比对（语料无装饰器）；oxc 解析 0 errors，但 MethodDefinition 含装饰器时 span 起点需实测确认（是否含 `@decorator` 前缀）。
- 假设：管线不消费 TS parseDiagnostics（现状如此），故 oxc `errors` 数组忽略是行为等价。
- 假设：worker 场景直接用 `parseSync`（现有 workers 架构不变），不用 async `parse`。
- POC 中 oxc 分支用 `sourceType:'unambiguous'` 对齐 TS 自动判定；若出现 .js 与 TS 判定分歧的文件，需单独夹具验证。

---

## 9. oxc-in-worker 实测（2026-08-13 追加）

> 在 1500 文件 × 2.5KB 密集语料（`C:/tmp/ar-binary-prof/corpus`）上对 **worker 路径**（`parser:'oxc'`，4/8 worker + hybrid K）的实测补充。方法：AR_TIMING=1 逐阶段计时 + 裸 worker load 微基准 + 严格交替 A/B（机器负载漂移 1.67× 已知）。**结论先行：oxc-in-worker 成立（重调 hybrid K 后 w4 -19.7% / w8 -13.4%），但默认 parser 仍为 `typescript`，oxc 是 opt-in。**

### 9.1 模块 load 对比（裸 worker 4 并行）

| 模块 | avg | 说明 |
|---|---|---|
| `require('typescript')` | 178.8–223ms | worker.ts 顶层无条件 import，**两种 parser 都付**（架构级待消项） |
| `require('oxc-parser')` | **12.5ms** | lazy require（OxcAdapter.parse 内）→ 只进首条消息 m1，不进 import 窗口 |
| adapters / traverse / analyzers | ~10 / ~0.3 / ~3ms | 可忽略 |

### 9.2 稳态 per-file parse+物化（worker 表）

| parser | per-file parse+mat | 说明 |
|---|---|---|
| `typescript` | 1.10–1.38ms | 历史 + 本次一致 |
| `oxc` | **0.90ms** | 2.5KB 小文件上 oxc parse 收益压过反射 normalize 损耗（大文件 mapOxc 17.3ms > mapTs 13.4ms 的反向结论**不适用于小文件**）；worker busy 395→227ms |

### 9.3 w4/w8 wall A/B（严格配对，同机同状态，3–5 对取中位）

| 配置 | w4 | w8 |
|---|---|---|
| ts + K=500（现默认） | 682–691ms | 689–730ms |
| oxc + K=500（未重调） | 648ms | 681ms |
| **oxc + K=200（parser-aware 默认）** | **555ms** | **597ms** |
| 差值（vs ts+K500） | **-19.7%** | **-13.4%** |

### 9.4 hybrid 交互（关键）

- oxc 下最优 hybrid K 是 **200–300**，不是 ts 的 500：oxc worker 更快（0.9ms/文件）→ 需卸载的量更少；K=500 对 oxc 实测零收益（≈ no-hybrid）。
- 主线程 in-process 在 oxc 下 ≈ ts（~1.1ms/文件，未变快）—— oxc 收益只在 worker isolate 内兑现。
- 实现：`analyzer.ts` hybridK 按 `config.parser` 选基值（`HYBRID_FILES_TS=500` / `HYBRID_FILES_OXC=200`），`AR_HYBRID_FILES` 手动覆盖优先，`AR_HYBRID=0` 关闭，`availCores>=2n` 核数守卫不变。
- hybrid 在 oxc 下可用且 issues 恒 14835；`npm run validate` 9/9 PASS（corpus-workers-oxc 即 oxc+worker+hybrid 硬门）。

### 9.5 风险清单（oxc opt-in 落地前提）

1. **native prebuild 平台覆盖**：oxc-parser 是 native `.node` 预编译绑定，覆盖依赖发布方 prebuild；当前**无 wasm 回退**（若产品需覆盖无 prebuild 平台需先补）。
2. **ESM-only require**：oxc-parser 为 `"type":"module"`，worker 内 `require(esm)` 需 Node ≥ 22.12（本项目 22.22.2 ✓）。
3. **超纲语法 Divergence**：oxc adapter 补偿已验证 corpus 级，JSX 变体 / 装饰器 / `.d.ts` / `declare` 等未入语料的语法可能 Divergence —— 需扩展 validate 语料后才有资格谈默认翻转。
4. **worker typescript import 未消除**：即使 parser='oxc'，worker.ts 仍无条件 import typescript（~180–220ms/worker）—— 消掉需懒加载改造（架构级，独立于本结论）。

### 9.6 状态

- 默认 parser 仍为 `typescript`（zero change for ts users）；oxc 为 opt-in（`parser:'oxc'`），配 parser-aware K 自动获得 -20%（w4）/-13%（w8）。
- 若未来翻转默认：需先补 9.5-3 的语料扩展回归 + 平台覆盖验证（9.5-1）。
