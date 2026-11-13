# Praxis SDK, 3-Layer Diff Topology & Rust+TS Byte-Parity Guide

Reference guide for `PraxisReviewClient` (`src/core/praxis/`), 3-layer topological Diff (`diff-topology.ts`), union-find presentation deduplication (`semantic-correlation.ts`), and Rust/TS operator parity.

---

## 1. Praxis Client SDK (`IPraxisReviewClient`)

```typescript
import { createPraxisClient, IPraxisReviewClient } from 'auto-refactor';

const client: IPraxisReviewClient = createPraxisClient({
  root: process.cwd(),
  enableMoE: true,
  includeDualFacedPresentation: true,
  defaultLocale: 'en',
});
```

Core async methods: `reviewWorkspace`, `reviewFile`, `reviewDiff`, and `evaluateMergeGate`, emitting `AgentDirectivesBundle` (`items`, `compactPromptText`, `renderedMarkdown`, and `presentationPayload`).

---

## 2. Dual-Surface Diff, 3-Layer Escalation & Union-Find Clustering

- **`DiffAgentFace`**: Emits `enclosingSymbol`, `exactLineOffsets`, `deterministicHunkId`, and AST-bound `actionable.patch` ops (`SIM-TRN-001`, `HYG-WRAP-001`, `HYG-DED-001`, `HYG-STB-002`, `insertAnchor: 'after_imports'`).
- **`DiffHumanFace`**: Emits `decisionBadge`, bilingual `i18nMessage` (`377/377` rules in `diagnostic-catalog.ts`), and actions (`accept | auto_fix | rework | escalate_l3a | reject`).
- **3-Layer Diff**: L1 file/unit AST mapping $\to$ L2 `SemanticGraph` reverse-dependency impact closure $\to$ L3 cross-layer/destructive/loop-alloc/conflict escalation (`shouldEscalateToL3A`), serialized via `toAgentUnifiedPatch()`.
- **Deduplication (`semantic-correlation.ts`)**: Clusters co-located findings across `SEMANTIC_OVERLAP_GROUPS` (`11` groups), electing one `primaryCard` by severity $\text{block}(4) > \text{warn}(3) > \text{info}(2) > \text{pass}(1)$ and folding peers into `correlatedRules`.

---

## 3. Rust Native vs Pure-TS Parity Matrix

| Domain | Core Algorithm | Rust Crate | Pure-TS Fallback | Parity Gate |
| :--- | :--- | :--- | :--- | :--- |
| **Source Masking** | 64-bit SWAR masking (`ascii`/`utf16`) | `crates/ops-mask` | `src/core/native/native-mask-shim.ts` | `validate-native-parity.js` |
| **Diffing** | Bit-Parallel Myers / Histogram | `crates/ops-diff` | `src/core/native/native-diff-shim.ts` | `validate-equivalence.js` |
| **Graph & CFG** | Tarjan SCC & Dominator Tree | `crates/ops-graph` | `src/core/native/native-flow-shim.ts` | `validate-control-flow-graph.js` |
| **Clones & Scope** | MinHash LSH & Scope Shadowing | `crates/ops-clone`, `ops-scope` | `src/core/native/native-clone-shim.ts` | `validate-native-bridge.js` |

Both tracks must guarantee identical JSON key order, UTF-8/LF line-column offsets, and 4-decimal float precision.
