---
name: algorithmic-operator-engineering
description: >-
  【触发：bench/route/slow/jank/SoA/LUT/SWAR/SIMD】Apply 5-step SoA/LUT complexity reduction and differential parity verification on hot-loop bottlenecks.
---

# algorithmic-operator-engineering — First-Principles Operator & Hot-Path Engineering

Guides high-throughput operators across `auto-refactor` (Rust/TS lexical/AST/graph/diff), `WebGames` (headless solvers/pools), and `workspace-timing` (streaming aggregators).

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[rust-engineering](../rust-engineering/SKILL.md)、[webgames-workflow](../webgames-workflow/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)、[telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Fractal-Git Kernel（链上第 5 步）；另 1 个领域支援；其余 2 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：taxis binary output differs byte-for-byte from git → `fractal-git-dev` + `taxis-daemon-and-agent-control` + `algorithmic-operator-engineering`；Optimize 5-tier Sparse MoE routing and lazy AST projection → `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence`
<!-- SKILL-LINKS:END -->

## 1. Five-Step Dimensional Reduction Protocol

Evaluate in order before editing any hot path:
1. **Zero-Work Pre-Filter**: Reject $>95\%$ non-targets via $O(1)$ bitmask, length, or extension gate.
2. **Data-Layout Inversion (AoS $\to$ SoA / CSR)**: Replace object trees with flat `TypedArray` arenas, `SymbolInterner` IDs, and CSR `head/to/next` adjacency arrays.
3. **Branchless LUT & Bit Parallelism**: Replace `if/switch`/regex ladders with 256-byte `Uint8Array` LUTs (`CHAR_FLAGS[code] & MASK`), `charCodeAt(0)`, or 32/64-bit SWAR.
4. **Single-Pass Tape Fusion**: Fuse $K$ scans into 1 `maskSource` pass emitting `LineFeatureTape` (`LINE_FLAG_*`) for pre-filtered `ActiveHook[]`.
5. **Epoch Reset**: Replace $O(V)$ `visited.fill(0)` / `new Set()` resets with $O(1)$ monotonic `++currentEpoch` on `visitedEpoch: Int32Array`.

## 2. Eight Operator Paradigms & Stack Mapping

| Paradigm | First-Principles Operator | TS / Node | Rust | GDScript 4.7 | Rules |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Pre-Filter** | L0 ext/len $\to$ L1 `lineFeatureMask` $\to$ L2 hash $\to$ L3 exact | `LineFeatureTape` | `memchr` | Fast key guard | `PRF-ALG-002` |
| **2. SoA / CSR** | `SymbolInterner` (`u32`) + CSR `head/to/next` | `Int32Array`/`Float64Array` | `Vec<u32>`/`&[u8]` | `PackedInt32Array` | `CPX-SPACE-001`, `ADV-PRF-002` |
| **3. 256-LUT** | 256-byte bitflag table + `charCodeAt` | `Uint8Array(256)` | `static [u8; 256]` | `PackedByteArray` | `GUARD-AST-001` |
| **4. SWAR / Bits** | Bitset unions, BPM Myers, 64-bit SWAR | `Uint32Array` | `u64`/`u128` | `int` (64-bit) | `ALGORITHMIC_PROOF` |
| **5. Tape Fusion** | 1-pass `maskSource` + `ActiveHook[]` | `SourceMask` | `ops-mask` DFA | Snapshot push | `PRF-MEM-001` |
| **6. Epoch Reset** | `visitedEpoch[u] === ++epoch` | `Int32Array` + `epoch` | `Vec<u32>` + `wrapping_add` | `PackedInt32Array` + `reset_state()` | `ADV-PRF-002` |
| **7. Poly-Modal** | $N\le 16$ bits $\to$ BPM $\to$ $>1500$L / $>2\text{M}$ cells `histogramDiff` | `myers-algorithm.ts` | `MAX_MYERS_CELLS` | Heuristic cutoff | `INVARIANT_BOUNDARY` |
| **8. Kinetics** | Closed-form oscillator ($e^{-\zeta \omega_0 t}$) + gamma | Closed-form | Closed-form | Closed-form | `UI-ENG-002` |

## 3. Oracle Parity, Benchmarks & Verification

- **Oracle Parity**: Verify against a simple reference across empty, multi-byte UTF-8, and degenerate inputs (`validate-native-parity.js`, `validate-equivalence.js`).
- **Benchmark Proof (`bench-hot-paths.js` / `TB-REGRESSION`)**: Prove `hrtime.bigint` latency & heap delta wins before adding complexity.
- **Craft (`GUARD-AST-001` / `CPX-SPACE-001` / `ADV-PRF-002`)**: $\text{CC}\le 15$, $\text{Depth}\le 4$, zero loop heap allocs; document bitmasks & cutoffs in 6-field JSDoc.

```bash
node auto-refactor/scripts/bench-hot-paths.js && cd auto-refactor && npm run build && npm test
python WebGames/scripts/py/audit_arch_static.py && node scripts/common/evaluate-eloc-budget.js
```

- [bit-parallel-lut-and-dod-patterns.md](references/bit-parallel-lut-and-dod-patterns.md): Branchless LUT, bit-parallel, CSR, tape fusion & epoch reset patterns.
- [branchless-lut-and-epoch-operator.ts](templates/branchless-lut-and-epoch-operator.ts): Reusable 256-LUT + CSR + epoch traversal scaffold.
- [rust-engineering](../rust-engineering/SKILL.md): Rust zero-cost abstractions, Type-State & `// SAFETY:` proofs.
