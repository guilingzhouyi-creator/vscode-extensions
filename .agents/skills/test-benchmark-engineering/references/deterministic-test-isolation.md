# Deterministic Test Isolation, Memory Stubs & Duration Ratchets (`TB-REGRESSION`)

Standards for deterministic clock/RNG injection, isolated scratch fixtures, and monotonic suite timing ratchets.

---

## 1. Virtualized Clock (`withFixedNow`) & Seeded PRNG (Mulberry32)

1. **Inject fixed timestamps** around midnight boundaries or expiry checks (`try ... finally` restores `Date.now`):
   ```typescript
   export async function withFixedNow<T>(fixedMs: number, fn: () => Promise<T> | T): Promise<T> {
     const orig = Date.now;
     try { Date.now = () => fixedMs; return await fn(); }
     finally { Date.now = orig; }
   }
   ```
2. **Seeded PRNG (ban raw `Math.random()`)**:
   ```typescript
   export function mulberry32(seed: number): () => number {
     return () => {
       let t = (seed += 0x6d2b79f5);
       t = Math.imul(t ^ (t >>> 15), t | 1);
       t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
       return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
     };
   }
   ```
3. **Symmetric sandbox cleanup**: Unit tests favor `Map<string, T>` in-memory stubs; integration tests create uniquely suffixed directories under `os.tmpdir()` and clean files/listeners inside `afterEach` or `finally`.

---

## 2. Monotonic Suite Duration Ratchet (`TB-REGRESSION`)

- **Tiered targets**: Pure unit tests `<= 10ms` each; local streaming gates report both in-memory (~`1ms`) and end-to-end subprocess (~`160ms`) budgets.
- **1.15x ratchet**: Suite runtimes exceeding `1.15x` recorded baseline fail (`TB-REGRESSION`) to expose leaked timers or $O(N^2)$ regressions; tighten baselines whenever optimizations permanently reduce runtime.
