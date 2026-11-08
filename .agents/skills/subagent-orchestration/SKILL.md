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

1. **5-Layer Context Hierarchy & 75% Dehydration**:
   - Priority order: **L1 Global Axioms (`AGENTS.md`) $\to$ L2 Active Spec (`SPEC.md` section) $\to$ L3 Target Source & AST Slice $\to$ L4 Top 5 Stack Frames $\to$ L5 Session History**.
   - At 75% context utilization, prune failed trial logs and raw console dumps, retaining only `[Goal, Root Cause, Hard Constraints]`. Place hard axioms at the start (Primacy) and the atomic task + verification commands at the end (Recency).
2. **Differential Token Injection (`System Contract` vs. `Task Shell`)**:
   - **5-Layer System Contract**: Synthesized by `synthesize-subagent.js` (global axioms, Path Jail prefix, domain stack axioms, posture constraints, Layer 4 verification commands).
   - **High-SNR Task Shell**: Injects only `[Exclusive File List (Zero-Intersection Path Jail) -> Core Technical Objective -> Pre-Delivery Layer 4 Check]`, cutting prompt overhead by ~34%.
3. **Four-Line SubAgent Defense**:
   - **Line 1 (Rule Injection)**: `AGENTS.md` is injected into all parent/child agents.
   - **Line 2 (Physical Tool Gating)**: `review` and `explore` postures enforce `enable_write_tools: false` and `enable_subagent_tools: false`.
   - **Line 3 (5-Layer `system_prompt`)**: Enforces 6 reasoning invariants, Path Jail, and domain verification.
   - **Line 4 (`Model: "inherit"` + 8-Step Cross-Review)**: Locks subagent model to parent (`Model: "inherit"`) and requires independent 8-step parent verification.

---

## 2. Orthogonal `(Archetype × Posture)` Preset Matrix

<!-- METRICS:BEGIN subagent-archetype-count -->**7 个**<!-- METRICS:END subagent-archetype-count --> domain archetypes × 5 postures derive <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> presets (SSOT in `.agents/subagents/agents/*.md`, mirrored by `sync-agents-mirror.js`; DSH runtime modes `wg-{construct,refactor,review,explore}` documented in [.agents/dsh/README.md](../../dsh/README.md)):

| Archetype | Path Jail Prefix | Presets | Local Verification Command |
| :--- | :--- | :--- | :--- |
| **`vs-extension`** | `workspace-timing/` | `wt-construct`, `wt-review`, `wt-refactor`, `wt-explore` | `cd workspace-timing && npm run compile && npm run test:fast && npm run review` |
| **`cli-engine`** | `auto-refactor/` | `ar-construct`, `ar-review`, `ar-refactor`, `ar-explore` | `cd auto-refactor && npm run build && node scripts/gate-self.js && npm test` |
| **`game-engine`** | `WebGames/` | `wg-construct`, `wg-review`, `wg-refactor`, `wg-explore` | `cd WebGames && python scripts/py/audit_config.py --strict && pwsh scripts/ps1/audit-all.ps1` |
| **`git-kernel`** | `fractal-git/` | `fg-construct`, `fg-review`, `fg-refactor`, `fg-explore` | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1 && cargo test --workspace --manifest-path fractal-git/Cargo.toml` |
| **`infra-tool`** | `scripts/` | `infra-construct`, `infra-review`, `infra-refactor`, `infra-explore`, `infra-guardian` | `pwsh -File scripts/ps1/pre-commit-gate.ps1 && pwsh -File scripts/ps1/audit-all.ps1 -Fast` |
| **`workspace-meta`** | Workspace root | `workspace-review`, `workspace-refactor`, `workspace-guardian` | `node scripts/common/generate-rule-catalog.js --check-only` |
| **`skill-governance`** | `.agents/skills/` | `skill-construct`, `skill-review`, `skill-refactor` | `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check` |

---

## 3. Zero-Intersection Path Jail & Parallel Session Isolation

1. **Pairwise Disjoint Jails ($\forall i \ne j,\ \text{Jail}_i \cap \text{Jail}_j = \emptyset$)**: Concurrent write subagents (`construct`/`refactor`) must receive explicit, non-overlapping file lists; use `Workspace: "branch"` when parallelizing across top-level projects.
2. **Read-First Cadence & `mark_chapter` Checkpoints**: Follow `Explore/Review (read-only) -> Construct/Refactor (scoped write) -> Guardian (verification)`, emitting re-entrant `mark_chapter` checkpoints after major milestones.
3. **Parallel Session Mutex**: Never touch, format, or revert (`git restore .`, `git clean -fd`) files modified by external parallel sessions in `git status -s`; stage only explicit whitelist paths (`git add <files>`).
4. **5D ELOC Clamping & Interleaved Beats**: Enforce per-file micro bounds (add $\le 120/180$, del $\le 100$) and batch admission turnover ($\ge \Theta_{\text{admission}}$), committing production code (Code Beat) separately from audit snapshots (Telemetry Beat).

---

## 4. Synthesis Commands & 8-Step Parent Cross-Review

```bash
node .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js --preset fg-construct --files "fractal-git/crates/fg-index/src/lib.rs" --task "Optimize lock-free index" --json
node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js
node .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js
```
*(Pass `--intent "<natural language>"` to `synthesize-subagent.js` to route via bigram Dice similarity $\ge 0.3$ against `skill-registry.json#domains[].scenarios[]`.)*

After a SubAgent completes, the parent Agent **must** execute the **8-Step Cross-Review**:
① **Path Jail Boundary Audit** (`git status` / `git diff --name-only`) $\to$ ② **Domain Build Check** $\to$ ③ **Volume & Density Check** (`evaluate-eloc-budget.js` / `validate-code-density.js`) $\to$ ④ **Rule ID Closure** (`validate-rule-id-closure.js`) $\to$ ⑤ **Domain Architecture Guard** $\to$ ⑥ **Self-Scan Ratchet & Zero High/Critical Debt** $\to$ ⑦ **Domain Test Suite** (`auto-refactor` <!-- METRICS:BEGIN test-suite-count -->**194 套**<!-- METRICS:END test-suite-count -->, `workspace-timing` <!-- METRICS:BEGIN ws-test-case-count -->**246 项**<!-- METRICS:END ws-test-case-count -->) $\to$ ⑧ **Workspace <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count --> Audit** (`audit-all.ps1 -Fast`).

---

## 5. References & Templates

- [cross-review-closed-loop-protocol.md](references/cross-review-closed-loop-protocol.md): 4-line defense, 5-layer context priority, Path Jail disjointness & 8-step cross-review routing table.
- [task-shell-construct.md](templates/task-shell-construct.md): Write/read-only task shell & `mark_chapter` checkpoint template.
- [archetype-scaffold.json](templates/archetype-scaffold.json): Archetype & posture JSON configuration scaffold.
