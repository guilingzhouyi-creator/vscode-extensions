# auto-refactor 误报清除与词法规范落地（交付记录）

**目标**：清误报，且**泛化提纯为规范**——不做点状修补，而是建立统一词法底座 + 可失败回归闸门。
**日期**：2026-09-15　**结果**：`npm run gate` **exit 0**（含 32 套验证，全绿）

---

## 一、一句话结论

误报不是"阈值调不好"，而是**四条 CMP 规则各自用行级正则重新实现了一遍词法剥离**。把它们改为消费
仓库早已存在的共享掩码原语（并为其补上正则字面量建模），误报从根上消失；同一个原语同时修掉了独立
的第二条规则族（`PRF-LEAK-001`）的 1 类误报与 4 类漏报。约束已写进规范文档并固化为可失败的回归闸门。

---

## 二、泛化：一个底座，两个消费方

### 2.1 底座：`src/core/sourceMask.ts`（扩展，非新建）

原本只服务 4 个语言包，现提纯为**全仓唯一词法入口**：

| 新增 | 作用 |
| :--- | :--- |
| `SourceMaskConfig.regexLiterals?` | **可选**开启正则字面量掩码（`/.../flags`，含字符类与转义，未闭合则掩到行尾）。默认关闭，故 4 个语言包输出**逐字节不变** |
| `SOURCE_MASK_PRESETS` | 语言 id → 注释/引号/正则语法表；Rust 沿用"不含 `'`"的既有取舍以保护生命周期与字符字面量 |
| `languageIdFromPath()` | 扩展名 → 语言 id，供只有路径的调用方使用 |
| `maskPresetForLanguage()` / `maskedLinesOf()` / `maskedLinesOfPath()` | 单入口构建掩码视图 |

> 该文件原注释断言"不建模正则只牺牲 **rare** false positive"。实测 16 条命中中 **6 条由正则直接造成
> （37.5%）**，前提已被数据推翻，故补上（保留为 opt-in，不改变既有调用方行为）。

### 2.2 消费方一：治理规则族（B6）

- `RuleEvaluationContext` 增**必填** `masked: string[]` —— 必填而非可选，让编译器强制两处构造点都提供，
  不给"回退读原文"留后门。
- `GovernanceAnalyzer.ensureInitialized` 用 `maskedLinesOf(content, capabilities.languageId)` 每文件构建一次
  （生命周期已核实：`analyzerRegistry.ts` 记载多路复用路径**逐文件新建实例**，缓存安全）。
- `compressionBounds.ts`：**删除** `sanitizeLine` / `stripStringLiterals` / `stripRegexLiterals` 与
  `startsWith('*')` 特例，四条规则改读 `ctx.masked`。

### 2.3 消费方二：性能规则（B7）

- `detectUnboundedGrowth` 改读 `maskedLinesOfPath(filePath, content)`。
- 作用域从"布尔标志"改为**按花括号深度索引的栈**，且追加点与花括号**在同一字符序行走中交错处理**
  （分两遍会让同行回调的作用域尚未入栈，正是此行差点漏掉 same-line 用例）。
- `hasCapacityBounding` **删除文件级模式**（`(?:MAX|LIMIT|CAPACITY|clamp|evict|ringBuffer)`），改为只认
  针对该集合名的局部证据；有界与否按集合一次性判定，不再逐行全文重扫。
- 集合声明识别扩展至类字段（`private entries: string[] = []`）。
- `location` 给出真实列位与 `end.column`，对齐 `governance.ts` 约定。

---

## 三、误报清除实测

### 3.1 CMP-* 在本仓库自身 `src` 上

| 规则 | 修复前 | 修复后 | 说明 |
| :--- | ---: | ---: | :--- |
| `CMP-LIN-001` | 8（**8 误报**） | **0** | 原为 7 条 JSDoc 续行 + 1 条 CLI 用法文本 |
| `CMP-DEN-001` | 7（**7 误报**） | **0** | 原为 6 条正则字面量 + 1 条 JSDoc |
| `CMP-EXP-001` | 1 | 1 | `oxcAdapter.ts:1039` 的 6 项 `&&` 守卫，判为规则契约内的真阳性 |
| **合计** | **16（93.75% 误报）** | **1** | — |

### 3.2 `PRF-LEAK-001` 行为缺陷（五类全部修复）

| 场景 | 修复前 | 修复后 |
| :--- | :--- | :--- |
| A 单行定时器之后的 `b.push(2)`（定时器之外） | 2 条（**误报**） | **1 条** ✓ |
| B 回调内字符串 `'}'` 之后的真实 leak | 0 条（**漏报**） | **1 条** ✓ |
| C 文件他处一句 `// TODO: consider a limit later` | 0 条（**漏报**） | **1 条** ✓ |
| D 真实无限增长集合恰好叫 `ringBuffer` | 0 条（**漏报**） | **1 条** ✓ |
| E 类字段 `private entries: string[] = []` 在循环中累积 | 0 条（**漏报**） | **1 条** ✓ |

### 3.3 门禁与指标修正

| 项 | 修复前 | 修复后 |
| :--- | :--- | :--- |
| `--coupling-gate` 可达性 | exit **2**（`config not found`）——该分支被放在项目配置检查之后 | `validate-data-flow [4/5]` PASS |
| 耦合门禁假拒绝 | 合法本地分解（行数 −39、+1 个**本地**模块）→ **FAILED** | `couplingDelta 0` → **PASSED** |
| `computeCoupling` | `'./a'` 与 `node:fs` 同为 1（把内部模块计为外部耦合，且 rationale 自称校验 external） | `'./a'`→0、`node:fs`→1 |
| `computeEffectiveLoc` | `/* c */ const y = 2;` → 1（注释与代码同行时整行丢失） | → 2 |
| `computeComplexityProxy` | 在原文上计数，注释/字符串里的 `?`、`&&` 计入 | 在掩码视图上计数 |
| `CMT-CON-001` | `trimmed.includes('async')`：把 `type TransferType = 'direct' \| 'async' \| …` 报成"异步函数缺并发语义" | 关键字级判定 + 排除类型别名声明的声明 |
| `requiresRuntime` 语义 | `CMT-CON-001`（docstring 缺并发说明）、`CMP-CAL-001`（嵌套深度）声称需要运行时证据 | 二者改为 `false`：纯静态事实不得声称运行时证据 |
| 规则语言声明 | 4 个规则对象**未声明** `languages` ⇒ 运行时不过滤，实际在所有语言上运行；`entries` 却写 `ALL_LANGUAGES` | 双处收窄为 `['typescript','javascript']` |

---

## 四、规范：让回归无法悄悄回来

`scripts/validate-compression-bounds.js` 的指标重写为**可失败**形态：

```js
const cmpTotal = issues.filter(i => i.rule.startsWith('CMP-')).length;
const cmpOnNegative = /* 负样本夹具上的命中数 */;
assert.ok(cmpTotal >= 6, 'positive fixtures must still fire, or the FP rate is vacuous');
const fpRate = cmpOnNegative / cmpTotal;   // 分母 = 命中总数，而非扫描行数
assert.strictEqual(cmpOnNegative, 0, 'idiomatic constructs must produce zero CMP findings');
```

三点关键差异（正对应旧实现的失效方式）：

1. **分母是命中总数**，旧实现是扫描行数 → 0 命中即 `0.00%`，删空规则照样通过；
2. **先断言正样本仍有命中**，杜绝 `0/0` 空过；
3. **新增真实语料回归守卫**：12 个曾产生误报的生产文件（`multilang.ts`、`diffClassifier.ts`、
   `simplify.ts`、`dependencyGraph.ts`、`exceptionSafety.ts`、`incrementalState.ts`、`reporters.ts`、
   `typescriptAdapter.ts`、`daemon/server.ts`、`index.ts`、`security.ts`、`comments.ts`）断言零命中。

`validate-data-flow.js` 同步：夹具 C（"有界集合"）**去真空化**——原夹具通过的原因是集合**名字叫
`ringBuffer`** 命中了文件级关键词，删掉边界逻辑仍通过；现改用中性名 + 真实边界逻辑，并新增 8 组
正/边界/负样本（含 A–E 五类）、`[5/5]` 词法语义断言（LOC/复杂度忽略散文、耦合只计外部模块）。

文档层面：`docs/04-analyzers-and-rules/01-builtin-rules.md` 写入**强制词法规范**（内容型规则必须消费
`masked`、禁止自造行级剥离）与启用口径/语言范围/已知漏报；`08-phase2-work-order.md` 的 B6 证据段
**如实更正**了那条 `0.00%` 声明，并记录根因、修复与复测数字（该工单本就禁止"未交付却声称已交付"）。

---

## 五、验证结果

| 命令 | 结果 |
| :--- | :--- |
| `npm run build` | ✅ exit 0 |
| `npm run format:check` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0（改造前为 13 errors） |
| `npm run gate:comments` | ✅ exit 0（改造前 strict ratchet FAIL） |
| `npm run gate:self` | ✅ PASS，`newBlocking(error)=0`（改造前 2 条新 error：脚本内计时器字面量、`detectUnboundedGrowth` 圈复杂度 31>12；后者已通过提取 6 个辅助函数降到阈值内） |
| `npm run validate-compression` | ✅ 全通过，FP rate 0.00%（负样本分母）+ 12 文件零命中 |
| `npm run validate-data-flow` | ✅ 5/5 全通过 |
| `npm run validate-governance` | ✅ 20/20（语言收窄未打破 maintainability 计数） |
| `npm run validate-rules-registry` | ✅ 111 规则，文档 111/111 |
| **`npm run gate`** | ✅ **exit 0（32 套全绿）** |

---

## 六、基线指纹（sha1[:12]）

| 指纹 | 文件 |
| :--- | :--- |
| `4e57c2b00b30` | `src/core/sourceMask.ts` |
| `c77800a9ba57` | `src/core/governance/types.ts` |
| `2d1cc3a7858b` | `src/analyzers/governance.ts` |
| `24f912c1a21f` | `src/analyzers/comments.ts` |
| `775565f03c70` | `src/core/governance/rules/compressionBounds.ts` |
| `8dafb42b719c` | `src/core/rules/entries/governance.ts` |
| `536d46678458` | `src/core/intelligence/dataFlow.ts` |
| `2d64f7954ba9` | `templates/consumer/run.mjs` |
| `443f1a7f7977` | `scripts/validate-compression-bounds.js` |
| `5229b21234b`→`c5229b21234b` | `scripts/validate-data-flow.js` |
| `9caa054eb13b` | `docs/05-specs-and-benchmarks/08-phase2-work-order.md` |

---

## 七、有意未做（需另行决策）

| 项 | 原因 |
| :--- | :--- |
| `DataFlowGraph` 接线或标注 `Unwired` | 该图类目前唯一调用方是自己的验证脚本。接线属**功能补齐**，非误报清除；按工单约束应如实上报为 Unwired |
| `Duplication Delta`、消费 `editDiff.ts`/`histogramDiff` | 工单 B7 明确要求，但属功能缺口，与本次"清误报 + 泛化"目标正交 |
| `maintainabilityDelta` 参与判定 | 目前计算但不参与 verdict；权重无出处，需先定标定方法 |
| `computeCoupling` 的 import 正则（`[\s\S]*?` 可跨语句） | 未在本轮触发误判；收紧需另配夹具 |
| `PRF-LEAK-001` 改为 opt-in | 当前随 `performance` 默认启用，而其它新能力一律 opt-in。五类缺陷已修复，是否改 opt-in 属产品口径决策 |
| 6 项 `&&` 守卫是否判真阳性 | 建议维持"真阳性"，如判定改阈值需同步 harness 期望值 |

---

# 追加：第二轮推进（继续完善优化）

**结果**：`npm run gate` 再次 **exit 0**（`gate:self` 曾抓到一处真问题，已按仓库规矩修掉，见 §8.5）

## 八、本轮完成的六项

### 8.1 `uncertainty` 重算（B6 最后一处正确性缺陷）

`summarizeUncertainty` 从 `analyzer.ts` 私有函数提为导出，`api.recomputeSummary` 现在同时刷新
`bySeverity` / `issuesTotal` / **`uncertainty`**。三个 post-scan 通道（dependency-graph、
literal-clusters、error-flow）会在 `Scanner.scan()` 组装报告**之后**追加 finding，此后报告不再可能
携带"描述自身 issue 列表早期版本"的计数。

> 诚实边界：post-scan 各通道当前产出的 finding **均不带 `evidence`**，因此该校验目前是**平凡成立**的。
> 重算的意义在于：一旦将来某个 post-scan 通道开始挂载 evidence，报告不会开始说谎。

### 8.2 `Duplication Delta`：按工作单要求消费共享底座

工作单 B7 要求"`src/core/editDiff.ts` + `histogramDiff` 聚合出 … Duplication Delta …"，且全局约束 #2
禁止各 Reviewer 自行解析仓库。新增 `countDuplicateLines(content)`：

- 复用 `computeLineStartsAndHashes`（`core/editDiff`）的**共享行哈希**，不另造一套行指纹；
- 用 `getLine` 排除空白行（否则空白行会在每个文件里平凡重复、淹没信号）；
- `computeIncrementalMetrics` 新增 `oldDuplication` / `newDuplication` / `duplicationDelta`。

`maintainabilityDelta` 由硬编码权重改为**有文档的策略常量**（`LOC_WEIGHT` / `COMPLEXITY_WEIGHT` /
`COUPLING_WEIGHT` / `DUPLICATION_WEIGHT`，并注明"同项目历史内的相对指标、不跨项目可比"），并新增
**`minMaintainabilityDelta` opt-in 硬地板**——未声明时 verdict 行为与之前**完全一致**，不会给既有
使用方重新设闸。

### 8.3 `computeCoupling` 收紧：不再把内部模块当外部耦合

上一轮已把相对路径排除；本轮进一步修掉**正则本身的缺陷**：原模式在 `import` 与 `from` 之间用了
`[\s\S]*?`，**可以跨语句边界**。现改为**逐行扫描 + 关键字存活校验**——匹配位置的关键词必须在掩码
视图里原样存在，这同时排除两类伪依赖：

- 注释里的 `// from 'ghost-pkg'`
- 字符串字面量里的 `const s = "import x from 'ghost-pkg'";`

### 8.4 `PRF-LEAK-001` 改为 opt-in

由 `opts.checkUnboundedGrowth !== false`（默认启用）改为 `=== true`。理由与本引擎其它新能力一致
（`crossFileLiteralClusters`、`errorPropagation`、各语言包均为 opt-in）：**内容启发式检测不得因分析器
本身启用就静默进入既有使用方的门禁**。文档已补启用口径与语言范围。

### 8.5 自扫描门禁抓到的真问题：模块超尺寸 → 按内聚拆分

`npm run gate` 首次复跑即被 `gate:self`（error 级棘轮）挡下：

```
NEW error: large-file/large-file src/core/intelligence/dataFlow.ts:1
  — File is too large and should be split (lines 948 >= fail threshold 900).
```

这正是仓库自身 900 行 fail 阈值的价值，且仓库明令禁止"改基线消音"。按内聚边界拆分：

| 文件 | 行数 | 内容 |
| :--- | ---: | :--- |
| `src/core/intelligence/dataFlow.ts` | 672 | 生命周期图 + 无界增长检测（+ 对指标段的 re-export） |
| `src/core/intelligence/incrementalMetrics.ts` | 307 | 指标段：LOC / 耦合 / 复杂度 / 重复行 / 增量判定 |

搬迁用脚本完成（显式 utf8，避免 PowerShell 默认 ANSI 读取造成中文损坏），并加了"切点不在 JSDoc 起始
或找不到 import 块即中止且不写盘"的守卫。公共导出面通过 re-export 保持不变，`api.ts` 与验证脚本无需改动。

### 8.6 `DataFlowGraph` 如实标注 Unwired

按工作单全局约束 #1（"入口可达 + 真实数据进入 + 分析逻辑执行 + 结果被消费"，缺一即标
Partial/Unwired），在 `dataFlow.ts` 头部新增 **PROVENANCE** 段落，明确区分：

- **已接线**：`detectUnboundedGrowth`、`computeCoupling`、`computeEffectiveLoc`、
  `computeComplexityProxy`、`countDuplicateLines`、`computeIncrementalMetrics`（性能分析器与消费方
  耦合门禁调用、验证脚本断言）；
- **Unwired**：`DataFlowGraph` 及 `traceLifecycle` / `findPipelines` / `stats` —— **只有验证脚本**
  在构造它，没有任何遍历从真实源码建图、也没有消费方读取。工作单同步记录，并写明补齐路径
  （需要一个接入共享遍历的生产者 + 一个消费规则，候选是"Source→Storage 管道缺 Validation 阶段"）。

## 九、新增/更新的可失败断言

`scripts/validate-data-flow.js` 的 `[5/5]` 扩充：

```js
assert.strictEqual(computeCoupling("// from 'ghost-pkg'"), 0);            // 注释里的伪依赖
assert.strictEqual(computeCoupling('const s = "import x from \'ghost-pkg\';";'), 0);
assert.strictEqual(countDuplicateLines(dupBase), 0);                      // 无重复
assert.strictEqual(countDuplicateLines(dupAdded), 1);                     // 重复行计一次
assert.strictEqual(relaxedDup.verdict, 'PASSED');                         // 未声明地板 → 不重新设闸
assert.strictEqual(flooredDup.verdict, 'FAILED');                         // 声明地板 → 强制执行
assert.ok(flooredDup.rejectionRationale.includes('declared floor'));      // 拒绝须自解释
```

## 十、本轮验证结果与指纹

| 命令 | 结果 |
| :--- | :--- |
| `npm run build` / `format:check` / `lint` / `gate:comments` | ✅ exit 0 |
| `npm run gate:self` | ✅ PASS，`files=174`、`newBlocking(error)=0` |
| `npm run validate-data-flow` | ✅ 5/5 |
| `npm run validate-compression` | ✅ FP rate 0.00%（负样本分母）+ 12 文件零命中 |
| `npm run validate-governance` / `rules-registry` / 其余 28 套 | ✅ |
| **`npm run gate`** | ✅ **exit 0** |

| 指纹 sha1[:12] | 行数 | 文件 |
| :--- | ---: | :--- |
| `6c694d0e752f` | 672 | `src/core/intelligence/dataFlow.ts` |
| `9bd804d93f41` | 307 | `src/core/intelligence/incrementalMetrics.ts` |
| `65028022fae6` | 2572 | `src/core/analyzer.ts` |
| `3d514e5bd9cc` | 1263 | `src/api.ts` |
| `9c305746dc58` | 349 | `src/analyzers/performance.ts` |
| `06e513756181` | 477 | `scripts/validate-data-flow.js` |
| `ff51a5655fc0` | 321 | `docs/04-analyzers-and-rules/01-builtin-rules.md` |
| `fa42b73ae45e` | 211 | `docs/05-specs-and-benchmarks/08-phase2-work-order.md` |

## 十一、仍待决策/未做

| 项 | 状态 |
| :--- | :--- |
| `DataFlowGraph` 接线 | 已如实标注 Unwired；补齐需新增生产者 + 消费规则（候选规则见 §8.6） |
| `maintainabilityDelta` 权重定标 | 权重已文档化为策略；跨项目可比性需另做标定 |
| `countDuplicateLines` 的 `getLine` 逐行取子串 | 门禁路径上可接受；若用于全量扫描需改为哈希直读 |
| 6 项 `&&` 守卫的判定 | 维持"真阳性"；改阈值需同步 harness 期望值 |
| `incrementalMetrics.ts` 与 `dataFlow.ts` 的 re-export 边界 | 若将来指标段继续增长，应把 re-export 收窄为只导出消费方真正使用的符号 |

