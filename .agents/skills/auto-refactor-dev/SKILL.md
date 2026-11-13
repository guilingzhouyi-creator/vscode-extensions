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

## 1. Six-Layer Architecture, Rust+TS Byte Parity & Project Neutrality

1. **6-Layer Unidirectional Topology**: L1 Native Operators (`crates/ops-{diff,graph,pattern,mask,clone}`, `ops-mask` split into `ascii`/`utf16`/`tests` with 3-part `// SAFETY:` proofs) $\to$ L2 `NormalizedNode` + `LineFeatureTape` + 8-language `SemanticGraph` $\to$ L3 (<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> pooled analyzers & <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor -->) $\to$ L4 5-Tier Sparse MoE Router & `< 10ms` AST slice pipeline $\to$ L5 10-pillar scoring & CAI 2.0 evolution plane $\to$ L6 Praxis SDK & LayerVFS sandbox.
2. **Rust+TS 100% Byte Parity**: Rust N-API operators and `src/core/native/*-shim.ts` must produce 100% identical JSON key order, UTF-8/LF line-column offsets, dominator tree ordering, and 4-decimal float precision (`validate-native-parity.js` & `validate-equivalence.js`).
3. **Project Neutrality & Preset Plugins (`validate-project-neutrality.js`)**: Core analyzers and `recipeExtractor.ts` must never hardcode consumer-specific paths (`WebGames/`, `workspace-timing/`) or DSL rules; infer `ProjectArchetype` from manifests and load project rules via preset `trajectoryPlugin` (`presets/godot-game.config.json`).
4. **Module Boundaries & Decomposition**: Maintain cohesive domain splits (`reportFinalizer` $\to$ `post-scan-{suppressions,arbitration,quality-scoring}`, `aas-reporter` $\to$ `aas-{dimension-details,health-metrics,defect-records}`, `python-modern` $\to$ `python-modern-{contracts,shadowing}`) with zero shell trampolines (`ARCH-FAC-001 = 0`, zero `VOL-DOC-001`).
5. **`PathClassifier` & Telemetry Hardening**: Route all path exemptions through `PathClassifier` (`src/core/path/index.ts`); validate empty paths, null bytes, non-finite metrics, and EOF-less LCOV flush boundaries in `src/core/telemetry/`. Register long-lived caches with `sharedMemoryGovernor`.
6. **Elastic Debt Quota (`elastic-debt-budget.ts`)**: Enforce rigid Critical/High limits across `SEC-*`/`DEP-*` alongside dynamic volume scaling; route family claims through `effectiveApply(...)`.

---

## 2. Four-Stage Analyzer Pipeline & Five-Tier Sparse MoE Routing

`analyzer-registry.ts`, `config/config.ts`, and `router/sparseRuleRouter.ts` assemble all 32 analyzers in monotonic Stage 0–3 order ($6 + 5 + 9 + 12 = 32$):

| Stage | Analyzer IDs (`AnalyzerId`) | Execution Scope & Core Checks |
| :--- | :--- | :--- |
| **Stage 0: Physical & Security** (6) | `hygiene`, `shell-lint`, `shell-safety`, `large-file`, `secrets`, `security` | Byte-stream fast path; 0-byte/EOL, destructive taint (`GUARD-DESTR-001`), ELOC/LOC budget, secrets & injection |
| **Stage 1: Lexical & Docs** (5) | `comments`, `naming`, `constants`, `docs`, `production-hygiene` | Token/line state machines; 6-field headers/ECR, naming conventions, magic literals, JSDoc sync, debug residue |
| **Stage 2: Single-File AST** (9) | `simplify`, `complexity`, `stdlib`, `typescript-modern`, `python-modern`, `rust-modern`, `gdscript-modern`, `go-modern`, `frontend` | Single-file AST & CFG (`< 10ms` slices); control-flow flattening, $\text{CC}\le 15 / \text{Depth}\le 4$, `*-modern` idioms |
| **Stage 3: Cross-File & Domain** (12) | `performance`, `architecture`, `data-architecture`, `dependency-layout`, `dependency-graph`, `gate-architecture`, `gdscript-game`, `vscode-extension`, `client-exposure`, `test-modernity`, `concurrency`, `governance` | Cross-file `SemanticGraph` (Tarjan SCC / dominator tree); zero loop alloc, facade substance, dependency cycles, async/lock hazards, SSOT closure |

- **5-Tier Sparse MoE Invariants**:
  1. **Preflight & Trigger Gating**: `file-preflight-gate.ts`, `sparse-activator.ts` (`LANGUAGE_ANALYZER_MATRIX`), and `trigger-catalog.ts` (`ASYNC_TRIGGERS`, `DOCS_EXTS`, `SHELL_EXTS`) bypass analyzers before AST parsing when file extensions or fast substring triggers do not match.
  2. **32-Bit Unsigned Bitmask Parity**: `AnalyzerBit.CONCURRENCY = 1 << 31` sets the Int32 sign bit (`-2147483648`). `BIT_TO_ANALYZER_NAME`, `EXPERT_BY_BIT` (`expert-catalog.ts`), and `EXPERT_BASE_SCORES` (`expert-activation-library.ts`) must normalize keys with `(bit >>> 0)` and index both signed/unsigned keys, backed by `EXPERT_BY_INDEX` in `grouped-dispatcher.ts`.
  3. **`LineFeatureTape` (`LINE_FLAG_*`) Pre-Gating**: Use precomputed per-line bitmasks (`LINE_FLAG_HAS_CALL_PAREN`, `LINE_FLAG_COMMENT`, `LINE_FLAG_IMPORT` in `source-mask.ts`) to skip non-matching lines in $O(1)$.
  4. **32/32 `resetState()` Pooling & Lazy `ctx.sourceFile`**: Every analyzer must implement `resetState()` for `AnalyzerPool` reuse and evaluate `ctx.lines` / `ctx.maskedText` before touching `ctx.sourceFile` in `finalize(ctx)`.
- **Rule & Regex SSOT**: Register rules as `FAMILY-TOPIC-NNN` across `src/core/rules/`, `dimensionRuleTable.ts` ($\text{AxesPerFinding} \le 4$), and `scripts/common/rule-catalog.json`; register all `scripts/validate-*.js` in `scripts/test-parallel.js` (<!-- METRICS:BEGIN test-suite-count -->**197 套**<!-- METRICS:END test-suite-count --> suites, `validate-suite-manifest.js`). Centralize regex literals in `src/core/constants/regex-patterns.ts` (`validate-regex-ssot.js`). Avoid duplicate `export *` collisions in `src/api.ts` (`TS2308`).

---

## 3. Praxis SDK, Dual-Surface Diff, Daemon & Hot-Path Discipline

1. **Praxis SDK & 3-Layer Diff**: `createPraxisClient` exposes `reviewWorkspace`, `reviewFile`, `reviewDiff`, and `evaluateMergeGate`, emitting symmetric `DiffAgentFace` + `DiffHumanFace` payloads across L1 (unit) $\to$ L2 (reverse dependency closure) $\to$ L3 (`shouldEscalateToL3A`), with union-find deduplication across <!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count --> overlap clusters (`electPrimaryCard`).
2. **Daemon & Atomic Staging**: Forbid blocking `*Sync` I/O on daemon hot paths (`PRF-IO-001`); isolate sync I/O behind `*IoBarrier` with sync methods ordered above `async`; cluster IPC command constants at module top (`NAM-LEN-002`); suffix timestamps with `*Ms` using `Brand<T, B>`; separate `stagingPath` and `compactStagingPath` with atomic `rename`.
3. **5D ELOC Differential Bounds (`differential-bounds.ts`)**: Clamps per-file micro diffs (add $\le 120/180$, del $\le 100$) and batch macro diffs (add $\le 360$, del $\le 280$) with Jeffreys Beta admission threshold $\Theta_{\text{admission}} \in [3.0, 25.0]$ 5D ELOC and $\text{TSPR} \ge 0.40$.

---

## 4. Gate Chain & Native CI Parity

1. **Full Gate Pipeline**: `npm run gate` chains `gate:rust` $\to$ `build` $\to$ `format:check` $\to$ `lint` $\to$ `gate:comments` $\to$ `gate:redundancy` $\to$ `gate:self` $\to$ `self-test` $\to$ `test:no-build` (eliminating duplicate `tsc` builds, mirrored in `pre-push-gate`); `audit-all --fast` schedules incremental `gate:self:slice`.
2. **Fail-Closed Native Build**: Prebuilt `index.node` stays gitignored; `validate-native-parity.js` fails closed (exit 1) when native bindings are missing, and CI builds live via `dtolnay/rust-toolchain@stable` + `npm run build:native`.
3. **Commit & Ledger Guards**: Changes under `crates/**` trigger Cargo workspace checks in `pre-commit-gate`; `vitest related` enforces `--passWithNoTests=false`; `validate-rule-dictionary-closure.js` verifies <!-- METRICS:BEGIN rule-auto-refactor-canonical -->**360 条**<!-- METRICS:END rule-auto-refactor-canonical --> canonical rules; `validate-trajectory-ledger.js` guards `baseline-signatures.json` and `governance-supervisor.json` weights; `audit-all` reverts timestamp-only diffs via `--revert-timestamp`.

---

## 5. Verification & References

```bash
cd auto-refactor && npm run build && npm run gate && npm test && node scripts/bench-hot-paths.js
```

- [praxis-client-and-diff-topology.md](references/praxis-client-and-diff-topology.md): Praxis SDK interfaces, 3-layer Diff topology, union-find clustering & Rust+TS byte-parity matrix.
- [type-level-engineering-and-caching.md](references/type-level-engineering-and-caching.md): Nominal `Brand<T, B>` types, 4-tier cache invalidation & 12 hot-path memory patterns.
- [analyzer-boilerplate.ts](templates/analyzer-boilerplate.ts) / [validate-suite-boilerplate.js](templates/validate-suite-boilerplate.js): Standard analyzer & validation suite templates.
