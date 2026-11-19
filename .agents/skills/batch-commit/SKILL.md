---
name: batch-commit
description: >-
  【触发：commit/stage/fix/reject/block/git/5D/slang】Plan 6-layer atomic commits, strip forbidden prose, enforce 5D diff bounds, and run offline commit-msg gates.
---

# batch-commit — Six-Layer Topological Atomic Commit & Pre-Flight Gate Workflow

Governs bottom-up 6-layer topological commit batching, parallel session isolation, 5D ELOC differential clamping, structured commit message authoring, 6-class forbidden term interception, and offline gate pre-flight verification.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[docs-archive-governance](../docs-archive-governance/SKILL.md) → **本技能** → [constraint-driven-development](../constraint-driven-development/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`gate-governance`、`rule-catalog-governance`。
- **领域**：Parallel Delivery & Meta-Governance（领域入口）；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `workspace-meta`：`workspace-review`、`workspace-refactor`、`workspace-guardian`
- **何时联动**：Stage atomic commits alongside dirty parallel sessions → `batch-commit` + `subagent-orchestration` + `constraint-driven-development`；Diagnose commit-msg-gate or forbidden-term rejection → `batch-commit` + `rule-catalog-governance` + `gate-governance`
<!-- SKILL-LINKS:END -->

## 1. Bottom-Up Six-Layer Commit Topology

Split multi-file ($> 15$) or cross-layer edits into self-contained commits ordered L1 $\to$ L6:
**L1 Contracts/Storage** $\to$ **L2 Infra/Operators** $\to$ **L3 Config/Rules** $\to$ **L4 Domain/Views** $\to$ **L5 Quality/Tests** $\to$ **L6 Docs/Archives** (`docs`).
Commit production+tests (**Code Beat**) before audit snapshots (**Telemetry Beat**), emitting `mark_chapter` checkpoints after major layers.

---

## 2. Four-Step S-P-C-V Execution Loop

### Step 1: Staging, Session Mutex & 5D Diff Bounds (`git add <files>`)
1. **Whitelist & Mutex**: Ban `git add .`, `git add -A`, `git checkout -- .`, `git restore .`, `git clean -fd`, `git reset --hard`. Stage only current-batch Path-Jail files (`git add a.ts b.ts`); leave external dirty files in `git status -s` untouched.
2. **5D ELOC Bounds (`FGT-GAT-001`, SSOT: `scripts/common/diff-bounds-contract.json`)**:
   - **Micro**: Source add new $\le 240$, existing $\le 180$, refactor-witness $\le 260$; test add new $\le 360$, existing $\le 260$, refactor-witness $\le 380$; del plain $\le 120$, witnessed $\le 360$; substantive floor/target `0.45/0.60`, $\text{TSPR}\ge 0.40$.
   - **Macro**: Pure growth add $\le 540$, cross-file refactor add $\le 720$ (`crossFileRefactorMinDelEloc=30`, `crossFileRefactorDelRatio=0.6`), test weight `0.5x`, del $\le 360$, turnover $\ge \Theta_{\text{admission}}\in [3.0, 25.0]$ (`.taxis/telemetry/admission_ledger.ndjson`).
   - **Overflow**: Fix `FILE_ADD_OVERFLOW` / `BATCH_ADD_OVERFLOW` by extracting cohesive submodules ($240$ source / $360$ test ceiling) or splitting commits ([5d-eloc-differential-clamping-guide.md](references/5d-eloc-differential-clamping-guide.md)).

### Step 2: Author Message & Pre-Flight (`commit-msg-gate`)
1. **Header & Body**: `<type>(<scope>): <imperative summary>` (`feat|fix|refactor|docs|test|chore|style|perf|ci|build`; $15\text{–}80$ chars, subject $10\text{–}70$, ASCII `): `, no `.`, BOM, or emoji). First section `[Project]` (`CMG-PRJ-001`: `workspace-timing | auto-refactor | WebGames | fractal-git | governance`), `[Why]` ($\ge 15$), `[Verification]` ($\ge 12$, qualitative only), plus `[Added]`/`[Fixed]` ($\ge 12$)/`[Changed]`/`[Breaking Changes]`; `- ` bullets $\ge 8$, body $\ge 30$ chars.
2. **Forbidden Styles (`CMG-STY-001`~`008` & `RCFG-RULE-DRIFT`)**:

| Rule ID | Category | Blocked Examples | Requirement |
| :--- | :--- | :--- | :--- |
| `CMG-STY-001` | Sprint / Wip | `wip`, `temp`, `tmp`, `phase2`, `sprint 3`, `st7`, `w3`, `pass 2` | Exact technical scope & invariants |
| `CMG-STY-002` | Exaggeration | `100%`, `perfect`, `ultimate`, `industrial-grade` | Concrete mechanisms & edge cases |
| `CMG-STY-003` | Pejorative | `useless code`, `broken beyond repair` | Objective technical root cause |
| `CMG-STY-004` | Meta-Prose | Notes on prose tone or removing hype | Describe code/doc changes directly |
| `CMG-STY-005` | Log Dump | `exit code 0`, `returned 0`, `all checks green` | Falsifiable behavioral assertions |
| `CMG-STY-006` | Raw Counts | `146 tests passed`, `50.8s`, `419 files`, `98%` | Zero digits/% in `[Verification]` |

   - Enforce `CMG-STY-008` (no `I`/`we`/`my`/`our`; `"disk read/write"`, not `I/O`) and `RCFG-RULE-DRIFT` (`scripts/common/rule-catalog.json`). Run `pwsh -File scripts/ps1/commit-msg-gate.ps1 "$dir\commit_batch_N.txt"`.

### Step 3: Hygiene & Commit (`pre-commit-gate` $\to$ `git commit`)
Run `pwsh -File scripts/ps1/pre-commit-gate.ps1` headlessly (`GUARD-AST-001`: flatten $\text{CC}>15$ / $\text{Depth}>4$, re-stage, re-run). Commit via `git commit -F "$dir\commit_batch_N.txt"` (never `--no-verify`), then `pwsh -File scripts/ps1/audit-all.ps1`. Keep `CHANGELOG.md`/`README.md` jargon-free.

---

## 3. Templates & Reference Guides

- [commit-template-standard.txt](templates/commit-template-standard.txt): Standard structured commit message template.
- [forbidden-terms-guide.md](references/forbidden-terms-guide.md): Forbidden vocabulary & qualitative assertion guide.
- [5d-eloc-differential-clamping-guide.md](references/5d-eloc-differential-clamping-guide.md): 5D ELOC differential clamping & module deconstruction guide.
