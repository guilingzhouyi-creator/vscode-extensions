# Commit Message Forbidden Terms & Objective Conversion Guide

Based on `scripts/common/commit-msg-forbidden-terms.json` and `validate-commit-msg.js`, commit messages must present strictly objective, high-cohesion technical facts.

---

## 1. Forbidden Style Rules Matrix

| Rule ID | Category | Blocked Examples | Root Cause | Objective Replacement Pattern |
| :--- | :--- | :--- | :--- | :--- |
| **`CMG-STY-001`** | Perfunctory / WIP prose | `wip`, `temp`, `hack`, `quickfix`, casual placeholders | Masks unfinished boundaries | State exact scope & precondition: `"Implement basic branch dispatch; async streaming excluded"` |
| **`CMG-STY-002`** | Exaggerated claims | `100%`, `perfect`, `ultimate`, `industrial-grade`, hype labels | Subjective inflation | State concrete guarantees: `"Add type guards and explicit error propagation"` |
| **`CMG-STY-003`** | Pejorative remarks | Abusive/dismissive phrasing about prior code | Non-technical emotion | Describe structural flaws: `"Eliminate O(n^2) nested scan and transient loop allocs"` |
| **`CMG-STY-004`** | Style meta-prose | Claims about rewriting tone or removing hype | Describes editing style, not code | State concrete text change: `"Update object-pool capacity bounds in README §4"` |
| **`CMG-STY-005`** | Procedural exit dumps | `exit code 0`, `returned 0`, `all checks green` | Transient runtime exit status | State qualitative assertion: `"Assert zero blank files and aligned line offsets"` |
| **`CMG-STY-006`** | Ephemeral run counts | `146 tests passed`, `took 50.8s`, `covered 419 files` | Fragile point-in-time metrics | State input/output invariant: `"Assert empty snapshot returns default safe baseline"` |

---

## 2. Qualitative `[Verification]` Standard

Never place exit codes (`CMG-STY-005`) or run counts/timings (`CMG-STY-006`) inside `[Verification]`. State **input -> invariant -> asserted outcome**:
- Reject: `pwsh pre-commit-gate.ps1 exit code 0` / `npm test passed 243 cases in 3.2s`
- Accept: `Run auto-refactor test suite and verify malformed inputs emit deterministic AST diagnostics.`
- Accept: `Run pre-commit gate and assert staged files enforce LF endings and slice CC bounds.`

---

## 3. Ban Sprint Codenames & Enforce Rule Closure (`RCFG-RULE-DRIFT`, `CMG-STY-007`)

- Never use sprint/phase/wip tags (`p1`, `phase2`, `st03`, `temp`, `new-*`, `wip`) in messages, comments, or paths; convert them to domain nouns (`RingBuffer persistence`, `facade decoupling`).
- Every rule ID cited in a commit body must already exist in `scripts/common/rule-catalog.json`.

---

## 4. Pronoun & Word-Boundary Guard (`CMG-STY-008`)

Commit gates block first-person pronouns (`I`, `we`, `my`, `our`) via word-boundary regexes. Write imperative headers/bullets (`Add...`, `Fix...`, `Refactor...`) and write `"disk read/write"` or `"stream operations"` rather than `"I/O"` where standalone `I` could trigger boundary matching.

---

## 5. Type-to-Section Binding (`GUARD-MSG-001`)

| Commit `<type>` | Mandatory Body Section | Expected Contract |
| :--- | :--- | :--- |
| `feat` | `[Added]` | New modules, APIs, or test coverage |
| `refactor` / `perf` | `[Changed]` | Adjusted behavior, complexity cuts, internal structure |
| `fix` | `[Fixed]` | Root cause, failure mode, and fix assertion |
| `!<breaking>` | `[Breaking Changes]` | Deprecated/changed public signatures and migration path |
