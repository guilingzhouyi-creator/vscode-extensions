---
name: docs-archive-governance
description: >-
  【触发：文档归档/蓝图/架构演进/README/归档清单/死链/案卷封存】编写、修改顶层架构蓝图、交付物归档、案卷封存或全宗技术档案时触发。维护 agent-native-system-blueprint 与纯正面向用户标准。
---

# docs-archive-governance — Blueprint Evolution, Read-Only Archives & Link Hygiene

Governs the autonomous system blueprint (`docs/agent-native-system-blueprint.md`), read-only historical archive freeze rules (`archive/deliverables/`, `WebGames/docs/归档库/`), 4-stage design dossier structure, Markdown link hygiene, and user-facing documentation isolation.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[rule-catalog-governance](../rule-catalog-governance/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md) → **本技能** → [batch-commit](../batch-commit/SKILL.md)、[release-package-workflow](../release-package-workflow/SKILL.md)；并行支援 `coding-craft`、`gate-governance`、`complexity-budget`、`debugging-and-error-recovery`。
- **领域**：技能与规则元治理（链上第 3 步）；另 1 个领域支援；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`
- **何时联动**：新增技能或改技能描述 → `skill-governance` + `docs-archive-governance` + `batch-commit`；发版日志与版本号对齐 → `release-package-workflow` + `docs-archive-governance` + `batch-commit`
<!-- SKILL-LINKS:END -->

## 1. System Blueprint Evolution (`docs/agent-native-system-blueprint.md`)

1. **Four Pillars**: ① Peer Cell Triad (Builder, Tester, Reviewer with HTN-B dispatch); ② Dual-Surface 3-Layer Topological Diff; ③ R1–R5 Memory Distillation Pipeline; ④ Fractal Git Gate Topology.
2. **Architectural Purity**: Record only verified architectural contracts, state machines, and Mermaid topologies; never write debugging notes, conversational drafts, or agile sprint codenames (`W1~W9`, `Pass 1..6`, `phase\d+`, `st\d+`).

---

## 2. Read-Only Archive Freeze & Dossier Metadata

1. **Historical Freeze Rule (`archive/deliverables/`, `WebGames/docs/归档库/`)**: Archived dossiers are immutable historical evidence. **Never** alter code snippets, logs, or conclusions inside archived dossiers to silence new linter rules.
2. **Archive Metadata Header** (within first 20 lines; see [archive-metadata-header.md](templates/archive-metadata-header.md)):
   ```markdown
   # {Dossier Title}

   > 档号: KALAR-DEV-YYYY-ST{NN}-{PPP}
   > 验收状态: PASS / LOCKED
   > 归档时间: YYYY-MM-DD
   > 密级: 内部技术档案（只读存证，严禁擅自修改已验收历史断言）
   ```
3. **4-Stage Design Dossier Layout**: Active feature/refactoring plan directories must contain only the 4 canonical files (`阶段1_上下文分析与影响面评估.md`, `阶段2_架构拓扑与接口契约设计.md`, `阶段3_原子施工与分步实施路线.md`, `阶段4_全量验证与回归测试断言.md`) with zero ad-hoc scratch files.

---

## 3. Markdown Link Hygiene & User-Facing Isolation

1. **Relative Link Hygiene (`DOC-LNK-001` / `HC-ABS-PATH`)**:
   - Forbid Windows drive letters (`c:/...`), `file:///`, or machine-absolute paths inside repository `.md` files; use valid relative paths (e.g., [blueprint](../../../docs/agent-native-system-blueprint.md)).
   - Every linked file and `#heading` anchor must resolve on disk ([relative-link-hygiene.md](references/relative-link-hygiene.md)).
2. **User-Facing Isolation & Style Honesty**:
   - Keep user-facing documents (root `README.md`, extension `README.md`, `CHANGELOG.md`) free of internal refactoring jargon (e.g., trampoline ablation, AST slice complexity, RingBuffer dual-write) and sprint codenames (`p[0-9]+`, `phase[0-9]+`, `st[0-9]+`, `temp`, `wip`; `WebGames` views `fe_01`–`fe_17` exempt).
   - Enforce `CMG-STY-001`~`004` (zero perfunctory, exaggerated, pejorative, or meta-narrative prose).

---

## 4. Verification Commands

```powershell
bash scripts/sh/check-display-assets.sh
python WebGames/scripts/py/audit_docs.py
node auto-refactor/scripts/validate-docs.js
node scripts/common/validate-doc-anchors.js
node scripts/common/validate-doc-reachability.js
```
