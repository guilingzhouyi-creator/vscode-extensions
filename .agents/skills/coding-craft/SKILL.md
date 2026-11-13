---
name: coding-craft
description: >-
  【触发：write/design/review/broken/cycle/SSOT/types/export】Enforce contract naming, explicit errors, exhaustive types, minimal exports, and unidirectional dependencies.
---

# coding-craft — Universal Coding Craft, Multi-Language Idioms & Normative Thinking

Defines function-level engineering craft invariants and 6 metacognitive constraints across all workspace languages, backed by `scripts/common/rule-catalog.json` (<!-- METRICS:BEGIN rule-family-count-all -->**70 个规则族**<!-- METRICS:END rule-family-count-all -->, <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total -->).

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md) → **本技能** → [test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)；并行支援 `constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`、`algorithmic-operator-engineering`。
- **领域**：Gate & Shell Infrastructure（链上第 3 步）；另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：PowerShell and Bash gate semantics diverge → `gate-governance` + `coding-craft` + `debugging-and-error-recovery`；Audit recursive delete or path-traversal taint risks → `defensive-security-and-taint-safety` + `gate-governance` + `coding-craft`
<!-- SKILL-LINKS:END -->

## 1. Seven-Domain Coding Craft Matrix

| Domain | Rigid Criterion | Blocked Anti-Patterns | Catalog Rules |
| :--- | :--- | :--- | :--- |
| **1. Naming as Contract** | Infer inputs, outputs & side effects from identifier alone; verbs for functions, `is/has/should` for booleans, plurals for collections ($3\sim 30$ chars); re-export aliases via `export { orig as alias };` | Bare `data`, `res`, `tmp`, `handleData`, non-loop 1-char vars, sprint codenames (`phase2`), `export const alias = orig;` | `NAM-VAG-001`, `NAM-SGL-001`, `NAM-DEC-001`, `NAM-JRG-002` |
| **2. Explicit Failure Semantics** | Single failure channel per module (discriminated `Result` or typed error with `code`); error message states `[Action + Target + Expected + Actual]`; **fail-soft `catch` blocks must include an explicit intent comment** (`// ignore: ...` or `// intentional: ...`) | Empty `catch {}` (`GOV-EXC-001` Critical), bare `unwrap()`/`expect()`, `\|\| true` error swallowing, returning `null` to mask failure | `ERR-FLT-001`, `ERR-MSG-001`, `GOV-EXC-001`, `RSM-UNWRAP-001`, `PS-ERROR-001` |
| **3. Type Narrowing & Exhaustiveness** | Explicit literal unions (prevent widening); materialize single-pass `IterableIterator` via `Array.from()` before multi-pass use; exhaustive `switch` + `assertNever` | `as any`, `as unknown as T`, non-null `!`, `let v = 0` widening literal unions, reusing exhausted iterators | `TSM-ANY-001`, `TSM-TYPE-001` |
| **4. Minimal Surface Exposure** | Module-private by default; separate `export type` from value exports; facades require $\text{ELOC}\ge 15$ or `Object.freeze`; vtable proxy exemption comments must sit within 5 lines above declaration (`HYG-WRAP-001`) | Wildcard `export *` collisions, exporting private helpers for tests, $\le 3$-line trampolines ([facade-discipline](../facade-discipline/SKILL.md)) | `EXP-*`, `ARCH-FAC-001`, `ARCH-ABS-001`, `HYG-WRAP-001` |
| **5. Unidirectional Dependencies** | Strict top-down `Interface -> Service -> Domain -> Infra`; zero same-layer cycles; zero `devDependencies` in production paths | Infra importing Domain, dynamic `import()` hiding cycles, undeclared phantom dependencies | `DEP-INV-001`, `DEP-DEV-001`, `MOD-BWD-001` |
| **6. Testability by Design** | Injectable `Clock` and seeded PRNG; pure computation separated from thin I/O adapters; zero module-load side-effect singletons | Direct `Date.now()` / `Math.random()` in domain logic, top-level `setInterval`, tautological assertions | `TST-DEN-001`, `TST-SKP-001`, `TST-ORC-001`, `TST-TAU-001` |
| **7. Layout & Token Density** | Spaces only (TS 4-space multiples, others 2-space); lift nested ternaries to guard clauses; line width $\le 100$ chars, token density $\tau \in [2.5, 22.0]$; pack $\ge 4$ params into `readonly` parameter object | Nested ternaries inside object literals causing off-grid indentation (`HYG-IND-001`), vertical param sprawl ($\tau < 2.5$), dense one-liners ($\tau > 22.0$) | `SIM-ARGS-001`, `VOL-DIL-001`, `HYG-IND-001`, `GUARD-AST-001` |

---

## 2. Six-Language Modern Idioms

| Stack | Required Modern Idioms | Blocked Anti-Patterns |
| :--- | :--- | :--- |
| **TypeScript** | `const` first, `readonly` fields, `satisfies`, `let v: 0 \| 1 = 0`, `Array.from(map.values())`, `assertNever`, `export { orig as alias }`, `@override` | `any` (`TSM-ANY-001`), `var` (`TSM-VAR-001`), `require()` (`TSM-REQUIRE-001`), exhausted `IterableIterator`, `export const alias = orig;` |
| **Python** | `collections.abc`, built-in `list[int]`, `X \| None`, `pathlib.Path`, `datetime.UTC`, `@dataclass(slots=True)`, `raise ... from err` | `typing.List/Optional` (`PYM-GENERIC-001`/`PYM-UNION-001`), sync blocking in `async def` (`PYM-ASYNC-001`), mutable default args (`PYM-DEFAULT-001`) |
| **Rust** | `let-else`, `&str` params, `thiserror` enums, `// SAFETY:` proofs, lock-free CAS | Production `unwrap()` (`RSM-UNWRAP-001`), holding lock across `.await` (`RSM-LOCK-001`), `panic!` (`RSM-PNC-001`) |
| **GDScript** | Typed node refs, paired signal `connect`/`disconnect`, pooled `reset_state()`, `apply_snapshot()` | Loop `.new()` (`ADV-PRF-002`), business formulas or `randf()` inside views |
| **Bash** | `set -euo pipefail`, double-quoted expansions, `trap` cleanup, 3-step delete taint guard | Unquoted vars (`SH-QUOTE-001`), `\|\| true` error masking (`SH-ERR-001`) |
| **PowerShell** | `Verb-Noun`, `try/finally` disposal, `$MyInvocation.ExpectingInput` in wrappers | `[Parameter()]` in GNU wrappers (`GUARD-SHELL-001`), writing read-only auto vars (`GUARD-VAR-001`), `iex` (`PS-SEC-001`) |

---

## 3. Six Normative Metacognitive Constraints

Internalize before writing code (full derivations in [normative-thinking-constraints.md](references/normative-thinking-constraints.md)):
1. **Closed State Space**: Represent state via discriminated unions or Type-State so illegal states are unrepresentable; pair every scope entry flag with a deterministic exit reset.
2. **Single-Source Derivation & Bidirectional Closure**: Maintain one SSOT and enforce $A \setminus B = \varnothing \land B \setminus A = \varnothing$ via automated guards.
3. **Anti-Gaming & Complexity Conservation**: Reduce complexity only via guard clauses, table dispatch, and cohesive extraction; never strip comments (`CMT-VMD-001`) or create $\le 3$-line trampolines (`ARCH-ABS-001`).
4. **Negative-Space First**: Implement empty-input, size-ceiling, timeout, and 3-step path taint guards ([defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md)) before the happy path.
5. **Flat Memory & Symmetric Lifecycle**: Design SoA/TypedArray layouts and symmetric acquire/release paths ([state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)) upfront.
6. **Self-Probing Guards**: Every validator script must ship `runSelfProbes()` proving both positive acceptance and negative defect detection.

---

## 4. Verification & JIT Assets

```powershell
node scripts/common/validate-skills.js && node scripts/common/validate-family-contract.js
node scripts/common/validate-rule-id-closure.js && node scripts/common/validate-docs-consistency.js
node scripts/common/evaluate-eloc-budget.js && node scripts/common/validate-code-density.js --all
```

- [rule-family-map.md](references/rule-family-map.md): Complete mapping of <!-- METRICS:BEGIN rule-family-count-all -->**70 个规则族**<!-- METRICS:END rule-family-count-all --> and <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total -->.
- [normative-thinking-constraints.md](references/normative-thinking-constraints.md): Six normative metacognitive constraints and self-probing guard patterns.
- [python-idioms.md](references/python-idioms.md): `PYM` modern Python idioms and refactoring examples.
- [code-review-checklist.md](templates/code-review-checklist.md): 7-domain pre-commit code review checklist.
