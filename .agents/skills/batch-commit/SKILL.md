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

Split multi-file ($> 15$ files) or cross-layer changes into self-contained, independently compilable commits ordered from L1 to L6:
1. **Batch L1 (Contracts & Storage)**: Types, schemas, persistence protocols (`feat`/`refactor`).
2. **Batch L2 (Infrastructure & Operators)**: Pools, native operators, runtime primitives (`feat`/`refactor`).
3. **Batch L3 (Config & Rule Catalogs)**: Config tables, SSOT rule catalogs (`feat`/`refactor`).
4. **Batch L4 (Domain & Views)**: Business logic, analyzers, UI views (`feat`/`refactor`).
5. **Batch L5 (Quality & Tests)**: Unit/regression suites, density/complexity tuning (`test`/`refactor`).
6. **Batch L6 (Documentation & Archives)**: Architecture specs, skills, blueprints (`docs`).

- **Code Beat vs. Telemetry Beat**: Commit production code first (Code Beat), then commit audit snapshots/telemetry separately (Telemetry Beat). Record `mark_chapter` checkpoints (Commit SHA, passed suites, remaining batches) after major layers.

---

## 2. Four-Step S-P-C-V Execution Loop

### Step 1: Explicit Whitelist Staging & Parallel Session Isolation (`git add <files>`)
1. **Explicit File List**: Never run `git add .` or `git add -A`. Stage only files belonging to the current batch and within the current session's Path Jail (`git add path/to/a.ts path/to/b.ts`).
2. **Parallel Session Isolation**: Treat any modified/untracked files outside your task scope in `git status -s` as active parallel sessions — zero touch, zero formatting, zero cleanup. **Never** run `git checkout -- .`, `git restore .`, `git clean -fd`, or `git reset --hard`.
3. **5D ELOC Differential Clamping (`FGT-GAT-001`)**:
   - **Per-File Micro Envelope**: New file $E_{\text{add}} \le 360.0$ 5D ELOC; existing file $E_{\text{add}} \le 120.0$ (or $\le 180.0$ with $\ge 10$ lines refactored deletion); deletion $E_{\text{del}} \le 100.0$ (max $280.0$ with refactoring witness); substantive ratio $\ge 0.60$, $\text{TSPR} \ge 0.40$.
   - **Batch Macro Envelope**: $\sum E_{\text{add}} \le 360.0$ 5D ELOC, $\sum E_{\text{del}} \le 280.0$ 5D ELOC, turnover $\sum E_{\text{add}} + 0.8 \sum E_{\text{del}} \ge \Theta_{\text{admission}} \in [3.0, 25.0]$ 5D ELOC.
   - **Overflow Deconstruction**: Resolve `FILE_ADD_OVERFLOW` or `BATCH_ADD_OVERFLOW` by extracting cohesive algorithms into dedicated submodules (each new file receives a $360.0$ quota) or splitting commits; never lower gate thresholds. See [5d-eloc-differential-clamping-guide.md](references/5d-eloc-differential-clamping-guide.md).

### Step 2: Author Commit Message & Run Offline Pre-Flight (`commit-msg-gate`)
1. **Header Grammar**: `<type>(<scope>): <imperative summary>` (`type` $\in$ `feat|fix|refactor|docs|test|chore|style|perf|ci|build`; total length $15 \sim 80$ chars, subject $10 \sim 70$ chars; ASCII `(` `)` and `): `; no trailing `.`; no BOM/zero-width chars; no emoji).
2. **Mandatory Sections & Lengths**:
   - First section `[Project]` (`CMG-PRJ-001`): `- <workspace-timing | auto-refactor | WebGames | fractal-git | governance>`
   - `[Why]` ($\ge 15$ non-whitespace chars), `[Verification]` ($\ge 12$ non-whitespace chars, qualitative assertions only), plus `[Added]` (`feat`), `[Fixed]` ($\ge 12$ chars, `fix`), `[Changed]` (`refactor`/`perf`), or `[Breaking Changes]` (`!`).
   - Use ASCII brackets `[...]` and `- ` bullets ($\ge 8$ chars each), separated by single blank lines; total body $\ge 30$ non-whitespace chars.
3. **Six Forbidden Style Classes & Rule Closure**:

| Rule ID | Category | Blocked Examples | Requirement |
| :--- | :--- | :--- | :--- |
| `CMG-STY-001` | Perfunctory / Sprint Codenames | `wip`, `temp`, `tmp`, `phase2`, `sprint 3`, `st7`, `w3`, `pass 2` | State exact technical scope and invariants |
| `CMG-STY-002` | Exaggeration | `100%`, `perfect`, `ultimate`, `industrial-grade`, hype labels | State concrete mechanisms and boundary cases |
| `CMG-STY-003` | Pejorative | `useless code`, `broken beyond repair`, derogatory remarks | State objective technical root cause |
| `CMG-STY-004` | Meta-Narrative | Claims about adjusting prose tone or removing hype words | Describe code/doc changes directly |
| `CMG-STY-005` | Procedural Log Dump | `exit code 0`, `returned 0`, `all checks green` | State falsifiable behavioral assertions in `[Verification]` |
| `CMG-STY-006` | Raw Execution Counts | `146 tests passed`, `50.8s`, `419 files`, `98% coverage` | Zero Arabic numerals/percentages in `[Verification]` |

   - Also enforce `CMG-STY-008` (no first-person pronouns `I`/`we`/`my`/`our`; write `"disk read/write"` instead of `I/O`) and `RCFG-RULE-DRIFT` (every rule ID must exist in `scripts/common/rule-catalog.json`).
4. **Pre-Flight Check**:
   ```powershell
   pwsh -File scripts/ps1/commit-msg-gate.ps1 "$dir\commit_batch_N.txt"
   ```

### Step 3: Staged Hygiene & AST Slice Pre-Flight (`pre-commit-gate`)
```powershell
pwsh -File scripts/ps1/pre-commit-gate.ps1
```
If `GUARD-AST-001` (`CC > 15` or `Depth > 4`) fires, flatten branches with early guard returns or extract pure helper predicates, re-stage via `git add <file>`, and re-run. All gate subprocesses must run headlessly without stealing GUI focus.

### Step 4: Atomic Commit & Final Regression (`git commit`)
```powershell
git commit -F "$dir\commit_batch_N.txt"
pwsh -File scripts/ps1/audit-all.ps1
```
Never pass `--no-verify`. Keep user-facing `CHANGELOG.md` / `README.md` isolated from internal engineering commit jargon.

---

## 3. Templates & Reference Guides

- [commit-template-standard.txt](templates/commit-template-standard.txt): Standard structured commit message template.
- [forbidden-terms-guide.md](references/forbidden-terms-guide.md): Forbidden vocabulary & qualitative assertion guide.
- [5d-eloc-differential-clamping-guide.md](references/5d-eloc-differential-clamping-guide.md): 5D ELOC differential clamping & module deconstruction guide.
