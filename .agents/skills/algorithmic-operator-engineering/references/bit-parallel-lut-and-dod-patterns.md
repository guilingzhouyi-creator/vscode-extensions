# Branchless 256-LUT, Bit-Parallel Algebra, CSR Graphs & Epoch $O(1)$ Reset

Five data-oriented operator patterns across TypeScript (V8), Rust (N-API), and GDScript 4.7.

---

## 1. Branchless 256-Entry `Uint8Array` Character LUT

Replace branch-heavy `if (ch === ...)` chains and `.replace(/\s+/g, '')` allocations with one module-level 256-byte bitmask table (`charCodeAt(i)` + `&`):

```typescript
const FLAG_WS = 1 << 0, FLAG_OP = 1 << 1, FLAG_QUOTE = 1 << 2, FLAG_IDENT = 1 << 3;
const CHAR_LUT = (() => {
  const lut = new Uint8Array(256);
  for (const c of [9, 10, 11, 12, 13, 32]) lut[c] |= FLAG_WS;
  for (const c of '?:+-*/%&|^!~=<>') lut[c.charCodeAt(0)] |= FLAG_OP;
  for (const c of '\'"`') lut[c.charCodeAt(0)] |= FLAG_QUOTE;
  for (let c = 48; c <= 57; c++) lut[c] |= FLAG_IDENT;
  for (let c = 65; c <= 90; c++) lut[c] |= FLAG_IDENT;
  for (let c = 97; c <= 122; c++) lut[c] |= FLAG_IDENT;
  lut[95] |= FLAG_IDENT; lut[36] |= FLAG_IDENT;
  return lut;
})();

export function scanLineMetricsBranchless(line: string): { nonWs: number; ops: number } {
  let nonWs = 0, ops = 0;
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    const flags = code < 256 ? CHAR_LUT[code] : 0;
    nonWs += (flags & FLAG_WS) === 0 ? 1 : 0;
    ops += (flags & FLAG_OP) !== 0 ? 1 : 0;
  }
  return { nonWs, ops };
}
```

---

## 2. Line-Level 32-Bit Feature Bitmask Tape

During single-pass lexical masking, populate `featureMask = new Uint32Array(lineCount)` (`BIT_HAS_TERNARY`, `BIT_HAS_LOGICAL_CHAIN`, `BIT_HAS_NULLISH`, `BIT_HAS_CALL_PAREN`, `BIT_HAS_STRING_LIT`). Skip regex/AST work in 1 CPU cycle whenever `(lineFeatureMask[idx] & rule.requiredMask) !== rule.requiredMask`.

---

## 3. Flat Compressed Sparse Row (CSR) Graph

Represent directed graphs with $V$ nodes (`0..V-1`) via three flat `Int32Array` buffers (`head`, `to`, `next`) instead of `Map<string, Set<string>>` pointer graphs:

```typescript
for (let e = head[u]; e !== -1; e = next[e]) {
  const v = to[e];
  // process edge u -> v sequentially in L1 cache
}
```

---

## 4. Epoch Generation Counter ($O(1)$ Traversal Reset)

Avoid $O(V^2)$ repeated `visited.fill(0)` across $V$ graph traversals by incrementing a monotonic `currentEpoch: number` in `visitedEpoch = new Int32Array(MAX_NODES)`:

```typescript
let currentEpoch = 1;
const visitedEpoch = new Int32Array(MAX_NODES);
export function beginTraversalPass(): number {
  currentEpoch = (currentEpoch + 1) | 0;
  if (currentEpoch <= 0) { visitedEpoch.fill(0); currentEpoch = 1; }
  return currentEpoch;
}
```

---

## 5. Bitset Algebra, Rust SWAR & GDScript Packed Arrays

1. **Bitset Set Ops**: Pack dominator/closure sets into `Uint32Array` (TS) or `Vec<u64>` (Rust) for 32x–64x word-parallel union/intersection/difference.
2. **Rust 64-bit SWAR (`crates/ops-mask`)**: Load `u64` chunks and test `"` / `/` / `\n` across 8 bytes simultaneously via broadcast mask `0x0101_0101_0101_0101_u64`, skipping 8-byte ASCII runs in `O(1)`.
3. **GDScript Hot Loops (`WebGames`)**: Use `PackedInt32Array` / `PackedFloat64Array` plus object-pool `reset_state()` + epochs for zero per-frame allocations (`ADV-PRF-002`).
