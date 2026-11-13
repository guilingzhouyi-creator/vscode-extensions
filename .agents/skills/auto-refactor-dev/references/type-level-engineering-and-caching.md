# TypeScript Type Discipline & 12 Hot-Path Memory Patterns

Compact reference for compile-time type safety and the 12 memory/latency invariants guarded by `bench-hot-paths.js`.

---

## 1. Six Type-Level Safety Principles

1. **Nominal Brands (`Brand<T, B>`)**: Tag `TimestampMs`, `LineNumber`, `ColumnNumber`, and `FileHash` with `unique symbol` brands at zero runtime cost.
2. **Exhaustive Switching (`assertNever`)**: Terminate `switch` on `GateStage` and `DiffSemanticCategory` with `assertNever(variant)`.
3. **Template Rule IDs (`StandardRuleId`)**: Enforce `FAMILY-TOPIC-NNN` / `FGT-*-NNN` typing synced to `rule-catalog.json`.
4. **Type Predicates (`item is Target`)**: Narrow worker/IPC payloads via type guards with zero `as any` (`GOV-TYP-005`).
5. **Immutable AST (`DeepReadonly<NormalizedNode>`)**: Prevent in-place AST mutation during single-pass MoE traversal.
6. **Options Compression (`SIM-ARGS-001`)**: Collapse $\ge 4$ positional parameters into readonly options interfaces.

---

## 2. Four-Tier Avoidance & 12 Hot-Path Memory Invariants

- **Four Avoidance Layers**: Sparse MoE routing (`sparseRuleRouter.ts`) $\to$ 3-tier topology caching (`topology-cache-manager.ts`) $\to$ pre-read `Transferable` buffers (`worker-scheduler.ts`) $\to$ single-pass tape scanning (`analyzer-runner.ts`).
- **12 Memory Rules**:
  1. Bound Myers trace by edit distance $D$, falling back to `histogramDiff` above $1500$ lines.
  2. Detach worker listeners (`w.off('message'|'error', ...)`) after batch completion.
  3. Advance BFS cursors via `queue[head++]` instead of $O(V^2)$ `queue.shift()`.
  4. Walk cycles with an explicit 3-color iterative stack (`White/Gray/Black`).
  5. Index graph queries with `nodesByFile` (`Map<string, SemanticNode[]>`).
  6. Split lines once at entry (`cachedLines`) and slice per-function views.
  7. Hoist regex literals (`PRF-MEM-001`, centralized `regex-patterns.ts`); reset `/g` `lastIndex = 0`.
  8. Isolate sync I/O behind `*IoBarrier` ordered above `async` methods (`PRF-IO-001`).
  9. Prebuild `Set` lookup tables outside loops (`PRF-ALG-002`).
  10. Dispatch source masking via `charCodeAt` jump tables into flat $\text{CC} \le 6$ pure helpers.
  11. Execute extension-filtered `ActiveHook[]` in the same loop that constructs `MaskedLine[]`.
  12. Scan `charCodeAt` directly in `compressionBounds.ts` instead of regex whitespace stripping.
