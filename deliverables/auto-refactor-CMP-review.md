# auto-refactor 在途改动质量审查报告

**审查对象**：压缩下界规则族 `CMP-*` + `IssueEvidence` 不确定性模型
**仓库**：`C:\CODE_game-development\vscode-extensions`（git 根位于工作区级，改动路径前缀 `auto-refactor/`）
**改动规模**：13 个已跟踪文件修改 + 2 个新增文件（`src/core/governance/rules/compressionBounds.ts`、`scripts/validate-compression-bounds.js`）
**审查日期**：2026-09-15

---

## 一、结论摘要

改动**架构落位是正确的**：类型契约、规则注册表、声明式规则条目、JSON Schema、文档、门禁脚本五处同步，构建/格式/注册表/别名/文档/治理套件全部通过，`evidence` 字段在 `Issue` 中的位置正确，新增字段全部可选且用条件展开避免污染既有报告字节。

但**检测内核存在一类可复现的误报缺陷**，且**新增的验证脚本没有测到它宣称的东西**——它把 93.75% 的误报率认证为绿色。这是本次改动的核心问题。

| 项目 | 状态 | 实测数据 |
| :--- | :--- | :--- |
| `npm run build` | ✅ 通过 | `tsc` exit 0 |
| `npm run format:check` | ✅ 通过 | — |
| `npm run lint` | ✅ 通过 | exit 0（审查期间曾失败，见 §5） |
| `npm run gate:comments` | ✅ 通过 | 171 文件 / 0 issue（审查期间曾失败，见 §5） |
| `npm run gate:self` | ✅ 通过 | 171 文件 / 7733 issue / newBlocking(error)=0 |
| `validate-rules-registry` | ✅ 通过 | 110 条规则唯一；文档覆盖 110/110 |
| `validate-rule-aliases` | ✅ 通过 | 5 项断言 |
| `validate-docs` | ✅ 通过 | — |
| `validate-governance` | ✅ 通过 | 20/20 |
| `validate-compression` | ⚠️ 通过但**无实际约束力** | 见 P0-2 |

### 缺陷分级

| 编号 | 级别 | 问题 | 可复现 |
| :--- | :--- | :--- | :--- |
| P0-1 | 高 | `CMP-*` 在本项目自身 `src` 上命中 16 次，其中 **15 次是误报（93.75%）**；8/8 `CMP-LIN-001` 全部命中注释而非代码 | ✅ 已复现 |
| P0-2 | 高 | 验证脚本的「误报率 ≤5%」不是误报率；0 命中即 0.00% 空过 | ✅ 已复现 |
| P1-1 | 中 | `summary.uncertainty` 在 post-scan 追加 issue 后**不刷新**（潜伏，未触发） | 代码可证，未触发 |
| P1-2 | 中 | `requiresRuntime` 被误用到**纯静态可判定**的发现上，污染该指标本身 | ✅ 已复现 |
| P2-1 | 低 | 无 evidence 时 `averageConfidence` 默认 `1.0`，语义为"100% 确信" | ✅ 已复现 |
| P2-2 | 低 | `uncertainty` 的 Schema 对象缺 `required` 与 `additionalProperties: false` | 静态可证 |
| P2-3 | 低 | `languages: ALL_LANGUAGES` 与实现可达范围不符（未复现为误报源） | ✅ 已证伪误报假设 |
| P2-4 | 低 | `family: 'CMP'` 未提为常量，且文件头注释"every id starts with `GOV-`"已失效 | 静态可证 |

**风险定级说明**：`governance` 分析器位于 `SPECIALIZED_ANALYZERS`（`src/core/config.ts:82-83`），`defaultAnalyzers()` 以 `enabled: !SPECIALIZED_ANALYZERS.has(name)` 赋值 —— 即 **governance 默认关闭**，`CMP-*` 属显式声明后启用的模式。因此 P0-1 不是默认路径回归，而是**该模式一旦启用即输出近 94% 噪声**，会直接摧毁治理模式作为门禁信号的可信度。

---

## 二、P0-1：`CMP-*` 误报率 93.75%（本项目自身源码）

**复现**（governance 单开，扫描 `src/**/*.ts`）：

```js
// 探针：governance 单开扫描本项目 src
const { scan } = require('<ROOT>/dist/api');
const r = await scan({ root: '<ROOT>', configFile: cfgPath, cache: false, logLevel: 'error' });
r.issues.filter(i => i.rule.startsWith('CMP-'));
```

**结果**：`total issues = 524`，`CMP findings = 16`。逐条定位如下（源码行摘录为规则实际匹配的原文）：

| # | 规则 | 位置 | 命中的源码（截断） | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | CMP-LIN-001 | `src/analyzers/security.ts:5` | `* the single-pass visit()/finalize() streaming contract; finalize() is the merge point.` | ❌ 误报（JSDoc） |
| 2 | CMP-LIN-001 | `src/core/incrementalState.ts:92` | `* Column stride for the packed (line, column) function key; collision-free while` | ❌ 误报（JSDoc） |
| 3 | CMP-LIN-001 | `src/core/multilang.ts:194` | `* Project one raw node into a NormalizedNode (one per visit; may return the shared` | ❌ 误报（JSDoc） |
| 4 | CMP-LIN-001 | `src/core/multilang.ts:303` | `* reuse (line-level incremental); omitted ⇒ full materialization (default, byte-identical).` | ❌ 误报（JSDoc） |
| 5 | CMP-LIN-001 | `src/core/reporters.ts:5` | `* formats (text, JSON, SARIF 2.1.0); imported by api.ts render()/Scanner.` | ❌ 误报（JSDoc） |
| 6 | CMP-LIN-001 | `src/core/typescriptAdapter.ts:519` | `* raised while decoding the source; callers that need the materialized fallback (such as` | ❌ 误报（JSDoc） |
| 7 | CMP-LIN-001 | `src/daemon/server.ts:14` | `* exit(0); a bind failure exits(1) after a stderr message; idle timers are unref'd so the` | ❌ 误报（JSDoc） |
| 8 | CMP-LIN-001 | `src/index.ts:242` | `--concurrency <n>    Max files analyzed in parallel (single-process mode; default: min(4, cpus))` | ❌ 误报（CLI 用法文本） |
| 9 | CMP-DEN-001 | `src/analyzers/comments.ts:341` | `if (/^\s*(\/\/|\/\*|\*\|#\|##\|""")/.test(trimmed)) {` | ❌ 误报（含 `#` 的行） |
| 10 | CMP-DEN-001 | `src/analyzers/comments.ts:437` | `} else if (/^\s*(\/\/\|\/\*\|...)/.test(trimmed) && !trimmed.startsWith('#!')) {` | ❌ 误报（同上） |
| 11 | CMP-DEN-001 | `src/analyzers/simplify.ts:48` | `const CODE_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*(?:[-+*/%]?=\|\+\+\|--\|...)/;` | ❌ 误报（正则字面量） |
| 12 | CMP-DEN-001 | `src/core/dependencyGraph.ts:130` | `/^from[ \t]+(\.+\|\.*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]+import[ \t]+([^\n#]*)/.exec(` | ❌ 误报（正则字面量） |
| 13 | CMP-DEN-001 | `src/core/governance/rules/exceptionSafety.ts:19` | `const SINGLE_LINE_SWALLOW = /^\s*except(?:\s+[^:]*)?:\s*(?:pass\|\.\.\.)\s*(?:#.*)?$/;` | ❌ 误报（正则字面量） |
| 14 | CMP-DEN-001 | `src/core/multilang.ts:111` | `/** Cyclomatic decision-point weight (if/for/while/match/switch/case/?/&&/\|\|...). Default 0. */` | ❌ 误报（JSDoc） |
| 15 | CMP-DEN-001 | `src/core/router/diffClassifier.ts:59` | `const COMMENT_LINE_RE = /^\s*(?:\/\/\|\/\*\|\*\|#)/;` | ❌ 误报（正则字面量） |
| 16 | CMP-EXP-001 | `src/core/oxcAdapter.ts:1039` | `if (!isLiteral && !fnLike && !isClassDefining && !isBinding && !isScope && !topLevel) {` | ⚠️ 可争议 |

**误报统计**：`CMP-LIN-001` 8/8 全误报；`CMP-DEN-001` 7/7 全误报；`CMP-EXP-001` 1 条可争议（6 个 `&&` 的单行守卫子句属惯用写法，阈值 `>=5` 且无括号感知）。**合计 15/16 = 93.75%。**

### 根因链（三条独立缺陷叠加）

**根因 1 —— `sanitizeLine` 在无词法感知的前提下做行级截断**（`compressionBounds.ts:35-38`）

```ts
const withoutComment = raw.replace(/\/\/.*$/, '').replace(/#.*$/, '');
```

该函数在**任何字符串/正则掩码之前**执行。`#` 的截断本意是覆盖 Python/shell 注释，但对 TS/JS 行会在**字符串或正则内部**误截断。以 `#14`/`#15` 为例，`...*|#)/;` 中的 `#` 触发截断，行的右半部分（含正则闭合斜杠）被丢弃，导致后续 `stripRegexLiterals` 找不到配对的 `/` 而**无法掩码**，残留一串 `/`、`*`、`|`、`?`、`:` 被当作运算符计入。

同一根因还波及字符串字面量：`const url = 'https://x';` 会被截成 `const url = 'https:`，随后 `stripStringLiterals` 因引号不闭合而失配。

**根因 2 —— `stripRegexLiterals` 会把含"路径式斜杠"的注释行解析成运算符汤**（`compressionBounds.ts:30-32`）

`#14` 即为实证：`/** ... (if/for/while/match/switch/case/?/&&/||...). Default 0. */` 被逐段匹配 `/for/`、`/while/`、`/match/`、`/switch/`、`/case/`、`/&&/` 并各替换为 `//`，最终该行残留约 7 组 `//` 加 `||`，实测密度 **52%** 触发 `CMP-DEN-001`。

**根因 3 —— 四条规则间注释屏蔽不一致**

- `CognitiveDensityRule` 有 `if (!trimmed \|\| trimmed.startsWith('*')) continue;`（`compressionBounds.ts:263`）
- 但该守卫**只覆盖以 `*` 开头的续行，漏掉单行 `/** ... */`**（`#14` 正是从此漏过）
- `GiantExpressionRule`、`SingleLineMultiSemanticRule`、`CallbackDepthRule` **完全没有**任何注释守卫 → `#1`–`#8` 全部由此外泄

四条规则均为逐行处理、无跨行词法状态（块注释态、模板字符串态），因此多行 `/* */` 与多行模板字符串天然无法被屏蔽。

### 修复建议（按优先级）

1. **统一前置掩码层**：把"字符串 + 正则 + 注释（含块注释态）"的掩码提为单一入口，在 `sanitizeLine` 之前完成；项目内已有 `src/core/sourceMask.ts` 承担同类职责（见 `docs/04-analyzers-and-rules/01-builtin-rules.md:337` 对语言包共用掩码的说明），应复用而非另造行级正则。
2. **拆分 `#` 截断**：仅当文件语言为 Python/GDScript/shell 时才启用 `#` 注释截断；TS/JS 行禁用。
3. **给四条规则补齐统一注释守卫**，并把 `startsWith('*')` 扩展为对 `/**` 的识别。
4. **`stripRegexLiterals` 需要前置换行/运算符上下文判定**，避免把 `a/b/c` 文本当作正则；或改为基于掩码层产出的区间表，而非对整行做正则替换。

---

## 三、P0-2：验证脚本未测量它所宣称的指标

`scripts/validate-compression-bounds.js` 的文件头声明三项断言，其中两项不成立。

### 3.1 「误报率 ≤5%」不是误报率

```js
const fpRate = cmpHitsInGov / totalGovLines;      // L212
assert.ok(fpRate <= 0.05, ...);                    // L216
```

- 分子是**命中数**、分母是**总行数** —— 这是「每行命中率」，与误报率无因果关系。
- 实测输出：`Scanned 538 lines of production governance modules: 0 CMP findings (FP rate: 0.00%)`。**0 命中 ⇒ 0.00% ⇒ 断言恒真**。若把 `CMP-*` 四条规则全部删除、只留 `return null`，本节依然全绿。
- 抽样仅 3 个 governance 文件（538 行）+ 1 个 10 行合成样本，而真实误报率是 **93.75%**（171 文件 / 16 命中 / 15 误报）。

**正确写法**：分母应为总命中数，且输入应含已知干净代码与已知含正则/注释的代码；或直接断言「在 N 个生产文件上命中数 === 0」这类可失败的命题。

### 3.2 断言只有下界，过报不可见

全部断言形如 `>=1` / `>=2`。`CallbackDepthRule` 在 `callbackDepth >= 3` 时**逐行**产出（`compressionBounds.ts:213-228`），嵌套每加深一层就多一条重复发现，而现有断言**无法察觉**。应补上界断言（如 `assert.strictEqual(expIssues.length, 2)`）。

### 3.3 夹具与实现阈值互相贴合

`clean_code.ts` 中的 `for (let i = 0; i < 5; i++) {` 之所以不触发 `CMP-LIN-001`，唯一原因是规则里 `if (/^\s*for\s*(?:await\s*)?\(/.test(raw)) continue;` 这条前缀豁免（`compressionBounds.ts:123`）。夹具**恰好**落在豁免范围内，属夹具适配实现而非独立验证。同理，4 条规则各自仅 1-2 个正样本，无边界样本（如恰好 2 个 `&&`、恰好嵌套 2 层）。

### 3.4 已验证有效的部分

`[2/3]` 段对不确定性的计数一致性断言（`requiresRuntimeCount === issues.filter(requiresRuntime).length`）是**真断言**，且 `averageConfidence` 落在 `(0,1]` 的校验有效。12 个夹具文件/5 个 fixture 的命中率检查能捕捉"规则完全失效"，此处未误解。

---

## 四、P1-1：`summary.uncertainty` 在 post-scan 追加后不刷新（潜伏）

`src/core/analyzer.ts:2533` 在 `Scanner.scan()` 组装报告时一次性计算 `uncertainty: summarizeUncertainty(issues)`。此后 `src/api.ts` 有三个 post-scan 通道会**追加 issue 后再刷新摘要**：

| 通道 | 追加位置 | 刷新调用 |
| :--- | :--- | :--- |
| `dependency-graph` | `api.ts:755` | `api.ts:757` |
| `literal-clusters` | `api.ts:776` | `api.ts:777` |
| `error-flow` | `api.ts:797` | `api.ts:798` |

而 `recomputeSummary` 只刷新两个字段：

```ts
function recomputeSummary(report: ScanReport): void {
    const by = { info: 0, warning: 0, error: 0 };
    for (const i of report.issues) by[i.severity]++;
    report.summary.bySeverity = by;
    report.summary.issuesTotal = report.issues.length;   // ← 只有这两个
}
```

`uncertainty` 不在其中，因此**只要上述三个通道中任意一个产出非空，报告便会同时携带"已更新的 issuesTotal"与"陈旧的 uncertainty"**，两者互相矛盾。

**实测边界（诚实披露）**：开启全部三个通道扫描本项目 `src` 时，实测 `postScanPasses = ["dependency-graph","literal-clusters","error-flow","suppressions"]`、`issuesTotal 3889 === issues.length 3889`、不变量 **HOLD**、`post-scan-emitted rule ids = {}` —— 即三个通道**本例均未产出 issue**，缺陷未触发。故此项属**代码可证的潜伏缺陷**，而非已复现故障。在同一探针中仅开 governance+performance 时同样成立（652/652，HOLD）。

**修复**：把 `summarizeUncertainty` 从 `analyzer.ts` 提为共享模块，并在 `recomputeSummary` 内一并重算。

---

## 五、P1-2：`requiresRuntime` 被误用到纯静态可判定的发现

本次改动为 4 处规则挂载 `evidence`。按「该结论是否可能被运行时执行所证实/证伪」逐条评估：

| 规则 | 位置 | confidence | requiresRuntime | 语义评估 |
| :--- | :--- | :--- | :--- | :--- |
| `GOV-PRF-001` | `rules/performance.ts:85-89` | 0.7 | ✅ true | **合理** —— 循环内配置查找/昂贵创建，性能分析可证实 |
| `GOV-PRF-002` | `rules/performance.ts:151-155` | 0.65 | ✅ true | **合理** —— 循环内线性查找，profiling 可证实 |
| `CMT-CON-001` | `analyzers/comments.ts:554-558` | 0.6 | ❌ true | **不合理** —— "docstring 缺少并发说明"是纯文本事实，任何运行时执行都无法为其提供证据 |
| `CMP-CAL-001` | `compressionBounds.ts:222-226` | 0.85 | ❌ true | **不合理** —— 回调嵌套深度是纯语法事实，运行时无法改变 |

影响直接作用在本次新增的对外指标上：`summary.uncertainty.requiresRuntimeCount` 是"需要运行时验证的发现数"。实测本项目 `src` 该值为 **94**，全部来自 `GOV-PRF-001`(9) + `GOV-PRF-002`(85) —— 也就是说当前 `CMT-CON-001`/`CMP-CAL-001` 尚未在自扫描中命中，**指标恰好未被污染**；但一旦启用 `comments` 分析器（`CMT-CON-001` 属 comments 分析器），该值会立即失真。

此外 `runtimeEvidenceReason` 恒为常量哨兵 `'NEED_RUNTIME_EVIDENCE'`（8 处调用点全同值），字段名为 "reason" 却承载零信息量；真正的依据写在 `IssueEvidence` 的 JSDoc 里。建议要么改名为 `runtimeEvidenceMarker`，要么改填人类可读理由。

---

## 六、P2 级问题

### P2-1 `averageConfidence` 默认 `1.0`

```ts
const averageConfidence = evidenceCount > 0 ? Number((confidenceSum / evidenceCount).toFixed(2)) : 1.0;
```

零 evidence 时输出 `1.0` —— 报告在**完全没有依据**的情况下宣称"平均置信度 100%"。同时该值是**仅对有 evidence 的子集**求均值，而 Schema 描述写的是无条件的 "average confidence"。建议：无 evidence 时省略该字段或返回 `0`，并在 Schema 描述中写明"仅统计携带 evidence 的发现"。

### P2-2 `uncertainty` 的 Schema 对象偏松

`report.schema.json:45-58` 中 `uncertainty` 未声明 `required`，也未声明 `additionalProperties: false`，因此 `"uncertainty": {}` 可通过校验。同文件同层级的兄弟对象更严格（`evidence` 声明了 `required: ["confidence"]`，`suppression` 声明了 `additionalProperties: false`）。建议对齐。

### P2-3 `languages: ALL_LANGUAGES` 与实现可达范围不符

`src/core/rules/entries/governance.ts:259/271/283/295` 四条均声明 `ALL_LANGUAGES`，但实现是 C 族语法专用：

- `CMP-EXP-001` 依赖 `? :` 三元 —— Python/GDScript/Rust 无此语法（Rust 的 `?` 是 try 运算符，行内需再出现 `:` 才可能误匹配）
- `CMP-CAL-001` 依赖 `=>` —— Python 为 `lambda`、Rust 为 `|x| {}`
- `CMP-LIN-001` 按 `;` 切分 —— Python/GDScript 无语句分号

**未复现为误报源**：跨语言探针（TS/Rust/Python/GDScript 各 1 文件，均为惯用位运算/模式匹配/联合类型写法）实测 `filesScanned=4, CMP findings=3`，**3 条全部落在 TS 文件**，Rust `(val & mask) | (offset << 2) ^ flag` 与 Rust `Some(x) | None =>` 模式提升均未触发（运算符数 `4 < 8` 未达阈值）。故此项目前是**元数据过度声明**（影响 `--list-rules`、文档覆盖面表述），不是误报来源。

同文件已有收窄声明范式可循：`:44` `[LANGUAGE_TYPESCRIPT, 'javascript', 'python']`、`:164/:176` `[LANGUAGE_TYPESCRIPT, 'javascript']`、`:248` `[LANGUAGE_TYPESCRIPT]`。建议收窄为 `[LANGUAGE_TYPESCRIPT, 'javascript']`。

### P2-4 `family: 'CMP'` 未提为常量 + 文件头注释失效

- 同文件兄弟条目统一使用提升常量 `RULE_FAMILY_GOVERNANCE`（`:17`），新增条目直接内联 `'CMP'`（`:256/268/280/292`）。内联族名在别处确有先例（`'LANG'`/`'CPX'`/`'DOC'`/`'PRF'`），故**不算破坏**，但建议补 `const RULE_FAMILY_CMP = 'CMP';` 以对齐本文件风格。
- `:16` 的注释 `/** Rule-id family prefix for governance rules; every id starts with GOV-. */` 在新条目加入后**已不成立**（该文件现已同时产出 `GOV-*` 与 `CMP-*`）。文件头 `:10-11` 的 "governance rules vs built-in analyzer rules vs platform/legacy ids" 分组说明也需相应更新。

### P2-5 `test` 脚本已成 32 段命令链，新校验追加在末尾

`package.json` 的 `test` 现为 32 个 `npm run validate-*` 的 `&&` 串联，`validate-compression` 追加在 `test-codec` 之后 **最末位**。影响：(1) 该套件失败要等前 31 套跑完才暴露；(2) 命令链长度与可读性持续劣化。建议按域分组（如 `test:core` / `test:languages` / `test:governance`）。

### P2-6 新增 16 条 warning 被自扫描门的 error-only 棘轮静默吸收

`gate:self` 实测 `issues=7733 suppressed=6276 newBlocking(error)=0` → PASS。原因是棘轮只看 `severity=error`，而 `CMP-*` 全部声明为 `warning`。当前不阻塞，但两点需留意：
1. 若任一消费方使用 `--fail-on warning` 或后续收紧棘轮到 warning，本项目将**立即新增 16 条阻断项**（其中 15 条是误报）。
2. 文档第 16 节明确写了语言包"全部默认关闭，声明后才参与扫描，因此升级引擎不会静默改变既有门禁结果"；新增的第 17 节**未写明 governance 亦为默认关闭**（`config.ts:82-83` + `:308` 证实默认关闭），建议补上这一句，与兄弟章节的表述保持一致。

---

## 七、已验证通过项（值得保留的设计）

1. **`evidence` 在 `Issue` 中的 Schema 位置正确** —— `report.schema.json:230-250`，与 `suppression` 同级、位于 issue 的 `properties` 内（非误置于 `suppression` 子对象中）。
2. **`additionalProperties: true` 与 `IssueEvidence` 的索引签名 `[key: string]: unknown` 一致**，契约自洽。
3. **条件展开避免字段污染** —— `...(v.evidence ? { evidence: v.evidence } : {})`（`analyzers/governance.ts:195`）与 `...(evidence ? { evidence } : {})`（`analyzers/comments.ts:604`），确保无 evidence 的产出与改动前**逐字节相同**，符合本项目"字节级等价"的一贯约束。
4. **新增字段全部可选** —— `Issue.evidence?`、`ScanSummary.uncertainty?`、`GovernanceViolation.evidence?` 均不破坏既有消费方。
5. **`CallbackDepthRule` 的深度钳制正确** —— `const diff = Math.min(callbackDepth, closes - opens);`（`compressionBounds.ts:234`）避免深度转负，是有意识的下溢防护。
6. **规则注册、别名、文档、Schema 四处同步无漏项** —— `validate-rules-registry` 报 `docs coverage 110/110`，且 `validate-rule-aliases`/`validate-docs` 全绿；`index.ts` 的 `export * from './rules/compressionBounds'` 与 `registry.ts` 的导入/入列一致。
7. **`docsAnchor` 指向表格行而非标题** —— 与全库 30+ 条既有规则完全一致（全库均为 `...#<lowercased-rule-id>` 形式，且文档各节均为表格无二级标题），**属既有约定，非本次缺陷**；`validate-docs.js` 亦不校验锚点可达性。

---

## 八、审查过程中的两个边界披露

### 8.1 工作树在审查期间被外部改动

`gate:comments` 与 `lint` 的失败结果在审查过程中**自行消失**，经 mtime 交叉核对确认是同一工作树被并发修改，而非我的测量误差：

| 时刻 | 事件 |
| :--- | :--- |
| 13:45:36 | `gate:comments` → **FAIL**：`scripts/validate-compression-bounds.js` 触发 `CMT-HDR-002`（缺第 6 个标准头字段 `Exit Semantics & Design Rationale / 退出语义与设计依据`） |
| 13:45:36 | `lint` → **FAIL**：`src/core/types.ts:597:1  error  This line has a length of 106. Maximum allowed is 100` |
| 13:46:34 | 复跑，同样两条仍 **FAIL** |
| **13:45:56** | `compressionBounds.ts` mtime 更新 |
| **13:46:39** | `types.ts` mtime 更新 |
| 13:49:34 | `gate:comments` → **PASS**（171 文件 / 0 issue）；`lint` → **PASS**（exit 0） |

我在本次审查中**未对任何源文件执行写入**（仅只读命令 + `npm run build`，后者只写 `dist/`）。结论：有并发进程/Agent 正在同一棵树上做修复。请以 §9 指纹确认双方审阅的是同一修订版。

### 8.2 已排除的伪问题

- **中文乱码**：首次抓取 diff 时看到大量 mojibake（如 `'灏嗗法鍨嬪祵濂椾笁鍏冭〃杈惧紡...'`），经用 UTF-8 通道直读源文件核对，`entries/governance.ts:263` 实为 `remediation: '将巨型嵌套三元或长逻辑链拆分为具名中间变量或 if-else 分支。'` —— **仓库文件编码正常**，乱码出自我对 `git` stdout 的 PowerShell 捕获管道（GBK 解码后二次编码）。**不是仓库缺陷**，已排除。
- **`types.ts:597` 列宽问题的真实内容**：该行原为单行 JSDoc `/** Uncertainty metrics summarizing findings requiring runtime verification and average confidence. */`（4 空格缩进 + 98 字符 = 106 列 > 100）。现已折为 4 行，`node` 复核当前该文件 **0 行超过 100 列**。
- **跨语言误报**：假设被实测证伪，已从缺陷降级为 P2-3 的元数据问题（见 §6）。

---

## 九、审查基线指纹

复核本文结论时，请先核对 `sha1[:12]` 是否一致；不一致说明工作树已再次变动。

| sha1[:12] | 字节数 | 文件 |
| :--- | ---: | :--- |
| `b44e77e5f929` | 33555 | `docs/04-analyzers-and-rules/01-builtin-rules.md` |
| `c1e6f80f25bf` | 5822 | `package.json` |
| `9f0c25617e8d` | 10287 | `report.schema.json` |
| `3206ac00bbb1` | 27280 | `src/analyzers/comments.ts` |
| `da4de2427066` | 7968 | `src/analyzers/governance.ts` |
| `167eebe515d5` | 55584 | `src/api.ts` |
| `596c3d5a6ced` | 114599 | `src/core/analyzer.ts` |
| `7a7553fcba41` | 1545 | `src/core/governance/index.ts` |
| `bf9b71fe0203` | 5692 | `src/core/governance/registry.ts` |
| `a5b27ae1b895` | 11521 | `src/core/governance/rules/performance.ts` |
| `817cccaf367c` | 4560 | `src/core/governance/types.ts` |
| `e5040cfdd255` | 14306 | `src/core/rules/entries/governance.ts` |
| `2f00f8639f99` | 36303 | `src/core/types.ts` |
| `e66306469d3c` | 9144 | `scripts/validate-compression-bounds.js` |
| `5f1637f7b7f2` | 12700 | `src/core/governance/rules/compressionBounds.ts` |

---

## 十、建议的放行条件

当前改动**不建议直接合入**。最小放行门槛建议如下（P0 两项为硬门槛）：

| 序号 | 条件 | 验证方式 |
| :--- | :--- | :--- |
| 1 | P0-1 修复后，本项目 `src` 的 `CMP-*` 命中数从 16 降至 **0 或仅保留经确认为真的条目** | governance 单开扫描 `src`，逐条人工判定 |
| 2 | P0-2 重写 `[3/3]`：分母改为总命中数，输入含"含正则/JSDoc/字符串 URL"的负样本；补上界断言 | 新增夹具后，删空任一条规则必须能让该节变红 |
| 3 | P1-2 从 `CMT-CON-001` 与 `CMP-CAL-001` 摘除 `requiresRuntime`（或改名为非运行时语义的字段） | 复核 4 处 evidence 挂载点 |
| 4 | P1-1 将 `summarizeUncertainty` 并入 `recomputeSummary` | 代码评审（缺陷潜伏，无法用现有样本触发） |
| 5 | P2-1/P2-2 收敛 `averageConfidence` 语义并补齐 Schema 约束 | Schema 单测 + 文档描述同步 |
| 6 | 全量门禁复跑：`npm run gate`（build + format:check + lint + gate:comments + gate:self + test）**全绿** | 一次完整 `npm run gate` |

> **注**：条件 6 在审查期间曾失败两次（`CMT-HDR-002` + `max-len`），后由并发进程修复。合入前请以最终修订版**重新跑一次完整 `npm run gate`**，不要依赖本文中任何一次历史门禁结论。
