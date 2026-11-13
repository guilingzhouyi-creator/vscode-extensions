# Floor Guard Contract & Five Adversarial Falsification Probes

Mechanical rules for staged Floor Guard checks and the pre-delivery Doubt Cycle across five adversarial fault classes.

---

## 1. Floor Guard Mechanical Contract

- **Input**: Staged diffs and untracked added/modified files.
- **Checks**:
  1. Block newly introduced lint/type suppressions (`@ts-ignore`, `eslint-disable`, `#[allow(...)]`).
  2. Assert test case and `expect`/`assert!` counts have non-negative delta with zero skipped tests (`TST-SKP-001`).
  3. Block 0-byte files (`HYG-EMP-001`), comment-only shells (`HYG-EMP-002`), unresolved `TODO`s, and empty `catch` blocks (`ERR-FLT-001`).
- **Exit codes**: `0` clean pass; `1` violation with `file:line`; `2` guard runtime failure (fail-closed, never auto-pass).

---

## 2. Five Adversarial Falsification Probes

| Probe Dimension | Overconfident Assumption | Falsification Question |
| :--- | :--- | :--- |
| **1. Boundary / Degenerate Input** | "Inputs are non-empty and modest" | Do empty arrays, singletons, midnight crossings, or `>1500`-line inputs cause division by zero, OOB, or $O(N^2)$ stalls? |
| **2. Loop Heap Allocations** | "Just a tiny helper call" | Do `.replace()`, `.slice()`, regex literals, or closures allocate inside hot loops (`CPX-SPACE-001` / `ADV-PRF-002` / `FGT-PRF-001`)? |
| **3. Error-Path Leaks** | "Cleanup runs at task end" | On early return or async rejection, do listeners, timers, handles, and pooled objects run symmetric cleanup + `reset_state()`? |
| **4. Shared Mutable Leaks** | "Returning internal ref is faster" | Can callers mutate returned internals? Are facade objects frozen via `Object.freeze` (`ARCH-FAC-001`)? |
| **5. Crash Half-Write Corruption** | "Direct overwrite is fine" | Does crash mid-write leave 0-byte/truncated files instead of staging `.tmp -> rename`? |

---

## 3. Doubt Cycle Review Record Template

```markdown
## Adversarial Doubt Review
- **Claim**: <critical assumption & blast radius>
- **Slice**: <file:lines + pre/post-invariants>
| # | Probe Axis (Bounds/Alloc/Leak/Mutate/Write) | Failure Vector | Verdict (Defect/Tradeoff/Noise) | Action |
| :--- | :--- | :--- | :--- | :--- |
| 1 | | | | |
```
