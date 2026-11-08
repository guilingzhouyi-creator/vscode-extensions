---
name: constraint-driven-development
description: >-
  【触发：交割/验收/证伪/Doubt/阈值下调/测试弱化/半成品】完成特性交付、声称修复完成或合入前对抗性证伪时必须触发。落实 Floor Guard 刚性底线与单调棘轮，主动推翻边界假设与脆弱实现。
---

# constraint-driven-development — Floor Guard, Monotonic Ratchet & Adversarial Doubt Cycle

Combines pre-coding **Floor Guard & Monotonic Ratchet** enforcement with pre-delivery **5-Step Adversarial Falsification (Doubt Cycle)** to block threshold relaxation, test weakening, and unverified boundary assumptions.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[batch-commit](../batch-commit/SKILL.md) → **本技能** → [docs-archive-governance](../docs-archive-governance/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`debugging-and-error-recovery`、`test-benchmark-engineering`。
- **领域**：工作区元治理与并行交付（链上第 2 步）；另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：并行会话改动混杂需要精准暂存 → `batch-commit` + `subagent-orchestration` + `constraint-driven-development`；评分口径被注水或刷分 → `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev`
<!-- SKILL-LINKS:END -->

## 1. The Six Non-Negotiable Floor Guards

Never make a test or gate pass by degrading any of these six invariants:
1. **No Threshold Lowering**: Never relax `baseline.json`, `eloc-budget-baseline.json`, linter configs, or gate thresholds.
2. **No Suppression Silencing**: Never add `@ts-ignore`, `eslint-disable`, or `#[allow(...)]` to hide defects.
3. **No Test Weakening**: Never delete tests, add `it.skip` (`TST-SKP-001`), or weaken `expect` assertions (`TST-TAU-001`).
4. **No Placeholder Artifacts**: Never commit 0-byte files (`HYG-EMP-001`), unresolved `TODO`/`FIXME` markers, or empty `catch {}` blocks (`GOV-EXC-001`).
5. **No Rule Catalog Drift**: Never cite an unregistered rule ID (`RCFG-RULE-DRIFT`).
6. **No Cross-Session Interference**: Never run `git restore .` or `git clean -fd`, and never touch files modified by external parallel sessions.

- **Monotonic Ratchet Principle**: Coverage, latency baselines (`TB-REGRESSION`), volume baselines (`eloc-budget-baseline.json`), and workspace High/Critical technical debt (**0 items**) move strictly in the improving direction.
- **Anti-Gaming Circuit Breaker (`BLOCK_GAMING_DETECTED`)**: Refactoring commits with semantic change ratio $\text{ELOC}_{\text{semantic}} \le 15\%$ and zero net technical debt reduction are rejected.

---

## 2. Five-Step Adversarial Falsification Loop (The Doubt Cycle)

Before claiming completion on any core branch refactoring, cross-module contract change, concurrency/idempotency logic, or persistence migration, execute:

```text
1. CLAIM ──▶ 2. EXTRACT ──▶ 3. DOUBT ──▶ 4. RECONCILE ──▶ 5. STOP (<= 3 rounds)
```

1. **CLAIM**: State in 2–3 lines the exact invariant your change relies on and what breaks if it fails.
2. **EXTRACT**: Strip subjective narrative and inspect only the raw **Diff Slice (`ARTIFACT`)** against **Pre/Post-Conditions (`CONTRACT`)** to eliminate confirmation bias.
3. **DOUBT**: Probe five adversarial vectors:
   - Degenerate empty / oversized / non-ASCII inputs;
   - Hidden transient heap allocations inside hot loops (`CPX-SPACE-001`);
   - Early-return resource or handle leaks (`PRF-LEAK-001`);
   - Cross-layer mutable reference aliasing;
   - Torn writes or non-idempotent crash replay.
4. **RECONCILE**: Classify each finding into `[Ambiguous Contract -> update doc]`, `[Real Defect -> fix + add regression test]`, `[Intentional Trade-off -> document in JSDoc]`, or `[Environment Noise -> ignore]`.
5. **STOP**: Terminate once real defects reach 0 or after 3 rounds (escalate unresolved trade-offs to the user).

---

## 3. Verification & JIT Assets

```powershell
pwsh -File scripts/ps1/audit-all.ps1
```

- [floor-guard.md](references/floor-guard.md): Floor Guard exit-code contracts, 5 adversarial probe checklists, and Doubt Cycle log sheet.
- [floor-guard-contract.json](templates/floor-guard-contract.json): Machine-verifiable quality budget and Floor Guard configuration template.
