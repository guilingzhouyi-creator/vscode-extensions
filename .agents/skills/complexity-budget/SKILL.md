---
name: complexity-budget
description: >-
  【触发：split/prune/bloat/nested/ELOC/CC/Depth/JSDoc】Enforce CC<=15, Depth<=4, ELOC<=900, LOC<=1400, 6-field JSDoc, and zero loop allocations when splitting hot files.
---

# complexity-budget — AST Complexity, Dual-Track Volume & Comment Density Contract

Defines per-function AST slice budgets, control-flow flattening patterns, dual-track volume envelopes (`ELOC`/`LOC`), 6-field JSDoc module headers, ECR comment density, algorithm fallback bounds, and zero loop heap allocation.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `coding-craft`、`constraint-driven-development`、`debugging-and-error-recovery`、`test-benchmark-engineering`。
- **领域**：另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Split bloated modules and dissolve pass-through trampolines → `auto-refactor-dev` + `facade-discipline` + `complexity-budget`；Eliminate per-frame object allocation in gameplay loops → `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 1. Per-Function AST Slice Budgets (`GUARD-AST-001`)

SSOT: `scripts/common/quality-budget-contract.json` and `scripts/common/lib/eloc-line-classifier.js`:

| Metric | Limit | Elastic Envelope | Remediation |
| :--- | :---: | :--- | :--- |
| **`CC`** | $\le 15$ | Flat dispatchers ($\text{Depth}\le 2$): $\le 25$; file-private pure ($\text{Depth}\le 3$, loop-free): $\le 18\text{–}20$; `*archetype*`/`*.test.ts`: $\le 20$ | Predicates; frozen `Map` dispatch ([control-flow-flattening-patterns.md#3-strategy-map-dispatch-on-to-o1-cc](references/control-flow-flattening-patterns.md#3-strategy-map-dispatch-on-to-o1-cc)) |
| **`Depth`** | $\le 4$ | Target $\le 2\text{–}3$; $> 4$ blocked (`CPX-NEST-001`) | Guard returns ([control-flow-flattening-patterns.md#1-guard-clauses-early-returns](references/control-flow-flattening-patterns.md#1-guard-clauses-early-returns)); isolate loop `try-catch` ([control-flow-flattening-patterns.md#2-isolate-parsing-pipelines-from-streaming-loops](references/control-flow-flattening-patterns.md#2-isolate-parsing-pipelines-from-streaming-loops), [flat-control-flow-patterns.ts](templates/flat-control-flow-patterns.ts)) |
| **`Noise`** | $\le 4.0$ | Non-identifier / identifier ratio $\le 4.0$ | Named constants; ban nested ternaries |

---

## 2. Volume, 1:3 Envelope & 5D Density

1. **Ceilings (`evaluate-eloc-budget.js`)**: $\text{ELOC}\le 900$, $\text{LOC}\le 1400$ (`quality-budget-contract.json`); never shred in-budget modules into 50-line files (`CPX-SPACE-001`).
2. **1:3 Envelope ([dynamic-envelope-cheatsheet.md](references/dynamic-envelope-cheatsheet.md))**: $\text{LOC}_{\text{max}} = \min(1400, \max(150, \lceil \text{ELOC}\times 3.0 \rceil))$; at $\text{LOC}\ge 250$, $\text{ELOC}\ge \lfloor \text{LOC}/3.0 \rfloor$; at $\text{ELOC}\ge 600$, $\text{Comments}/\text{LOC}\ge 0.08$.
3. **5D Density (`validate-code-density.js`)**: $\tau \in [2.5, 22.0]$ (`VOL-DIL-001` / `GUARD-AST-001`), $\text{POR}\le 0.60$, $\text{TSPR}\ge 0.40$ (`ARCH-FAC-001`; `index.*`/`*.d.ts`/`constants.*` exempt). Roles: `algorithm_computation` ($\le 1100/1500$, $\text{CC}\le 20$), `rules_registry` ($\le 2000/3000$), `shared_library` ($\le 450/600$).

---

## 3. JSDoc Header, ECR, Loop Alloc & Verification

1. **6-Field Header & ECR**: Modules declare `Module`, `File Path`, `Architecture Role`, `Dependencies & Triggers`, `Responsibilities`, `Design Rationale`. $\text{ECR} = \max(0, \sum w_i)/\text{totalCommentLines}$ (`DESIGN_RATIONALE`/`ARCHITECTURE_INTENT`/`ALGORITHMIC_PROOF` `+1.0`, `LIFECYCLE_OWNERSHIP`/`INVARIANT_BOUNDARY` `+0.9`, `API_CONTRACT` `+0.8`, `TRIVIAL_TRANSLATION`/`BEHAVIOR_ECHO` `0/-0.2`, `WATER_LOGGING` `-0.5`); at $\ge 5$ lines, $\text{ECR}<0.40$ or $\ge 2$ `WATER_LOGGING` triggers `GOV-GAM-001`. Document complexity bounds, fallbacks (Myers $\to$ `histogramDiff` $> 1500$ or $> 2\times 10^6$), and length invariants (`hashA.length === a.length`).
2. **Zero Loop Alloc (`CPX-SPACE-001` / `ADV-PRF-002` / `PRF-MEM-001`)**: Hoist closures/objects/`const RE_*`; preallocate typed arrays; `.push()`+`.join('\n')`; iterate `Map`/`Set` directly; `resetState()`; `queue[head++]`; reuse `cachedLines`.
3. **Anti-Gaming (`BLOCK_GAMING_DETECTED` / `GOV-GAM-001`)**: Blocks $\text{ELOC}_{\text{semantic}}\le 15\%$ refactors with zero debt cut.

```powershell
node scripts/common/evaluate-eloc-budget.js && node auto-refactor/scripts/validate-comment-governance.js
pwsh -File scripts/ps1/pre-commit-gate.ps1 && node scripts/common/validate-code-density.js --all
```
