# 📚 `auto-refactor` Documentation & Praxis Delivery Hub

> **Baseline**: `auto-refactor` v0.4.0 (TypeScript + Rust N-API 10-crate workspace, 8-language Semantic IR + `LineFeatureTape`, <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> pooled Sparse MoE analyzers, <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor --> registry, <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> test suites, LayerVFS CAS sandbox + MCTS refactoring tree, tri-plane quality scoring, and `PraxisReviewClient` SDK).  
> **Historical Snapshots**: Frozen in [`archive/auto-refactor/docs-snapshot-20261018/`](../../archive/auto-refactor/docs-snapshot-20261018/), [`archive/auto-refactor/docs-snapshot-20261010/`](../../archive/auto-refactor/docs-snapshot-20261010/), and [`archive/auto-refactor/docs-snapshot-20260928/`](../../archive/auto-refactor/docs-snapshot-20260928/).

---

## 🗺️ Six-Layer Documentation Map

### 🏛️ L1. Core Architecture, Pipeline & Rust Native Kernel (`01-architecture/`)
* [01-system-overview.md](./01-architecture/01-system-overview.md): 6-layer unidirectional topology, 32-analyzer 4-stage matrix, `DualTrackPipeline`, 5-tier Sparse MoE routing, and `LoadGovernor`.
* [02-pipeline-and-caching.md](./01-architecture/02-pipeline-and-caching.md): L1/L2/L3 incremental cache, `engineDigest` automatic invalidation, `TopologyCacheManager`, and `SyncIoBarrier` atomic flush.
* [03-daemon-and-ipc.md](./01-architecture/03-daemon-and-ipc.md): Cross-platform daemon (Named Pipe / Unix Socket), NDJSON streaming IPC, RSS self-healing, and cold-scan fallback.
* [04-praxis-git-fractal-and-gating-spec.md](./01-architecture/04-praxis-git-fractal-and-gating-spec.md): Praxis fractal Git worktree, LayerVFS virtual branching, `L1/L2/L3A` progressive gates, and `PraxisRollbackEngine` cascading rollback.
* [05-rust-native-operator-kernel.md](./01-architecture/05-rust-native-operator-kernel.md): Rust native operator crates (`auto-refactor-core`, `ops-diff`, `ops-graph`, `ops-pattern`, `ops-mask`, `ops-clone`) and 100% byte-identical TS fallback shims.
* [06-layervfs-virtual-storage-and-mcts.md](./01-architecture/06-layervfs-virtual-storage-and-mcts.md): LayerVFS virtual fork filesystem, FastCDC chunking, SQLite WAL CAS storage, sandbox projection, and MCTS refactoring tournament.

### 🌲 L2. Multi-Language Parsing, Semantic IR & Graph Base (`02-parsers-and-ast/`)
* [01-multilang-abstraction.md](./02-parsers-and-ast/01-multilang-abstraction.md): `NormalizedNode` unified AST, `SemanticGraph` cross-language IR, and 8-language adapter matrix (TS/JS, Python, Rust, Go, GDScript, Shell, YAML, Markdown).
* [02-oxc-fastpath.md](./02-parsers-and-ast/02-oxc-fastpath.md): Rust `oxc-parser` 0.144.0 Mode A zero-materialization fast path, Mode B on-demand compensation, and 100% byte parity with `typescript`.
* [03-lazy-projection.md](./02-parsers-and-ast/03-lazy-projection.md): Lazy on-demand `CFG`, iterative immediate dominators, `DFG`, and cross-file `CallGraph`.

### ⚡ L3. Line-Level Incremental, Vectorized Diff & Streaming (`03-incremental-and-diff/`)
* [01-line-level-incremental.md](./03-incremental-and-diff/01-line-level-incremental.md): `LineMap` coordinate shift, `reuseSubtree` zero-recomputation, `ASTSliceExtractor`, and `CallChainImpactTracer`.
* [02-diff-interface-spec.md](./03-incremental-and-diff/02-diff-interface-spec.md): 64-bit SWAR line scan, FNV-1a hashing, Bit-Parallel Myers (BPM) + Histogram diff stack, and `scanDiffStream` async events.
* [03-praxis-integration-guide.md](./03-incremental-and-diff/03-praxis-integration-guide.md): `CircularDiffBuffer` ring buffer, `Uint8Array` R4 cold eviction, and `SemanticPraxisContextEnricher`.
* [04-sparse-reference-replay.md](./03-incremental-and-diff/04-sparse-reference-replay.md): Sparse reference sliding-window replay, composite anchor merging, call-site bridging, and tree-level pruning.

### 🔍 L4. 4-Stage Rule Hierarchy & Built-in Analyzers (`04-analyzers-and-rules/`)
* [01-builtin-rules.md](./04-analyzers-and-rules/01-builtin-rules.md): 4-stage rule hierarchy, <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> built-in analyzers, dual-track EN/ZH diagnostics, and <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor --> dictionary (workspace SSOT <!-- METRICS:BEGIN rule-total -->**534 条规则**<!-- METRICS:END rule-total -->).
* [02-custom-analyzer-plugin.md](./04-analyzers-and-rules/02-custom-analyzer-plugin.md): Declarative `PatternKernel` and programmatic `Analyzer` plugin contract, `cacheCustom` isolation, and scoring integration.

### 📊 L5. Config Contracts, Tri-Plane Scoring & Benchmarks (`05-specs-and-benchmarks/`)
* [01-config-and-reports.md](./05-specs-and-benchmarks/01-config-and-reports.md): `auto-refactor.config.json` schema, 32-analyzer & 375-rule defaults, `.refactor-trajectory/` compact ledger (`< 350B`, `*Ms`), and JSON/SARIF/Text reports.
* [08-compact-agent-schema.md](./05-specs-and-benchmarks/08-compact-agent-schema.md): AAS v1.0 agent-native schema — file aggregation, `L1`–`L5` topological sort, inline code anchors, repair recipes, and 5D phase-space tensor.
* [02-performance-benchmarks.md](./05-specs-and-benchmarks/02-performance-benchmarks.md): 6-operator benchmark ledger (lexical mask 6,448 MB/s, bit-parallel distance 17.8 µs) and <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> regression guards.
* [03-comment-and-header-standard.md](./05-specs-and-benchmarks/03-comment-and-header-standard.md): 6-field module header contract (`CMT-HDR-001`), effective comment density (ECD-C) model, and comment rule dictionary.
* [04-cross-language-generalization.md](./05-specs-and-benchmarks/04-cross-language-generalization.md): Project neutrality guard (`validate-project-neutrality`) and semantic file-role inference (`file-role-inference.ts`).
* [05-consumer-integration.md](./05-specs-and-benchmarks/05-consumer-integration.md): External consumer integration — `baseline.json` 1.2.0 credit model, elastic debt quota, AAS v1.0, and `fractal-git` / `workspace-timing` / `WebGames` contracts.
* [06-modernization-program.md](./05-specs-and-benchmarks/06-modernization-program.md): 5-language modernization packs (`*-modern`), constant SSOT governance, and structural debt ABC classification.
* [07-quantified-quality-standard.md](./05-specs-and-benchmarks/07-quantified-quality-standard.md): 10 dimensions $\to$ 8 strategic pillars, hyperbolic saturation, dynamic security ceiling, tri-plane risk resonance ($S^{1.0} \cdot D^{1.2} \cdot H^{0.8}$), and **CAI 2.0 6D autonomy score** (Jeffreys Beta posterior).

### 🤝 L6. Praxis Delivery & SDK Integration (`06-praxis-delivery/`)
* [05-consumer-integration.md](./05-specs-and-benchmarks/05-consumer-integration.md): **External & Workspace Consumer Integration Guide** (<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> analyzers, <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->, <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> test suites, AAS v1.0).
* [01-praxis-architecture-and-spi-contracts.md](./06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md): `PraxisCardContext`, `ReviewDiffHunk`, AST diagnostic completeness vs presentation deduplication, and SPI extension slots.
* [02-praxis-six-governance-services-api.md](./06-praxis-delivery/02-praxis-six-governance-services-api.md): Governance facades and [`PraxisReviewClient`](../src/core/praxis/praxis-review-client.ts) (`createPraxisClient`) SDK API reference.
* [03-praxis-integration-runbook-and-acceptance.md](./06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md): End-to-end TypeScript integration runbook, union-find deduplication across <!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count --> overlap clusters, and <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count --> acceptance matrix.
* [04-praxis-layervfs-integration-guide.md](./06-praxis-delivery/04-praxis-layervfs-integration-guide.md): LayerVFS virtual workspace integration, FastCDC chunking, CAS zero-copy fork, sandbox projection, and MCTS tournament.
* [praxis-integration-guide.md](./praxis-integration-guide.md): **`IPraxisReviewClient` SDK, 3-Layer Topological Diff & Structured Agent Guidance Manual**.

### 📐 Architecture Diagrams (`diagrams/`)
* [class-diagram.mermaid](./diagrams/class-diagram.mermaid): Core engine class diagram (`AutonomyScorer`, `RiskFusionEngine`, `PraxisReviewClient`).
* [sequence-diagram.mermaid](./diagrams/sequence-diagram.mermaid): Dual-track scan, tri-plane risk resonance, and CAI scoring sequence diagram.
* [diff-class-diagram.mermaid](./diagrams/diff-class-diagram.mermaid): Praxis governance facades, `PraxisReviewClient` SDK, and `PraxisPresentationAdapter` class diagram.
* [diff-sequence-diagram.mermaid](./diagrams/diff-sequence-diagram.mermaid): Praxis multi-agent slice audit, semantic overlap union-find clustering, and dual-payload dispatch.
* [layervfs-architecture.mermaid](./diagrams/layervfs-architecture.mermaid): LayerVFS virtual fork, CAS storage, sandbox projection, and MCTS tournament sequence diagram.
