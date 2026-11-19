---
name: subagent-orchestration
description: >-
  【触发：subagent/派发任务/多agent协同/并发开发/隔离边界/上下文预算/交叉复审】派发或编排 SubAgent、处理五层上下文预算治理(75% 脱水)时必须使用。强制同构模型、独占 Zero-Intersection Path Jail 物理防冲突与交叉复审。
---

# subagent-orchestration — 5-Layer Context Governance & Orthogonal SubAgent Dispatch

Governs the 5-layer context hierarchy (75% budget dehydration), orthogonal `(Archetype × Posture)` SubAgent synthesis, exclusive Zero-Intersection Path Jail isolation, and the 8-step parent cross-review loop.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`batch-commit`。
- **领域**：另 2 个领域支援
- **协作专员**：全领域调度总枢（7 原型 × 5 姿态 × 27 预置）
- **何时联动**：技能描述命中率低或调用含义不清 → `skill-governance` + `subagent-orchestration` + `coding-craft`；多智能体任务装配与沙箱隔离 → `subagent-orchestration` + `skill-governance` + `gate-governance`
<!-- SKILL-LINKS:END -->

## 1. Five-Layer Context Budget & Four-Line Defense

1. **Priority & 75% Dehydration**: **L1 `AGENTS.md` $\to$ L2 `SPEC.md` $\to$ L3 AST Slice $\to$ L4 Top 5 Stack Frames $\to$ L5 History**. At 75% budget, prune raw logs to `[Goal, Root Cause, Hard Constraints]` (axioms first, checks last).
2. **Differential Injection (`synthesize-subagent.js`)**: Emits the 5-layer System Contract and a high-SNR Task Shell (`[Path Jail -> Objective -> Layer 4 Check]`), cutting prompt overhead ~34%.
3. **Four-Line Defense**: ① Inject `AGENTS.md`; ② lock `enable_write_tools: false` & `enable_subagent_tools: false` on `review`/`explore`; ③ 5-layer `system_prompt`; ④ lock `Model: "inherit"` + 8-step parent cross-review.

---

## 2. Orthogonal `(Archetype × Posture)` Matrix

<!-- METRICS:BEGIN subagent-archetype-count -->**7 个**<!-- METRICS:END subagent-archetype-count --> archetypes × 5 postures = <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> presets (`.agents/subagents/agents/*.md`, `sync-agents-mirror.js`; DSH in [.agents/dsh/README.md](../../dsh/README.md)):

| Archetype | Jail | Presets | Verification |
| :--- | :--- | :--- | :--- |
| **`vs-extension`** | `workspace-timing/` | `wt-{construct,review,refactor,explore}` | `cd workspace-timing && npm run compile && npm run test:fast && npm run review` |
| **`cli-engine`** | `auto-refactor/` | `ar-{construct,review,refactor,explore}` | `cd auto-refactor && npm run build && node scripts/gate-self.js && npm test` |
| **`game-engine`** | `WebGames/` | `wg-{construct,review,refactor,explore}` | `cd WebGames && python scripts/py/audit_config.py --strict && pwsh scripts/ps1/audit-all.ps1` |
| **`git-kernel`** | `fractal-git/` | `fg-{construct,review,refactor,explore}` | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1 && cargo test --workspace --manifest-path fractal-git/Cargo.toml` |
| **`infra-tool`** | `scripts/` | `infra-{construct,review,refactor,explore,guardian}` | `pwsh -File scripts/ps1/pre-commit-gate.ps1 && pwsh -File scripts/ps1/audit-all.ps1 -Fast` |
| **`workspace-meta`** | Root | `workspace-{review,refactor,guardian}` | `node scripts/common/generate-rule-catalog.js --check-only` |
| **`skill-governance`** | `.agents/skills/` | `skill-{construct,review,refactor}` | `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check` |

---

## 3. Path Jail, Mutex & Branch Topology

1. **Disjoint Jails ($\forall i \ne j,\ \text{Jail}_i \cap \text{Jail}_j = \emptyset$)**: Concurrent writers take non-overlapping files (`Workspace: "branch"` across projects); follow `Explore/Review -> Construct/Refactor -> Guardian` with `mark_chapter`.
2. **Session Mutex & 5D Bounds (`scripts/common/diff-bounds-contract.json`)**: Zero touch/revert (`git restore .`, `git clean -fd`) on external dirty files in `git status -s`; stage explicit paths (`git add <files>`). Enforce source add $\le 240/180/260$, test add $\le 360/260/380$, del $\le 120/360$, batch add $\le 540/720$ (`0.5x` test), del $\le 360$, $\Theta_{\text{admission}}\in [3.0, 25.0]$; split Code Beats from Telemetry Beats.
3. **5-Tier Fractal Branches (`FGT-TOP-001`)**: Enforce `main -> integration -> cell/<cell-id>/main -> cell/<cell-id>/card/<card-id>/main -> cell/<cell-id>/card/<card-id>/sub/<agent-id>` (`--cell`/`--card`/`--branch` or `branchTopology.recommendedBranch`); ban tier skips or direct protected pushes.

---

## 4. Synthesis & 8-Step Cross-Review

```bash
node .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js --preset fg-construct --files "fractal-git/crates/fg-index/src/lib.rs" --task "Optimize lock-free index" --json
node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js && node .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js
```
*(`--intent "<text>"` routes via Dice $\ge 0.3$ on `skill-registry.json#domains[].scenarios[]`.)*

**8-Step Cross-Review**: ① Path Jail (`git diff --name-only`) $\to$ ② Build $\to$ ③ Volume/Density (`evaluate-eloc-budget.js`, `validate-code-density.js`) $\to$ ④ Rule Closure (`validate-rule-id-closure.js`) $\to$ ⑤ Domain Guard $\to$ ⑥ Self-Scan Ratchet $\to$ ⑦ Domain Tests (`auto-refactor` <!-- METRICS:BEGIN test-suite-count -->**197 套**<!-- METRICS:END test-suite-count -->, `workspace-timing` <!-- METRICS:BEGIN ws-test-case-count -->**246 项**<!-- METRICS:END ws-test-case-count -->) $\to$ ⑧ Workspace <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count --> (`audit-all.ps1 -Fast`).

---

## 5. References & Templates

- [cross-review-closed-loop-protocol.md](references/cross-review-closed-loop-protocol.md): 4-line defense, 5-layer priority, Path Jail & 8-step routing table.
- [task-shell-construct.md](templates/task-shell-construct.md): Write/read-only task shell & `mark_chapter` template.
- [archetype-scaffold.json](templates/archetype-scaffold.json): Archetype & posture JSON scaffold.
