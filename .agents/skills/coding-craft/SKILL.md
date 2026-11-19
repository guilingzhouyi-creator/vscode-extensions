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

| Domain | Rigid Criterion | Blocked Anti-Patterns | Rules |
| :--- | :--- | :--- | :--- |
| **1. Naming** | Infer I/O/effects; fn verbs, `is/has/should`, plurals ($3\sim 30$ chars); `export { orig as alias };` | `data`, `res`, `tmp`, `handleData`, 1-char vars, `phase2`, `export const alias = orig;` | `NAM-VAG-001`, `NAM-SGL-001`, `NAM-DEC-001`, `NAM-JRG-002` |
| **2. Failures** | Single channel (`Result`/typed `code`); `[Action + Target + Expected + Actual]`; `catch` needs `// ignore:` / `// intentional:` | Empty `catch {}` (`GOV-EXC-001`), `unwrap()`/`expect()`, `\|\| true`, `null` mask | `ERR-FLT-001`, `ERR-MSG-001`, `GOV-EXC-001`, `RSM-UNWRAP-001`, `PS-ERROR-001` |
| **3. Types** | Literal unions; `Array.from()` before multi-pass `IterableIterator`; `switch` + `assertNever` | `as any`, `as unknown as T`, `!`, `let v = 0` widening, reused iterators | `TSM-ANY-001`, `TSM-TYPE-001` |
| **4. Exports** | Private by default; split `export type`; facades $\text{ELOC}\ge 15$ / `Object.freeze`; proxy note $\le 5$L above (`HYG-WRAP-001`) | `export *` clashes, test exports, $\le 3$-line trampolines ([facade-discipline](../facade-discipline/SKILL.md)) | `EXP-*`, `ARCH-FAC-001`, `ARCH-ABS-001`, `HYG-WRAP-001` |
| **5. Deps** | Top-down `Interface -> Service -> Domain -> Infra`; zero cycles; zero `devDependencies` in prod | Infra $\to$ Domain, `import()` cycles, phantom deps | `DEP-INV-001`, `DEP-DEV-001`, `MOD-BWD-001` |
| **6. Testable** | Injectable `Clock` + PRNG; pure core / thin I/O; zero load-time timers | `Date.now()` / `Math.random()` in domain, top-level `setInterval`, tautologies | `TST-DEN-001`, `TST-SKP-001`, `TST-ORC-001`, `TST-TAU-001` |
| **7. Layout** | Spaces (TS 4, else 2); lift ternaries; width $\le 100$, $\tau \in [2.5, 22.0]$; pack $\ge 4$ args (`readonly`) | Off-grid ternaries (`HYG-IND-001`), $\tau < 2.5$ sprawl, $\tau > 22.0$ | `SIM-ARGS-001`, `VOL-DIL-001`, `HYG-IND-001`, `GUARD-AST-001` |

---

## 2. Six-Language Modern Idioms

| Stack | Required Idioms | Blocked Anti-Patterns |
| :--- | :--- | :--- |
| **TS** | `const`, `readonly`, `satisfies`, `let v: 0 \| 1 = 0`, `Array.from(m.values())`, `assertNever`, `@override` | `any` (`TSM-ANY-001`), `var` (`TSM-VAR-001`), `require()` (`TSM-REQUIRE-001`), `export const alias = orig;` |
| **Python** | `collections.abc`, `list[int]`, `X \| None`, `pathlib.Path`, `datetime.UTC`, `@dataclass(slots=True)`, `raise ... from` | `typing.List/Optional` (`PYM-GENERIC-001`/`PYM-UNION-001`), sync in `async` (`PYM-ASYNC-001`), mutable defaults (`PYM-DEFAULT-001`) |
| **Rust** | `let-else`, `&str`, `thiserror`, `// SAFETY:`, lock-free CAS | Prod `unwrap()` (`RSM-UNWRAP-001`), lock across `.await` (`RSM-LOCK-001`), `panic!` (`RSM-PNC-001`) |
| **GDScript** | Typed refs, paired `connect`/`disconnect`, `reset_state()`, `apply_snapshot()` | Loop `.new()` (`ADV-PRF-002`), domain math or `randf()` in views |
| **Bash** | `set -euo pipefail`, quoted expansions, `trap`, 3-step delete taint guard | Unquoted vars (`SH-QUOTE-001`), `\|\| true` (`SH-ERR-001`) |
| **pwsh** | `Verb-Noun`, `try/finally`, `$MyInvocation.ExpectingInput` in wrappers | `[Parameter()]` in wrappers (`GUARD-SHELL-001`), writing auto vars (`GUARD-VAR-001`), `iex` (`PS-SEC-001`) |

---

## 3. Six Normative Constraints & Verification

Derivations in [normative-thinking-constraints.md](references/normative-thinking-constraints.md):
1. **Closed State**: Discriminated unions / Type-State; pair entry flags with exit resets.
2. **SSOT Closure**: Single SSOT; enforce $A \setminus B = \varnothing \land B \setminus A = \varnothing$.
3. **Anti-Gaming**: Reduce CC via guards/tables/splits; never strip comments (`CMT-VMD-001`) or add $\le 3$-line trampolines (`ARCH-ABS-001`).
4. **Negative-Space First**: Empty/size/timeout/taint guards ([defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md)) before happy path.
5. **Flat Memory & Lifecycle**: SoA/TypedArrays and symmetric acquire/release ([state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)).
6. **Self-Probing Guards**: Ship `runSelfProbes()` proving positive pass and negative catch.

```powershell
node scripts/common/validate-skills.js && node scripts/common/validate-family-contract.js
node scripts/common/validate-rule-id-closure.js && node scripts/common/validate-docs-consistency.js
node scripts/common/evaluate-eloc-budget.js && node scripts/common/validate-code-density.js --all
```

- [rule-family-map.md](references/rule-family-map.md): Mapping of <!-- METRICS:BEGIN rule-family-count-all -->**70 个规则族**<!-- METRICS:END rule-family-count-all --> and <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total -->.
- [normative-thinking-constraints.md](references/normative-thinking-constraints.md): Six normative constraints and self-probing guard patterns.
- [python-idioms.md](references/python-idioms.md): `PYM` modern Python idioms and refactoring examples.
- [code-review-checklist.md](templates/code-review-checklist.md): 7-domain pre-commit code review checklist.
