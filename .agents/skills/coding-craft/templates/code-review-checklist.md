# Seven-Domain Code Review Checklist

Rule-backed checklist so every review item cites a registered SSOT rule ID.

## 1. Naming
- [ ] Exported names stay self-explanatory without reading implementations (`NAM-VAG-001`)
- [ ] Single-letter names limited to loop indices or discards (`NAM-SGL-001`)
- [ ] No bloated stacked names or shared long prefixes (`NAM-DEC-001`)
- [ ] Verbs for functions, `is/has/should` for booleans, plurals for collections (`NAM-COL-001`)
- [ ] Clean filenames with zero sprint or temp tags (`NAM-FIL-001`, `NAM-JRG-002`)

## 2. Failure Semantics
- [ ] Uniform error representation per module; zero empty catches or bare `except` (`ERR-FLT-001`)
- [ ] Zero bare `unwrap()` / `panic!` in production Rust paths (`RSM-UNWRAP-001`, `RSM-PNC-001`)
- [ ] Errors state object, expected, actual, and context (`ERR-MSG-001`), preserving cause chains (`PYM-RAISE-001`)

## 3. Types & Interfaces
- [ ] Exhaustive `switch` + `assertNever` on unions; zero `!`, `@ts-ignore`, or unvalidated `as` casts
- [ ] Zero `export *`; exported signatures expose all referenced types
- [ ] Facades bear real substance (`ARCH-FAC-001`); zero `<= 3`-line trampolines (`ARCH-ABS-001`)

## 4. Dependencies & Testability
- [ ] Zero upward imports from infra (`DEP-INV-001`), import cycles (`import-cycle`), or dev deps in prod (`DEP-DEV-001`)
- [ ] Lazy dynamic imports documented and justified (`DEP-LAZ-001`)
- [ ] Clocks/RNG injected (`TST-DEN-001`); zero skipped tests (`TST-SKP-001`) or empty assertions (`TST-TAU-001`)

## 5. Language Idioms
- [ ] TypeScript: zero `any` / `var` / `require` (`TSM-ANY-001`, `TSM-VAR-001`, `TSM-REQUIRE-001`)
- [ ] Python: built-in generics, `|`, `collections.abc`, `with` guards (`PYM-*`)
- [ ] Rust: `let-else`, `&str`, 3-part `// SAFETY:`, zero locks across `.await` (`RSM-*`)
- [ ] Shell / PowerShell: `set -euo pipefail`, quoted expansions (`SH-QUOTE-001`), Verb-Noun, zero `iex` (`PS-*`)

## 6. Pre-Commit Checks
```powershell
node scripts/common/validate-skills.js
node scripts/common/validate-rule-id-closure.js
node scripts/common/evaluate-eloc-budget.js
pwsh -File scripts/ps1/pre-commit-gate.ps1
```
