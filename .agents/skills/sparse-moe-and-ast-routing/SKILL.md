---
name: sparse-moe-and-ast-routing
description: >-
  【触发：route/mask/slow/stale/MoE/AST/tape/pool】Govern 5-tier Sparse MoE routing, uint32 bitmasks, LineFeatureTape, lazy AST/CFG projection, and analyzer pooling.
---

# sparse-moe-and-ast-routing — 5-Tier Sparse MoE Routing, `LineFeatureTape` & Lazy AST Projection

Governs 5-tier Sparse MoE routing, 32-bit `AnalyzerBit` dispatch, single-pass `LineFeatureTape` (`LINE_FLAG_*`), 8-lang `NormalizedNode` / `SemanticGraph` lazy CFG/DFG projection, and `resetState()` pooling in `auto-refactor/`.

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[auto-refactor-dev](../auto-refactor-dev/SKILL.md) → **本技能** → [praxis-vfs-and-trajectory-learning](../praxis-vfs-and-trajectory-learning/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Auto-Refactor Engine（链上第 2 步）
- **协作专员**：原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`
- **何时联动**：Add analyzer or rule and register SSOT metadata → `auto-refactor-dev` + `sparse-moe-and-ast-routing` + `rule-catalog-governance` + `test-benchmark-engineering`；Optimize 5-tier Sparse MoE routing and lazy AST projection → `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence`
<!-- SKILL-LINKS:END -->

## 1. Five-Tier Sparse MoE Routing Cascade

Preserve all 5 tiers to bypass 70%–90% redundant AST walks with zero recall loss:

| Tier | Source Modules | Routing Mechanism & Invariant |
| :--- | :--- | :--- |
| **1. Preflight & Trigger** | `scanner/{file-preflight-gate,trigger-catalog}.ts`, `preflight/sparse-activator.ts` | Gate by ext (`LANGUAGE_ANALYZER_MATRIX`, `DOCS_EXTS`, `SHELL_EXTS`), `FAST_PATH_ANALYZERS`, 256-LUT / `checkFile` before parse |
| **2. Macro Router** | `router/sparseRuleRouter.ts` | Prune by `DiffSemanticCategory` × `ProjectArchetype` ($\ge 70\%$ bypass; Always-On: `hygiene`, `secrets`, `security`, `governance`) |
| **3. Micro CED Gate** | `router/sparseMoEGate.ts`, `ast-slice/` | Extract bounded slices (`ASTSliceExtractor`), score 7-bit `SliceFeatureVector` (10%–25% = 2–4 experts + core fallback) |
| **4. Bitmask & Tape** | `constants/analyzer-bitmask.ts`, `experts/{expert-catalog,expert-activation-library,grouped-dispatcher}.ts`, `ast/source-mask.ts` | Encode <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> analyzers (`1 << 0`..`1 << 31`) and gate lines via `LineFeatureTape` (`LINE_FLAG_*`) in $O(1)$ |
| **5. Pool & Lazy AST** | `analyzers/*.ts`, `core/analyzer-pool.ts` | Reuse all 32 via `resetState()`; read `ctx.sourceFile` only after fast text/tape checks pass |

## 2. Bitmask, Tape & Pooling Invariants

1. **Bit 31 Unsigned Normalization (`AnalyzerBit.CONCURRENCY = 1 << 31`)**: `1 << 31` is signed `-2147483648` vs `(1 << 31) >>> 0 === 2147483648`. `BIT_TO_ANALYZER_NAME`, `EXPERT_BY_BIT`, and `EXPERT_BASE_SCORES` must index both `(bit >>> 0)` and `(bit | 0)`; `grouped-dispatcher.ts` keeps `EXPERT_BY_INDEX` ($0 \dots 31$) fallback so Bit 31 is never dropped.
2. **`LineFeatureTape` (`CPX-SPACE-001`)**: `maskSource` populates `ctx.lineFeatures` (`LINE_FLAG_COMMENT`, `LINE_FLAG_IMPORT`, `LINE_FLAG_HAS_CALL_PAREN`, `LINE_FLAG_ASYNC_AWAIT`, `LINE_FLAG_LOOP`, `LINE_FLAG_STRING_LITERAL`); `analyze(ctx)` must check `(lineFlags & REQUIRED_MASK) === 0` before regex/substring scans.
3. **Pooling & Lazy `ctx.sourceFile` (`PRF-MEM-001`)**: Every analyzer implements `resetState(): void` for `AnalyzerPool`, defers `ctx.sourceFile` until needed, and caches compiled matchers in `WeakMap<object, RegExp[]>` (`PathClassifier` in `src/core/path/index.ts`).

## 3. Multi-Language IR, Lazy Graph & Verification

- **Mode A / B (`oxc-parser` & Tree-Sitter)**: Mode A runs zero-materialization visitors; Mode B builds `NormalizedAst` / `NormalizedNode` and `SemanticGraph` across 8 stacks (TS/JS, Python, Rust, Go, GDScript 4, Shell, YAML, Markdown).
- **Lazy Projection**: `CfgBuilder` constructs `CFG`, Cooper-Harvey-Kennedy dominators, `DFG`, and `CallGraph` only when Stage 2/3 analyzers request them.

```bash
cd auto-refactor && npm run build && npm test && node scripts/bench-hot-paths.js
node auto-refactor/scripts/validate-rules-registry.js
```

- [moe-5tier-routing-and-bitmask-spec.md](references/moe-5tier-routing-and-bitmask-spec.md): 5-tier MoE equations, Bit 31 duality proof & `LineFeatureTape` flags.
- [multilang-ir-and-lazy-projection.md](references/multilang-ir-and-lazy-projection.md): 8-lang `NormalizedNode`, Mode A/B parity, lazy CFG/DFG & `resetState()` checklist.
- [moe-pooled-analyzer-template.ts](templates/moe-pooled-analyzer-template.ts): Pooled analyzer scaffold with `LINE_FLAG_*`, `WeakMap` cache, `resetState()`, and lazy `ctx.sourceFile`.
