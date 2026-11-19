---
name: test-benchmark-engineering
description: >-
  【触发：test/bench/flaky/orphan/TDD/clock/seed/OnceLock】Enforce red-green TDD, deterministic clocks/seeds, suite-manifest closure, and monotonic benchmark ratchets.
---

# test-benchmark-engineering — TDD, Deterministic Isolation & Ratchets

Enforces **Red-Green-Refactor**, **clock/PRNG/sandbox isolation**, **suite registration (`TST-ORC-001`)**, and **latency ratchets (`TB-REGRESSION`)**.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)、[coding-craft](../coding-craft/SKILL.md) → **本技能** → [release-package-workflow](../release-package-workflow/SKILL.md)；并行支援 `constraint-driven-development`、`debugging-and-error-recovery`、`complexity-budget`、`spec-driven-development`。
- **领域**：Fractal-Git Kernel（链上第 6 步）；另 1 个领域支援；其余 4 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：Add or update taxis CLI subcommands and plumbing → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；Persistent daemon IPC, blackboard leases, or quarantine replay → `taxis-daemon-and-agent-control` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Red-Green-Refactor & Deterministic Isolation

`1. RED (failing test) -> 2. GREEN (minimal fix) -> 3. REFACTOR (flatten & pass)`

| Dimension | Contract | Prevented Failure & Rule |
|---|---|---|
| **Clock** | `withFixedNow` / injected `Clock` | `Date.now()` drift (`TST-DEN-001`) |
| **PRNG** | Fixed Mulberry32 / `DeterministicRNG` | `Math.random()` flakes (`TST-DEN-001`) |
| **Zero Sleep** | Condition waits + in-memory stubs | `setTimeout(100)` races & I/O coupling |
| **Cleanup & Drain** | `os.tmpdir()` + `try/finally` + `rmSyncWithRetry` (`auto-refactor/scripts/lib/resilient-fs-cleanup.js`) + `pump()/flush()` | Windows `EPERM`/`EBUSY` locks & hung dispatchers |
| **Assertions** | Ban `it.skip` & tautologies | Skips (`TST-SKP-001`), `toBeTruthy()` (`TST-TAU-001`) |

---

## 2. Suite Closure (`TST-ORC-001`) & Ratchets (`TB-REGRESSION`)

| Project | Suite Registration & Runner |
|---|---|
| `auto-refactor` | `scripts/validate-*.js` & unit specs in `scripts/test-parallel.js` (<!-- METRICS:BEGIN test-suite-count -->**197 套**<!-- METRICS:END test-suite-count --> suites; `validate-suite-manifest.js`) |
| `workspace-timing` | <!-- METRICS:BEGIN ws-test-case-count -->**246 项**<!-- METRICS:END ws-test-case-count --> cases in `src/test/` via `npm run test:fast` & `npm run review` |
| `WebGames` | `TestCase` in `tests/unit/{domains,frontend,infrastructure}/` + `config/infrastructure/domains.json` + `tests/test_registry.gd` (<!-- METRICS:BEGIN wg-test-suite-count -->**151 套**<!-- METRICS:END wg-test-suite-count --> suites) |
| `fractal-git` | Kernel & E2E suites in `Cargo.toml` & `audit-taxis.ps1` |

- **Latency Ratchet (`TB-REGRESSION`)**: $\le 10\text{ms}$/unit; suite $\le 1.15 \times \text{Baseline}$; dump last 50 log lines on timeout.

---

## 3. Verification & Assets

```bash
cd auto-refactor && npm test && node scripts/bench-hot-paths.js
cd workspace-timing && npm run test:fast
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [deterministic-test-isolation.md](references/deterministic-test-isolation.md): Clock/PRNG stubs & `TB-REGRESSION` guide.
- [deterministic-unit-test.ts](templates/deterministic-unit-test.ts) / [benchmark-suite-skeleton.js](templates/benchmark-suite-skeleton.js): Test & micro-benchmark templates.
