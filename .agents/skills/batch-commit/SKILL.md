---
name: batch-commit
description: >-
  【触发：提交/分批/暂存/commit/git/预审/禁词/原子提交】当准备提交代码、分批原子提交或审查 git commit 信息时必须使用。按 6 层拓扑拆解提交，拦截 6 类黑话禁词，执行离线门禁预审与原子提交闭环。
---

# batch-commit — Six-Layer Topological Atomic Commit & Pre-Flight Gate Workflow

Governs bottom-up 6-layer topological commit batching, parallel session isolation, 5D ELOC differential clamping, structured commit message authoring, 6-class forbidden term interception, and offline gate pre-flight verification.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[docs-archive-governance](../docs-archive-governance/SKILL.md) → **本技能** → [constraint-driven-development](../constraint-driven-development/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`gate-governance`、`rule-catalog-governance`。
- **领域**：工作区元治理与并行交付（领域入口）；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `workspace-meta`：`workspace-review`、`workspace-refactor`、`workspace-guardian`
- **何时联动**：并行会话改动混杂需要精准暂存 → `batch-commit` + `subagent-orchestration` + `constraint-driven-development`；提交信息被门禁拦下 → `batch-commit` + `rule-catalog-governance` + `gate-governance`
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
1. **Header Grammar**: `<type>(<scope>): <Chinese imperative summary>` (`type` $\in$ `feat|fix|refactor|docs|test|chore|style|perf|ci|build`; total length $15 \sim 80$ chars, subject $10 \sim 70$ chars; ASCII `(` `)` and `): `; no trailing `.`/`。`; no BOM/zero-width chars; no emoji).
2. **Mandatory Sections & Lengths**:
   - First section `[Project]` (`CMG-PRJ-001`): `- <workspace-timing | auto-refactor | WebGames | fractal-git | governance>`
   - `[Why]` ($\ge 15$ non-whitespace chars), `[Verification]` ($\ge 12$ non-whitespace chars, qualitative assertions only), plus `[Added]` (`feat`), `[Fixed]` ($\ge 12$ chars, `fix`), `[Changed]` (`refactor`/`perf`), or `[Breaking Changes]` (`!`).
   - Use ASCII brackets `[...]` and `- ` bullets ($\ge 8$ chars each), separated by single blank lines; total body $\ge 30$ non-whitespace chars.
3. **Six Forbidden Style Classes & Rule Closure**:

| Rule ID | Category | Blocked Examples | Requirement |
| :--- | :--- | :--- | :--- |
| `CMG-STY-001` | Perfunctory / Sprint Codenames | `wip`, `temp`, `tmp`, `暂存`, `临时方案`, `phase2`, `sprint 3`, `st7`, `w3`, `pass 2` | State exact technical scope and invariants |
| `CMG-STY-002` | Exaggeration | `绝对`, `彻底解决`, `完美`, `100%`, `工业级`, `案卷施工`, `规则金字塔` | State concrete mechanisms and boundary cases |
| `CMG-STY-003` | Pejorative | `垃圾`, `一团糟`, `烂代码`, `useless code`, `broken beyond repair` | State objective technical root cause |
| `CMG-STY-004` | Meta-Narrative | `低调中肯`, `求真务实`, `移除宣扬性词汇`, `风格升级`, `全部PASS` | Describe code/doc changes directly |
| `CMG-STY-005` | Procedural Log Dump | `退出码0`, `双端返回0`, `正常状态`, `运行完成`, `无报错` | State falsifiable behavioral assertions in `[Verification]` |
| `CMG-STY-006` | Raw Execution Counts | `通过146套测试`, `耗时50.8s`, `419个文件`, `覆盖率98%` | Zero Arabic numerals/percentages in `[Verification]` |

   - Also enforce `CMG-STY-008` (no first-person pronouns `I`/`we`/`my`/`our`; write `输入输出` instead of `I/O` in Chinese prose) and `RCFG-RULE-DRIFT` (every rule ID must exist in `scripts/common/rule-catalog.json`).
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
