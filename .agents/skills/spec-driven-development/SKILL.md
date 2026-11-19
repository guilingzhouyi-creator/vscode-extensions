---
name: spec-driven-development
description: >-
  【触发：clarify/design/rework/churn/spec/X-Y/contract/scope】Clarify ambiguous specs one question at a time, expose X-Y traps, and lock contracts before architecture edits.
---

# spec-driven-development — Single-Point Inquiry, Capability Map & Spec-First

Combines **Reverse ESR** and **Spec-Driven Development**: resolve ambiguity one question at a time, lock unidirectional topologies and typed contracts in `SPEC.md`, then implement.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 4 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Draft 4-stage spec before building new gameplay → `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Activation Scope

- **Activate**: Ambiguous trade-offs, cross-layer services, wire/storage upgrades, breaking changes, or FSM migrations.
- **Exempt**: Typos, deterministic 1-line null guards, or tweaks covered by an existing spec.

---

## 2. Five-Stage Pre-Coding Workflow

`Stage -1: Reverse ESR -> Stage 0: Capability Map -> Stage 1: Feature Spec -> Stage 2: Task Breakdown -> Stage 3: Implementation`

| Stage | Contract |
|---|---|
| **-1: Reverse ESR** | 1 blocking question/turn with 2–3 options (`(Recommended)` first + 1-sentence trade-off); expose X-Y traps (goal `X` when `Y` breaks layering/concurrency); elicit `[Environment, Trigger Input, Expected Behavior, Stack Trace]` for terse bugs |
| **0: Capability Map** | Bottom-up DAG ([questioning-and-capability-mapping.md](references/questioning-and-capability-mapping.md)) with `module-id` ordered `Contract/Shared -> Storage -> Core/Engine -> Service/Controller -> Interface/UI`; host-free core/storage tests |
| **1: `SPEC.md`** | Via [feature-spec-template.md](templates/feature-spec-template.md): ① Scope; ② Layer & deps; ③ Typed DTOs, `*Ms`, preconditions; ④ Negative space, crash recovery, complexity/memory budgets; ⑤ Falsifiable acceptance matrix |
| **2–3: Deliver** | File-disjoint tasks; $\text{CC} \le 15, \text{Depth} \le 4$, zero loop alloc (`CPX-SPACE-001`), zero $\le 3$-line trampolines (`ARCH-ABS-001`), 6-field JSDoc; verify compile + tests + static checks |

---

## 3. JIT Assets

- [questioning-and-capability-mapping.md](references/questioning-and-capability-mapping.md): Reverse ESR, inquiry bank & 5-layer capability mapping.
- [feature-spec-template.md](templates/feature-spec-template.md): Parameterized feature specification template.
