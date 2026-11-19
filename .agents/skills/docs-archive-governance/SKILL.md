---
name: docs-archive-governance
description: >-
  【触发：archive/write/stale/dead/README/link/docs/specs】Maintain blueprints, milestone archives, and end-user READMEs with live relative links and zero jargon.
---

# docs-archive-governance — Blueprints, Read-Only Archives & Link Hygiene

Governs `docs/agent-native-system-blueprint.md`, frozen archives (`archive/deliverables/`, `WebGames/docs/归档库/`), 4-stage dossiers, link hygiene, and user-facing doc isolation.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[rule-catalog-governance](../rule-catalog-governance/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md) → **本技能** → [batch-commit](../batch-commit/SKILL.md)、[release-package-workflow](../release-package-workflow/SKILL.md)；并行支援 `coding-craft`、`gate-governance`、`complexity-budget`、`debugging-and-error-recovery`。
- **领域**：Skill & Rule Meta-Governance（链上第 3 步）；另 1 个领域支援；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`
- **何时联动**：Add or optimize skills, JIT references, and mirror parity → `skill-governance` + `docs-archive-governance` + `batch-commit`；Align version bumps, changelogs, and milestone archives → `release-package-workflow` + `docs-archive-governance` + `batch-commit`
<!-- SKILL-LINKS:END -->

## 1. Blueprint & Archive Governance

| Surface | Invariant |
|---|---|
| **Blueprint** (`docs/agent-native-system-blueprint.md`) | 4 pillars (Peer Cell Triad+HTN-B, Dual-Surface 3-Layer Diff, R1–R5 Distillation, Fractal Git Gate); verified contracts/Mermaid only — no debug notes, drafts, or sprint tags (`W1~W9`, `Pass 1..6`, `phase\d+`, `st\d+`) |
| **Archives** (`archive/deliverables/`, `WebGames/docs/归档库/`) | Read-only evidence: never mutate snippets/logs/conclusions; keep [archive-metadata-header.md](templates/archive-metadata-header.md) (`KALAR-DEV-YYYY-ST{NN}-{PPP}`, `PASS / LOCKED`) in first 20 lines |
| **4-Stage Dossier** | Only `阶段1_上下文分析与影响面评估.md`, `阶段2_架构拓扑与接口契约设计.md`, `阶段3_原子施工与分步实施路线.md`, `阶段4_全量验证与回归测试断言.md`; zero scratch files |

---

## 2. Link Hygiene, Metric Parity & Isolation

- **Relative Links (`DOC-LNK-001` / `HC-ABS-PATH`)**: Ban drive-letter prefixes, local file URI schemes, and absolute paths; use relative targets (e.g. [blueprint](../../../docs/agent-native-system-blueprint.md)) with live files & `#heading` anchors ([relative-link-hygiene.md](references/relative-link-hygiene.md)).
- **User Isolation & Style (`CMG-STY-001`~`004`)**: Strip internal jargon, sprint tags (`p[0-9]+`, `phase[0-9]+`, `st[0-9]+`, `temp`, `wip`; `WebGames` `fe_01`–`fe_17` exempt), and perfunctory/exaggerated/pejorative/meta-prose from `README.md`/`CHANGELOG.md`.
- **Metric Parity**: Sync `METRICS:BEGIN/END` via `sync-doc-metrics.js` and closure via `validate-metric-coverage.js`.

---

## 3. Verification

```powershell
bash scripts/sh/check-display-assets.sh && python WebGames/scripts/py/audit_docs.py
node auto-refactor/scripts/validate-docs.js
node scripts/common/validate-doc-anchors.js && node scripts/common/validate-doc-reachability.js
node scripts/common/sync-doc-metrics.js --check && node scripts/common/validate-metric-coverage.js
```
