---
name: debugging-and-error-recovery
description: >-
  【触发：排错/报错/崩溃/单测失败/SSCCE/复现/假说/故障】遇到任何故障、测试报错或异常行为时必须使用。严格遵循观察-假说-SSCCE隔离-最小修复五步法，坚决贯彻两次受挫即停原则，严禁盲目猜修。
---

# debugging-and-error-recovery — Root-Cause Isolation, SSCCE Probes & Rule-of-Two Recovery

Governs defect localization, Short Self-Contained Correct Example (SSCCE) reproduction, the Rule-of-Two circuit breaker, and sliding-window oscillation detection.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `coding-craft`、`constraint-driven-development`、`test-benchmark-engineering`、`complexity-budget`。
- **领域**：另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：taxis 输出与 git 逐字节不一致 → `fractal-git-dev` + `debugging-and-error-recovery` + `algorithmic-operator-engineering`；Rust 与 TypeScript 输出字节不等价 → `auto-refactor-dev` + `rust-engineering` + `debugging-and-error-recovery`
<!-- SKILL-LINKS:END -->

## 1. Five-Step Scientific Debugging & SSCCE Isolation

```text
1. Observe ──▶ 2. Hypothesize ──▶ 3. Isolate (SSCCE) ──▶ 4. Minimal Fix ──▶ 5. Prove
```

1. **Grounded Pre-Investigation (`Observe & Hypothesize`)**:
   - Inspect the full stack trace, module 6-field JSDoc header, AST call chain, and `git log` / `git diff` before touching production code.
   - Formulate a falsifiable hypothesis backed by the 4-tuple: `[Runtime Environment, Trigger Input, Expected Contract, Observed Symptom & Ruled-Out Causes]`.
2. **SSCCE Reproduction Probe (`Isolate`)**:
   - **Compact ($\le 30$ lines)**: Strip unrelated business wrappers to isolate the exact failing slice.
   - **Hermetic**: Replace disk/network I/O with deterministic in-memory stubs (`TST-DEN-001`) that reproduce the failure offline in milliseconds.
   - **Regression Promotion**: Promote the passing SSCCE directly into the unit test suite (`Prove`).

---

## 2. Rule-of-Two Circuit Breaker & Oscillation Guard

1. **Stop After Two Failed Fix Attempts (Rule of Two)**:
   - If **2 consecutive fix attempts** fail to turn the test green or introduce new regressions, **stop editing immediately**.
   - Revert speculative trial edits on the target file, re-verify upstream assumptions and environment state, and report a structured Root Cause Analysis (RCA).
2. **Multi-Step Oscillation Detection ($k \le 16$ Sliding Window)**:
   - Track deterministic state hashes across up to 16 repair steps; if $H_t = H_{t - \text{cycleLength}}$ (e.g., $A \to B \to C \to A$), abort automated retries and escalate to architectural review.

---

## 3. Verification & JIT Assets

```powershell
cd auto-refactor && npm test
```

- [software-failure-modes.md](references/software-failure-modes.md): Taxonomy of initialization, IPC, concurrency race, and host extension failure modes plus SSCCE construction patterns.
- [root-cause-analysis-template.md](templates/root-cause-analysis-template.md): Structured Root Cause Analysis (RCA) and recovery record template.
