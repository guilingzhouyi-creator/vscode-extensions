---
name: constraint-driven-development
description: >-
  【触发：verify/merge/bypass/partial/Doubt/Floor/ratchet/gate】Run Floor Guard ratchets and adversarial Doubt loops before delivery; forbid baseline weakening or partial hacks.
---

# constraint-driven-development — Floor Guard, Ratchet & Doubt Cycle

Enforces pre-coding **Floor Guard & Monotonic Ratchet** and pre-delivery **5-Step Doubt Cycle** against threshold relaxation, test weakening, and unverified assumptions.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[batch-commit](../batch-commit/SKILL.md) → **本技能** → [docs-archive-governance](../docs-archive-governance/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`debugging-and-error-recovery`、`test-benchmark-engineering`。
- **领域**：Parallel Delivery & Meta-Governance（链上第 2 步）；另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Stage atomic commits alongside dirty parallel sessions → `batch-commit` + `subagent-orchestration` + `constraint-driven-development`；Detect score padding, gaming, or telemetry boundary failures → `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev`
<!-- SKILL-LINKS:END -->

## 1. Six Floor Guards & Monotonic Ratchet

| Guard | Forbidden Bypass |
|---|---|
| **No Floor Lowering** | Relaxing `baseline.json`, `eloc-budget-baseline.json`, linters, or gate thresholds |
| **No Silencing** | Adding `@ts-ignore`, `eslint-disable`, or `#[allow(...)]` |
| **No Test Weakening** | Deleting tests, `it.skip` (`TST-SKP-001`), or weaker `expect` (`TST-TAU-001`) |
| **No Placeholders** | 0-byte files (`HYG-EMP-001`), `TODO`/`FIXME`, or empty `catch {}` (`GOV-EXC-001`) |
| **No Catalog Drift** | Unregistered rule IDs (`RCFG-RULE-DRIFT`) |
| **Session Isolation** | `git restore .` / `git clean -fd` or editing external parallel dirty files |

- **Ratchet & Anti-Gaming (`BLOCK_GAMING_DETECTED`)**: Coverage, latency (`TB-REGRESSION`), volume (`eloc-budget-baseline.json`), and High/Critical debt (**0 items**) strictly improve; refactors with $\text{ELOC}_{\text{semantic}} \le 15\%$ and zero net debt cut are rejected.

---

## 2. Five-Step Doubt Cycle (`<= 3` Rounds)

Run on core refactors, cross-module contracts, concurrency/idempotency, or persistence migrations:
`1. CLAIM -> 2. EXTRACT -> 3. DOUBT -> 4. RECONCILE -> 5. STOP`
- **CLAIM & EXTRACT**: State exact invariant and failure mode (2–3 lines); inspect raw **Diff Slice (`ARTIFACT`)** vs **Pre/Post-Conditions (`CONTRACT`)**.
- **DOUBT (5 Probes)**: ① Empty/oversized/non-ASCII; ② Loop heap alloc (`CPX-SPACE-001`); ③ Early-return leaks (`PRF-LEAK-001`); ④ Cross-layer mutable aliasing; ⑤ Torn writes / non-idempotent replay.
- **RECONCILE & STOP**: Bucket as `[Ambiguous Contract -> doc]`, `[Real Defect -> fix + test]`, `[Intentional Trade-off -> JSDoc]`, or `[Env Noise -> ignore]`; stop at 0 defects or 3 rounds.

---

## 3. Verification & Assets

```powershell
pwsh -File scripts/ps1/audit-all.ps1
```

- [floor-guard.md](references/floor-guard.md): Exit-code contracts, 5 probe checklists & Doubt Cycle log.
- [floor-guard-contract.json](templates/floor-guard-contract.json): Quality budget & Floor Guard template.
