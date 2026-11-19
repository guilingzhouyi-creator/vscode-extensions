---
name: debugging-and-error-recovery
description: >-
  【触发：debug/triage/crash/fail/flaky/SSCCE/stack/repro】Debug via Observe-Hypothesize-SSCCE-MinimalFix and strict stop-after-2-failures discipline without guesswork.
---

# debugging-and-error-recovery — Root-Cause Isolation, SSCCE & Rule-of-Two

Governs defect localization, SSCCE reproduction, the Rule-of-Two circuit breaker, and oscillation detection.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `coding-craft`、`constraint-driven-development`、`test-benchmark-engineering`、`complexity-budget`。
- **领域**：另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Rust native operator output diverges from TS shim → `auto-refactor-dev` + `rust-engineering` + `debugging-and-error-recovery`；GameConfig schema mismatches UI snapshot state → `webgames-workflow` + `debugging-and-error-recovery` + `coding-craft`
<!-- SKILL-LINKS:END -->

## 1. Debugging Loop & SSCCE Isolation

`1. Observe -> 2. Hypothesize -> 3. Isolate (SSCCE) -> 4. Minimal Fix -> 5. Prove`

| Phase | Discipline |
|---|---|
| **Observe & Hypothesize** | Inspect stack trace, 6-field JSDoc, AST call chain, and `git log`/`diff` first; form `[Runtime Environment, Trigger Input, Expected Contract, Observed Symptom & Ruled-Out Causes]` |
| **Isolate (SSCCE)** | Write $\le 30$-line reproducer without business wrappers; use in-memory stubs (`TST-DEN-001`) |
| **Fix & Prove** | Apply minimal root-cause fix; promote passing SSCCE into unit tests |

---

## 2. Rule-of-Two & Oscillation Guard

- **Rule of Two**: After **2 consecutive failed fixes** (still failing or new regressions), **stop editing**, revert speculative changes, re-verify upstream/env state, and emit an RCA.
- **Oscillation Guard ($k \le 16$)**: Track state hashes; if $H_t = H_{t - \text{cycleLength}}$ ($A \to B \to C \to A$), abort retries and escalate.

---

## 3. Verification & Assets

```powershell
cd auto-refactor && npm test
```

- [software-failure-modes.md](references/software-failure-modes.md): Initialization, IPC, race & host failure modes + SSCCE patterns.
- [root-cause-analysis-template.md](templates/root-cause-analysis-template.md): Structured RCA & recovery template.
