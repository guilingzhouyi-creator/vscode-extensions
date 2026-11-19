---
name: auto-refactor-dev
description: >-
  【触发：refactor/audit/broken/skew/Praxis/Oxc/Stage0】Govern auto-refactor 6-layer engine, Rust/TS byte parity, Stage 0-3 analyzers, Praxis SDK, and telemetry guards.
---

# auto-refactor-dev — Static Refactoring Engine, Dual-Track Operators & Praxis SDK Contract

Governs the `auto-refactor/` 6-layer architecture, Rust+TS 100% byte parity, <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> built-in Sparse MoE analyzers across 4 pipeline stages (Stage 0–3), <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor --> (<!-- METRICS:BEGIN test-suite-count -->**197 套**<!-- METRICS:END test-suite-count --> test suites), `PraxisReviewClient` SDK, and 3-layer topological Diff engine.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [sparse-moe-and-ast-routing](../sparse-moe-and-ast-routing/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Auto-Refactor Engine（领域入口）
- **协作专员**：原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`
- **何时联动**：Add analyzer or rule and register SSOT metadata → `auto-refactor-dev` + `sparse-moe-and-ast-routing` + `rule-catalog-governance` + `test-benchmark-engineering`；Debug LayerVFS forks, 3-ply MCTS, or preset recipe plugins → `praxis-vfs-and-trajectory-learning` + `auto-refactor-dev` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Six-Layer Architecture, Rust+TS Parity & Neutrality

1. **6-Layer Topology**: L1 Native Operators (`crates/ops-{diff,graph,pattern,mask,clone}`, `ops-mask` split `ascii`/`utf16`/`tests` with `// SAFETY:`) $\to$ L2 `NormalizedNode` + `LineFeatureTape` + 8-lang `SemanticGraph` $\to$ L3 (<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> analyzers, <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor -->) $\to$ L4 Sparse MoE & `< 10ms` AST slices $\to$ L5 10-pillar/CAI 2.0 $\to$ L6 Praxis SDK & LayerVFS.
2. **Rust+TS Parity**: Rust N-API and `src/core/native/*-shim.ts` must match JSON key order, UTF-8/LF offsets, dominator order, and 4-decimal floats (`validate-native-parity.js`, `validate-equivalence.js`).
3. **Neutrality & Boundaries**: `validate-project-neutrality.js` forbids consumer paths (`WebGames/`, `workspace-timing/`); infer `ProjectArchetype` from manifests and load rules via `trajectoryPlugin` (`presets/godot-game.config.json`). Keep splits (`reportFinalizer`, `aas-reporter`, `python-modern`) free of trampolines (`ARCH-FAC-001 = 0`, zero `VOL-DOC-001`). Route exemptions via `PathClassifier`, caches via `sharedMemoryGovernor`, and `SEC-*`/`DEP-*` via `elastic-debt-budget.ts` (`effectiveApply(...)`).

---

## 2. Four-Stage Analyzers & Sparse MoE Delegation

`analyzer-registry.ts`, `config/config.ts`, and `router/sparseRuleRouter.ts` order 32 analyzers across Stage 0–3 ($6 + 5 + 9 + 12$):

| Stage | Analyzer IDs (`AnalyzerId`) | Core Scope |
| :--- | :--- | :--- |
| **0: Physical** (6) | `hygiene`, `shell-lint`, `shell-safety`, `large-file`, `secrets`, `security` | Byte stream; 0-byte/EOL, taint (`GUARD-DESTR-001`), ELOC/LOC, secrets |
| **1: Lexical** (5) | `comments`, `naming`, `constants`, `docs`, `production-hygiene` | Token/line FSM; 6-field JSDoc/ECR, naming, literals, debug residue |
| **2: AST** (9) | `simplify`, `complexity`, `stdlib`, `typescript-modern`, `python-modern`, `rust-modern`, `gdscript-modern`, `go-modern`, `frontend` | `< 10ms` AST/CFG; flattening, $\text{CC}\le 15 / \text{Depth}\le 4$, `*-modern` |
| **3: Graph** (12) | `performance`, `architecture`, `data-architecture`, `dependency-layout`, `dependency-graph`, `gate-architecture`, `gdscript-game`, `vscode-extension`, `client-exposure`, `test-modernity`, `concurrency`, `governance` | `SemanticGraph` (Tarjan SCC/dominators); loop alloc, facade substance, cycles, async/lock, SSOT |

- **Sparse MoE**: Preflight/trigger gates, `(bit >>> 0)` bitmask parity (`AnalyzerBit.CONCURRENCY = 1 << 31`), `LineFeatureTape`, `resetState()` pooling, and lazy `ctx.sourceFile` live in [sparse-moe-and-ast-routing](../sparse-moe-and-ast-routing/SKILL.md).
- **SSOT**: Register `FAMILY-TOPIC-NNN` across `src/core/rules/`, `dimensionRuleTable.ts` ($\text{AxesPerFinding}\le 4$), and `scripts/common/rule-catalog.json`; register validators in `scripts/test-parallel.js` (<!-- METRICS:BEGIN test-suite-count -->**197 套**<!-- METRICS:END test-suite-count --> suites, `validate-suite-manifest.js`); centralize regexes in `src/core/constants/regex-patterns.ts` (`validate-regex-ssot.js`); prevent `export *` collisions in `src/api.ts` (`TS2308`).

---

## 3. Praxis SDK, Daemon, Cleanup & 5D Diff Bounds

1. **Praxis & Daemon**: `createPraxisClient` emits `DiffAgentFace` + `DiffHumanFace` across L1 $\to$ L2 $\to$ L3 (`shouldEscalateToL3A`), deduplicating <!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count --> overlap clusters (`electPrimaryCard`). Ban hot `*Sync` I/O (`PRF-IO-001`); isolate behind `*IoBarrier`; top-cluster IPC constants (`NAM-LEN-002`); `*Ms` (`Brand<T, B>`); atomic `stagingPath` rename.
2. **5D Bounds (`diff-bounds-contract.ts`)**: Leaf loader for `scripts/common/diff-bounds-contract.json` (`diff-bounds-governor.ts`, `diff-bounds-batch.ts`): source $\le 240/180/260$, test $\le 360/260/380$, del $\le 120/360$, batch add $\le 540/720$ (`0.5x` test), del $\le 360$, $\Theta_{\text{admission}}\in [3.0, 25.0]$, substantive `0.45/0.60`, $\text{TSPR}\ge 0.40$ (`.taxis/telemetry/admission_ledger.ndjson`).
3. **Gate Chain & Cleanup**: `npm run gate` runs `gate:rust` $\to$ `build` $\to$ `format:check` $\to$ `lint` $\to$ `gate:comments` $\to$ `gate:redundancy` $\to$ `gate:self` $\to$ `self-test` $\to$ `test:no-build`; clean temp dirs via `auto-refactor/scripts/lib/resilient-fs-cleanup.js` (`rmSyncWithRetry`). Fail-closed `validate-native-parity.js`; `crates/**` triggers Cargo; `vitest related` `--passWithNoTests=false`; `validate-rule-dictionary-closure.js` (<!-- METRICS:BEGIN rule-auto-refactor-canonical -->**360 条**<!-- METRICS:END rule-auto-refactor-canonical --> canonical); `validate-trajectory-ledger.js` + `--revert-timestamp`.

---

## 4. Verification & References

```bash
cd auto-refactor && npm run build && npm run gate && npm test && node scripts/bench-hot-paths.js
```

- [praxis-client-and-diff-topology.md](references/praxis-client-and-diff-topology.md): Praxis SDK interfaces, 3-layer Diff topology, union-find clustering & Rust+TS parity.
- [type-level-engineering-and-caching.md](references/type-level-engineering-and-caching.md): Nominal `Brand<T, B>` types, 4-tier cache invalidation & hot-path memory patterns.
- [analyzer-boilerplate.ts](templates/analyzer-boilerplate.ts) / [validate-suite-boilerplate.js](templates/validate-suite-boilerplate.js): Analyzer & validation suite templates.
