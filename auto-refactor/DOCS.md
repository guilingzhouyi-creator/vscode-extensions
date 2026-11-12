# 📚 `auto-refactor` Architecture Index & Praxis Whitepaper | Docs Index

> **Authoritative Pointer**: Global index for the `auto-refactor` static analysis and multi-agent governance engine (referenced by workspace [`AGENTS.md`](../AGENTS.md)).  
> **Historical Archives**: Prior documentation snapshots are frozen in `archive/auto-refactor/docs-snapshot-20261018/`, `archive/auto-refactor/docs-snapshot-20261010/`, and `archive/auto-refactor/docs-snapshot-20260928/` (excluded from build and CI).

---

## 🏗️ 1. Actual Tech Stack Matrix (`v0.4.0`)

`auto-refactor` implements a hybrid **TypeScript Orchestration + Rust N-API Native Kernel** architecture across six unidirectional layers:

| Layer | Core Modules & Paths | Key Technical Components & Scale Metrics |
| :--- | :--- | :--- |
| **L1. Rust N-API Native Kernel** | `crates/auto-refactor-core`<br/>`crates/ops-{diff,graph,pattern,mask,clone,math,vector,scope}`<br/>`src/core/native/` | **10-Crate Cargo Workspace**: Linear-space Myers diff & bit-parallel distance, Tarjan SCC & iterative dominator tree, single-pass lexical masking DFA, MinHash+LSH clone detection, rare-byte multi-pattern scan, statistical moments & vector geometry, scope shadow detection; paired with 100% byte-identical pure-TS fallback shims in `src/core/native/` |
| **L2. Multi-Language AST & Semantic IR** | `src/core/ast/`<br/>`src/core/semantic/`<br/>`src/core/cfg/` | **`NormalizedNode` + `SemanticGraph` + `LineFeatureTape`**: Supports 8 ecosystems — **TS/JS** (`oxc-parser` 0.144.0 + `typescript` 5.3), **Python** (`tree-sitter-python`), **Rust** (`tree-sitter-rust`), **Go**, **GDScript 4**, **Shell**, **YAML**, **Markdown**; lazy on-demand CFG / DFG / CallGraph projection |
| **L3. 4-Stage Rule Hierarchy & Analyzers** | `src/core/rules/registry.ts`<br/>`src/analyzers/*.ts`<br/>`src/core/messages/` | <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> built-in analyzers (`resetState()` pooled, lazy `ctx.sourceFile` evaluation) and <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor --> (<!-- METRICS:BEGIN rule-auto-refactor-canonical -->**360 条**<!-- METRICS:END rule-auto-refactor-canonical --> Canonical `FAMILY-TOPIC-NNN` + <!-- METRICS:BEGIN rule-auto-refactor-legacy -->**17 条**<!-- METRICS:END rule-auto-refactor-legacy --> Legacy Aliases, 100% documented in<!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor -->; workspace SSOT totals <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total -->); dual-track English (SARIF 2.1.0 / CAPP) + Chinese diagnostics |
| **L4. Sparse MoE Routing & Dual-Track Pipeline** | `src/core/router/sparseMoEGate.ts`<br/>`src/core/experts/`<br/>`src/core/scanner/file-preflight-gate.ts`<br/>`src/core/pipeline/dualTrackPipeline.ts` | **32-Expert Sparse MoE Router** (`file-preflight-gate` + `SparseActivator` + `SparseRuleRouter` + `SparseMoEGate` + `AdaptiveExpertBiasRouter` + `GroupedExpertDispatcher` with 32-bit unsigned `AnalyzerBit` routing, $\ge 70\%$ incremental bypass), `< 10ms` `ASTSliceExtractor` Fast Track + cross-file Deep Track, L1/L2/L3 cache & NDJSON Daemon |
| **L5. Tri-Plane Quality Scoring & Autonomy** | `src/core/scoring/`<br/>`src/core/dynamic/`<br/>`src/core/evolution/` | **Static Plane** (10 pillars + hyperbolic density saturation + arithmetic/geometric bottleneck penalty) + **Dynamic Telemetry Plane** (`DynamicEvidenceDTO` + `RiskFusionEngine`) + **Evolution Plane** (Git trajectory mining + gradient weight tuning + Code Autonomy Index **CAI**) |
| **L6. Praxis Delivery & LayerVFS** | `src/core/praxis/`<br/>`src/core/praxis/vfs/`<br/>`src/core/ring-buffer.ts`<br/>`src/core/rollback.ts` | **LayerVFS Zero-Copy Sandbox**: FastCDC chunking + SQLite WAL CAS deduplication (Fork `< 3ms`, Rollback `< 1ms`), non-blocking sandbox materialization (timeout exit 124), MCTS refactoring tournament (UCT pruning + incremental CC delta); **6 Governance Facades** + **`PraxisReviewClient` SDK** |

---

## 🗂️ 2. Six-Layer Documentation Directory

### 🏛️ Layer 1: Core Architecture, Pipeline & Native Kernel (`docs/01-architecture/`)

| Document | Core Scope | Status |
| :--- | :--- | :---: |
| [docs/01-architecture/01-system-overview.md](./docs/01-architecture/01-system-overview.md) | 6-layer unidirectional topology, 32-expert 4-stage matrix, `DualTrackPipeline`, 5-tier Sparse MoE routing, `LoadGovernor` | ✅ Aligned |
| [docs/01-architecture/02-pipeline-and-caching.md](./docs/01-architecture/02-pipeline-and-caching.md) | L1/L2/L3 incremental cache, `engineDigest` invalidation, `TopologyCacheManager`, `SyncIoBarrier` atomic flush | ✅ Aligned |
| [docs/01-architecture/03-daemon-and-ipc.md](./docs/01-architecture/03-daemon-and-ipc.md) | Cross-platform daemon (Named Pipe / UDS), NDJSON protocol, RSS self-healing & cold-scan fallback | ✅ Aligned |
| [docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md](./docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md) | Praxis fractal Git worktree, LayerVFS virtual branches, `L1/L2/L3A` progressive gates & cascading rollback | ✅ Aligned |
| [docs/01-architecture/05-rust-native-operator-kernel.md](./docs/01-architecture/05-rust-native-operator-kernel.md) | Rust native operator crates (`ops-diff/graph/pattern/mask/clone`) & pure-TS shim byte-parity contract | ✅ Aligned |
| [docs/01-architecture/06-layervfs-virtual-storage-and-mcts.md](./docs/01-architecture/06-layervfs-virtual-storage-and-mcts.md) | LayerVFS virtual fork, FastCDC chunking, SQLite WAL CAS store, sandbox projection & MCTS tournament | ✅ Aligned |

### 🌲 Layer 2: Multi-Language Parsing, Semantic IR & Graph Base (`docs/02-parsers-and-ast/`)

| Document | Core Scope | Status |
| :--- | :--- | :---: |
| [docs/02-parsers-and-ast/01-multilang-abstraction.md](./docs/02-parsers-and-ast/01-multilang-abstraction.md) | `NormalizedNode` unified AST, `SemanticGraph` cross-language IR & 8-language adapter matrix | ✅ Aligned |
| [docs/02-parsers-and-ast/02-oxc-fastpath.md](./docs/02-parsers-and-ast/02-oxc-fastpath.md) | Rust `oxc-parser` Mode A zero-materialization fast path, Mode B compensation & byte-parity proof | ✅ Aligned |
| [docs/02-parsers-and-ast/03-lazy-projection.md](./docs/02-parsers-and-ast/03-lazy-projection.md) | Lazy zero-materialization `CFG`, dominator tree, `DFG`, and cross-file `CallGraph` | ✅ Aligned |

### ⚡ Layer 3: Line-Level Incremental, Vectorized Diff & Streaming (`docs/03-incremental-and-diff/`)

| Document | Core Scope | Status |
| :--- | :--- | :---: |
| [docs/03-incremental-and-diff/01-line-level-incremental.md](./docs/03-incremental-and-diff/01-line-level-incremental.md) | `LineMap` coordinate shift, `reuseSubtree`, `ASTSliceExtractor` & `CallChainImpactTracer` | ✅ Aligned |
| [docs/03-incremental-and-diff/02-diff-interface-spec.md](./docs/03-incremental-and-diff/02-diff-interface-spec.md) | 64-bit SWAR, FNV-1a, Bit-Parallel Myers / Histogram Diff stack & `scanDiffStream` event stream | ✅ Aligned |
| [docs/03-incremental-and-diff/03-praxis-integration-guide.md](./docs/03-incremental-and-diff/03-praxis-integration-guide.md) | `CircularDiffBuffer` ring buffer, `Uint8Array` R4 cold eviction & `SemanticPraxisContextEnricher` | ✅ Aligned |

### 🔍 Layer 4: 4-Stage Rule Hierarchy & Built-in Analyzers (`docs/04-analyzers-and-rules/`)

| Document | Core Scope | Status |
| :--- | :--- | :---: |
| [docs/04-analyzers-and-rules/01-builtin-rules.md](./docs/04-analyzers-and-rules/01-builtin-rules.md) | 4-stage rule hierarchy, <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> built-in analyzers, dual-track diagnostics & <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor --> dictionary (workspace SSOT <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total -->) | ✅ Aligned |
| [docs/04-analyzers-and-rules/02-custom-analyzer-plugin.md](./docs/04-analyzers-and-rules/02-custom-analyzer-plugin.md) | Declarative `PatternKernel` & programmatic `Analyzer` plugin contract, `cacheCustom` isolation & scoring | ✅ Aligned |

### 📊 Layer 5: Config Contracts, Tri-Plane Scoring & Benchmarks (`docs/05-specs-and-benchmarks/`)

| Document | Core Scope | Status |
| :--- | :--- | :---: |
| [docs/05-specs-and-benchmarks/01-config-and-reports.md](./docs/05-specs-and-benchmarks/01-config-and-reports.md) | `auto-refactor.config.json` schema, suppression rules, JSON / SARIF 2.1.0 / Text reports & exit codes | ✅ Aligned |
| [docs/05-specs-and-benchmarks/02-performance-benchmarks.md](./docs/05-specs-and-benchmarks/02-performance-benchmarks.md) | 6-operator performance ledger, hot-path ablation & <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> regression test suites | ✅ Aligned |
| [docs/05-specs-and-benchmarks/03-comment-and-header-standard.md](./docs/05-specs-and-benchmarks/03-comment-and-header-standard.md) | 6-field module header contract (`CMT-HDR-001`), effective comment density (ECD-C) & `gate:comments` ratchet | ✅ Aligned |
| [docs/05-specs-and-benchmarks/04-cross-language-generalization.md](./docs/05-specs-and-benchmarks/04-cross-language-generalization.md) | Project neutrality guard (`validate-project-neutrality`) & semantic file-role inference (`file-role-inference.ts`) | ✅ Aligned |
| [docs/05-specs-and-benchmarks/05-consumer-integration.md](./docs/05-specs-and-benchmarks/05-consumer-integration.md) | Consumer integration guide — `baseline.json` 1.2.0 credit model, elastic debt quota, AAS v1.0 & workspace consumers | ✅ Aligned |
| [docs/05-specs-and-benchmarks/06-modernization-program.md](./docs/05-specs-and-benchmarks/06-modernization-program.md) | 5-language modernization packs (`*-modern`), constant SSOT topology & structural debt ABC classification | ✅ Aligned |
| [docs/05-specs-and-benchmarks/07-quantified-quality-standard.md](./docs/05-specs-and-benchmarks/07-quantified-quality-standard.md) | Tri-plane quality model (10 static pillars + dynamic telemetry + evolution feedback) & CAI 2.0 | ✅ Aligned |
| [docs/05-specs-and-benchmarks/08-compact-agent-schema.md](./docs/05-specs-and-benchmarks/08-compact-agent-schema.md) | AAS v1.0 agent-native schema — file aggregation, `L1`–`L5` topological sort, inline code anchors & 5D phase tensor | ✅ Aligned |

### 🤝 Layer 6: Praxis Delivery & SDK Integration (`docs/06-praxis-delivery/`)

| Document | Core Scope | Status |
| :--- | :--- | :---: |
| [docs/05-specs-and-benchmarks/05-consumer-integration.md](./docs/05-specs-and-benchmarks/05-consumer-integration.md) | **External & Workspace Consumer Integration Guide** (AAS v1.0, elastic debt budget & multi-project contracts) | ✅ Delivered |
| [docs/06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md](./docs/06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md) | Praxis architecture, data contracts (`PraxisCardContext` / `ReviewDiffHunk`) & SPI extension slots | ✅ Delivered |
| [docs/06-praxis-delivery/02-praxis-six-governance-services-api.md](./docs/06-praxis-delivery/02-praxis-six-governance-services-api.md) | 6 governance facades, workspace manager & unified `PraxisReviewClient` SDK API reference | ✅ Delivered |
| [docs/06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md](./docs/06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md) | End-to-end TypeScript integration runbook, fallback SLA & <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> acceptance matrix | ✅ Delivered |
| [docs/06-praxis-delivery/04-praxis-layervfs-integration-guide.md](./docs/06-praxis-delivery/04-praxis-layervfs-integration-guide.md) | LayerVFS virtual workspace integration, FastCDC chunking, CAS zero-copy fork, sandbox projection & MCTS | ✅ Delivered |
| [docs/praxis-integration-guide.md](./docs/praxis-integration-guide.md) | **`IPraxisReviewClient` SDK, 3-Layer Topological Diff & Structured Agent Guidance Manual** | ✅ Delivered |

### 📐 Architecture Diagrams (`docs/diagrams/`)

| Diagram | Description |
| :--- | :--- |
| [docs/diagrams/class-diagram.mermaid](./docs/diagrams/class-diagram.mermaid) | 6-layer class diagram (`Scanner`, `DualTrackPipeline`, `SemanticGraph`, `NativeBridge`, `QualityScorer`) |
| [docs/diagrams/sequence-diagram.mermaid](./docs/diagrams/sequence-diagram.mermaid) | Dual-track pipeline & tri-plane quality scoring sequence diagram |
| [docs/diagrams/diff-class-diagram.mermaid](./docs/diagrams/diff-class-diagram.mermaid) | Praxis 6 governance facades, 5 SPIs & rollback engine class diagram |
| [docs/diagrams/diff-sequence-diagram.mermaid](./docs/diagrams/diff-sequence-diagram.mermaid) | Praxis multi-agent slice audit, `scanDiffStream`, conflict arbitration & card-level atomic rollback |
| [docs/diagrams/layervfs-architecture.mermaid](./docs/diagrams/layervfs-architecture.mermaid) | LayerVFS virtual fork, CAS storage, sandbox projection & MCTS tournament sequence diagram |

---

## 🛡️ 3. Gate & Verification Matrix

| Command | Scope | Gate Contract |
| :--- | :--- | :--- |
| `npm run gate` | `gate:rust` $\to$ `build` $\to$ `format:check` $\to$ `lint` $\to$ `gate:comments` $\to$ `gate:self` $\to$ `npm test` | Single pre-commit closure across <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> parallel & serial suites |
| `npm run gate:rust` | `cargo clippy -- -D warnings` + `cargo fmt --check` + `cargo test` | Zero warnings and 100% test pass across Rust operator crates |
| `npm run gate:self` | Self-scan baseline ratchet (`error` severity) | `newBlocking(error) === 0` |
| `npm run gate:self:slice` | AST semantic slice incremental self-audit (`scripts/gate-self-slice.js`) | Sub-15ms localized AST mutation self-check |
| `npm run gate:comments` | Comment density & 6-field header ratchet (`scripts/gate-comments.js`) | Blocks any new comment or module header violation |
| `npm run validate-rules-registry` | Bidirectional closure between `registry.ts`, emitters & `01-builtin-rules.md` | 377/377 rule registration & doc coverage (100%), zero orphans, aligned with <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total --> |
| `npm run validate-docs` | Markdown fence closure (`DOC-FEN-001`), broken links (`DOC-LNK-001`) & duplicate blocks (`DOC-DUP-001`) | Zero documentation hygiene violations |
| `npm run validate-praxis` | Praxis diff operators, 5 SPIs, R4 ring buffer, streaming events, LayerVFS & atomic rollback | 100% integration assertions pass |
| `auto-refactor gate` | `composite-quality-gate` structured verdict | Evaluates static score, dynamic telemetry, ELOC density, QED ROI & debt delta (`--stage pre-commit\|pre-push\|ci`) |

---

## 💻 4. CLI Commands Reference

| Subcommand | Syntax | Responsibility & Output |
| :--- | :--- | :--- |
| `scan` | `auto-refactor scan --format <json\|sarif\|text\|aas\|agent> [options]` | Full/incremental static scan, quality scoring, L1/L2 cache & autofix (`--fix`) |
| `gate` | `auto-refactor gate [--stage pre-commit\|pre-push\|ci] [--root <dir>]` | Evaluates `composite-quality-gate` thresholds and emits structured gate verdict |
| `review` | `auto-refactor review --verdict <true-positive\|false-positive> [--rule <id>] [--root <dir>]` | Records review verdicts into `review-verdicts.json` and recalibrates Bayesian priors |
| `self-test` | `auto-refactor self-test` | Runs built-in violation corpus against all 32 domain analyzers |
| `daemon` | `auto-refactor daemon start\|stop\|status [--root <dir>]` | Manages background daemon (Named Pipe / UDS) for sub-15ms warm scans |
| `symbols` | `auto-refactor symbols <name> [--root <dir>]` | Queries AST symbol definitions, cross-file references & call-chain depth |
| `guide` | `auto-refactor guide <file> [--domain <d>] [--line <l>]` | Extracts active agent governance constraints and rule guidance for a file/line |
| `trajectory` | `auto-refactor trajectory [<file>\|--summary]` | Inspects `.refactor-trajectory/` revision history or per-file quality trajectory |
| `memory` | `auto-refactor memory` | Reports active review memory records, revision pool & topology cache utilization |
| `stats` | `auto-refactor stats [--root <dir>]` | Computes physical LOC, effective ELOC, code density & dilution metrics |
