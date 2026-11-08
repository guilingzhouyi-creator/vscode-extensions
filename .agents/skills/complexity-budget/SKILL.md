---
name: complexity-budget
description: >-
  【触发：重构/拆分文件/CC/Depth/ELOC/LOC/JSDoc/注水】重构大文件、优化认知复杂度(CC<=15)、缩减嵌套深度(Depth<=4)或检查体积包络(ELOC<=900)时触发。落实六字段 JSDoc 契约与循环零堆分配。
---

# complexity-budget — AST Complexity, Dual-Track Volume & Comment Density Contract

Defines per-function AST slice budgets, control-flow flattening patterns, dual-track volume envelopes (`ELOC`/`LOC`), 6-field JSDoc module headers, ECR comment density, algorithm fallback bounds, and zero loop heap allocation.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `coding-craft`、`constraint-driven-development`、`debugging-and-error-recovery`、`test-benchmark-engineering`。
- **领域**：另 6 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：消融纯转发跳板与参数收敛 → `auto-refactor-dev` + `facade-discipline` + `complexity-budget`；热路径循环里出现对象分配 → `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 1. Per-Function AST Slice Budgets (`GUARD-AST-001`)

| Metric | Rigid Limit | Elastic Envelope | Remediation Pattern |
| :--- | :---: | :--- | :--- |
| **Cyclomatic / Cognitive Complexity (`CC`)** | $\text{CC} \le 15$ | • Flat loop-free `if/switch` dispatchers ($\text{Depth} \le 2$): $\text{CC} \le 25$<br/>• File-private pure functions ($\text{Depth} \le 3$, loop-free): $\text{CC} \le 18\text{–}20$ (exported API locked at $\le 15$)<br/>• `*archetype*` & `*.test.ts`: $\text{CC} \le 20$ | Extract pure helper predicates; replace cascading branches with frozen `Map` / lookup tables ([control-flow-flattening-patterns.md#三-策略映射表替代级联分支-strategy-map-dispatch](references/control-flow-flattening-patterns.md#三-策略映射表替代级联分支-strategy-map-dispatch)) |
| **Control-Flow Nesting (`Depth`)** | $\text{Depth} \le 4$ | Target $\text{Depth} \le 2\text{–}3$; $\text{Depth} > 4$ is blocked workspace-wide (`CPX-NEST-001`) | Flatten via early guard returns (`return`/`continue`/`break`) ([control-flow-flattening-patterns.md#一-卫语句提前返回-guard-clauses](references/control-flow-flattening-patterns.md#一-卫语句提前返回-guard-clauses)) and extract loop-body `try-catch` into pure parsers ([control-flow-flattening-patterns.md#二-复杂数据管道与日志解析解耦](references/control-flow-flattening-patterns.md#二-复杂数据管道与日志解析解耦), [flat-control-flow-patterns.ts](templates/flat-control-flow-patterns.ts)) |
| **Single-Line Token Noise (`Noise`)** | $\text{Noise} \le 4.0$ | Ratio of non-identifier chars to identifier chars on non-blank code lines $\le 4.0$ | Extract named intermediate constants; eliminate nested ternaries and inline regex chains |

---

## 2. Dual-Track Volume, 1:3 Dynamic Envelope & 5D Code Density

1. **Absolute Ceilings (`evaluate-eloc-budget.js`)**: Effective code lines $\text{ELOC} \le 900$; physical lines $\text{LOC} \le 1400$.
2. **1:3 Bidirectional Dynamic Envelope ([dynamic-envelope-cheatsheet.md](references/dynamic-envelope-cheatsheet.md))**:
   - **Forward Physical Ceiling**: $\text{LOC}_{\text{max}} = \min(1400, \max(150, \lceil \text{ELOC} \times 3.0 \rceil))$.
   - **Reverse Semantic Floor**: When $\text{LOC} \ge 250$, require $\text{ELOC} \ge \lfloor \text{LOC} / 3.0 \rfloor$ ($\ge 33.3\%$ code density).
   - **High-Load Comment Floor**: When $\text{ELOC} \ge 600$, require $\text{Comments} / \text{LOC} \ge 0.08$ ($\ge 8\%$).
   - **Cohesion Preservation**: Never mechanically fragment cohesive modules already within $\text{ELOC} \le 900, \text{LOC} \le 1400$ into tiny 50-line files; prioritize eliminating loop allocations (`CPX-SPACE-001`).
3. **5D Code Density & Plumbing Overhead (`validate-code-density.js`)**:
   - **Token Density ($\tau = \text{tokens} / \text{ELOC}$)**: Floor $\tau \ge 2.5$ (`VOL-DIL-001`, blocks vertical line-splitting sprawl); ceiling $\tau \le 22.0$ (`GUARD-AST-001`, blocks dense one-liners).
   - **Plumbing Overhead & Payload (`ARCH-FAC-001`)**: $\text{POR} \le 0.60$, $\text{TSPR} \ge 0.40$ (`index.*`, `*.d.ts`, `constants.*` exempt).
   - **Role Envelopes**: `algorithm_computation` ($\text{ELOC} \le 1100, \text{LOC} \le 1500, \text{CC} \le 20$); `rules_registry` ($\text{ELOC} \le 2000, \text{LOC} \le 3000$); `shared_library` ($\text{ELOC} \le 450, \text{LOC} \le 600$).

---

## 3. Six-Field JSDoc Header, ECR Comment Model & Algorithm Bounds

1. **6-Field Module Header**: Core modules (`src/**`, operators, facades, scripts) must start with a JSDoc block containing: `Module`, `File Path`, `Architecture Role`, `Dependencies & Triggers`, `Responsibilities` (numbered 1–4), and `Design Rationale` (or `Exit Semantics & Design Rationale`).
2. **Effective Comment Ratio (`ECR = max(0, sum(w_i)) / totalCommentLines`)**:
   - Weights: `DESIGN_RATIONALE` / `ARCHITECTURE_INTENT` / `ALGORITHMIC_PROOF` (`+1.0`), `LIFECYCLE_OWNERSHIP` / `INVARIANT_BOUNDARY` (`+0.9`), `API_CONTRACT` (`+0.8`), `TRIVIAL_TRANSLATION` / `BEHAVIOR_ECHO` (`0.0 / -0.2`), `WATER_LOGGING` (`-0.5`).
   - When `totalCommentLines >= 5`, $\text{ECR} < 0.40$ or $\ge 2$ `WATER_LOGGING` lines triggers `GOV-GAM-001`. Forbid ghost-branch comments and sprint codenames (`W1~W9`, `Pass 1..6`, `Sprint 3`).
3. **Algorithm Degradation Bounds**: Non-trivial operators (Myers Diff, AST walkers, solvers) must document worst-case complexity, fallback thresholds (e.g., Myers fallback to `histogramDiff` when $\max(\text{midN} + \text{midM}) > 1500$ or matrix $> 2\times 10^6$), and buffer length invariants (`hashA.length === a.length`).

---

## 4. Zero Loop Heap Allocation (`CPX-SPACE-001` / `ADV-PRF-002` / `PRF-MEM-001`) & Anti-Gaming

1. **8 Zero-Allocation Rules in Hot Loops**: ① Hoist closures/object literals outside loops; ② preallocate `Float64Array`/`Int32Array` buffers; ③ accumulate strings via array `.push()` + post-loop `.join('\n')`; ④ iterate `Map`/`Set` directly without `[...map.entries()]`; ⑤ pool stateful objects with `resetState()` / `reset_state()`; ⑥ use cursor index `queue[head++]` instead of `Array.shift()`; ⑦ reuse `cachedLines` instead of repeated `.split('\n')`; ⑧ hoist regexes to module-level `const RE_*` (`PRF-MEM-001`).
2. **Anti-Gaming Circuit Breaker (`BLOCK_GAMING_DETECTED` / `GOV-GAM-001`)**: Refactoring commits with $\text{ELOC}_{\text{semantic}} \le 15\%$ and zero net technical debt elimination are blocked.

---

## 5. Verification Commands

```powershell
node scripts/common/evaluate-eloc-budget.js
node auto-refactor/scripts/validate-comment-governance.js
pwsh -File scripts/ps1/pre-commit-gate.ps1
node scripts/common/validate-code-density.js --all
```
