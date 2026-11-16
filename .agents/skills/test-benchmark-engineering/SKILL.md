---
name: test-benchmark-engineering
description: >-
  【触发：test/bench/flaky/orphan/TDD/clock/seed/OnceLock】Enforce red-green TDD, deterministic clocks/seeds, suite-manifest closure, and monotonic benchmark ratchets.
---

# test-benchmark-engineering — TDD Red-Green-Refactor, Deterministic Isolation & Benchmark Ratchets

Unifies **Red-Green-Refactor TDD**, **deterministic clock/PRNG/sandbox isolation**, **zero orphan test registration (`TST-ORC-001`)**, and **monotonic latency ratchets (`TB-REGRESSION`)**.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)、[coding-craft](../coding-craft/SKILL.md) → **本技能** → [release-package-workflow](../release-package-workflow/SKILL.md)；并行支援 `constraint-driven-development`、`debugging-and-error-recovery`、`complexity-budget`、`spec-driven-development`。
- **领域**：Fractal-Git Kernel（链上第 6 步）；另 1 个领域支援；其余 4 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：Add or update taxis CLI subcommands and plumbing → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；Persistent daemon IPC, blackboard leases, or quarantine replay → `taxis-daemon-and-agent-control` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Red-Green-Refactor Loop & Deterministic Isolation

```text
1. RED (Write failing test & observe failure) ──▶ 2. GREEN (Minimal production fix) ──▶ 3. REFACTOR (Flatten & pass gates)
```

| Dimension | Mandatory Contract | Prevented Failure Mode & Rule ID |
| :--- | :--- | :--- |
| **Clock Virtualization** | `withFixedNow` / injected `Clock` | Flaky cross-midnight or timer drift from bare `Date.now()` (`TST-DEN-001`) |
| **Seeded PRNG** | Fixed-seed Mulberry32 / `DeterministicRNG` | Non-reproducible random failures from bare `Math.random()` (`TST-DEN-001`) |
| **Zero Blind Sleep** | Condition-driven waits + in-memory stubs | Flaky `setTimeout(100)` races and external disk/network I/O coupling |
| **Sandbox & Drain** | `os.tmpdir()` + `try/finally` + `pump()/flush()` | Leftover temp dirs and hung background dispatchers on exit |
| **Assertion Integrity** | Forbid `it.skip` & tautological assertions | Skipped specs (`TST-SKP-001`) or vacuous `toBeTruthy()` checks (`TST-TAU-001`) |

---

## 2. Zero Orphan Specs (`TST-ORC-001`) & Latency Ratchet (`TB-REGRESSION`)

1. **Mandatory Suite Registration across Controlled Projects**:
   - **`auto-refactor`**: Register all `scripts/validate-*.js` and unit suites in `scripts/test-parallel.js` (<!-- METRICS:BEGIN test-suite-count -->**197 套**<!-- METRICS:END test-suite-count --> suites, verified by `validate-suite-manifest.js`).
   - **`workspace-timing`**: <!-- METRICS:BEGIN ws-test-case-count -->**246 项**<!-- METRICS:END ws-test-case-count --> unit tests under `src/test/` executed via `npm run test:fast` and `npm run review`.
   - **`WebGames`**: Inherit `TestCase` under `tests/unit/{domains,frontend,infrastructure}/` and register in both `config/infrastructure/domains.json` and `tests/test_registry.gd` (<!-- METRICS:BEGIN wg-test-suite-count -->**149 套**<!-- METRICS:END wg-test-suite-count --> suites).
   - **`fractal-git`**: Register kernel & E2E suites in `Cargo.toml` and `audit-taxis.ps1`.
2. **Latency Ratchet (`TB-REGRESSION`) & Timeout Tail Dump**:
   - Pure unit test target $\le 10\text{ms}$; suite duration capped at $1.15 \times \text{Baseline}$ (`TB-REGRESSION`).
   - On subprocess or headless test timeout, dump the last 50 lines of the log to expose the deadlocked stack.

---

## 3. Verification & JIT Assets

```bash
cd auto-refactor && npm test && node scripts/bench-hot-paths.js
cd workspace-timing && npm run test:fast
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [deterministic-test-isolation.md](references/deterministic-test-isolation.md): Clock/PRNG virtualization, in-memory storage stubs, and `TB-REGRESSION` ratchet guide.
- [deterministic-unit-test.ts](templates/deterministic-unit-test.ts) / [benchmark-suite-skeleton.js](templates/benchmark-suite-skeleton.js): Deterministic unit test and micro-benchmark templates.
