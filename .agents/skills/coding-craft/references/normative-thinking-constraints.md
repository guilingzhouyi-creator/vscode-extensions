# Six Normative Engineering Constraints for Coding Agents

Pre-edit cognitive checklist targeting the six primary failure modes in automated code generation.

---

## 1. State-Space Algebraic Closure

- **Defect**: Ad-hoc boolean flags (`insideBlock = false`) reset in happy paths only, leaking state across early returns or exceptions.
- **Rule**: Replace multiple independent booleans with one **Discriminated Union** or **Type-State** parameter (`Make Illegal States Unrepresentable`). Write entry and exit/stack/bracket invariants together with `try/finally` restoration.

---

## 2. SSOT Derivation & Bidirectional Closure

- **Defect**: Hand-duplicating enumerations across TypeScript/Rust code, Markdown tables, and JSON configs until they drift.
- **Rule**: Treat every registry update as the atomic triple **SSOT edit -> `sync-*` projection -> `validate-*` difference check**. Assert symmetric set equality ($A \setminus B = \varnothing$ and $B \setminus A = \varnothing$, e.g. `validate-family-contract.js`).

---

## 3. Anti-Mechanical-Gaming & Complexity Conservation

- **Defect**: Dodging `VOL-ELOC-001`, `CPX`, `SIM-ARGS-001`, or `VOL-DIL-001` by stripping comments, spawning `<= 3`-line pass-through shells, or packing statements onto one line.
- **Rule**: Reduce complexity legitimately via **guard clauses**, **lookup tables**, and **cohesive domain helpers**—never forwarding trampolines (`ARCH-ABS-001` / `BLOCK_GAMING_DETECTED`). Preserve $\text{ECR} \ge 0.75$, $\tau \in [2.5, 22.0]$, and $\text{POR} \le 0.60$.

---

## 4. Negative Space & Degenerate Bounds

Before coding, verify all three negative-space questions:
1. **Degenerate inputs**: Do empty files, $>10\text{KB}$ minified lines, or deep recursion (`maxDepth`) short-circuit in $O(1)$ with explicit bounds?
2. **Blast-radius isolation**: Can empty or `..` variables aim destructive ops at `/` or `$HOME` (`GUARD-DESTR-001`), and do spawned tools enforce timeouts + kill guards?
3. **Single failure contract**: Return `{ ok: false, reason }` or throw typed errors explicitly—never return ambiguous `null`/`undefined`.

---

## 5. Data-Oriented Zero-Allocation Loops

- Design data layout before loop control flow. Audit hot loops for zero transient heap allocations (`CPX-SPACE-001` / `ADV-PRF-002` / `FGT-PRF-001`).
- Hoist `RegExp`/lookup constants to module scope and reuse pre-allocated buffers via cursor indices (`queue[head++]`) or `reset_state()` / `clear()`.

---

## 6. Falsifiable Self-Probing Guards

Never declare a validator done on `0 violations` alone—regex bugs fail open silently. Every custom guard must ship failing negative probes alongside passing positive probes in `runSelfProbes()` and exit non-zero if discrimination fails.
