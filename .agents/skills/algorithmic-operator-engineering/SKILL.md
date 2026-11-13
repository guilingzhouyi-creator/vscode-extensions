---
name: algorithmic-operator-engineering
description: >-
  【触发：bench/route/slow/jank/SoA/LUT/SWAR/SIMD】Apply 5-step SoA/LUT complexity reduction and differential parity verification on hot-loop bottlenecks.
---

# algorithmic-operator-engineering — First-Principles Operator & Hot-Path Engineering

Guides high-throughput algorithm and operator design across `auto-refactor` (Rust/TS lexical/AST/graph/diff operators), `WebGames` (headless solvers & object pools), and `workspace-timing` (streaming aggregators) via data-layout inversion, algebraic pre-filtering, bit-level parallelism, and single-pass tape fusion.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[rust-engineering](../rust-engineering/SKILL.md)、[webgames-workflow](../webgames-workflow/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)、[telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Fractal-Git Kernel（链上第 5 步）；另 1 个领域支援；其余 2 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：taxis binary output differs byte-for-byte from git → `fractal-git-dev` + `taxis-daemon-and-agent-control` + `algorithmic-operator-engineering`；Optimize 5-tier Sparse MoE routing and lazy AST projection → `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence`
<!-- SKILL-LINKS:END -->

## 1. Five-Step Dimensional Reduction Protocol

Before editing any hot loop or operator, evaluate these five reductions in order:
1. **Step 1 (Zero-Work Pre-Filter)**: Can an $O(1)$ bit signature, length check, or extension/trigger gate reject $> 95\%$ of non-target inputs before entering the loop?
2. **Step 2 (Data-Layout Inversion — AoS $\to$ SoA / CSR)**: Can pointer-heavy object graphs (`{ id: string, children: Node[] }`) be inverted into flat `TypedArray` arenas, `SymbolInterner` integer IDs, and Compressed Sparse Row (`head/to/next`) adjacency tables?
3. **Step 3 (Branchless LUT & Bit Parallelism)**: Can multi-branch `if/switch` ladders or regexes be replaced by a 256-entry `Uint8Array` lookup table (`CHAR_FLAGS[code] & MASK`), `charCodeAt(0)` dispatch, or 32/64-bit SWAR bitmasks?
4. **Step 4 (Single-Pass Tape Fusion)**: Can $K$ separate passes over a file ($O(K \cdot N)$) be fused into 1 lexical pass (`maskSource`) emitting a `LineFeatureTape` (`LINE_FLAG_*`) consumed by pre-filtered `ActiveHook[]`?
5. **Step 5 (Epoch Reset & Sliding Window)**: Can $O(V)$ per-query `visited.fill(0)` / `new Set()` resets be replaced with an $O(1)$ monotonic `currentEpoch++` counter over `visitedEpoch: Int32Array`?

---

## 2. Eight Operator Breakthrough Paradigms & Cross-Stack Mapping

| Paradigm | Conventional Bottleneck | First-Principles Operator | TS / Node.js | Rust Native | GDScript 4.7 | Catalog Rules |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Pre-Filter Funnel** | Full regex/AST pass on every line/file | L0 ext/length $\to$ L1 `lineFeatureMask` $\to$ L2 rolling hash $\to$ L3 exact match | `LineFeatureTape` | `memchr` / rare-byte | Fast key guard | `PRF-ALG-002` |
| **2. Flat Arena / CSR** | Heap object trees & GC churn | `SymbolInterner` (`u32`) + CSR `head/to/next` | `Int32Array` / `Float64Array` | `Vec<u32>` / `&[u8]` | `PackedInt32Array` | `CPX-SPACE-001`, `ADV-PRF-002` |
| **3. Branchless 256-LUT** | Cascading char `if/else` or `startsWith` | Static 256-byte bitflag table + `charCodeAt` | `Uint8Array(256)` | `static [u8; 256]` | `PackedByteArray` | `GUARD-AST-001` |
| **4. Bit-Parallel / SWAR** | `Set<number>` intersections or 2D DP tables | Bitset unions, `Peq` bit-parallel Myers, 64-bit SWAR | `Uint32Array` bitsets | `u64` / `u128` SWAR | `int` (64-bit mask) | `ALGORITHMIC_PROOF` |
| **5. Single-Pass Tape** | $K$ analyzers rescanning raw text | Single-pass `maskSource` + `ActiveHook[]` | `SourceMask` tape | `ops-mask` DFA | Snapshot broadcast | `PRF-MEM-001` |
| **6. $O(1)$ Epoch Reset** | `visited.fill(0)` / `Set.clear()` per query | `visitedEpoch[u] === ++epoch` | `Int32Array` + `epoch` | `Vec<u32>` + `wrapping_add` | `PackedInt32Array` + `reset_state()` | `ADV-PRF-002` |
| **7. Poly-Modal Envelope** | Single heavy algorithm on all input sizes | $N \le 16$ bitmask $\to$ BPM Myers $\to$ $>1500$ lines / $>2\text{M}$ cells fallback `histogramDiff` | `myers-algorithm.ts` | `MAX_MYERS_CELLS` | Heuristic cutoff | `INVARIANT_BOUNDARY` |
| **8. Analytic Kinetics** | Per-frame numeric Euler integration | Closed-form damped harmonic oscillator ($e^{-\zeta \omega_0 t}$) + power-law gamma | Closed-form eval | Closed-form eval | Closed-form eval | `UI-ENG-002` |

---

## 3. Differential Oracle Parity & Micro-Benchmark Verification

1. **100% Reference Oracle Parity**: Every bit-parallel, LUT, CSR, or tape-fused operator must be verified against a simple reference implementation across empty inputs, multi-byte UTF-8, and degenerate boundary corpora (`validate-native-parity.js` & `validate-equivalence.js`).
2. **Empirical Micro-Benchmark Proof (`bench-hot-paths.js` / `TB-REGRESSION`)**: Measure `hrtime.bigint` latency and heap delta before and after optimization; never add algorithmic complexity without measured throughput gain.
3. **Complexity & Header Discipline (`GUARD-AST-001` / `CPX-SPACE-001` / `ADV-PRF-002`)**: Keep helpers flat ($\text{CC} \le 15$, $\text{Depth} \le 4$), zero transient heap allocations inside loops, and document bitmask layouts, buffer length invariants, and fallback cutoffs in the 6-field JSDoc header.

---

## 4. Verification Commands & JIT Assets

```bash
node auto-refactor/scripts/bench-hot-paths.js
cd auto-refactor && npm run build && npm test
python WebGames/scripts/py/audit_arch_static.py
node scripts/common/evaluate-eloc-budget.js
```

- [bit-parallel-lut-and-dod-patterns.md](references/bit-parallel-lut-and-dod-patterns.md): Branchless 256-LUT, bit-parallel algebra, CSR graphs, single-pass feature tapes, and $O(1)$ epoch reset implementations (TS / Rust / GDScript).
- [branchless-lut-and-epoch-operator.ts](templates/branchless-lut-and-epoch-operator.ts): Reusable operator template combining a 256-entry `Uint8Array` LUT, CSR graph, and `Int32Array` epoch traversal.
- [rust-engineering](../rust-engineering/SKILL.md): Rust zero-cost abstractions, Type-State, and `// SAFETY:` invariants.
