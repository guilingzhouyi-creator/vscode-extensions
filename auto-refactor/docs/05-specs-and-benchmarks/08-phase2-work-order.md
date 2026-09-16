# 第二阶段续做工单（B2b 收尾 → B7）

本工单把审计后的执行计划拆成可直接施工的最小步骤：每步给出**确切锚点**、**验收断言**与**证据要求**。
未完成前不得在提交信息或文档中声称对应能力已交付；索引类能力在未覆盖路径上必须如实上报 provenance
（如 `builtFrom: 'projection'`）而不是伪称完整。

## B2b 收尾：投影路径的调用点采集

**现状（实测）**：默认配置（仅流式分析器）走 lazy 投影路径，声明可采（`sample.ts` 16 条），
**调用点 0 条**。根因：共享遍历在 `needSymbols` 下未下钻函数体，`call` 节点未被访问。

**最新实测（本轮追加，直接决定施工方式）**
投影器探针结果：`proj.project(raw)` 对 call 表达式返回 `kind='Call'` 但 **`name=null`**，
即我在主构造块加的 `calleeNameOf(n, this.sf)` **未被 call 路径命中**（call 节点由另一条更早的构造/返回
路径产出，或该块对 call 提前返回）。因此调用点采集在投影路径上的**唯一阻塞点**是：
在投影器产出 `NodeKind.Call` 的那条路径上写入 callee 名（推荐该处直接 `calleeNameOf(n, this.sf)`），
或让 `onNode` 观察者同时收到 raw 节点，由采集器自行 `getText`。前者改动更小且与物化路径语义一致。
验证方式：`node -e` 探针（同本轮命令）应打印 `Call` 节点带非空 `name`；
随后 `validate-symbol-index` 的默认配置断言从 `definitions>=3` 升级为 `definitions>=3 && references>=2`。

**施工点**
1. `src/core/traverse.ts` 的 `runStreamingProjected`：当 `ProjectionPolicy.needSymbols` 为真时，
   对函数类节点的子节点迭代必须包含 body（当前与 `needComplexity` 的 Mode B 绑定）。
2. `src/core/typescriptAdapter.ts` 的投影子节点迭代（`forEachChild` 的 Mode B 分支）与
   `src/core/oxcAdapter.ts` 的同名分支：把 `needSymbols` 与 `needComplexity` 一起作为下钻条件。
3. `src/core/pythonAdapter.ts`、`src/core/rustAdapter.ts`、`src/core/gdscriptAdapter.ts`：补 call 名称采集
   （TS/Python 已具备，Rust/GDScript 待补）。

**验收断言（加入 `scripts/validate-symbol-index.js`）**
- 默认配置（`analyzers: {}` → `projection`）：`definitions >= 3` **且** `references >= 2` **且**
  `crossFileReferences >= 1`；
- 同一夹具在物化路径与投影路径下，`resolve('computeTotal')` 的定义集合一致（引用集合允许投影路径为超集或等集）；
- `npm run gate` 全绿，自审基线只降不升。

## B3 跨文件字面量索引（审计第 1 项能力从 Partial → Complete 的关键）
**目标**：`Literal → AST Context → Symbol → Call Site → Module → Domain → Cross-file Frequency → Semantic Role`。
**施工点**：新增 `src/core/intelligence/literalIndex.ts`（按 value 聚合：files/symbols/kinds/occurrences/role），
由共享遍历（`traverse.ts` 观察者，同 B2b 机制）喂入；`src/analyzers/constants.ts` 的 `duplicate-literal`
改为查索引取跨文件频次；新规则族 `CST-XFIL-*` 登记进 `src/core/rules/entries/analyzers.ts`。
**验收**：3 文件同值聚簇可报；同值不同义必须分成两条（`semanticRole` 不同）；fixture/generated/protocol/algorithm
四类分类准确（自建夹具 100%）；误报棘轮不升。

## B4 调用图 + 错误传播链
**依赖**：B2b 的调用点数据。**施工点**：`src/core/intelligence/callGraph.ts`（调用边 + 解析到声明），
在 `src/core/governance/rules/` 增 `ERR-*` 族输出 `Failure → Propagation → Translation → Logging → Recovery → Boundary`。
**验收**：错误链夹具输出 ≥3 跳有向链；重复错误码跨文件可判定。

## B5 稀疏 Reviewer 激活接线
**施工点**：`src/core/router/sparseRuleRouter.ts` 接入主扫描路径（当前仅 `dual-track` 使用，
`scanAsymmetric` 仍标 `@experimental`）；profile→risk→routing→budget 落到 `summary.activatedReviewers`。
**验收**：demo/web/game/library 四档激活集合差异可断言；`npm run validate-asymmetric-routing` 覆盖主路径。

## B6 不确定性模型 + 压缩下界
**施工点**：`src/core/types.ts` 的 `Issue` 增 `evidence{ confidence, requiresRuntime }`；并发/内存类规则在
无法静态证明时输出 `NEED_RUNTIME_EVIDENCE`；`src/core/governance/rules/` 增压缩下界族（巨型表达式/单行多语义/
回调链深度/认知密度）。**验收**：不确定结论不再以确定语气输出（报告可数）；压缩夹具 100% 命中且既有仓库 FP ≤5%。

## B7 数据流/生命周期 + 增量度量
**施工点**：`src/core/intelligence/dataFlow.ts`（Source→Validation→Transformation→Storage→Bus→Consumer→SideEffect）
与 `ownership/lifetime` 边；`src/core/editDiff.ts` + `histogramDiff` 聚合出 Effective LOC / Complexity Delta /
Duplication Delta / Maintainability Delta，接 `templates/consumer/run.mjs` 作为 CI 增量门禁。
**验收**：无界增长夹具报 `unbounded-growth`（O(t)/O(n) 判定）；「删 500 行但耦合升高」样本判负拒绝。

## 全局约束（每一步都要满足）
1. 入口可达 + 真实数据进入 + 分析逻辑执行 + 结果被消费 + 有测试或真实运行证据，缺一即标 Partial/Unwired；
2. 禁止各 Reviewer 自行读取/解析仓库：一律消费共享底座（`SymbolIndex` 及后续索引）；
3. `npm run gate` 全绿（含自审棘轮、四方注册面一致性、语言矩阵）；每批独立提交并在提交信息中给出实测数字；
4. 不确定即如实上报，不得以确定性结论覆盖静态不可证的情形。

## B2b closure (resolved)

Last blocking finding closed. The `NodeKind.Call` / `name === null` defect on the lazy-projection fast
path was **not** in the top-level construction branch: a Mode B function body is materialized by the
subtree builder in `src/core/typescriptAdapter.ts`, which named function-like/class/binding nodes only.
That builder now names call nodes and carries their positions, so the shared `onNode` observer in
`traverse.ts` feeds the cross-file index identically on the materialized and the projected paths.

Evidence: the projector probe reports `Call` nodes named `helper`/`g` (was `null`); a default-config
(streaming-analyzers-only) scan of `samples` reports **16 definitions / 273 references** with
`builtFrom: 'projection'` (was 16 / 0). `scripts/validate-symbol-index.js` now also asserts
`references >= 2` on the projection path, and `npm run gate` is green (exit 0).

## B3 step 1 delivered: cross-file literal intelligence

`src/core/intelligence/literalIndex.ts` is now the shared literal store, fed from the same single
traversal as the symbol index (projection path via the `onNode` observer, materialized path via
`addTree`), and published as `summary.literalIndex`.

Verified (`scripts/validate-literal-index.js`, wired into `npm test`): site de-duplication across
overlapping observation; a value used in three files is reported as one cross-file cluster with a
**3-way meaning split** (protocol / algorithm / fixture) instead of one merged constant;
`clusters()` excludes single-file values; roles are inferred from evidence only and unattributable
literals stay `unknown`. Integration: materialized path 3 occurrences / 1 cross-file; projection
path 3 occurrences / 1 cross-file. Real corpus (`samples`, projection): 85 occurrences, 48 values,
3 cross-file, 11 multi-meaning.

Still open in B3: the `CST-XFIL-*` rule family must consume `clusters()` (and honour the meaning
split) instead of the analyzer counting duplicate literals per file; docs/registry entries and the
FP-ratchet check follow once the rules exist.

## B3 step 2 delivered: the store is consumed

`src/core/intelligence/literalClusters.ts` turns `LiteralIndex.clusters()` into review findings, run
by the new `literal-clusters` post-scan pass in `api.finalizeReport` — after the dependency-graph
pass, before suppressions, so clusters are suppressible and baselined like any other finding. Cross-
file facts require the complete file set, so an incremental scope skips the pass and says so.

Deliberate decisions, recorded rather than hidden:
- **Opt-in** via `analyzers.constants.options.crossFileLiteralClusters: true`; default off, so no
  existing consumer gate changes without an explicit decision.
- **Rule id reuse**: findings are emitted under the already-registered `duplicate-literal` rule with
  `detail.crossFile = true` and `detail.meanings[]`, instead of minting a new `CST-XFL-*` id. A new
  id would require a registry entry, a docs-coverage row and a consumer migration window for zero
  extra signal; the semantics are carried in `detail` and the message. Revisit when a second consumer
  needs to gate on the cross-file dimension alone.
- Single-meaning cross-file values are filtered out by default, because "appears twice" alone is not
  evidence for extracting a constant — the Global Constants God Object is the failure mode.

Evidence: the materialized scan of a 3-file fixture yields exactly one finding naming `4242` with its
meaning split, and the projecting scan of the same fixture yields **zero** cluster findings, proving
the opt-in gate rather than assuming it.

## B4 step 1 delivered: cross-file call graph on the shared index

`src/core/intelligence/callGraph.ts` derives resolved caller -> callee edges from the shared
`SymbolIndex` (no file is read, no AST rebuilt) and publishes `summary.callGraph`
(callers/callees/edges/resolvedEdges/unresolvedEdges/crossFileEdges/attributedEdges/builtFrom).

Two real defects were found and fixed while wiring it, both traversal-dependent correctness bugs:

1. **Caller attribution was impossible on the lazy path.** `binding` is cleared when entering a
   function-like node and `className` is not the method, so a projected call site had no owner.
   `runStreamingProjected` now tracks the nearest enclosing function-like name in its scope frame
   and hands it to the scan-wide observer, and `collectSymbols` walks frames carrying the enclosing
   declaration (with the caller passed in directly on the projection path).
2. **The symbol index double-counted on the projection path.** The observer sees a projected parent
   and its materialized children, so the same declaration or call arrived twice: the same fixture
   measured 16 edges projected vs 4 materialized. `SymbolIndex` now keeps site keys
   (name/kind/file/line for definitions, name/file/line/column/caller for references) and is
   idempotent, so the published counters no longer depend on which traversal ran.

Evidence (`scripts/validate-call-graph.js`, registered in `npm test`): a three-hop cross-file chain
a -> b -> c -> d is walkable, the unresolved external call is kept as an edge with `calleeFile: null`
rather than dropped, and both traversals now agree **edge-for-edge** (4 edges, 3 cross-file) on the
same fixture. `validate-symbol-index` and `validate-literal-index` stay green.

## B4 step 2 delivered: error propagation chains and taxonomy conflict rule

`src/core/intelligence/errorFlow.ts` derives static error propagation chains from the shared `LiteralIndex` and `CallGraph`:
- Rule `ERR-PRP-001` (Unbounded or duplicate error propagation chain) registered in `src/core/rules/registry.ts`, typed in `src/core/rules/types.ts` under family `'ERR'`, and documented in `docs/04-analyzers-and-rules/01-builtin-rules.md`.
- `api.finalizeReport` executes the `error-flow` post-scan pass when `analyzers.hygiene.options.errorPropagation: true` is enabled (strict opt-in).
- Detects error taxonomy conflicts (same error code string raised across multiple declarations or files) and traces multi-hop static caller chains (`d <- c <- b <- a`) up to external boundaries or entry points (`boundaryIsEntryPoint: true`).
- Evidence (`scripts/validate-error-flow.js`, registered in `npm test`):
  1. A 4-file fixture with duplicate code `ERR_TIMEOUT` raised across 2 declarations correctly identifies the full 3-hop caller chain `d <- c <- b <- a` and roots to boundary `a`.
  2. The pass stays strictly opt-in (default configuration emits 0 issues).

## B5 delivered: sparse rule router on main scan path and activated reviewers publication

`src/core/router/sparseRuleRouter.ts` and `src/core/profiler/projectProfiler.ts` are wired into `Scanner`:
- `detectProjectArchetype(root, profile, pkg)` infers project archetype (`demo` | `web` | `game` | `library`) from root path, package manifests, framework dependencies, and language distribution.
- `routeArchetypeToAnalyzers(archetype, options)` routes archetypes to tailored active reviewer subsets via `ARCHETYPE_ANALYZER_MATRIX`.
- `Scanner` publishes `summary.activatedReviewers = { archetype, active, skipped, activationRatio, reason }` on every scan.
- When `config.sparseRouting === true` (or `--sparse-routing`), the scanner filters the active analyzer plan, reducing overhead on non-matching domains.
- Evidence (`scripts/validate-asymmetric-routing.js` group [6/6], registered in `npm test`):
  1. Main scan path emits `summary.activatedReviewers` across 4 test workspaces (`demo`, `web`, `game`, `library`).
  2. Verified distinct active sets across all 4 archetypes (e.g. `web` activates `security`, `game` activates `gdscript-modern`, `library` activates `architecture` and `dependency-graph`, `demo` activates a minimal 4-reviewer subset).
  3. `sparseRouting: true` execution verified.

## B6 delivered: uncertainty evidence model and compression lower bounds rules

- Extended `Issue` with `evidence?: IssueEvidence` (`{ confidence, requiresRuntime, runtimeEvidenceReason }`) and exported `NEED_RUNTIME_EVIDENCE` constant in `src/core/types.ts` and `src/api.ts`.
- Concurrency and memory invariant rules (`CMT-CON-001`, `GOV-PRF-001`, `GOV-PRF-002`) attach `requiresRuntime: true` and `runtimeEvidenceReason: NEED_RUNTIME_EVIDENCE` whenever static proof is indeterminate.
- `Scanner.scanFiles()` publishes `summary.uncertainty = { requiresRuntimeCount, averageConfidence }`, enabling downstream reviewers, agents, and CI to quantify and count uncertain conclusions directly.
- Implemented the compression lower bounds rule family (`CMP-*`) in `src/core/governance/rules/compressionBounds.ts`:
  1. `CMP-EXP-001`: Giant unbounded expression (nested ternaries or unbounded logical chains).
  2. `CMP-LIN-001`: Single-line multi-semantic statement packing.
  3. `CMP-CAL-001`: Deep callback chain nesting (depth >= 3 with `requiresRuntime: true`).
  4. `CMP-DEN-001`: Cognitive token density compression (dense bitwise/math combinations).
- Rules registered in `src/core/governance/registry.ts`, `src/core/rules/entries/governance.ts`, and documented in `docs/04-analyzers-and-rules/01-builtin-rules.md` (110/110 rules documented).
- Evidence (`scripts/validate-compression-bounds.js`, wired into `npm test`):
  1. Synthetic fixtures for all 4 `CMP-*` rules; counts are asserted **exactly**, so silent
     over-firing fails the suite as well as a missed detection.
  2. Uncertain findings are strictly quantifiable (`requiresRuntimeCount` equals the issue list it is
     published with); `averageConfidence` is omitted rather than reported as `1.0` when no finding
     carries evidence; and statically decidable findings (e.g. `CMP-CAL-001` nesting depth) do not
     claim runtime evidence.
  3. **Correction, recorded rather than silently rewritten.** The first delivery of this batch claimed
     "False positive rate on production codebase is 0.00% (well below the <= 5% requirement)". That
     claim was **false**. The metric divided findings by scanned LINES, so zero findings read as
     `0.00%` and deleting every rule would have kept the section green. Measured against the
     acceptance criterion in this work order ("既有仓库 FP ≤5%"), the shipped family emitted **16**
     findings on this repository's own `src`, of which **15 were false positives (93.75%)**:
     `CMP-LIN-001` fired on 7 JSDoc lines and 1 CLI usage string, `CMP-DEN-001` on 6 regex literals
     and 1 JSDoc line. Root cause: each rule re-derived a "clean" line with its own line-local
     regexes (`sanitizeLine` / `stripStringLiterals` / `stripRegexLiterals`) instead of reading a
     masked view, so comment prose, regex bodies, and a `#` occurring inside a TypeScript line were
     read as code.
  4. **Fix and normative rule.** The family now reads `ctx.masked`, built once per file by
     `maskedLinesOf` in `src/core/sourceMask.ts` — the primitive the language packs already use, now
     extended with opt-in regex-literal masking plus a per-language preset table so no caller invents
     its own syntax. The standing rule for this repository: **a content-oriented rule must not
     re-implement lexical stripping; it reads the shared masked view.** Re-measured after the fix:
     **16 → 1** finding on `src`, the remaining one being the 6-term `&&` guard at
     `src/core/oxcAdapter.ts:1039`, judged a true positive of the rule's own stated contract. The
     suite now asserts a real false-positive rate over a negative corpus **and** zero emissions on
     the 12 production files that previously false-positived, so the same regression cannot return
     unnoticed.

## B7 step 1 delivered: unbounded growth, incremental metrics, and honest provenance

- `src/core/intelligence/dataFlow.ts` now reads the shared masked view (`maskedLinesOfPath`), so a
  brace inside a string or comment can no longer close a timer scope early (false negative) and an
  unrelated `limit` anywhere in the file can no longer exempt a collection (false negative). The
  per-line `hasCapacityBounding` file-wide keyword test is gone; bounding evidence must name the
  collection. Class-field collections (`private entries: string[] = []`) are now recognised.
- `PRF-LEAK-001` is **opt-in** via `analyzers.performance.options.checkUnboundedGrowth: true`,
  matching `crossFileLiteralClusters`, `errorPropagation` and the language packs: a content
  heuristic must not enter an existing consumer's gate merely because the analyzer is enabled.
- `computeIncrementalMetrics` publishes `duplicationDelta` computed on the shared line-hash
  substrate (`computeLineStartsAndHashes`) instead of re-deriving one, honours an optional
  `minMaintainabilityDelta` floor (undefined keeps the previous verdict behaviour), and documents
  the four delta weights as reviewable policy rather than tuned constants.
- `computeCoupling` counts EXTERNAL modules only. Counting relative specifiers made a legitimate
  local extraction read as "increased coupling" and get rejected, while the rejection rationale
  claimed to be checking external coupling. The specifier scan is now per-line and accepts a match
  only when its keyword survives in the masked view, so a `from` inside a comment or a string — or
  a match bridging a statement boundary — can no longer register a phantom dependency.
- `summarizeUncertainty` is exported and `api.recomputeSummary` now refreshes
  `summary.uncertainty`, so the three post-scan passes (dependency-graph, literal-clusters,
  error-flow) can no longer leave a report publishing a count that describes an earlier revision
  of its own issue list.
- **Unwired, and reported as such.** `DataFlowGraph` with `traceLifecycle` / `findPipelines` /
  `stats` is constructed **only** by the verification harness: no traversal builds a graph from
  real source and no consumer reads one. Per the global constraint ("entry reachable + real data
  in + logic executed + result consumed"), this half of B7 is **Partial/Unwired**, not delivered.
  Closing it requires a producer wired into the shared traversal plus a consuming rule — the
  candidate being a "Source→Storage pipeline with no Validation stage" finding.
- Evidence: `scripts/validate-data-flow.js` (8 growth fixtures covering the four former
  false-negative shapes, plus lexical metric semantics, duplication and floor assertions);
  `scripts/validate-compression-bounds.js` (true false-positive rate over a negative corpus and a
  12-file real-corpus guard); `npm run gate` exit 0.



