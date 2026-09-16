# auto-refactor 第二轮代码审查 + 完善优化改造计划（v2）

> 本文档取代 v1 的两份交付物（`auto-refactor-CMP-review.md`、`auto-refactor-CMP-remediation-plan.md`），
> 保留 v1 作为历史。v1 中对缺陷的**根因分析仍然有效**，变更的是基线、门禁状态与优先级。
> 审查日期：2026-09-15 23:00 前后

---

## 0. 基线变更与本文档定位

期间在途 Agent 的改动已停止，代码推进情况如下：

| 项 | v1 审查时 | 现在（v2） |
| :--- | :--- | :--- |
| B6（CMP-\* + uncertainty） | 工作树未提交 | **已提交为 `2e19e7e`**（17 文件，+743/-4） |
| v1 提出的修复 | 未实施 | **仍未实施**（`src/core/uncertainty.ts`、`src/core/governance/codeView.ts` 均不存在） |
| 新在途特性 | — | **B7（data flow / 生命周期 + 增量耦合门禁）**：7 改 2 新 |
| `docs/05-specs-and-benchmarks/08-phase2-work-order.md` | 不在关注范围 | **已进库，是 B2b→B7 的施工工单与验收依据** |

**定位**：本文档 = ① 对 B6 已进库缺陷的复核；② 对 B7 在途改动的审查；③ 覆盖两者的改造计划。

---

## 1. 当前门禁实测总表

命令均在 `auto-refactor/` 下实跑，原始输出已留档。

| 命令 | 结果 | 实测摘要 |
| :--- | :--- | :--- |
| `npm run build` | ✅ exit 0 | `tsc` 通过 |
| `npm run lint` | ❌ **exit 1** | **13 errors**（详见 §3.1） |
| `npm run format:check` | ❌ **exit 1** | Prettier：`dataFlow.ts`、`validate-data-flow.js` 两个新文件不合格式 |
| `npm run gate:comments` | ❌ **exit 1** | 3 issue（2 WARNING 超宽注释 + 1 INFO 误报），strict ratchet → FAIL |
| `npm run gate:self` | ✅ exit 0 | 173 文件 / 7972 issue / newBlocking(error)=0 |
| `npm run validate-data-flow` | ❌ **exit 1** | `[4/4]` 断言失败：期望退出码 1，实得 **2** |
| `npm run validate-compression` | ✅ exit 0 | 但 FP 指标仍为空过（§2） |
| `npm run validate-rules-registry` | ✅ exit 0 | 111 规则（+1 = `PRF-LEAK-001`），文档覆盖 111/111 |
| `npm run validate-docs` | ✅ exit 0 | — |
| `npm run validate-symbol-index` | ✅ exit 0 | 连带 literal-index / call-graph / error-flow 全绿 |
| `npm run gate` | ❌ **必红** | 因 lint + format:check + gate:comments + validate-data-flow 四项 |

**结论：B7 在途改动当前不满足工作单全局约束 #3（`npm run gate` 全绿），不可提交。**

---

## 2. B6 复核：缺陷随提交进了库，且交付证据失实

### 2.1 误报率未变

governance 单开扫描本项目 `src/**/*.ts`：

```
total issues = 530; CMP findings = 16
per rule = {"CMP-DEN-001":7,"CMP-LIN-001":8,"CMP-EXP-001":1}
```

与 v1 实测**逐条一致**（同 15 个文件同行号）：

| 规则 | 命中数 | 误报数 | 误报形态 |
| :--- | ---: | ---: | :--- |
| `CMP-LIN-001` | 8 | 8 | 7 条 JSDoc 注释行 + 1 条 CLI 用法文本（`src/index.ts:242`） |
| `CMP-DEN-001` | 7 | 7 | 6 条正则字面量 + 1 条 JSDoc（`src/core/multilang.ts:111`） |
| `CMP-EXP-001` | 1 | 0~1 | `src/core/oxcAdapter.ts:1039` 的 6 项 `&&` 守卫（可争议，见 §7-1） |
| **合计** | **16** | **15** | **误报率 93.75%** |

### 2.2 交付证据失实（新增发现）

`docs/05-specs-and-benchmarks/08-phase2-work-order.md` 的 B6 交付段（第 180-183 行）记录：

> 3. False positive rate on production codebase is **0.00%** (well below the <= 5% requirement).

而该工单第 56 行声明的 B6 验收标准是：

> 压缩夹具 100% 命中且**既有仓库 FP ≤5%**

第 3-5 行还明确要求：「未完成前不得在提交信息或文档中声称对应能力已交付」。

**实测：既有仓库 FP = 93.75%，超出验收标准 18.75 倍。** 该条证据不成立，属工单禁止的失实声明。根因是 `validate-compression-bounds.js:212` 的指标定义错误：

```js
const fpRate = cmpHitsInGov / totalGovLines;   // 命中数 / 总行数 —— 这不是误报率
```

分子应是"负样本上的命中数"，分母应是"命中总数"。当前写法下 **0 命中 ⇒ 0.00% ⇒ 断言恒真**；把四条规则删空，该节仍全绿。且抽样只有 3 个 governance 文件（538 行）。

### 2.3 其余 B6 项复核

| 项 | 状态 | 证据 |
| :--- | :--- | :--- |
| `summary.uncertainty` 自洽性 | ⚠️ 本次实测成立 | `requiresRuntimeCount: 96`，`postScanPasses: ["dependency-graph","suppressions"]`，`issuesTotal` 与 `issues.length` 一致 |
| 但 `recomputeSummary` 未刷新 `uncertainty` | ❌ **仍存在**（潜伏） | `src/api.ts` 的 `recomputeSummary` 只刷新 `bySeverity` + `issuesTotal`；三个 post-scan 通道仍会 push 后调用它。v1 已证明机制，本次仍未触发（`dependency-graph` 通道产出 0） |
| `requiresRuntime` 误用 | ❌ 仍存在 | `CMT-CON-001`（docstring 缺并发说明）与 `CMP-CAL-001`（回调嵌套深度）仍是纯静态事实 |
| `averageConfidence` 零依据时返回 `1.0` | ❌ 仍存在 | `analysisFilter` 分支未改 |
| 语言声明过宽 | ❌ 仍存在 | 4 个规则对象未声明 `languages` ⇒ 运行时不过滤 |

---

## 3. B7 在途审查

### 3.1 门禁红灯明细（必须先修）

**`npm run lint` — 13 errors**

```
scripts/validate-data-flow.js
   6:1   error  This line has a length of 101. Maximum allowed is 100            max-len
  29:3   error  'computeEffectiveLoc' is assigned a value but never used         no-unused-vars
  30:3   error  'computeCoupling' is assigned a value but never used             no-unused-vars
  31:3   error  'computeComplexityProxy' is assigned a value but never used      no-unused-vars

src/core/intelligence/dataFlow.ts
  12:1   error  This line has a length of 104. Maximum allowed is 100            max-len
 373:1   error  Missing JSDoc @param "content" / @returns                       jsdoc/require-param
 388:1   error  Missing JSDoc @param "content" / @returns
 393:1   error  Missing JSDoc @param "content" / @returns
 411:1   error  Missing JSDoc @param "content" / @returns
```

**`npm run gate:comments` — 3 issue**

```
■ scripts/validate-data-flow.js
  [WARNING] CMT-WID-001 @6:1  — 注释行超 100 列（found 101）
■ src/core/intelligence/dataFlow.ts
  [WARNING] CMT-WID-001 @12:1 — 注释行超 100 列（found 104）
  [INFO]    CMT-CON-001 @35:1 — Missing concurrency semantics:
            Asynchronous function 'TransferType' lacks concurrency safety or reentrancy specification
```

最后一条是**误报**：`dataFlow.ts:35` 是

```ts
export type TransferType = 'direct' | 'async' | 'event' | 'storage';
```

即一个**类型别名**，因联合成员里出现了字符串字面量 `'async'`，被 `CMT-CON-001` 当成"异步函数缺并发语义"。该规则正是 B6 中被打上 `requiresRuntime: true` 的那一条，因此这条误报**同时会污染 `summary.uncertainty.requiresRuntimeCount`**。这也说明 B7 的新代码第一次真正触发了 B6 规则族的误报面。

### 3.2 `--coupling-gate` 不可达（B7 验收项 4 直接失败）

`npm run validate-data-flow` 在 `[4/4]` 断言失败：

```
AssertionError: Consumer runner must exit 1 on coupling gate violation, got 2
```

**根因已精确定位**（不是导入问题）：

```
$ node run.mjs --engine <ROOT> --root <tmp> --coupling-gate --compare-before A --compare-after B
  status = 2
  stderr = "[auto-refactor] config not found: <tmp>\.auto-refactor\config.json"
```

- 我独立验证过 ESM 动态导入**工作正常**：`dist/api.js` 经 `import()` 可见 **148 个具名导出**，`typeof mod.computeIncrementalMetrics === 'function'`，且 `mod.default.computeIncrementalMetrics` 也是函数。所以 `fail('engine api missing computeIncrementalMetrics')` 这条路径并未触发。
- 真正原因：`templates/consumer/run.mjs` 把 `--coupling-gate` 分支**插在了项目配置解析之后**。耦合门禁只需要两个源文件，不需要 `.auto-refactor/config.json`，却被迫先通过配置检查 ⇒ 在**任何没有项目配置的目录里该特性都不可达**，而验证脚本恰恰使用 tmp 目录。
- 去掉 `--engine` 得到同样的错误，进一步证明是执行顺序问题而非引擎定位问题。

### 3.3 `PRF-LEAK-001` 行为缺陷（5 类，全部已复现）

原实现：`detectUnboundedGrowth(filePath, content)`，用布尔标志 + 逐字符花括号计数 + 文件级正则豁免。

| # | 场景 | 期望 | 实测 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| A | 单行定时器 `setInterval(() => { b.push(1); }, 10);` 之后的 `b.push(2)`（**在定时器之外**） | 1 条 | **2 条**（L2、L3 均报 `O(t)`） | ❌ **误报** |
| B | 回调内字符串字面量含 `'}'`：`console.log('}');` 之后才是真实的 `items.push(1)` | 1 条 | **0 条** | ❌ **漏报** |
| C | 文件他处有 `// TODO: consider a limit later` 注释 | 1 条 | **0 条** | ❌ **漏报** |
| D | 真实的无限增长集合，恰好命名为 `ringBuffer`（无任何边界逻辑） | 1 条 | **0 条** | ❌ **漏报** |
| E | 类字段集合 `private entries: string[] = [];` 在循环中被 `this.entries.push(...)` | 1 条 | **0 条** | ❌ **漏报** |

根因（逐条对应）：

- **A / B**：花括号深度在**原始行**上逐字符统计，字符串、模板、注释、正则里的 `{` `}` 会污染深度；且 `inTimerContext` 的解除条件写作 `timerBraceDepth <= 0 && timerStartLine !== lineNum`，**同一行内闭合时不解除**，于是标志沿用到下一行 → A 的误报；而字符串里的 `}` 会把深度提前打回 0 → 同在行末解除标志 → B/C 的漏报。这正是 v1 在 `compressionBounds.ts` 里发现的**同一类缺陷**（无词法屏蔽），而项目里**已经有** `src/core/sourceMask.ts` 这个原语可用。
- **C / D**：`hasCapacityBounding()` 的第 4 个模式是**文件级**的（且不含集合名）：

  ```ts
  new RegExp(`(?:MAX|LIMIT|CAPACITY|clamp|evict|ringBuffer)\\b`, 'i')
  ```

  只要文件里**任何位置**出现 `limit` / `capacity` / `clamp` / `evict` / `ringBuffer` 等词（含注释），**该文件所有集合**都会被判为"已有边界"，规则整体失效 → C、D。
- **E**：`findCollectionDeclarations()` 要求声明带 `const|let|var|this.` 前缀，**类字段声明 `private entries: string[] = []` 不匹配** → 最常见的真实形态完全漏检。

顺带两个工程问题：

- **性能**：`hasCapacityBounding(content, name)` 在**逐行 × 逐集合**的内层被调用，每次现场 `new RegExp` 4 次并对**整个文件内容**做 `.test` ⇒ 复杂度 O(追加点 × 4 × |content|)，大文件上是准二次开销。应提到集合级只算一次并缓存正则。
- **位置精度**：`location` 恒为 `{ line, column: 1 }` 且 `end === start`（零宽区间），与 `governance.ts` 的 `end.column = column + 1` 约定不一致，也不指向真正的追加表达式。

### 3.4 验证脚本的断言质量

`scripts/validate-data-flow.js` 4 组断言中，至少两处不成立：

1. **`[2/4]` 打印 "O(t) and O(n) leaks detected with 100% precision"** —— 该措辞被 §3.3 的 5 类反例直接推翻（1 误报 + 4 漏报）。脚本只测了 3 个正/负夹具。
2. **夹具 C（"有界集合"）是空过的**：其内容为

   ```js
   const ringBuffer = [];
   setInterval(() => { ringBuffer.push(Math.random()); if (ringBuffer.length > 100) ringBuffer.shift(); }, 1000);
   ```

   把中间的 `if (...) shift()` 全部删掉，**断言依然通过** —— 因为集合**名字就叫 `ringBuffer`**，命中文件级模式 4。它验证的不是"检测到了边界逻辑"，而是"名字撞上了关键词"。这属于断言与结论不匹配。
3. 缺少 A/B/C/D/E 五类真实形态的负样本；缺少"同一行闭合的定时器"这类边界样本。

### 3.5 B7 规格缺口（对照工单 B7 条目）

工单第 58-62 行要求：

> `src/core/intelligence/dataFlow.ts`（Source→Validation→Transformation→Storage→Bus→Consumer→SideEffect）与 `ownership/lifetime` 边；**`src/core/editDiff.ts` + `histogramDiff` 聚合出 Effective LOC / Complexity Delta / Duplication Delta / Maintainability Delta**，接 `templates/consumer/run.mjs` 作为 CI 增量门禁。

| 要求 | 状态 |
| :--- | :--- |
| 七阶段图 + ownership/lifetime 边 | ⚠️ **Unwired**：`DataFlowGraph` 及其 `traceLifecycle` / `findPipelines` / `stats` 的**唯一调用方是 `scripts/validate-data-flow.js`**（脚本里手工 `addNode`/`addEdge` 构造）。全仓无任何分析器从真实代码构建该图、无任何消费方读取它。按工单全局约束 #1「入口可达 + … + 结果被消费，缺一即标 Partial/Unwired」，当前必须标 **Unwired**，而 `dataFlow.ts` 文件头却声称已"trace full multi-stage lifecycle pipelines" |
| Effective LOC Delta | ✅ 有（`computeEffectiveLoc`）但**同行块注释误算**：`computeEffectiveLoc('/* c */ const y = 2;\nconst z = 3;') = 1`（应为 2），`const y = 2` 被整行丢弃 |
| Complexity Delta | ⚠️ 有（`computeComplexityProxy`），但按**全文件原文**统计 `?`/`&&`/`||`/`??` 与 `case`，**注释与字符串一并计入** |
| Coupling Delta | ⚠️ 有，但语义与自己的 rationale 矛盾（见下） |
| **Duplication Delta** | ❌ **完全缺失**：`IncrementalMetrics` 接口无该字段 |
| 消费 `editDiff.ts` + `histogramDiff` | ❌ **未消费**：`computeIncrementalMetrics` 只做行计数，未使用既有 diff 底座。工单全局约束 #2「禁止各 Reviewer 自行读取/解析仓库：一律消费共享底座」在此未满足 |
| `maintainabilityDelta` | ⚠️ 计算了但**不参与任何判定**（`verdict` 只看 `effectiveLocDelta`/`couplingDelta`），权重 `-0.1/-0.5/-2.0` 无出处，属装饰性指标 |

**耦合门禁的假拒绝（产品级问题）**：`computeCoupling` 把**相对路径的内部模块**也计为耦合（实测 `computeCoupling("import { X } from './a';") = 1`，与 `node:fs` 等同）。于是：

```
--- 合法的本地分解（行数 -39，新增 1 个本地模块导入）---
effectiveLocDelta = -39, couplingDelta = 1
verdict = FAILED
rationale = Anti-pattern rejected: lines of code decreased by 39 but coupling increased by +1
            (violates maintainability invariant: code deletion must not increase external coupling)
```

rationale 自称校验 "**external** coupling"，而实现把**本地**模块计入 —— **一次正确的"抽模块"重构会被 CI 门禁拒绝**。验证脚本的夹具全部使用相对路径，且只覆盖"导入数下降"的干净案例，因此这个假拒绝从未被测到。

---

## 4. 完善优化改造计划

### 阶段 P0 —— 先让 B7 在途变绿（当前第一优先级，不可提交的硬阻断）

| # | 文件 | 动作 | 验收 |
| :--- | :--- | :--- | :--- |
| P0-1 | `templates/consumer/run.mjs` | 把 `if (opts['coupling-gate']) { ... }` 分支**上移到项目配置解析之前**（紧接 `projectDir` 确定之后）。该分支只依赖 `--compare-before/--compare-after`，不应受 `.auto-refactor/config.json` 约束 | `node run.mjs --root <无配置目录> --coupling-gate ...` 返回 1/0 而非 2；`validate-data-flow` 的 `[4/4]` 转绿 |
| P0-2 | `src/core/intelligence/dataFlow.ts` | ① `:12` 注释折行至 ≤100 列；② 为 `extractDependencies`(373)、`computeCoupling`(388)、`computeEffectiveLoc`(393)、`computeComplexityProxy`(411) 补 `@param`/`@returns` | `npm run lint` exit 0 |
| P0-3 | `scripts/validate-data-flow.js` | ① `:6` 注释折行至 ≤100 列；② 删除未使用的 `computeEffectiveLoc`/`computeCoupling`/`computeComplexityProxy` 导入（或改为真正的断言，见 P2-11） | `npm run lint` exit 0 |
| P0-4 | 两个新文件 | `npx prettier --write` | `npm run format:check` exit 0 |
| P0-5 | 同 P0-2/P0-3 | 超宽注释修复后 `gate:comments` 的 2 条 CMT-WID-001 消失；剩余 CMT-CON-001 的 `TransferType` 误报由 **P1-4** 修 | `npm run gate:comments` exit 0 |
| P0-6 | 全部 | 重跑 `npm run gate` | **exit 0** |

> P0-1 是唯一影响功能可达性的项，其余为格式/契约类，改动量小。

### 阶段 P1 —— B6 缺陷修复（方案沿用 v1，实施位置改为已提交基线）

| # | 文件 | 动作 |
| :--- | :--- | :--- |
| P1-1 | **新增** `src/core/governance/codeView.ts` | 组合 `maskSourceText`（跨行块注释/引号态）+ CMP 自有正则字面量掩码；**不改** `src/core/sourceMask.ts`、**不改** 4 个语言包（爆炸半径最小） |
| P1-2 | `src/core/governance/types.ts` | `RuleEvaluationContext` 增**必填** `masked: string[]` |
| P1-3 | `src/analyzers/governance.ts` | `ensureInitialized` 计算并缓存 `maskedLines`；`visit`/`finalize` 两处 evalCtx 注入。（生命周期已核实：`analyzerRegistry.ts:55-61` 记载逐文件新建实例，缓存安全） |
| P1-4 | `src/core/governance/rules/compressionBounds.ts` | 删 `stripStringLiterals`/`stripRegexLiterals`/`sanitizeLine` 与 `startsWith('*')` 特例；四规则改消费 `ctx.masked`；`hasBitwise` 收紧为只认强位运算 `<< >> ^ ~`；4 个规则对象加 `languages: ['typescript','javascript']`；`CMP-CAL-001` 的 `requiresRuntime` 改 `false` |
| P1-5 | `src/core/rules/entries/governance.ts` | 4 处 `ALL_LANGUAGES` → `[LANGUAGE_TYPESCRIPT,'javascript']`；`'CMP'` 提为 `RULE_FAMILY_CMP` 常量；修正 `:16` 已失效的 "every id starts with GOV-" 注释 |
| P1-6 | `scripts/validate-compression-bounds.js` | `[3/3]` 改为真误报率：**分母 = 命中总数**，**先断言正样本仍有命中**（否则删空规则会 0/0 空过）；新增 12 条负样本夹具 + **本次 15 条误报的原始现场生产文件**零命中断言；断言全部改精确等值 |
| P1-7 | `src/analyzers/comments.ts` | `CMT-CON-001`：① 摘除 `requiresRuntime`（docstring 缺并发说明是纯文本事实）；② **修 `'async'` 字符串字面量误报**（当前对 `type TransferType = 'direct' \| 'async' \| ...` 报"异步函数缺并发语义"）。②为新增项，由 B7 首次触发 |
| P1-8 | `src/core/uncertainty.ts`（新增）+ `src/api.ts` + `src/core/analyzer.ts` | `summarizeUncertainty` 提为共享纯函数；`recomputeSummary` 补算 `report.summary.uncertainty`；`averageConfidence` 无 evidence 时**省略**而非返回 `1.0` |
| P1-9 | `report.schema.json` | `uncertainty` 补 `required: ["requiresRuntimeCount"]` + `additionalProperties: false`；`averageConfidence` 改可选 |
| P1-10 | `docs/05-specs-and-benchmarks/08-phase2-work-order.md` | **更正 B6 证据段**：把 "FP rate 0.00%" 改为实测值并如实标注该验收项当时未达成、及修复后的复测值。这是工单自身的记录纪律要求 |

### 阶段 P2 —— B7 修正（功能正确性 + 规格补齐）

| # | 文件 | 动作 | 修掉的缺陷 |
| :--- | :--- | :--- | :--- |
| P2-1 | `src/core/intelligence/dataFlow.ts` | `detectUnboundedGrowth` 改为消费**掩码视图**（复用 P1-1 的 `codeView`），不再在原始行上数花括号 | A、B |
| P2-2 | 同上 | 用**显式栈**记录嵌套的定时器/循环区间，替代 `inTimerContext`/`inLoopContext` 布尔标志；区间在成功配对时弹出，不再依赖"下一行"解除 | A、B、嵌套场景 |
| P2-3 | 同上 | `hasCapacityBounding` **删除文件级模式**，改为只认针对**该集合名**的局部证据（`name.length/size` 比较、`name.shift/pop/splice/slice/clear/delete`、以及名称含 `ringBuffer` 等词的**该集合自身**）；`MAX`/`LIMIT`/`capacity` 等泛词不再作为豁免 | C、D |
| P2-4 | 同上 | `findCollectionDeclarations` 扩展：识别类字段与 `this.x` 归属；同名不同作用域不再互相覆盖（改用 `name@scope` 或按行区间绑定）；补 `= [] as T[]`、`new WeakMap()` 等形态 | E |
| P2-5 | 同上 | 把边界判定提到**集合级一次性计算**并缓存正则，去掉内层的 4 次 `new RegExp` + 全文 `.test` | 性能 |
| P2-6 | 同上 | `location` 给出真实列位（`column = 行内追加表达式的起始列`）与 `end.column = column + 1`，对齐 `governance.ts` 约定 | 报告契约 |
| P2-7 | 同上 | `computeCoupling` 区分**内部相对模块**与**外部依赖**：相对路径（`./` `../`）不计入 external coupling；或在 `IncrementalMetrics` 中拆为 `externalCouplingDelta` + `internalCouplingDelta` 并据此判定。同时修正 rationale 与实现的一致性 | 合法重构被假拒绝 |
| P2-8 | 同上 | `computeEffectiveLoc` 正确处理**与代码同行的块注释**（`/* c */ const y = 2;` 应计入），并按掩码视图判定，避免注释/字符串污染计数 | LOC 误算 |
| P2-9 | 同上 | `computeComplexityProxy` 改为在掩码视图上统计，排除注释与字符串中的 `?`/`&&`/`||` | Complexity Delta 失真 |
| P2-10 | 同上 + `src/core/editDiff.ts` | 补齐 **Duplication Delta**，并按工单要求改为**消费 `editDiff.ts` + `histogramDiff`** 聚合四项指标（满足全局约束 #2） | 规格缺口 |
| P2-11 | 同上 | `maintainabilityDelta` 要么进入 `verdict` 判定（并给出权重出处与校准方式），要么从接口删除 | 装饰性指标 |
| P2-12 | `scripts/validate-data-flow.js` | ① 把 §3.3 的 A/B/C/D/E 五类形态做成**负样本夹具**；② **去真空化**夹具 C（用一个不叫 `ringBuffer` 的名字 + 真实边界逻辑，或删除"有界"夹具的名字巧合）；③ 删除 "100% precision" 这类无法支撑的措辞，改为精确计数断言；④ 补"同一行闭合的定时器""嵌套定时器""字符串含花括号"边界样本；⑤ 补"合法本地分解不得被拒绝"的正向断言 | 断言与结论不匹配 |
| P2-13 | `dataFlow.ts` / `api.ts` | `DataFlowGraph` 及其 `findPipelines`/`traceLifecycle`/`stats`：**要么接线**（由真实扫描构建图并交给某个消费方/报告字段），**要么**在文档与 `api.ts` 注释中如实标注 `Unwired` 并按工单约束 #1 上报，不得以"已交付生命周期图"表述 | Unwired 未如实上报 |
| P2-14 | `src/core/rules/entries/analyzers.ts` | `PRF-LEAK-001` 的 `languages: ALL_LANGUAGES` 与实现的 JS/TS 专用性不符（`const/let/var`、`push/add/set`、`setInterval`）；收窄为 TS/JS，或补多语言夹具后再扩 | 语言声明过宽 |

### 阶段 P3 —— 收尾与文档

| # | 动作 |
| :--- | :--- |
| P3-1 | `docs/04-analyzers-and-rules/01-builtin-rules.md`：CMP-\* 节补"随 governance 启用（该分析器默认关闭）""当前仅 TS/JS""已知漏报（纯 `&`/`|` 位运算行）"；`PRF-LEAK-001` 行补语言范围与已知漏报 |
| P3-2 | `package.json`：`validate-compression` / `validate-data-flow` 前移到同类域附近（现均在 32 段链末尾，失败要等前 31 套跑完才暴露） |
| P3-3 | 提交切分：`fix(b7): 修复耦合门禁可达性与 lint/format/comment 契约`（P0）→ `feat(governance): 代码视图掩码层`（P1-1~P1-3）→ `fix(governance): CMP-* 消费掩码视图并收窄语言范围`（P1-4~P1-6）→ `fix(core): uncertainty 重算与语义修正`（P1-7~P1-9）→ `fix(intelligence): PRF-LEAK-001 正确性与耦合语义`（P2）→ `docs: 更正 B6 证据并补齐能力边界`（P1-10、P3-1）。按 AGENTS.md 约定：分支 `<type>/<scope>-简述`、提交 `<type>(<scope>): 简述` + 中文正文引需求ID、每批独立提交并在提交信息中给出实测数字；本机需 `--no-gpg-sign` |

---

## 5. 验收矩阵

### 5.1 硬门禁（每阶段必跑）

| 命令 | P0 后 | P1 后 | P2 后 |
| :--- | :--- | :--- | :--- |
| `npm run build` | ✅ | ✅ | ✅ |
| `npm run format:check` | ✅ | ✅ | ✅ |
| `npm run lint` | ✅ | ✅ | ✅ |
| `npm run gate:comments` | ✅ | ✅ | ✅ |
| `npm run gate:self` | ✅ | ✅ | ✅ |
| `npm run gate` | ✅ | ✅ | ✅ |

### 5.2 专项验收（判据必须可失败）

| 项 | 判据 | 反证方式（必须能变红） |
| :--- | :--- | :--- |
| B7 耦合门禁可达 | `node run.mjs --root <无配置目录> --coupling-gate ...` 返回 1/0 | 把 P0-1 的顺序改回去，`validate-data-flow` 的 `[4/4]` 必须失败 |
| B6 误报收敛 | governance 单开扫 `src`：`CMP-*` 命中 **16 → 0**（1 条可争议项见 §7-1） | 恢复旧 `strip*` 逻辑，命中必须回到 16 |
| B6 harness 可失败 | 把任一 CMP 规则的 `checkFile` 改为 `return null` | `validate-compression` 必须 exit 1 |
| `PRF-LEAK-001` 正确性 | §3.3 的 A/B/C/D/E 五类全部给出**期望**结果 | 任一夹具失败即红（当前 A~E 全部不符期望） |
| 耦合门禁不假拒绝 | 合法本地分解 `verdict === 'PASSED'` | 当前实测为 `FAILED` |
| uncertainty 自洽 | post-scan 通道产出后不变量仍成立 | 注释掉 `recomputeSummary` 中的重算行必须变红 |
| 能力边界如实 | `DataFlowGraph` 要么有生产消费方，要么被明确标 `Unwired` | 代码检索 `DataFlowGraph` 的引用方非测试文件 |

---

## 6. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
| :--- | :--- | :--- | :--- |
| P0-1 移动分支改变既有 CLI 行为 | 低 | 参数解析顺序变化 | 分支仅消费 `--coupling-gate`/`--compare-before`/`--compare-after`，与配置无交集；`validate-consumer-runner` 与 `validate-data-flow` 复跑 |
| P1-2 把 `masked` 设为必填，外部 governance 插件编译失败 | 低 | SPI 变更 | 已确认构造点仅 `analyzers/governance.ts` 两处；若有外部实现，需 CHANGELOG 标注 |
| `validate-governance` 的 maintainability 计数断言被打破 | **高** | 门禁红（非产品缺陷） | P1 后立即复跑；计数变化属预期变更，同步更新断言并在提交正文说明 |
| P2-3 去掉文件级豁免后误报上升 | 中 | 新误报 | 必须以 §3.3 的 A~E 夹具 + 真实源码回归语料共同约束；`PRF-LEAK-001` 目前默认随 `performance` 分析器启用，收紧前建议先改为显式 opt-in（与 `crossFileLiteralClusters`/`errorPropagation` 的既有约定一致） |
| P2-10 接入 `editDiff`/`histogramDiff` 改动面大 | 中 | 引入新缺陷 | 单独提交、单独夹具；保持 `computeIncrementalMetrics` 签名不变 |
| 与外部 Agent 并发冲突 | 中 | 重复劳动 | 开工前复核 §7-3 指纹；用独立分支 |

**回滚**：P0 单独提交，可独立 revert（revert 后门禁回到当前红灯状态）。P1 的 P1-1~P1-3 与 P1-4~P1-6 成对回滚。

---

## 7. 开工前需确认的事项

### 7-1 `CMP-EXP-001` 对 6 项 `&&` 守卫链的判定（v1 遗留，仍未决）

`src/core/oxcAdapter.ts:1039`：`if (!isLiteral && !fnLike && !isClassDefining && !isBinding && !isScope && !topLevel) {`

| 选项 | 后果 |
| :--- | :--- |
| A（建议） | 判为真阳性并纳入 harness 期望计数；B6 收敛目标为 **16 → 1** |
| B | 阈值提到 `>= 7`；目标 16 → 0，但漏报 5-6 项真实长链 |
| C | 加括号感知豁免；语料更准但实现复杂度上升 |

### 7-2 `PRF-LEAK-001` 的启用策略

当前 `analyze()` 中为 `if (opts.checkUnboundedGrowth !== false)`，即**随 `performance` 分析器默认启用**。而本项目其它新能力一律 opt-in（`crossFileLiteralClusters`、`errorPropagation`、各语言包均默认关闭）。在 §3.3 的 5 类缺陷修完前，建议先改为显式 opt-in，避免误报进入使用方门禁。

### 7-3 开工前基线复核

```powershell
git -C C:\CODE_game-development\vscode-extensions status --porcelain=v1
# 期望：7 个 M（auto-refactor/ 前缀）+ 2 个 ??（scripts/validate-data-flow.js、src/core/intelligence/dataFlow.ts）
git -C C:\CODE_game-development\vscode-extensions log --oneline -1
# 期望：2e19e7e feat(governance): uncertainty evidence model and compression lower bounds rules (B6)
```

工作树若再次变动，需重跑 §2.1 与 §3.3 的复现探针后再决定计划是否需要调整。本次审查期间已确认过两轮并发改动（B6 提交前后各一次），不可假设缺陷仍处于本文档描述的状态。
