---
name: facade-discipline
description: >-
  【触发：prune/refactor/bloat/dead/ARCH/facade/wrap/argobj】Dissolve <=3-line pure trampolines (ARCH-ABS-001), pack >=4 args, and enforce substantive frozen facades (>=15 ELOC).
---

# facade-discipline — Substantive Facades & Trampoline Ablation

Enforces **Substantive Facades (`ARCH-FAC-001`)**, **$\le 3$-line Trampoline Ablation (`ARCH-ABS-001`)**, and **Behavior-Equivalent Simplification (`SIM-ARGS-001` / `HYG-CLN-001`)**.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 3 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Enrich thin crate facades and eliminate trampolines → `fractal-git-dev` + `facade-discipline` + `rust-engineering`；Split bloated modules and dissolve pass-through trampolines → `auto-refactor-dev` + `facade-discipline` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 1. Substantive Facade Pillars (`ARCH-FAC-001`)

Facades/gateways/`index.ts` barrels must satisfy $\text{POR} \le 0.60$ ($\text{TSPR} \ge 0.40$) and $\ge 1$ pillar (never split modules within $\text{ELOC} \le 900, \text{LOC} \le 1400$):

| Pillar | Criterion | Role |
|---|---|---|
| **Volume** | $\text{ELOC} \ge 15$ | Orchestration, lifecycle, daemon error guards, or event bridging |
| **Freeze** | `Object.freeze` / `deepFreeze` | Lock exported snapshots, configs, or SDK contracts |
| **Subdomains** | $\ge 3$ subdomains | Coordinates $\ge 3$ subsystems (e.g. `PraxisReviewClient`) |
| **Validation** | Explicit schema/preconditions | Input guards & fallback defaults at boundary |

> AST-extracted SDK facades satisfy $\text{Diff}(\text{Core}_{\text{public}}, \text{SDK}_{\text{exported}}) \equiv \emptyset$.

---

## 2. Trampoline Ablation (`ARCH-ABS-001`) & Simplification

| Rule | Invariant |
|---|---|
| **Parity** | Preserve I/O, side-effect order, error semantics, and assertions |
| **Trampolines (`ARCH-ABS-001`)** | Files $\le 3$ ELOC forwarding one target (`export * from './sub'`) incur $+3.0$ cognitive penalty: ① find imports $\to$ ② redirect $\to$ ③ delete. Put single-module code directly in `index.ts` ($\text{ELOC} \ge 15$) |
| **Args (`SIM-ARGS-001`)** | Pack $\ge 4$ positional args into `readonly interface XxxParams`; keep $\tau \ge 2.5$ (`VOL-DIL-001`) |
| **Decoder (`HYG-CLN-001`)** | Share one pure state-machine decoder across stdio & socket IPC |
| **JSDoc & UI (`CMT-VMD-001`)** | Keep 6-field JSDoc; $\le 1$ closed UI border/ray (demote inner controls to `Ghost`/fills) |

---

## 3. Verification & Assets

```powershell
node auto-refactor/scripts/validate-facade-governance.js
node scripts/common/evaluate-eloc-budget.js && node scripts/common/validate-code-density.js
```

- [trampoline-elimination-guide.md](references/trampoline-elimination-guide.md): Detection, 3-step ablation & density metrics.
- [contract-facade.ts](templates/contract-facade.ts): Multi-subdomain frozen facade template.
