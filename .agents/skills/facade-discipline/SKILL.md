---
name: facade-discipline
description: >-
  【触发：门面/跳板/透传/ARCH-ABS/参数收敛/消融/空壳膨胀】消融<=3行纯转发跳板(ARCH-ABS-001)、压缩多形参对象(SIM-ARGS-001)或重构模块导出面时触发。确保门面具备实质承载(ARCH-FAC-001)与不可变冻结。
---

# facade-discipline — Substantive Facades, Trampoline Ablation & Behavior-Preserving Simplification

Unifies the **Substantive Facade Contract (`ARCH-FAC-001`)**, **$\le 3$-Line Trampoline Ablation (`ARCH-ABS-001`)**, and **100% Behavior-Equivalent Simplification (`SIM-ARGS-001` / `HYG-CLN-001`)**.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 3 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：精简模块导出面与消除空门面 → `fractal-git-dev` + `facade-discipline` + `rust-engineering`；消融纯转发跳板与参数收敛 → `auto-refactor-dev` + `facade-discipline` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 1. Four Pillars of a Substantive Facade (`ARCH-FAC-001`)

Every facade, gateway, adapter, or barrel `index.ts` must satisfy $\text{POR} \le 0.60$ ($\text{TSPR} \ge 0.40$) and exhibit at least one substantive capability (never fragment cohesive modules already within $\text{ELOC} \le 900, \text{LOC} \le 1400$):

| Pillar | Criterion | Architectural Role |
| :--- | :--- | :--- |
| **1. Effective Volume Floor** | $\text{ELOC} \ge 15$ | Implements real orchestration, lifecycle management, daemon error guards, or event bridging |
| **2. Immutable Snapshot Freeze** | `Object.freeze` / `deepFreeze` | Freezes exported state snapshots, config dictionaries, or SDK contracts against external mutation |
| **3. Multi-Subdomain Aggregation** | Aggregates $\ge 3$ subdomains | Coordinates $\ge 3$ distinct subsystems (e.g., `PraxisReviewClient` combining scan, graph, diff, MoE routing & guidance) |
| **4. Boundary Validation** | Explicit schema/precondition guards | Validates inputs and applies fallback defaults at the module boundary |

> **AST-Extracted SDK Facades**: In MOD/SDK architectures, offline AST extractors generate read-only SDK facades verified by $\text{Diff}(\text{Core}_{\text{public}}, \text{SDK}_{\text{exported}}) \equiv \emptyset$.

---

## 2. Trampoline Ablation (`ARCH-ABS-001`) & Six Simplification Rules

1. **100% Observable Behavior Parity**: Simplification changes internal structure only — never alter inputs/outputs, side-effect ordering, error semantics, or test assertions.
2. **Ablate $\le 3$-Line Trampolines (`ARCH-ABS-001`)**: Any file with $\text{ELOC} \le 3$ that merely re-exports a single target (`export * from './sub'`) without local logic incurs a $+3.0$-unit cognitive penalty and must be ablated in three steps: ① search all inbound imports $\to$ ② redirect callers to the source module $\to$ ③ delete the trampoline. When creating a new single-module subdirectory, place the implementation directly in `index.ts` ($\text{ELOC} \ge 15$) rather than forwarding to a sibling file.
3. **Consolidate $\ge 4$ Positional Parameters (`SIM-ARGS-001`)**: Replace parameter lists of $\ge 4$ arguments with a `readonly` parameter interface (`interface XxxParams`), avoiding single-parameter-per-line vertical sprawl that drops token density below $\tau \ge 2.5$ (`VOL-DIL-001`).
4. **Deduplicate Transport Decoders (`HYG-CLN-001`)**: Share a single pure state-machine decoder across heterogeneous channels (e.g., stdio and socket IPC).
5. **Preserve 6-Field JSDoc Headers (`CMT-VMD-001`)**: Never delete module header contracts to shrink line counts.
6. **Single Closed UI Border**: Enforce at most 1 closed border along any visual ray; demote inner controls to `Ghost` or surface fills.

---

## 3. Verification & JIT Assets

```powershell
node auto-refactor/scripts/validate-facade-governance.js
node scripts/common/evaluate-eloc-budget.js
node scripts/common/validate-code-density.js
```

- [trampoline-elimination-guide.md](references/trampoline-elimination-guide.md): Trampoline detection criteria, 3-step ablation SOP, and before/after density metrics.
- [contract-facade.ts](templates/contract-facade.ts): Standard multi-subdomain facade template with deep freeze and boundary validation.
