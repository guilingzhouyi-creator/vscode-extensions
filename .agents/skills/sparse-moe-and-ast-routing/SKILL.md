---
name: sparse-moe-and-ast-routing
description: >-
  【触发：route/mask/slow/stale/MoE/AST/tape/pool】Govern 5-tier Sparse MoE routing, uint32 bitmasks, LineFeatureTape, lazy AST/CFG projection, and analyzer pooling.
---

# sparse-moe-and-ast-routing — 5-Tier Sparse MoE Routing, `LineFeatureTape` & Lazy AST Projection

Governs the 5-tier Sparse Mixture-of-Experts (MoE) routing cascade, 32-bit unsigned `AnalyzerBit` bitmask dispatch, single-pass `LineFeatureTape` (`LINE_FLAG_*`) pre-gating, 8-language `NormalizedNode` / `SemanticGraph` lazy CFG/DFG projection, and zero-allocation `resetState()` analyzer pooling in `auto-refactor/`.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[auto-refactor-dev](../auto-refactor-dev/SKILL.md) → **本技能** → [praxis-vfs-and-trajectory-learning](../praxis-vfs-and-trajectory-learning/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Auto-Refactor Engine（链上第 2 步）
- **协作专员**：原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`
- **何时联动**：Add analyzer or rule and register SSOT metadata → `auto-refactor-dev` + `sparse-moe-and-ast-routing` + `rule-catalog-governance` + `test-benchmark-engineering`；Optimize 5-tier Sparse MoE routing and lazy AST projection → `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence`
<!-- SKILL-LINKS:END -->

## 1. Five-Tier Sparse MoE Routing Cascade

To bypass 70%–90% of redundant AST traversals with zero recall loss, every analyzer and router modification must preserve all five routing tiers:

| Tier | Source Module | Routing Mechanism & Invariant |
| :--- | :--- | :--- |
| **Tier 1: File Preflight & Trigger Gate** | `src/core/scanner/file-preflight-gate.ts`<br/>`src/core/preflight/sparse-activator.ts`<br/>`src/core/scanner/trigger-catalog.ts` | Filters analyzers by extension (`LANGUAGE_ANALYZER_MATRIX`, `DOCS_EXTS`, `SHELL_EXTS`), auto-generated `FAST_PATH_ANALYZERS`, and 256-LUT / `checkFile` raw-buffer triggers before parsing |
| **Tier 2: Macro File-Level Router** | `src/core/router/sparseRuleRouter.ts` | Prunes candidate analyzers by `DiffSemanticCategory` × `ProjectArchetype` ($\ge 70\%$ incremental bypass; Always-On Core: `hygiene`, `secrets`, `security`, `governance`) |
| **Tier 3: Micro AST-Slice CED Gate** | `src/core/router/sparseMoEGate.ts`<br/>`src/core/ast-slice/` | Extracts bounded slices via `ASTSliceExtractor` and evaluates 7-bit `SliceFeatureVector` per mutated block, activating 10%–25% (2–4 domain experts) with `complexity + governance + hygiene` fallback |
| **Tier 4: 32-Bit Unsigned Expert Bitmask & Tape** | `src/core/constants/analyzer-bitmask.ts`<br/>`src/core/experts/{expert-catalog,expert-activation-library,grouped-dispatcher}.ts`<br/>`src/core/ast/source-mask.ts` | Encodes all <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> analyzers in a 32-bit bitmask (`1 << 0` .. `1 << 31`) and gates per-line checks via `LineFeatureTape` (`LINE_FLAG_*`) in $O(1)$ |
| **Tier 5: Zero-Alloc Pooling & Lazy AST** | `src/analyzers/*.ts`<br/>`src/core/analyzer-pool.ts` | Pools all 32 analyzers via `resetState()` and defers `ctx.sourceFile` access until after fast text/tape checks pass |

---

## 2. Critical Bitmask, Tape & Pooling Invariants

1. **Bit 31 Unsigned Normalization (`AnalyzerBit.CONCURRENCY = 1 << 31`)**:
   - In JavaScript/TypeScript, `1 << 31` evaluates to signed `-2147483648`, whereas `(1 << 31) >>> 0` evaluates to `2147483648`.
   - `BIT_TO_ANALYZER_NAME`, `EXPERT_BY_BIT` (`expert-catalog.ts`), and `EXPERT_BASE_SCORES` (`expert-activation-library.ts`) **must** index both `(bit >>> 0)` and `(bit | 0)`, and `grouped-dispatcher.ts` must maintain `EXPERT_BY_INDEX` ($0 \dots 31$) fallback so Bit 31 is never dropped during bitmask iteration.
2. **`LineFeatureTape` (`LINE_FLAG_*`) $O(1)$ Pre-Gating (`CPX-SPACE-001`)**:
   - Single-pass lexical masking (`maskSource`) populates `ctx.lineFeatures` with bitflags (`LINE_FLAG_COMMENT`, `LINE_FLAG_IMPORT`, `LINE_FLAG_HAS_CALL_PAREN`, `LINE_FLAG_ASYNC_AWAIT`, `LINE_FLAG_LOOP`, `LINE_FLAG_STRING_LITERAL`).
   - Line-level checks in `analyze(ctx)` must test `(lineFlags & REQUIRED_MASK) === 0` before running regexes or substring searches.
3. **Universal `resetState()` Pooling & Lazy `ctx.sourceFile` (`PRF-MEM-001`)**:
   - Every built-in analyzer must implement `resetState(): void` to clear per-file state in place for `AnalyzerPool`.
   - Never read `const sf = ctx.sourceFile` at the top of `finalize(ctx)` before text/line checks — `ctx.sourceFile` is a lazy getter that triggers full TypeScript AST parsing on demand.
   - Cache compiled glob/config matchers in a `WeakMap<object, RegExp[]>` keyed on the options object (`PathClassifier` SSOT in `src/core/path/index.ts`).

---

## 3. Multi-Language Semantic IR & Lazy Graph Projection

1. **Mode A vs. Mode B Parsing (`oxc-parser` & Tree-Sitter)**:
   - **Mode A (Streaming Fast Path)**: Zero-materialization AST visitor for single-file complexity and syntax checks.
   - **Mode B (Materialized Compensation)**: On-demand `NormalizedAst` / `NormalizedNode` and `SemanticGraph` construction across 8 ecosystems (TS/JS, Python, Rust, Go, GDScript 4, Shell, YAML, Markdown).
2. **Lazy CFG / Dominator / DFG Projection**:
   - `CfgBuilder` projects Control-Flow Graphs (`CFG`), iterative Cooper-Harvey-Kennedy immediate dominators, Data-Flow Graphs (`DFG`), and cross-file `CallGraph` lazily only when Stage 2/3 analyzers request them.

---

## 4. Verification Commands & JIT Assets

```bash
cd auto-refactor && npm run build && npm test && node scripts/bench-hot-paths.js
node auto-refactor/scripts/validate-rules-registry.js
```

- [moe-5tier-routing-and-bitmask-spec.md](references/moe-5tier-routing-and-bitmask-spec.md): Complete 5-tier MoE routing equations, Bit 31 signed/unsigned duality proof, and `LineFeatureTape` bitmask reference table.
- [multilang-ir-and-lazy-projection.md](references/multilang-ir-and-lazy-projection.md): 8-language `NormalizedNode` mapping, Mode A/B equivalence, lazy CFG/DFG projection, and `resetState()` pooling checklist.
- [moe-pooled-analyzer-template.ts](templates/moe-pooled-analyzer-template.ts): Standard pooled analyzer scaffold demonstrating `LINE_FLAG_*` pre-gating, `WeakMap` option caching, `resetState()`, and lazy `ctx.sourceFile` access.
