# Trampoline Dissolution (`ARCH-ABS-001`), Redundant Indirection & Equivalence Matrix

Standard procedure for eliminating pass-through trampolines and proving behavioral/metric equivalence after simplification.

---

## 1. Identifying Trampolines & Dead Indirection

1. **Empty Pass-Through File (`ARCH-ABS-001`)**: Excluding header comments, $\text{ELOC} \le 3$ (or $\text{POR} > 0.60$ without immutable freeze), holding only `export *` or single-target re-exports (`+3.0 units/hop` cognitive penalty).
2. **Redundant Function Wrapper**: Pure passthrough `function save(x) { return store.save(x); }` adding zero validation, transformation, retry, or transaction boundary, or single-implementation interfaces never swapped in tests.

---

## 2. Three-Step Safe Dissolution SOP

1. **Find all callers**: `git grep -n "from ['\"].*old-trampoline['\"]"` (including dynamic imports and tests).
2. **Redirect atomically**: Point every consumer import directly to the canonical module so builds remain green continuously.
3. **Delete & verify**: Remove the trampoline file and run `node auto-refactor/scripts/validate-facade-governance.js` to confirm `0 trampolines found`.

---

## 3. Post-Refactor Equivalence Checklist

After dissolving trampolines, flattening control flow, or collapsing `>= 4` args (`SIM-ARGS-001`):
- [x] Full test suite passes with zero relaxed or deleted assertions;
- [x] Public exported signatures stay compatible (only internal pass-through hops removed);
- [x] 6-field JSDoc module header preserved cleanly (`CMT-VMD-001`);
- [x] `evaluate-eloc-budget.js` and `validate-code-density.js` pass.
