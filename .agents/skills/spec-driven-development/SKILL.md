---
name: spec-driven-development
description: >-
  【触发：需求澄清/质询/能力拓扑/规格书/X-Y/返工】遇到模糊需求、重大架构重构或开发新特性前触发。通过每次一问消除歧义与 X-Y 问题，先确立能力拓扑图与接口契约规格，再行动手编码。
---

# spec-driven-development — Single-Point Inquiry, Capability Mapping & Spec-First Workflow

Combines **Reverse Engineering Specification Review (Reverse ESR)** with **Spec-Driven Development** before coding: resolve ambiguity one question at a time, lock unidirectional capability topologies and typed contracts in `SPEC.md`, and obtain alignment before implementation.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 4 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：新玩法先出四阶段方案 → `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. When to Activate (and Exemptions)

- **Activate**: Ambiguous requirements with architectural trade-offs; new features, cross-layer services, or wire/storage protocol upgrades; breaking changes or state-machine migrations.
- **Exempt**: Typo fixes, deterministic 1-line null guards, or localized tweaks already covered by an existing spec.

---

## 2. Five-Stage Pre-Coding Workflow

```text
Stage -1: Reverse ESR ──▶ Stage 0: Capability Map ──▶ Stage 1: Feature Spec ──▶ Stage 2: Task Breakdown ──▶ Stage 3: Implementation
```

### Stage -1: Reverse ESR (One Question at a Time)
1. **Single Blocking Question**: Ask only 1 highest-priority architectural or boundary question per turn — never dump a multi-question survey.
2. **Concrete Options with `(Recommended)`**: Offer 2–3 concrete options, prefix the preferred choice with `(Recommended)`, and state the trade-off in one sentence.
3. **X-Y Problem Detection**: If a requested mechanism (`Y`) violates layering or concurrency safety, surface the underlying goal (`X`) and propose a compliant alternative.
4. **Bug-Report 4-Tuple**: When given a terse bug report, elicit `[Environment, Trigger Input, Expected Behavior, Stack Trace]`.

### Stage 0: Unidirectional Capability Mapping
Decompose multi-module features into a bottom-up DAG ([questioning-and-capability-mapping.md](references/questioning-and-capability-mapping.md)):
- Assign each module a stable `module-id` ordered `Contract/Shared -> Storage -> Core/Engine -> Service/Controller -> Interface/UI`.
- Ensure core domain and storage modules can be unit-tested in memory without host UI/engine dependencies.

### Stage 1: Author `SPEC.md` ([feature-spec-template.md](templates/feature-spec-template.md))
Include: ① Decision record & In/Out-of-Scope boundaries; ② Layer placement & unidirectional dependencies; ③ Strongly typed DTOs/interfaces, unit suffixes (`*Ms`), and preconditions; ④ Negative space, crash recovery, complexity & memory budgets; ⑤ Falsifiable acceptance test matrix.

### Stages 2 & 3: Exclusive-File Task Breakdown & Red-Green-Refactor Delivery
Partition into file-disjoint atomic tasks and enforce:
- Guard-clause control flow ($\text{CC} \le 15, \text{Depth} \le 4$), zero loop heap allocation (`CPX-SPACE-001`), zero $\le 3$-line trampolines (`ARCH-ABS-001`), and 6-field JSDoc headers.
- Verify compile + unit tests + static rules before claiming completion.

---

## 3. JIT References & Templates

- [questioning-and-capability-mapping.md](references/questioning-and-capability-mapping.md): Reverse ESR protocol, domain inquiry bank, and 5-layer capability mapping guide.
- [feature-spec-template.md](templates/feature-spec-template.md): Parameterized feature specification template.
